import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
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

function rawStatus(port, text) {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    let reply = '';
    socket.on('data', chunk => { reply += chunk; });
    socket.on('error', () => {});
    socket.on('close', () => resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(reply)?.[1] ?? 0)));
  });
}

test('demo server uses its held credentials only for its own page and relays only operator calls', async () => {
  const received = [];
  const backend = createServer((incoming, response) => {
    received.push([incoming.method, incoming.url, incoming.headers['x-voiceops-tool-key'] ?? null, incoming.headers['x-voiceops-tech-key'] ?? null]);
    incoming.resume();
    incoming.on('end', () => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); });
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const env = { ...process.env, VOICEOPS_URL: `http://127.0.0.1:${backend.address().port}`, TOOL_API_KEY: toolKey, TECHNICIAN_API_KEY: technicianKey, DEMO_PORT: '0', DEMO_TOOL_RELAY_PORT: '0' };
  const demo = spawn(process.execPath, ['dist/tools/demo.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    let output = '';
    for await (const chunk of demo.stdout) {
      output += chunk;
      if (/Demo UI on .*\n[\s\S]*Voice tool relay on .*\n/.test(output)) break;
    }
    const port = Number(/Demo UI on http:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1]);
    const relay = Number(/Voice tool relay on http:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1]);
    assert.ok(port > 0 && relay > 0, `demo server reported both ports: ${output}`);
    const own = `127.0.0.1:${port}`;
    const action = JSON.stringify({ requestId: 'demo-test-1', workOrderId: 'demo-busy-rotating', technicianId: 'Tech-01', action: 'resolve' });
    const write = (headers, method = 'POST') => call(port, { method, path: '/demo/api/technician/actions', headers: { host: own, 'content-type': 'text/plain', ...headers }, body: action });

    for (const origin of ['https://evil.example', 'null', `http://127.0.0.1:${port + 1}`, `http://localhost:${port + 1}`, `http://${own}.evil.example`, 'http://127.0.0.1']) {
      assert.equal((await write({ origin })).status, 403, `write from Origin ${origin} rejected`);
    }
    assert.equal((await write({})).status, 403, 'write without an Origin rejected');
    for (const method of ['PUT', 'DELETE', 'PATCH']) assert.equal((await write({ origin: 'https://evil.example' }, method)).status, 403, `cross-site ${method} rejected`);
    for (const host of [`evil.example:${port}`, `LOCALHOST:${port}`, `127.0.0.1:${port + 1}`]) {
      assert.equal((await call(port, { path: '/demo/api/state', headers: { host } })).status, 403, `Host ${host} rejected`);
    }
    assert.equal((await call(port, { path: '/demo/events', headers: { host: `evil.example:${port}` } })).status, 403, 'rebound Host cannot read the trace stream');
    for (const site of ['cross-site', 'same-site']) {
      assert.equal((await call(port, { path: '/demo/api/state', headers: { host: own, 'sec-fetch-site': site } })).status, 403, `${site} read rejected`);
    }
    assert.equal((await call(port, { path: '/demo/api/admin', headers: { host: own } })).status, 404, 'unlisted route not forwarded');
    assert.equal(await rawStatus(port, `GET //[ HTTP/1.1\r\nHost: ${own}\r\nConnection: close\r\n\r\n`), 400, 'malformed URL rejected on the page port');

    assert.equal((await call(relay, { method: 'POST', path: '/technician/actions', headers: { 'x-voiceops-tool-key': toolKey }, body: action })).status, 404, 'relay refuses technician writes');
    assert.equal((await call(relay, { path: '/state', headers: { 'x-voiceops-tool-key': toolKey } })).status, 404, 'relay refuses technician reads');
    assert.equal((await call(relay, { path: '/assets/P-101' })).status, 401, 'relay rejects a call without the operator key');
    assert.equal((await call(relay, { path: '/assets/P-101', headers: { 'x-voiceops-tool-key': 'synthetic-wrong-operator-key' } })).status, 401, 'relay rejects a wrong operator key');
    assert.equal(await rawStatus(relay, 'GET //[ HTTP/1.1\r\nHost: tunnel.example\r\nConnection: close\r\n\r\n'), 400, 'malformed URL rejected on the relay port');
    assert.deepEqual(received, [], 'no rejected request reached the backend');

    assert.equal((await write({ origin: `http://${own}` })).status, 200, 'same-origin write forwarded');
    assert.equal((await write({ origin: `http://localhost:${port}`, host: `localhost:${port}`, 'sec-fetch-site': 'same-origin' })).status, 200, 'localhost origin forwarded');
    assert.equal((await call(port, { path: '/demo/api/state', headers: { host: own } })).status, 200, 'same-host read forwarded');
    assert.equal((await call(relay, { path: '/assets/P-101', headers: { host: 'tunnel.example', 'x-voiceops-tool-key': toolKey, 'x-voiceops-tech-key': technicianKey } })).status, 200, 'relay forwards an operator call');
    assert.deepEqual(received, [
      ['POST', '/technician/actions', null, technicianKey],
      ['POST', '/technician/actions', null, technicianKey],
      ['GET', '/state', null, technicianKey],
      ['GET', '/assets/P-101', toolKey, null]
    ]);
    assert.equal(demo.exitCode, null, 'demo server is still running');
  } finally {
    demo.kill();
    await new Promise(resolve => backend.close(resolve));
  }
});
