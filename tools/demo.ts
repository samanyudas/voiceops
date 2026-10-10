import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Local demo server. It serves the demo page, holds both backend credentials,
// and records every forwarded backend call so the page can show real traffic.
// The optional tool relay lets a tunnel send the hosted voice agent's webhook
// calls through this process, so live calls appear in the same trace.

const backend = process.env.VOICEOPS_URL ?? 'http://127.0.0.1:3000';
const toolKey = process.env.TOOL_API_KEY;
const technicianKey = process.env.TECHNICIAN_API_KEY;
if (!toolKey || !technicianKey) throw new Error('TOOL_API_KEY and TECHNICIAN_API_KEY are required.');
const port = Number(process.env.DEMO_PORT ?? '4173');
const relayPort = process.env.DEMO_TOOL_RELAY_PORT === undefined ? null : Number(process.env.DEMO_TOOL_RELAY_PORT);
const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
const agentId = process.env.ELEVENLABS_AGENT_ID;
const maxBody = 64 * 1024;

type Role = 'operator' | 'technician';
interface Route { readonly role: Role; readonly method: string; readonly pattern: RegExp; readonly record: boolean }
const routes: readonly Route[] = [
  { role: 'operator', method: 'GET', pattern: /^\/assets\/[^/]+$/, record: true },
  { role: 'operator', method: 'POST', pattern: /^\/intake\/(prepare|confirm)$/, record: true },
  { role: 'technician', method: 'POST', pattern: /^\/technician\/actions$/, record: true },
  { role: 'technician', method: 'GET', pattern: /^\/work-orders\/[^/]+$/, record: true },
  { role: 'technician', method: 'GET', pattern: /^\/state$/, record: false }
];

interface Trace {
  readonly id: string; readonly at: string; readonly source: 'ui' | 'voice-agent';
  readonly method: string; readonly path: string; readonly status: number; readonly ms: number;
  readonly request: unknown; readonly response: unknown;
}
const traces: Trace[] = [];
const listeners = new Set<ServerResponse>();
function publish(trace: Trace): void {
  traces.push(trace);
  if (traces.length > 200) traces.shift();
  for (const listener of listeners) listener.write(`data: ${JSON.stringify(trace)}\n\n`);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBody) { reject(new Error('Request body is too large.')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function parse(text: string): unknown {
  if (text === '') return null;
  try { const value: unknown = JSON.parse(text); return value; } catch { return text; }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

// Forward one allowlisted call. The UI path adds the server-held credential.
// The relay path passes the caller's own operator credential through unchanged.
async function forward(request: IncomingMessage, response: ServerResponse, path: string, source: Trace['source']): Promise<void> {
  const method = request.method ?? 'GET';
  const route = routes.find(candidate => candidate.method === method && candidate.pattern.test(path));
  if (!route || (source === 'voice-agent' && route.role !== 'operator')) return send(response, 404, { error: 'Unknown demo route.' });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (source === 'ui') headers[route.role === 'operator' ? 'x-voiceops-tool-key' : 'x-voiceops-tech-key'] = route.role === 'operator' ? toolKey ?? '' : technicianKey ?? '';
  else {
    const supplied = request.headers['x-voiceops-tool-key'];
    if (typeof supplied === 'string') headers['x-voiceops-tool-key'] = supplied;
  }
  const body = method === 'POST' ? await readBody(request) : undefined;
  const started = performance.now();
  try {
    const upstream = await fetch(`${backend}${path}`, { method, headers, redirect: 'error', signal: AbortSignal.timeout(10000), ...(body === undefined ? {} : { body }) });
    const text = await upstream.text();
    const ms = Math.round(performance.now() - started);
    if (route.record) publish({ id: randomUUID(), at: new Date().toISOString(), source, method, path, status: upstream.status, ms, request: body === undefined ? null : parse(body), response: parse(text) });
    response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store', 'x-demo-latency-ms': String(ms) });
    response.end(text);
  } catch {
    const ms = Math.round(performance.now() - started);
    if (route.record) publish({ id: randomUUID(), at: new Date().toISOString(), source, method, path, status: 502, ms, request: body === undefined ? null : parse(body), response: { error: 'Backend unreachable.' } });
    send(response, 502, { error: 'Backend unreachable.' });
  }
}

async function signedUrl(response: ServerResponse): Promise<void> {
  if (!elevenLabsKey || !agentId) return send(response, 503, { error: 'Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID to enable live voice.' });
  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, { headers: { 'xi-api-key': elevenLabsKey }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    const result: unknown = await upstream.json();
    if (!upstream.ok || typeof result !== 'object' || result === null || !('signed_url' in result) || typeof result.signed_url !== 'string') {
      return send(response, 502, { error: `ElevenLabs returned HTTP ${upstream.status} without a signed URL.` });
    }
    send(response, 200, { signedUrl: result.signed_url });
  } catch {
    send(response, 502, { error: 'ElevenLabs is unreachable.' });
  }
}

const assets: Readonly<Record<string, string>> = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const types: Readonly<Record<string, string>> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

function boundPort(): number {
  const address: AddressInfo | string | null = ui.address();
  return typeof address === 'object' && address !== null ? address.port : port;
}

// The server holds both credentials, so it serves only its own page. Checking
// Host blocks DNS rebinding, and checking Origin blocks cross-site writes.
function ownOrigin(request: IncomingMessage): boolean {
  const hosts = [`127.0.0.1:${boundPort()}`, `localhost:${boundPort()}`];
  if (!hosts.includes(request.headers.host ?? '')) return false;
  return request.method === 'GET' || hosts.some(host => request.headers.origin === `http://${host}`);
}

const ui = createServer((request, response) => {
  if (!ownOrigin(request)) return send(response, 403, { error: 'The demo server accepts only requests from its own page.' });
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const asset = assets[path];
  if (request.method === 'GET' && asset) {
    const text = readFileSync(new URL(`../../demo/${asset}`, import.meta.url));
    response.writeHead(200, { 'content-type': types[asset.split('.').pop() ?? ''] ?? 'text/plain', 'cache-control': 'no-store' });
    return void response.end(text);
  }
  if (request.method === 'GET' && path === '/demo/config') return send(response, 200, { backend, liveVoice: Boolean(elevenLabsKey && agentId), toolRelayPort: relayPort });
  if (request.method === 'GET' && path === '/demo/signed-url') return void signedUrl(response);
  if (request.method === 'GET' && path === '/demo/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    for (const trace of traces.slice(-50)) response.write(`data: ${JSON.stringify(trace)}\n\n`);
    listeners.add(response);
    request.on('close', () => listeners.delete(response));
    return;
  }
  if (path.startsWith('/demo/api/')) return void forward(request, response, path.slice('/demo/api'.length), 'ui').catch(() => send(response, 400, { error: 'Invalid request.' }));
  send(response, 404, { error: 'Not found.' });
});
ui.listen(port, '127.0.0.1', () => process.stdout.write(`Demo UI on http://127.0.0.1:${boundPort()} forwarding to ${backend}\n`));

if (relayPort !== null) {
  const relay = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    void forward(request, response, path, 'voice-agent').catch(() => send(response, 400, { error: 'Invalid request.' }));
  });
  relay.listen(relayPort, '127.0.0.1', () => process.stdout.write(`Voice tool relay on http://127.0.0.1:${relayPort}. Point the tunnel here.\n`));
}
