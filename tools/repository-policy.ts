import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { parse } from 'yaml';

export interface Finding { readonly file: string; readonly rule: string; readonly detail: string }

const boundaries: Readonly<Record<string, readonly string[]>> = {
  policy: ['policy', 'domain'],
  domain: ['domain'],
  repositories: ['repositories', 'domain', 'db'],
  services: ['services', 'policy', 'domain', 'repositories', 'db'],
  api: ['api', 'services', 'domain'],
  db: ['db', 'domain'],
  config: ['config']
};

export function inspectSource(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const group = file.replaceAll('\\', '/').split('/')[1];
  const pure = group === 'policy';
  const add = (rule: string, detail: string) => findings.push({ file, rule, detail });
  const checkImport = (specifier: string) => {
    if (pure && !specifier.startsWith('.')) add('pure-policy', `External dependency: ${specifier}`);
    if (specifier.startsWith('.')) {
      const target = relative('src', resolve(dirname(file), specifier)).replaceAll('\\', '/').split('/')[0];
      const allowed = group ? boundaries[group] : undefined;
      if (allowed && (!target || !allowed.includes(target))) add('dependency-boundary', `${group} imports ${specifier}`);
    }
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      checkImport(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      add('static-imports', 'Use static imports so dependency boundaries remain inspectable.');
    }
    if (pure && ts.isIdentifier(node) && ['process', 'fetch', 'Date', 'console', 'performance', 'crypto', 'setTimeout', 'setInterval', 'globalThis', 'global', 'Reflect', 'Function', 'eval'].includes(node.text)) {
      add('pure-policy', `Ambient effect or clock: ${node.text}`);
    }
    if (pure && ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'Math' && node.name.text === 'random') {
      add('pure-policy', 'Randomness must be an explicit input.');
    }
    if (pure && ts.isIdentifier(node) && node.text === 'Math' &&
      !((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node)) {
      add('pure-policy', 'Math cannot escape as a value or alias. Use a named deterministic operation.');
    }
    if (pure && ts.isElementAccessExpression(node) && node.expression.getText(source) === 'Math' &&
      (!ts.isStringLiteral(node.argumentExpression) || node.argumentExpression.text === 'random')) {
      add('pure-policy', 'Indexed Math access can hide randomness. Use a named deterministic operation.');
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      add('type-safety', 'Use validated types and narrowing instead of an unchecked assertion.');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function inspectWorkflow(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, detail: string) => findings.push({ file, rule, detail });
  const parsed: unknown = parse(text);
  if (!record(parsed) || !record(parsed.jobs)) return [{ file, rule: 'workflow-schema', detail: 'Workflow must contain jobs.' }];
  const triggers = parsed.on;
  const target = typeof triggers === 'string' ? triggers === 'pull_request_target'
    : Array.isArray(triggers) ? triggers.includes('pull_request_target')
      : record(triggers) && 'pull_request_target' in triggers;
  if (!record(parsed.permissions) || parsed.permissions.contents !== 'read') {
    add('workflow-permissions', 'Declare contents: read at workflow scope.');
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!record(value)) return;
    if (typeof value.uses === 'string' && !value.uses.startsWith('./') && !/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/.test(value.uses)) {
      add('action-pinning', `Pin the action by commit: ${value.uses}`);
    }
    if (typeof value.run === 'string' && /\$\{\{\s*github\.event\.(pull_request|issue|comment)/.test(value.run)) {
      add('untrusted-input', 'Pass event data through environment variables or a JSON event file.');
    }
    if (target && typeof value.uses === 'string' && value.uses.startsWith('actions/checkout@')) {
      const options = value.with;
      if (!record(options) || options.ref !== '${{ github.event.repository.default_branch }}' || options['persist-credentials'] !== false) {
        add('trusted-checkout', 'Privileged workflows must check out only the default branch without persistent credentials.');
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(parsed);
  return findings;
}

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (['.git', 'node_modules', 'dist', 'artifacts', 'coverage'].includes(entry.name)) return [];
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

export function inspectRepository(root: string): Finding[] {
  const findings: Finding[] = [];
  const required = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SUPPORT.md', 'PROGRESS.md', 'CONTEXT.md', 'package-lock.json', '.node-version', 'docs/AI-CONTRIBUTIONS.md', '.github/PULL_REQUEST_TEMPLATE.md'];
  for (const name of required) if (!existsSync(join(root, name))) findings.push({ file: name, rule: 'required-document', detail: 'Required repository document is absent.' });
  for (const path of files(root)) {
    const file = relative(root, path).replaceAll('\\', '/');
    const text = readFileSync(path, 'utf8');
    if (file.startsWith('src/') && extname(file) === '.ts') findings.push(...inspectSource(file, text));
    if (file.startsWith('.github/workflows/') && /\.ya?ml$/.test(file)) findings.push(...inspectWorkflow(file, text));
    if (extname(file) === '.md') {
      if (text.includes('\u2014')) findings.push({ file, rule: 'plain-punctuation', detail: 'Replace em dashes with periods or commas.' });
      const prose = text.replace(/```[\s\S]*?```/g, '');
      for (const match of prose.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        const href = match[1]?.split('#')[0]?.replace(/^<|>$/g, '');
        if (href && !/^(?:[a-z]+:|\/)/i.test(href) && !existsSync(resolve(dirname(path), decodeURIComponent(href)))) {
          findings.push({ file, rule: 'local-link', detail: `Missing link target: ${href}` });
        }
      }
    }
  }
  const instructions = join(root, 'AGENTS.md');
  if (existsSync(instructions) && readFileSync(instructions, 'utf8').split('\n').length > 100) {
    findings.push({ file: 'AGENTS.md', rule: 'instruction-size', detail: 'Move topic details into linked documents.' });
  }
  return findings;
}

export function selftest(): void {
  const bad = inspectSource('src/policy/priority.ts', 'export const priority = () => Date.now();');
  const good = inspectSource('src/policy/priority.ts', 'export const priority = (hazard: boolean) => hazard ? "CRITICAL" : "LOW";');
  if (!bad.some(finding => finding.rule === 'pure-policy') || good.length !== 0) throw new Error('Policy gate selftest failed.');
  process.stdout.write('Selftest passed: valid policy accepted and ambient clock rejected.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--selftest')) selftest();
  else {
    const findings = inspectRepository(process.cwd());
    for (const finding of findings) process.stderr.write(`${finding.file}: ${finding.rule}: ${finding.detail}\n`);
    process.exitCode = findings.length ? 1 : 0;
    if (!findings.length) process.stdout.write('Repository policies passed.\n');
  }
}
