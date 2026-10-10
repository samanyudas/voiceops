import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const commands = [
  { name: 'integration', args: ['--test', '--test-name-pattern=context normalizes', 'tests/integration/backend.test.mjs'] },
  { name: 'E2E', args: ['tools/run-e2e.mjs', 'tests/e2e/backend.e2e.ts', '--grep', '^OpenAPI describes'] },
];

for (const command of commands) test(`${command.name} rejects unsafe test database configuration before opening a connection`, async () => {
  let connections = 0;
  const rejectConnection = socket => { connections++; socket.destroy(); };
  const authority = createServer(rejectConnection);
  const fixtures = resolve('artifacts/e2e-guard-fixtures');
  await mkdir(fixtures, { recursive: true });
  const output = await mkdtemp(resolve(fixtures, 'target-'));
  try {
    await new Promise(resolve => authority.listen(0, '127.0.0.1', resolve));
    const port = authority.address().port;
    const local = `postgres://synthetic:synthetic@127.0.0.1:${port}/voiceops_guard_test`;
    const cases = [
      { name: 'host query override', url: `${local}?host=127.0.0.2` },
      { name: 'database query override', url: `${local}?dbname=voiceops` },
      { name: 'port query override', url: `${local}?port=${port}` },
      { name: 'startup options', url: `${local}?options=-c%20search_path%3Dpublic` },
      { name: 'unknown query parameter', url: `${local}?database=voiceops` },
      { name: 'fragment', url: `${local}#ignored` },
      { name: 'empty query', url: `${local}?` },
      { name: 'empty fragment', url: `${local}#` },
      { name: 'wrong protocol', url: local.replace('postgres:', 'https:') },
      { name: 'non-test database', url: local.replace('voiceops_guard_test', 'voiceops') },
      { name: 'nonlocal authority', url: local.replace('127.0.0.1', '127.0.0.2') },
      { name: 'encoded database path', url: local.replace('voiceops_guard_test', 'voiceops%2Fguard_test') },
      { name: 'malformed URL', url: 'not-a-url' },
      { name: 'malformed URL with credentials', url: 'postgres://synthetic:credential-must-stay-private@127.0.0.1:invalid/voiceops_guard_test' },
      { name: 'missing URL', url: undefined },
    ];
    for (const fixture of cases) {
      const env = { ...process.env, TEST_PORT: '0' };
      delete env.NODE_TEST_CONTEXT;
      if (fixture.url === undefined) delete env.TEST_DATABASE_URL;
      else env.TEST_DATABASE_URL = fixture.url;
      const args = command.name === 'E2E' ? [...command.args, '--output', output] : command.args;
      await assert.rejects(execute(process.execPath, args, { env, timeout: 20000 }), error => {
        assert.equal(typeof error.code, 'number', `${fixture.name} must exit without a timeout or signal`);
        const diagnostic = error.stdout + error.stderr;
        const expected = fixture.url === undefined ? /TEST_DATABASE_URL is required/ : /requires? a dedicated local (?:Postgres )?database/;
        assert.match(diagnostic, expected, `${fixture.name} must fail at the configuration guard`);
        assert.doesNotMatch(diagnostic, /credential-must-stay-private/, `${fixture.name} must not disclose credentials`);
        if (command.name === 'E2E') assert.doesNotMatch(diagnostic, /RUN\s+e2e/, `${fixture.name} must fail before the runner starts`);
        assert.equal(connections, 0, `${fixture.name} must not open a database connection`);
        return true;
      });
    }
  } finally {
    await new Promise(resolve => authority.close(resolve));
    await rm(output, { recursive: true, force: true });
  }
});

test('E2E validates the database target even when its runner is unavailable', async () => {
  const fixtures = resolve('artifacts/e2e-guard-fixtures');
  await mkdir(fixtures, { recursive: true });
  const directory = await mkdtemp(resolve(fixtures, 'preflight-'));
  try {
    await mkdir(resolve(directory, 'tools'));
    for (const name of ['run-e2e.mjs', 'test-database-target.ts']) {
      if (existsSync(resolve('tools', name))) await copyFile(resolve('tools', name), resolve(directory, 'tools', name));
    }
    const local = 'postgres://synthetic:synthetic@127.0.0.1:1/voiceops_guard_test';
    const env = { ...process.env, TEST_DATABASE_URL: `${local}?host=127.0.0.2` };
    delete env.NODE_TEST_CONTEXT;
    await assert.rejects(execute(process.execPath, ['tools/run-e2e.mjs'], { cwd: directory, env, timeout: 5000 }), error => {
      assert.equal(typeof error.code, 'number');
      assert.match(error.stderr, /require a dedicated local Postgres database/);
      assert.doesNotMatch(error.stderr, /MODULE_NOT_FOUND/);
      return true;
    });
    await assert.rejects(execute(process.execPath, ['tools/run-e2e.mjs'], { cwd: directory, env: { ...env, TEST_DATABASE_URL: local }, timeout: 5000 }), error => {
      assert.equal(typeof error.code, 'number');
      assert.match(error.stderr, /MODULE_NOT_FOUND/);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
