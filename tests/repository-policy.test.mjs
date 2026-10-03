import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectSource, inspectWorkflow, selftest } from '../dist/tools/repository-policy.js';

test('pure decision with explicit facts is accepted', () => {
  assert.deepEqual(inspectSource('src/policy/priority.ts', 'export const decide = (hazard: boolean) => hazard ? "CRITICAL" : "LOW";'), []);
});

for (const [name, source, rule] of [
  ['clock', 'export const now = Date.now();', 'pure-policy'],
  ['network', 'export const result = fetch("https://example.com");', 'pure-policy'],
  ['external dependency', 'import { x } from "effect";', 'pure-policy'],
  ['database import', 'import { x } from "../db/Pg.js";', 'dependency-boundary'],
  ['re-exported database', 'export { x } from "../db/Pg.js";', 'dependency-boundary'],
  ['dynamic dependency', 'const x = import("../db/Pg.js");', 'static-imports'],
  ['unchecked cast', 'const x = unknownValue as string;', 'type-safety'],
  ['any', 'const x: any = 1;', 'type-safety'],
  ['random', 'export const x = Math.random();', 'pure-policy'],
  ['indexed random', 'export const x = Math["random"]();', 'pure-policy'],
  ['ambient escape', 'export const x = globalThis["Date"].now();', 'pure-policy'],
  ['Node ambient escape', 'export const x = global["Date"].now();', 'pure-policy'],
  ['aliased random', 'const math = Math; export const x = math.random();', 'pure-policy'],
  ['destructured random', 'const { random } = Math; export const x = random();', 'pure-policy']
]) test(`policy gate rejects ${name}`, () => {
  assert.ok(inspectSource('src/policy/priority.ts', source).some(finding => finding.rule === rule));
});

test('domain import is permitted for a pure policy', () => {
  assert.deepEqual(inspectSource('src/policy/priority.ts', 'import type { Facts } from "../domain/Facts.js";'), []);
});

test('workflow gate rejects unpinned actions and event interpolation', () => {
  const source = 'permissions:\n  contents: read\non: pull_request\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo "${{ github.event.pull_request.title }}"\n';
  assert.deepEqual(inspectWorkflow('ci.yml', source).map(finding => finding.rule).sort(), ['action-pinning', 'untrusted-input']);
});

test('privileged workflow rejects a PR checkout', () => {
  const source = 'permissions:\n  contents: read\non:\n  pull_request_target:\n    types: [opened]\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          ref: "${{ github.event.pull_request.head.sha }}"\n';
  assert.ok(inspectWorkflow('issues.yml', source).some(finding => finding.rule === 'trusted-checkout'));
});

for (const trigger of ['pull_request_target', '[pull_request_target]']) {
  test(`privileged workflow rejects PR checkout with trigger ${trigger}`, () => {
    const source = `permissions:\n  contents: read\non: ${trigger}\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          ref: "\${{ github.event.pull_request.head.sha }}"\n`;
    assert.ok(inspectWorkflow('issues.yml', source).some(finding => finding.rule === 'trusted-checkout'));
  });
}

test('built maintenance selftest runs', () => selftest());

test('CLI denies an invalid policy and accepts the repaired checkout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'voiceops-gate-'));
  try {
    cpSync(process.cwd(), directory, { recursive: true, filter: source => !/(?:^|[/\\])(?:\.git|node_modules|dist|artifacts|coverage)(?:[/\\]|$)/.test(source) });
    const policy = join(directory, 'src/policy/probe.ts');
    mkdirSync(join(directory, 'src/policy'), { recursive: true });
    writeFileSync(policy, 'export const now = Date.now();\n');
    const cli = resolve('dist/tools/repository-policy.js');
    const denied = spawnSync(process.execPath, [cli], { cwd: directory, encoding: 'utf8' });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /src\/policy\/probe\.ts: pure-policy: Ambient effect or clock: Date/);
    writeFileSync(policy, 'export const decide = (hazard: boolean) => hazard ? "CRITICAL" : "LOW";\n');
    const accepted = spawnSync(process.execPath, [cli], { cwd: directory, encoding: 'utf8' });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /Repository policies passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
