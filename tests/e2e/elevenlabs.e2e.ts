import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { test, expect } from 'e2e';
import { Schema } from 'effect';
import { AssetContext, Prepared, ConfirmationResult } from '../../src/domain/models.js';
import { MissingRecord } from '../../src/domain/errors.js';
import { assess } from '../../src/policy/maintenance.js';

const execute = promisify(execFile);
const command = resolve('tools/elevenlabs.mjs');
const cleaner = resolve('tools/clean.mjs');
const output = resolve('artifacts/e2e');
const env = { ...process.env, VOICEOPS_PUBLIC_URL: 'https://voiceops.example.com', ELEVENLABS_TOOL_SECRET_ID: 'offline_secret_locator', ELEVENLABS_API_KEY: '' };
const toolNames = ['get_maintenance_context', 'prepare_work_order', 'confirm_work_order'];
const Mock = Schema.Struct({ is_error: Schema.Boolean, mock_result: Schema.String });
const Bundle = Schema.Struct({
  tools: Schema.Array(Schema.Struct({ tool_config: Schema.Struct({ name: Schema.String, follow_redirects: Schema.Boolean, api_schema: Schema.Struct({ method: Schema.String, url: Schema.String, request_headers: Schema.Record(Schema.String, Schema.Struct({ secret_id: Schema.String })) }) }) })),
  agent: Schema.Struct({ conversation_config: Schema.Struct({ agent: Schema.Struct({ prompt: Schema.Struct({ prompt: Schema.String, tool_ids: Schema.Array(Schema.String), enable_parallel_tool_calls: Schema.Boolean }) }) }) }),
  tests: Schema.Array(Schema.Struct({ key: Schema.String, request: Schema.Struct({
    type: Schema.Literal('simulation'), success_conditions: Schema.Array(Schema.String),
    tool_mock_config: Schema.Struct({ mocking_strategy: Schema.Literal('all'), fallback_strategy: Schema.Literal('raise_error') }),
    tool_mock_overrides: Schema.Record(Schema.String, Schema.Array(Mock)),
  }) })),
});
let directory: string | undefined;
const cwd = () => {
  if (!directory) throw new Error('The offline CLI fixture has not started.');
  return directory;
};
const cli = (args: string[], overrides: Record<string, string> = {}) => execute(process.execPath, [command, ...args], { cwd: cwd(), env: { ...env, ...overrides }, timeout: 8000 });
const preparedPath = () => resolve(cwd(), 'artifacts/elevenlabs/prepared.json');
const bundle = async () => {
  await cli(['prepare']);
  return Schema.decodeUnknownSync(Bundle)(JSON.parse(await readFile(preparedPath(), 'utf8')));
};

test.beforeEach(async () => {
  await mkdir(output, { recursive: true });
  directory = await mkdtemp(resolve(output, 'offline-cli-'));
});
test.afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

test('ElevenLabs prepare CLI writes private configuration without cloud state or an API key', async () => {
  const result = await cli(['prepare']);
  expect(result.stdout).toContain('Prepared three tools, one agent, and five mocked simulation tests. No cloud requests.');
  expect(result.stderr).toBe('');
  const prepared = await bundle();
  expect(prepared.tools.map(tool => tool.tool_config.name)).toEqual(toolNames);
  expect(prepared.tools.map(tool => tool.tool_config.api_schema.method)).toEqual(['GET', 'POST', 'POST']);
  expect(prepared.tools.map(tool => tool.tool_config.api_schema.url)).toEqual(['/assets/{assetId}', '/intake/prepare', '/intake/confirm'].map(path => env.VOICEOPS_PUBLIC_URL + path));
  for (const tool of prepared.tools) {
    expect(tool.tool_config.follow_redirects).toBe(false);
    expect(tool.tool_config.api_schema.request_headers).toEqual({ 'x-voiceops-tool-key': { secret_id: env.ELEVENLABS_TOOL_SECRET_ID } });
  }
  expect(prepared.agent.conversation_config.agent.prompt.tool_ids).toEqual(toolNames.map(name => `offline_${name}`));
  expect(prepared.agent.conversation_config.agent.prompt.enable_parallel_tool_calls).toBe(false);
  expect(prepared.agent.conversation_config.agent.prompt.prompt).toContain('explicit verbal confirmation before every confirm_work_order');
  expect(prepared.tests.map(scenario => scenario.key)).toEqual(['complete-intake', 'missing-asset', 'unknown-asset', 'emergency', 'ambiguous-facts']);
  await assert.rejects(readFile(resolve(cwd(), 'artifacts/elevenlabs/state.json')), { code: 'ENOENT' });
  if (process.platform !== 'win32') expect((await stat(preparedPath())).mode & 0o777).toBe(0o600);
  const first = await readFile(preparedPath(), 'utf8');
  await cli(['prepare']);
  expect(await readFile(preparedPath(), 'utf8')).toBe(first);
});

const scenarios = [
  { key: 'complete-intake', count: 3 },
  { key: 'missing-asset', count: 3 },
  { key: 'unknown-asset', count: 1 },
  { key: 'emergency', count: 3 },
  { key: 'ambiguous-facts', count: 3 },
];
for (const scenario of scenarios) test(`prepared ${scenario.key} scenario preserves backend response contracts and policy`, async () => {
  const prepared = await bundle();
  const fixture = prepared.tests.find(candidate => candidate.key === scenario.key);
  if (!fixture) throw new Error(`Missing scenario ${scenario.key}.`);
  expect(fixture.request.success_conditions.length).toBeGreaterThanOrEqual(3);
  let checked = 0;
  for (const [id, mocks] of Object.entries(fixture.request.tool_mock_overrides)) {
    expect(prepared.agent.conversation_config.agent.prompt.tool_ids).toContain(id);
    for (const mock of mocks) {
      const value: unknown = JSON.parse(mock.mock_result);
      if (mock.is_error) {
        expect(Schema.decodeUnknownSync(MissingRecord)(value).code).toBe('UnknownAsset');
      } else if (id === 'offline_get_maintenance_context') {
        expect(String(Schema.decodeUnknownSync(AssetContext)(value).asset.id)).toBe('P-101');
      } else if (id === 'offline_prepare_work_order') {
        const result = Schema.decodeUnknownSync(Prepared)(value);
        expect(result.draft.assessment).toEqual(assess(result.draft.report));
        if (scenario.key === 'emergency') expect(result.draft.report.facts).toMatchObject({ leak: 'significant', personnelHazard: 'yes' });
        if (scenario.key === 'ambiguous-facts') expect(Object.values(result.draft.report.facts)).toEqual(Array(6).fill('unknown'));
      } else if (id === 'offline_confirm_work_order') {
        const result = Schema.decodeUnknownSync(ConfirmationResult)(value);
        if (scenario.key === 'emergency') expect(result.workOrder).toMatchObject({ priority: 'CRITICAL', allocation: { kind: 'queued', escalationRequired: true } });
        if (scenario.key === 'ambiguous-facts') expect(result.workOrder).toMatchObject({ priority: null, allocation: { kind: 'held' } });
        if (scenario.key === 'complete-intake') expect(result.workOrder).toMatchObject({ priority: 'LOW', allocation: { kind: 'assigned', technicianId: 'Tech-01' } });
      } else throw new Error(`Unknown mocked tool ${id}.`);
      checked++;
    }
  }
  expect(checked).toBe(scenario.count);
});

test('ElevenLabs CLI rejects invalid arguments and unsafe configuration before writing prepared output', async () => {
  for (const args of [[], ['unknown'], ['prepare', '--unknown'], ['prepare', '--openapi'], ['prepare', '--resume', '--resume']]) await assert.rejects(cli(args));
  await assert.rejects(cli(['prepare'], { VOICEOPS_PUBLIC_URL: 'http://127.0.0.1:3100' }), /public HTTPS origin/);
  await assert.rejects(cli(['prepare'], { ELEVENLABS_TOOL_SECRET_ID: 'Bearer secret' }), /must identify an existing ElevenLabs secret/);
  await assert.rejects(readFile(preparedPath()), { code: 'ENOENT' });
});

test('ElevenLabs CLI denies each live command without explicit opt-in and without credentials', async () => {
  for (const mode of ['provision', 'adopt', 'run-tests']) {
    await assert.rejects(cli([mode]), /require the explicit --live flag/);
    await assert.rejects(cli([mode, '--live']), /Configure ELEVENLABS_API_KEY/);
  }
  await assert.rejects(readFile(resolve(cwd(), 'artifacts/elevenlabs/state.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(resolve(cwd(), 'artifacts/elevenlabs/state.lock')), { code: 'ENOENT' });
});

test('npm clean preserves durable ElevenLabs state and locks while removing generated outputs', async () => {
  await mkdir(resolve(cwd(), 'tools'), { recursive: true });
  await copyFile(cleaner, resolve(cwd(), 'tools/clean.mjs'));
  await writeFile(resolve(cwd(), 'package.json'), JSON.stringify({ private: true, scripts: { clean: 'node tools/clean.mjs' } }));
  const checkpoint = resolve(cwd(), 'artifacts/elevenlabs/state.json');
  const lock = resolve(cwd(), 'artifacts/elevenlabs/state.lock');
  await mkdir(resolve(cwd(), 'artifacts/elevenlabs'), { recursive: true });
  const state = JSON.stringify({ resources: { agent: { id: 'synthetic-agent-id', pending: true } }, invocation: { id: 'synthetic-invocation-id', pending: true } });
  await writeFile(checkpoint, state, { mode: 0o600 });
  await writeFile(lock, 'synthetic-operation-lock', { mode: 0o600 });
  for (const generated of ['dist', 'coverage', 'artifacts/e2e', 'artifacts/source-package']) {
    await mkdir(resolve(cwd(), generated), { recursive: true });
    await writeFile(resolve(cwd(), generated, 'generated.txt'), 'synthetic generated output');
  }
  for (const generated of ['voiceops-source.tar.gz', 'report #1.json']) await writeFile(resolve(cwd(), 'artifacts', generated), 'synthetic generated output');
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run this suite through npm run test:e2e.');
  await execute(process.execPath, [npm, 'run', 'clean'], { cwd: cwd(), env, timeout: 8000 });
  expect(await readFile(checkpoint, 'utf8')).toBe(state);
  expect(await readFile(lock, 'utf8')).toBe('synthetic-operation-lock');
  if (process.platform !== 'win32') expect((await stat(checkpoint)).mode & 0o777).toBe(0o600);
  for (const generated of ['dist', 'coverage', 'artifacts/e2e', 'artifacts/source-package']) await assert.rejects(stat(resolve(cwd(), generated)), { code: 'ENOENT' });
  for (const generated of ['voiceops-source.tar.gz', 'report #1.json']) await assert.rejects(stat(resolve(cwd(), 'artifacts', generated)), { code: 'ENOENT' });
  await execute(process.execPath, [npm, 'run', 'clean'], { cwd: cwd(), env, timeout: 8000 });
  expect(await readFile(checkpoint, 'utf8')).toBe(state);
  expect(await readFile(lock, 'utf8')).toBe('synthetic-operation-lock');
});
