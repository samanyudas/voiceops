import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
const execute = promisify(execFile);
test('compiled server rejects invalid rate limit settings before database startup', async () => {
  let connections = 0;
  const sentinel = createServer(socket => { connections++; socket.destroy(); });
  sentinel.listen(0, '127.0.0.1');
  await once(sentinel, 'listening');
  const address = sentinel.address();
  assert.ok(address && typeof address !== 'string');
  const env = { ...process.env, DATABASE_URL: `postgres://unused:unused@127.0.0.1:${address.port}/unused`, TOOL_API_KEY: 'synthetic-operator-key', TECHNICIAN_API_KEY: 'synthetic-technician-key', RATE_LIMIT_WINDOW_SECONDS: '60', RATE_LIMIT_ALL_PER_WINDOW: '120', RATE_LIMIT_WRITES_PER_WINDOW: '30' };
  const invalid = [
    ...['', '0', '-1', '1.5', '1e2', ' 60', '60 ', '3601', 'Infinity'].map(value => ({ RATE_LIMIT_WINDOW_SECONDS: value })),
    ...['0', '100001', 'NaN'].map(value => ({ RATE_LIMIT_ALL_PER_WINDOW: value })),
    ...['0', '100001', '1.5'].map(value => ({ RATE_LIMIT_WRITES_PER_WINDOW: value })),
    { RATE_LIMIT_ALL_PER_WINDOW: '10', RATE_LIMIT_WRITES_PER_WINDOW: '11' }
  ];
  try {
    for (const settings of invalid) {
      await assert.rejects(execute(process.execPath, ['dist/tools/server.js'], { env: { ...env, ...settings }, timeout: 3000 }), error => {
        assert.equal(error.code, 1);
        assert.match(error.stdout + error.stderr, /Backend startup failed.*rate limit settings/);
        assert.doesNotMatch(error.stdout + error.stderr, /ECONNREFUSED|synthetic-operator-key|synthetic-technician-key/);
        return true;
      });
    }
    assert.equal(connections, 0);
  } finally { await new Promise(resolve => sentinel.close(resolve)); }
});
