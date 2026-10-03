import { Effect, Schema } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { TechnicianAction } from "../src/domain/models.js";
const base = process.env.VOICEOPS_URL ?? 'http://127.0.0.1:3000';
const key = process.env.TECHNICIAN_API_KEY;
if (!key) throw new Error('TECHNICIAN_API_KEY is required.');
const [action,workOrderId,technicianId,requestId] = process.argv.slice(2);
const run = Effect.gen(function*() {
  const endpoint = action === 'state' ? '/state' : action === 'view' && workOrderId ? `/work-orders/${encodeURIComponent(workOrderId)}` : '/technician/actions';
  const payload = endpoint === '/technician/actions' ? yield* Schema.decodeUnknownEffect(TechnicianAction)({ action,workOrderId,technicianId,requestId }) : undefined;
  const response = yield* Effect.tryPromise(() => fetch(`${base}${endpoint}`, payload === undefined ? { headers: { 'x-voiceops-tech-key': key }, redirect: 'error', signal: AbortSignal.timeout(10000) } : { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'x-voiceops-tech-key': key, 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
  const result: unknown = yield* Effect.tryPromise(() => response.json());
  yield* Effect.sync(() => console.log(JSON.stringify({ status: response.status, result }, null, 2)));
  if (!response.ok) return yield* Effect.fail(new Error(`Technician request failed with HTTP ${response.status}.`));
});
NodeRuntime.runMain(run);
