import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

const toolKey = 'synthetic-demo-operator-key';
const technicianKey = 'synthetic-demo-technician-key';

function call(port, { method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers }, response => {
      response.destroy();
      resolve({ status: response.statusCode });
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

test('demo server forwards only same-origin requests with its held credentials', async () => {
  const received = [];
  const backend = createServer((incoming, response) => {
    received.push({ method: incoming.method, url: incoming.url, techKey: incoming.headers['x-voiceops-tech-key'] });
    incoming.resume();
    incoming.on('end', () => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); });
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const env = { ...process.env, VOICEOPS_URL: `http://127.0.0.1:${backend.address().port}`, TOOL_API_KEY: toolKey, TECHNICIAN_API_KEY: technicianKey, DEMO_PORT: '0' };
  delete env.DEMO_TOOL_RELAY_PORT;
  const demo = spawn(process.execPath, ['dist/tools/demo.js'], {
    env,
    stdio: ['ignore', 'pipe', 'inherit']
  });
  try {
    let output = '';
    for await (const chunk of demo.stdout) {
      output += chunk;
      if (/Demo UI on http:\/\/127\.0\.0\.1:\d+/.test(output)) break;
    }
    const port = Number(/127\.0\.0\.1:(\d+)/.exec(output)?.[1]);
    assert.ok(port > 0, `demo server reported its port: ${output}`);
    const own = `127.0.0.1:${port}`;
    const action = JSON.stringify({ requestId: 'demo-test-1', workOrderId: 'demo-busy-rotating', technicianId: 'Tech-01', action: 'resolve' });
    const write = headers => call(port, { method: 'POST', path: '/demo/api/technician/actions', headers: { host: own, 'content-type': 'text/plain', ...headers }, body: action });

    assert.equal((await write({ origin: 'https://evil.example' })).status, 403, 'cross-site write rejected');
    assert.equal((await write({})).status, 403, 'write without an Origin rejected');
    assert.equal((await call(port, { path: '/demo/api/state', headers: { host: `evil.example:${port}` } })).status, 403, 'rebound Host rejected');
    assert.equal((await call(port, { path: '/demo/events', headers: { host: `evil.example:${port}` } })).status, 403, 'rebound Host cannot read the trace stream');
    assert.deepEqual(received, [], 'no rejected request reached the backend');

    assert.equal((await write({ origin: `http://${own}` })).status, 200, 'same-origin write forwarded');
    assert.equal((await write({ origin: `http://localhost:${port}`, host: `localhost:${port}` })).status, 200, 'localhost origin forwarded');
    assert.equal((await call(port, { path: '/demo/api/state', headers: { host: own } })).status, 200, 'same-host read forwarded');
    assert.deepEqual(received.map(r => [r.method, r.url, r.techKey]), [
      ['POST', '/technician/actions', technicianKey],
      ['POST', '/technician/actions', technicianKey],
      ['GET', '/state', technicianKey]
    ]);
  } finally {
    demo.kill();
    await new Promise(resolve => backend.close(resolve));
  }
});
