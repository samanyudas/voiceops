import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Effect, ManagedRuntime, Redacted, Schema } from 'effect';
import { PgClient } from '@effect/sql-pg';
import { expect } from 'e2e';
import { ActionResult, ConfirmationResult, Prepared, State, type Action, type Facts, type PrepareInput, type WorkOrderView } from '../../src/domain/models.js';
import { requireTestDatabaseUrl } from '../../tools/test-database-target.js';

const databaseUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const makeRuntime = () => ManagedRuntime.make(PgClient.layer({ url: Redacted.make(databaseUrl), maxConnections: 4, connectTimeout: '3 seconds', startupParameters: { statement_timeout: '10000' } }));
let runtime: ReturnType<typeof makeRuntime> | undefined;
export const query = (text: string, params: readonly unknown[] = []) => {
  runtime ??= makeRuntime();
  return runtime.runPromise(Effect.flatMap(PgClient.PgClient, sql => sql.unsafe(text, params)));
};
const execute = promisify(execFile);
export const operatorKey = 'synthetic-e2e-operator-key';
export const technicianKey = 'synthetic-e2e-technician-key';
export const env = { ...process.env, RATE_LIMIT_WINDOW_SECONDS: '60', RATE_LIMIT_ALL_PER_WINDOW: '100000', RATE_LIMIT_WRITES_PER_WINDOW: '100000', DATABASE_URL: databaseUrl, TOOL_API_KEY: operatorKey, TECHNICIAN_API_KEY: technicianKey, HOST: '127.0.0.1', E2E_TELEMETRY_DISABLED: '1' };
let server: ReturnType<typeof spawn> | undefined;
let base = '';
let logs = '';

export async function start() {
  if (server && server.exitCode === null && server.signalCode === null) throw new Error('A test server is already running.');
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No local test port.');
  await new Promise<void>(resolve => listener.close(() => resolve()));
  base = `http://127.0.0.1:${address.port}`;
  logs = '';
  server = spawn(process.execPath, ['dist/tools/server.js'], { env: { ...env, PORT: String(address.port) } });
  let spawnError: Error | undefined;
  server.on('error', error => { spawnError = error; });
  server.stdout?.on('data', chunk => { logs = (logs + String(chunk)).slice(-8000); });
  server.stderr?.on('data', chunk => { logs = (logs + String(chunk)).slice(-8000); });
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Test server exited. ${logs}`);
      try {
        const response = await fetch(`${base}/openapi.json`, { signal: AbortSignal.timeout(500) });
        await response.text();
        if (response.ok) return;
      } catch {}
      await delay(50);
    }
    throw new Error(`Test server did not start. ${logs}`);
  } catch (error) {
    await stop();
    throw error;
  }
}
export async function stop() {
  const child = server;
  if (child && child.exitCode === null && child.signalCode === null && child.pid) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const escalation = setTimeout(() => child.kill('SIGKILL'), 3000);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Test server did not exit after SIGKILL.')), 5000);
    });
    try { await Promise.race([exited, timedOut]); } finally { clearTimeout(escalation); clearTimeout(deadline); }
  }
  server = undefined;
}
export async function dispose() {
  try { await stop(); } finally {
    const current = runtime;
    runtime = undefined;
    await current?.dispose();
  }
}
export async function seed() { await execute(process.execPath, ['dist/tools/seed.js'], { env, timeout: 10_000 }); }
export async function reset() {
  await query('TRUNCATE action_receipts,events,reports,drafts,assignments,work_orders,maintenance_history,technician_skills,technicians,assets RESTART IDENTITY CASCADE');
  await seed();
  await query('TRUNCATE action_receipts,events,reports,drafts,assignments,work_orders RESTART IDENTITY CASCADE');
}
export const url = (path: string) => `${base}${path}`;
export async function request(path: string, options: { method?: string; body?: unknown; role?: 'operator' | 'technician' | 'none'; credential?: string } = {}) {
  const role = options.role ?? 'operator';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role !== 'none') headers[role === 'operator' ? 'x-voiceops-tool-key' : 'x-voiceops-tech-key'] = options.credential ?? (role === 'operator' ? operatorKey : technicianKey);
  const response = await fetch(url(path), { method: options.method ?? 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(10_000), ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
export const facts: typeof Facts.Type = { equipment: 'operating', leak: 'none', fireOrSmoke: 'no', personnelHazard: 'no', vibration: 'normal', temperature: 'normal' };
export async function prepare(options: Partial<Omit<PrepareInput, 'facts'>> & { facts?: Partial<typeof Facts.Type> } = {}) {
  const result = await request('/intake/prepare', { method: 'POST', body: { asset: 'P-101', category: 'mechanical-leak', observations: 'Synthetic E2E report.', ...options, facts: { ...facts, ...options.facts } } });
  expect(result.status).toBe(200);
  return Schema.decodeUnknownSync(Prepared)(result.body);
}
export async function confirm(draft: typeof Prepared.Type['draft'], decision: { kind: 'new-occurrence' | 'no-duplicate-expected' } | { kind: 'same-issue'; workOrderId: string } = { kind: 'new-occurrence' }) {
  const result = await request('/intake/confirm', { method: 'POST', body: { draftId: draft.id, decision } });
  expect(result.status).toBe(200);
  return Schema.decodeUnknownSync(ConfirmationResult)(result.body);
}
export async function create(options: Parameters<typeof prepare>[0] = {}) { return (await confirm((await prepare(options)).draft)).workOrder; }
export async function state() {
  const response = await request('/state', { role: 'technician' });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(State)(response.body);
}
export async function act(order: WorkOrderView, action: Action, requestId = `${action}-${order.id}`) {
  if (order.allocation.kind !== 'assigned') throw new Error('This fixture requires assigned work.');
  const response = await request('/technician/actions', { method: 'POST', role: 'technician', body: { workOrderId: order.id, technicianId: order.allocation.technicianId, action, requestId } });
  expect(response.status).toBe(200);
  return Schema.decodeUnknownSync(ActionResult)(response.body);
}
export async function resolve(order: WorkOrderView, requestId?: string) {
  await act(order, 'acknowledge');
  await act(order, 'start');
  return act(order, 'resolve', requestId);
}
export async function cli(args: string[], overrides: Record<string, string> = {}) {
  return execute(process.execPath, ['dist/tools/technician.js', ...args], { env: { ...env, VOICEOPS_URL: base, ...overrides }, timeout: 15_000 });
}
