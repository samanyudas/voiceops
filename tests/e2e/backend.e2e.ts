import { test, expect } from 'e2e';
import assert from 'node:assert/strict';
import { Schema } from 'effect';
import { start, stop, dispose, reset, request, state, prepare, confirm, create, act, resolve, cli, seed, query, facts } from './runtime.js';
import type { Category, Skill, Priority } from '../../src/domain/models.js';

test.beforeAll(start);
test.afterAll(dispose);
test.beforeEach(reset);

test('the actual seed, API intake, and technician CLI complete a work order', async () => {
  const context = await request('/assets/pump%20p%20101');
  expect(context.status).toBe(200);
  expect(context.body.asset).toMatchObject({ id: 'P-101' });
  const draft = (await prepare({ category: 'electrical-fault' })).draft;
  expect((await state()).assignments).toHaveLength(0);
  const result = await confirm(draft, { kind: 'no-duplicate-expected' });
  expect(result.workOrder.allocation).toEqual({ kind: 'assigned', technicianId: 'Tech-02' });
  const steps = [{ action: 'acknowledge', lifecycle: 'ACKNOWLEDGED' }, { action: 'start', lifecycle: 'IN_PROGRESS' }, { action: 'resolve', lifecycle: 'RESOLVED' }, { action: 'close', lifecycle: 'CLOSED' }];
  for (const step of steps) {
    const output = await cli([step.action, result.workOrder.id, 'Tech-02', `cli-${step.action}`]);
    expect(JSON.parse(output.stdout)).toMatchObject({ status: 200, result: { workOrder: { lifecycle: step.lifecycle } } });
  }
  const current = JSON.parse((await cli(['view', result.workOrder.id])).stdout);
  expect(current.result.allocation).toEqual({ kind: 'completed' });
  expect(JSON.parse((await cli(['state'])).stdout).result.queue).toEqual([]);
});

test('OpenAPI describes every operational route without exposing operational data', async () => {
  const response = await request('/openapi.json', { role: 'none' });
  expect(response.status).toBe(200);
  expect(Object.keys(response.body.paths).sort()).toEqual(['/assets/{assetId}', '/intake/confirm', '/intake/prepare', '/state', '/technician/actions', '/work-orders/{workOrderId}']);
  expect(response.body.paths['/intake/prepare'].post.requestBody.content['application/json'].schema).toBeDefined();
  expect(response.body.paths['/technician/actions'].post.responses['200']).toBeDefined();
  expect(JSON.stringify(response.body)).not.toContain('Synthetic seal inspection');
});

test('asset lookup returns history and only matching unresolved work orders', async () => {
  const order = await create();
  await create({ asset: 'V-301', category: 'instrumentation-fault' });
  const context = await request('/assets/P-101');
  expect(context.body.history).toHaveLength(1);
  expect(context.body.openWorkOrders.map((candidate: { id: string }) => candidate.id)).toEqual([order.id]);
  await resolve(order);
  expect((await request('/assets/P-101')).body.openWorkOrders).toEqual([]);
  expect((await request('/assets/Q-123')).status).toBe(400);
  expect((await request('/assets/P-999')).status).toBe(404);
});

test('every protected route denies missing, wrong, and cross-class credentials without mutation', async () => {
  const draft = (await prepare()).draft;
  const order = await confirm(draft);
  const snapshot = await state();
  const routes: { path: string; role: 'operator' | 'technician'; method?: string; body?: unknown }[] = [
    { path: '/assets/P-101', role: 'operator' },
    { path: '/intake/prepare', role: 'operator', method: 'POST', body: { asset: 'P-101', category: 'mechanical-leak', observations: 'Denied report.', facts } },
    { path: '/intake/confirm', role: 'operator', method: 'POST', body: { draftId: draft.id, decision: { kind: 'new-occurrence' } } },
    { path: '/state', role: 'technician' },
    { path: `/work-orders/${order.workOrder.id}`, role: 'technician' },
    { path: '/technician/actions', role: 'technician', method: 'POST', body: { workOrderId: order.workOrder.id, technicianId: 'Tech-01', requestId: 'denied', action: 'acknowledge' } },
  ];
  for (const route of routes) {
    expect((await request(route.path, { ...route, role: 'none' })).status).toBe(401);
    expect((await request(route.path, { ...route, credential: 'invalid-credential' })).status).toBe(401);
    expect((await request(route.path, { ...route, role: route.role === 'operator' ? 'technician' : 'operator' })).status).toBe(403);
  }
  expect(await state()).toEqual(snapshot);
});

test('invalid HTTP payloads and missing records return errors without creating work', async () => {
  const snapshot = await state();
  const input = { asset: 'P-101', category: 'mechanical-leak', observations: 'Synthetic report.', facts };
  for (const body of [{ asset: 'P-101' }, { ...input, observations: ' ' }, { ...input, observations: 'x'.repeat(2001) }, { ...input, category: 'unsupported' }, { ...input, facts: { ...facts, leak: false } }, { ...input, facts: { ...facts, vibration: undefined } }]) {
    expect((await request('/intake/prepare', { method: 'POST', body })).status).toBe(400);
  }
  expect((await request('/intake/prepare', { method: 'POST', body: { ...input, asset: 'P-999' } })).status).toBe(404);
  expect((await request('/intake/confirm', { method: 'POST', body: { draftId: 'missing', decision: { kind: 'new-occurrence' } } })).status).toBe(404);
  expect((await request('/intake/confirm', { method: 'POST', body: { draftId: 'bad id', decision: { kind: 'invalid' } } })).status).toBe(400);
  expect((await request('/work-orders/missing', { role: 'technician' })).status).toBe(404);
  expect((await request('/technician/actions', { role: 'technician', method: 'POST', body: { workOrderId: 'missing', technicianId: 'Tech-01', requestId: 'missing', action: 'acknowledge' } })).status).toBe(404);
  expect(await state()).toEqual(snapshot);
});

test('preparation persists normalized observations without reserving capacity', async () => {
  const before = await state();
  const prepared = await prepare({ asset: ' pump p 101 ', observations: '  Synthetic condition.  ' });
  expect(prepared.kind).toBe('ready');
  expect(prepared.draft.report).toMatchObject({ assetId: 'P-101', observations: 'Synthetic condition.' });
  expect(Date.parse(prepared.draft.expiresAt) - Date.now()).toBeGreaterThan(590_000);
  expect(await state()).toEqual(before);
  const result = await confirm(prepared.draft);
  expect((await state()).reports).toMatchObject([{ workOrderId: result.workOrder.id, report: prepared.draft.report }]);
});

test('expired drafts reject confirmation without mutation and confirmed receipts replay after expiry', async () => {
  const expired = (await prepare()).draft;
  await query("UPDATE drafts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expired.id]);
  const before = await state();
  const denied = await request('/intake/confirm', { method: 'POST', body: { draftId: expired.id, decision: { kind: 'new-occurrence' } } });
  expect(denied.status).toBe(410);
  expect(denied.body.code).toBe('ExpiredDraft');
  expect(await state()).toEqual(before);
  const confirmed = (await prepare()).draft;
  const receipt = await confirm(confirmed);
  await query("UPDATE drafts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [confirmed.id]);
  const snapshot = await state();
  expect(await confirm(confirmed)).toEqual(receipt);
  expect(await state()).toEqual(snapshot);
});

test('unknown observations and unclassified work remain held after complete duplicate reports', async () => {
  const requiredFacts = ['equipment', 'leak', 'fireOrSmoke', 'personnelHazard', 'vibration', 'temperature'] satisfies readonly (keyof typeof facts)[];
  for (const fact of requiredFacts) {
    const prepared = await prepare({ facts: { [fact]: 'unknown', fireOrSmoke: fact === 'fireOrSmoke' ? 'unknown' : 'yes' } });
    expect(prepared.kind).toBe('manual-review');
    const held = (await confirm(prepared.draft)).workOrder;
    expect(held.allocation.kind).toBe('held');
    const duplicate = await confirm((await prepare()).draft, { kind: 'same-issue', workOrderId: held.id });
    expect(duplicate.workOrder.allocation.kind).toBe('held');
    expect((await state()).reports.some(record => record.workOrderId === held.id && record.report.facts[fact] === 'unknown')).toBe(true);
  }
  const unclassified = await create({ category: 'unclassified' });
  expect(unclassified.priority).toBeNull();
  expect(unclassified.allocation.kind).toBe('held');
  expect((await state()).assignments).toEqual([]);
});

const skillCases: { category: Category; skill: Skill; technician: string }[] = [
  { category: 'abnormal-vibration', skill: 'rotating-equipment', technician: 'Tech-01' },
  { category: 'temperature-issue', skill: 'mechanical', technician: 'Tech-01' },
  { category: 'mechanical-leak', skill: 'mechanical', technician: 'Tech-01' },
  { category: 'performance-degradation', skill: 'mechanical', technician: 'Tech-01' },
  { category: 'electrical-fault', skill: 'electrical', technician: 'Tech-02' },
  { category: 'instrumentation-fault', skill: 'instrumentation', technician: 'Tech-03' },
];
for (const example of skillCases) {
  test(`${example.category} dispatches to a technician with ${example.skill} skill`, async () => {
    const order = await create({ category: example.category });
    expect(order.allocation).toEqual({ kind: 'assigned', technicianId: example.technician });
    expect((await state()).technicians.find(technician => technician.id === example.technician)?.skills).toContain(example.skill);
  });
}

test('reported conditions produce each documented urgency and preserve maximum duplicate urgency', async () => {
  const cases: { facts: Parameters<typeof prepare>[0]; priority: Priority }[] = [
    { facts: {}, priority: 'LOW' },
    { facts: { facts: { leak: 'minor' } }, priority: 'LOW' },
    { facts: { category: 'performance-degradation' }, priority: 'MEDIUM' },
    { facts: { facts: { vibration: 'abnormal' } }, priority: 'MEDIUM' },
    { facts: { facts: { temperature: 'abnormal' } }, priority: 'MEDIUM' },
    { facts: { facts: { equipment: 'unavailable' } }, priority: 'HIGH' },
    { facts: { facts: { vibration: 'severe' } }, priority: 'HIGH' },
    { facts: { facts: { temperature: 'severe' } }, priority: 'HIGH' },
    { facts: { facts: { personnelHazard: 'yes' } }, priority: 'CRITICAL' },
    { facts: { facts: { fireOrSmoke: 'yes' } }, priority: 'CRITICAL' },
    { facts: { facts: { leak: 'significant' } }, priority: 'CRITICAL' },
  ];
  for (const example of cases) expect((await create(example.facts)).priority).toBe(example.priority);
  const critical = await create({ category: 'electrical-fault', facts: { personnelHazard: 'yes' } });
  const update = await confirm((await prepare({ category: 'electrical-fault' })).draft, { kind: 'same-issue', workOrderId: critical.id });
  expect(update.workOrder.priority).toBe('CRITICAL');
  expect(update.workOrder.reportCount).toBe(2);
});

test('confirmation receipts replay exactly and reject conflicting decisions', async () => {
  const draft = (await prepare()).draft;
  const receipt = await confirm(draft);
  const snapshot = await state();
  expect(await confirm(draft)).toEqual(receipt);
  expect((await request('/intake/confirm', { method: 'POST', body: { draftId: draft.id, decision: { kind: 'no-duplicate-expected' } } })).status).toBe(409);
  expect(await state()).toEqual(snapshot);
});

test('concurrent preparations require a fresh duplicate decision and preserve separate occurrences', async () => {
  const first = (await prepare()).draft;
  const second = (await prepare()).draft;
  const initial = await confirm(first, { kind: 'no-duplicate-expected' });
  const denied = await request('/intake/confirm', { method: 'POST', body: { draftId: second.id, decision: { kind: 'no-duplicate-expected' } } });
  expect(denied.status).toBe(409);
  expect(denied.body.code).toBe('DuplicateDecisionRequired');
  expect((await state()).workOrders).toHaveLength(1);
  const separate = await confirm(second);
  expect(separate.workOrder.id).not.toBe(initial.workOrder.id);
  expect((await state()).reports).toHaveLength(2);
});

test('same-issue reports retain assignment, append observations once, and reject stale or mismatched candidates', async () => {
  const order = await create();
  const duplicate = await prepare({ facts: { personnelHazard: 'yes' } });
  expect(duplicate.kind).toBe('duplicate-decision-required');
  expect(duplicate.draft.duplicateCandidates.map(candidate => candidate.id)).toEqual([order.id]);
  const decision = { kind: 'same-issue', workOrderId: order.id } satisfies { kind: 'same-issue'; workOrderId: string };
  const receipt = await confirm(duplicate.draft, decision);
  expect(receipt.operation).toBe('report-added');
  expect(receipt.workOrder).toMatchObject({ reportCount: 2, priority: 'CRITICAL', allocation: order.allocation });
  expect(await confirm(duplicate.draft, decision)).toEqual(receipt);
  expect((await state()).reports).toHaveLength(2);
  const stale = (await prepare()).draft;
  await resolve(order);
  const snapshot = await state();
  expect((await request('/intake/confirm', { method: 'POST', body: { draftId: stale.id, decision } })).status).toBe(409);
  const mismatch = (await prepare({ asset: 'V-301' })).draft;
  expect((await request('/intake/confirm', { method: 'POST', body: { draftId: mismatch.id, decision } })).status).toBe(409);
  expect(await state()).toEqual(snapshot);
  expect((await confirm(stale)).workOrder.id).not.toBe(order.id);
});

test('capacity release assigns critical, high, medium, then FIFO work and ends capacity escalation', async () => {
  const first = await create();
  await create();
  const low = await create();
  const lowNext = await create();
  const high = await create({ facts: { equipment: 'unavailable' } });
  const medium = await create({ facts: { temperature: 'abnormal' } });
  const critical = await create({ facts: { fireOrSmoke: 'yes' } });
  expect(critical.allocation).toEqual({ kind: 'queued', escalationRequired: true });
  expect((await state()).queue).toEqual([critical.id, high.id, medium.id, low.id, lowNext.id]);
  const result = await resolve(first);
  expect(result.assignments.map(assignment => assignment.workOrderId)).toEqual([critical.id]);
  const assigned = (await state()).workOrders.find(order => order.id === critical.id);
  if (!assigned) throw new Error('Critical order disappeared.');
  expect(assigned.allocation.kind).toBe('assigned');
  const next = await resolve(assigned);
  expect(next.assignments.map(assignment => assignment.workOrderId)).toEqual([high.id]);
  for (const [currentId, nextId] of [[high.id, medium.id], [medium.id, low.id], [low.id, lowNext.id]]) {
    const current = (await state()).workOrders.find(order => order.id === currentId);
    if (!current) throw new Error('Assigned work disappeared.');
    expect((await resolve(current)).assignments.map(assignment => assignment.workOrderId)).toEqual([nextId]);
  }
  const snapshot = await state();
  expect(snapshot.queue).toEqual([]);
  expect(snapshot.events.filter(event => event.workOrderId === critical.id && event.action === 'ESCALATION_REQUIRED')).toHaveLength(1);
  expect(snapshot.assignments.filter(assignment => assignment.releasedAt === null)).toHaveLength(2);
});

test('incompatible critical work does not block electrical work and duplicate urgency reorders queue', async () => {
  await create({ asset: 'C-201', category: 'abnormal-vibration' });
  const waiting = await create({ asset: 'C-201', category: 'abnormal-vibration', facts: { fireOrSmoke: 'yes' } });
  expect(waiting.allocation.kind).toBe('queued');
  expect((await create({ category: 'electrical-fault' })).allocation).toEqual({ kind: 'assigned', technicianId: 'Tech-02' });
  await create();
  const low = await create();
  const raised = await create();
  await confirm((await prepare({ facts: { equipment: 'unavailable' } })).draft, { kind: 'same-issue', workOrderId: raised.id });
  expect((await state()).queue).toEqual([waiting.id, raised.id, low.id]);
});

test('least-recently-assigned available technician receives the next mechanical order', async () => {
  const first = await create();
  expect(first.allocation).toEqual({ kind: 'assigned', technicianId: 'Tech-01' });
  await resolve(first);
  expect((await create()).allocation).toEqual({ kind: 'assigned', technicianId: 'Tech-03' });
});

test('unknown duplicate facts hold queued work without releasing an existing assignment', async () => {
  const assigned = await create();
  await create();
  const queued = await create();
  const held = await confirm((await prepare({ facts: { temperature: 'unknown' } })).draft, { kind: 'same-issue', workOrderId: queued.id });
  expect(held.workOrder.allocation.kind).toBe('held');
  const update = await confirm((await prepare({ facts: { temperature: 'unknown' } })).draft, { kind: 'same-issue', workOrderId: assigned.id });
  expect(update.workOrder.allocation).toEqual(assigned.allocation);
  expect((await state()).queue).toEqual([]);
  await resolve(assigned);
  expect((await request(`/work-orders/${queued.id}`, { role: 'technician' })).body.allocation.kind).toBe('held');
});

test('invalid lifecycle actions and technician mismatch preserve the full HTTP snapshot', async () => {
  const order = await create();
  for (const action of ['start', 'resolve', 'close']) {
    const snapshot = await state();
    expect((await request('/technician/actions', { role: 'technician', method: 'POST', body: { workOrderId: order.id, technicianId: 'Tech-01', requestId: `invalid-${action}`, action } })).status).toBe(409);
    expect(await state()).toEqual(snapshot);
  }
  const snapshot = await state();
  expect((await request('/technician/actions', { role: 'technician', method: 'POST', body: { workOrderId: order.id, technicianId: 'Tech-02', requestId: 'mismatch', action: 'acknowledge' } })).status).toBe(409);
  expect(await state()).toEqual(snapshot);
});

test('technician receipts replay after closure and conflicting keys never mutate state', async () => {
  const order = await create();
  const acknowledgement = await act(order, 'acknowledge', 'ack');
  await act(order, 'acknowledge', 'ack-again');
  await act(order, 'start', 'start');
  await act(order, 'start', 'start-again');
  const resolved = await act(order, 'resolve', 'resolve');
  await act(order, 'close', 'close');
  const snapshot = await state();
  expect(await act(order, 'acknowledge', 'ack')).toEqual(acknowledgement);
  expect(await act(order, 'resolve', 'resolve')).toEqual(resolved);
  expect((await request('/technician/actions', { role: 'technician', method: 'POST', body: { workOrderId: order.id, technicianId: 'Tech-01', requestId: 'ack', action: 'start' } })).status).toBe(409);
  expect(await state()).toEqual(snapshot);
  expect(snapshot.events.filter(event => event.action === 'CAPACITY_RELEASED')).toHaveLength(1);
});

test('simultaneous confirms and technician resolutions preserve one logical mutation', async () => {
  const draft = (await prepare()).draft;
  const receipts = await Promise.all(Array.from({ length: 5 }, () => confirm(draft)));
  for (const receipt of receipts) expect(receipt).toEqual(receipts[0]);
  expect((await state()).reports).toHaveLength(1);
  const order = receipts[0]?.workOrder;
  if (!order) throw new Error('No concurrent confirmation receipt.');
  await act(order, 'acknowledge');
  await act(order, 'start');
  const resolutions = await Promise.all(Array.from({ length: 5 }, () => act(order, 'resolve', 'race-resolve')));
  for (const receipt of resolutions) expect(receipt).toEqual(resolutions[0]);
  const snapshot = await state();
  expect(snapshot.events.filter(event => event.action === 'CAPACITY_RELEASED')).toHaveLength(1);
  expect(snapshot.assignments.filter(assignment => assignment.releasedAt !== null)).toHaveLength(1);
});

test('simultaneous intake and release retain priority and prevent double booking', async () => {
  const busy = await create({ category: 'electrical-fault' });
  const waiting = await create({ category: 'electrical-fault', facts: { equipment: 'unavailable' } });
  const drafts = await Promise.all([prepare({ category: 'electrical-fault' }), prepare({ category: 'electrical-fault' })]);
  await act(busy, 'acknowledge');
  await act(busy, 'start');
  await Promise.all([...drafts.map(prepared => confirm(prepared.draft)), act(busy, 'resolve', 'intake-race')]);
  const snapshot = await state();
  expect(snapshot.workOrders.find(order => order.id === waiting.id)?.allocation).toEqual({ kind: 'assigned', technicianId: 'Tech-02' });
  expect(snapshot.assignments.filter(assignment => assignment.releasedAt === null)).toHaveLength(1);
  expect(snapshot.queue).toHaveLength(2);
});

test('server restart retains pending drafts, current state, and original receipts', async () => {
  const confirmed = (await prepare()).draft;
  const receipt = await confirm(confirmed);
  const pending = (await prepare({ category: 'electrical-fault' })).draft;
  const acknowledgement = await act(receipt.workOrder, 'acknowledge', 'persisted-ack');
  const before = await state();
  await stop();
  await start();
  expect(await state()).toEqual(before);
  expect(await confirm(confirmed)).toEqual(receipt);
  expect(await act(receipt.workOrder, 'acknowledge', 'persisted-ack')).toEqual(acknowledgement);
  expect((await confirm(pending)).workOrder.allocation.kind).toBe('assigned');
});

test('seed CLI repeats without resetting jobs and technician CLI releases the demo queue', async () => {
  await seed();
  const seeded = await state();
  expect(seeded.workOrders).toHaveLength(2);
  expect(seeded.assignments.filter(assignment => assignment.releasedAt === null)).toHaveLength(2);
  await seed();
  expect(await state()).toEqual(seeded);
  const queued = await create();
  expect(queued.allocation.kind).toBe('queued');
  const output = JSON.parse((await cli(['resolve', 'demo-busy-mechanical', 'Tech-03', 'demo-release'])).stdout);
  expect(output.result.assignments).toMatchObject([{ workOrderId: queued.id, technicianId: 'Tech-03' }]);
  const current = await state();
  await seed();
  expect(await state()).toEqual(current);
});

test('technician CLI returns nonzero exits for invalid arguments, denied capabilities, and HTTP errors', async () => {
  const order = await create();
  const before = await state();
  const failureSchema = Schema.Struct({ code: Schema.Number, stdout: Schema.String, stderr: Schema.String });
  for (const args of [[], ['unknown'], ['view']]) await assert.rejects(cli(args), (error: unknown) => {
    const failure = Schema.decodeUnknownSync(failureSchema)(error);
    expect(failure.code).toBe(1);
    expect(failure.stdout).toContain('SchemaError: Expected');
    return true;
  });
  const failedRequest = (status: number) => (error: unknown) => {
    const failure = Schema.decodeUnknownSync(failureSchema)(error);
    expect(failure.code).toBe(1);
    const json = /^\{[\s\S]*?\n\}/.exec(failure.stdout)?.[0];
    if (!json) throw new Error('The technician CLI did not print its HTTP response.');
    const response = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.Number }))(JSON.parse(json));
    expect(response.status).toBe(status);
    expect(failure.stdout).toContain(`Technician request failed with HTTP ${status}.`);
    return true;
  };
  await assert.rejects(cli(['view', 'missing']), failedRequest(404));
  await assert.rejects(cli(['start', order.id, 'Tech-01', 'invalid-cli-transition']), failedRequest(409));
  await assert.rejects(cli(['state'], { TECHNICIAN_API_KEY: 'invalid-secret' }), failedRequest(401));
  await assert.rejects(cli(['state'], { TECHNICIAN_API_KEY: '' }), /TECHNICIAN_API_KEY is required/);
  expect(await state()).toEqual(before);
});
