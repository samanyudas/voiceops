import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Effect, ManagedRuntime, Redacted } from 'effect';
import { PgClient } from '@effect/sql-pg';
import { seed, seedDemo } from '../../dist/src/db/seed.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required. Integration tests never report a skipped success.');
const database = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(database.protocol)
  || !['127.0.0.1', 'localhost'].includes(database.hostname)
  || !/^\/[A-Za-z0-9_]+_test$/.test(database.pathname)
  || database.search !== '' || database.hash !== '') throw new Error('Tests require a dedicated local Postgres database ending in _test, without URL query parameters or fragments.');
const runtime=ManagedRuntime.make(PgClient.layer({url:Redacted.make(databaseUrl),maxConnections:4}));
const query = (text,params=[])=>runtime.runPromise(Effect.flatMap(PgClient.PgClient,sql=>sql.unsafe(text,params)));
const port=Number(process.env.TEST_PORT ?? '3107');
const base=`http://127.0.0.1:${port}`;
const toolKey='synthetic-operator-test-key';
const technicianKey='synthetic-technician-test-key';
let server;
let logs='';
async function start(rateLimits = {}) {
  logs='';
  server=spawn(process.execPath,['dist/tools/server.js'],{env:{...process.env,RATE_LIMIT_WINDOW_SECONDS:'60',RATE_LIMIT_ALL_PER_WINDOW:'100000',RATE_LIMIT_WRITES_PER_WINDOW:'100000',DATABASE_URL:databaseUrl,TOOL_API_KEY:toolKey,TECHNICIAN_API_KEY:technicianKey,PORT:String(port),...rateLimits}});
  server.stdout.on('data', chunk=> {logs+=chunk.toString();}); server.stderr.on('data',chunk=>{logs+=chunk.toString();});
  for (let i=0;i<100;i++) {
    if (server.exitCode!==null) throw new Error(`Server exited. ${logs}`);
    try { const response=await fetch(`${base}/openapi.json`,{signal:AbortSignal.timeout(1000)}); await response.text(); if(response.ok) { return; } } catch { await delay(50); continue; }
    await delay(50);
  }
  throw new Error(`Server failed to start. ${logs}`);
}
async function stop() { if(server?.exitCode===null && server?.signalCode===null) {server.kill('SIGTERM');await once(server,'exit');} }
async function request(path,{method='GET',body,role='operator',credential}={}) {
  const headers={'content-type':'application/json'};
  if(role!=='none') headers[role==='operator'?'x-voiceops-tool-key':'x-voiceops-tech-key']=credential??(role==='operator'?toolKey:technicianKey);
  const response=await fetch(`${base}${path}`,{method,headers,signal:AbortSignal.timeout(10000),...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await response.text();
  const result=text ? JSON.parse(text) : null;
  return {status:response.status,body:result};
}
const facts={equipment:'operating',leak:'none',fireOrSmoke:'no',personnelHazard:'no',vibration:'normal',temperature:'normal'};
async function prepare({asset='P-101',category='mechanical-leak',observations='Synthetic condition observed.',facts:changes={}}={}) {
  const result=await request('/intake/prepare',{method:'POST',body:{asset,category,observations,facts:{...facts,...changes}}});
  assert.equal(result.status,200,JSON.stringify(result.body)); return result.body;
}
async function confirm(draft,decision={kind:'new-occurrence'},expected=200) {
  const result=await request('/intake/confirm',{method:'POST',body:{draftId:draft.id,decision}});
  assert.equal(result.status,expected,JSON.stringify(result.body));return result.body;
}
async function create(options={}) {return confirm((await prepare(options)).draft);}
async function state() {const result=await request('/state',{role:'technician'});assert.equal(result.status,200,JSON.stringify(result.body));return result.body;}
async function act(order,action,requestId=`${action}-${order.id}`,expected=200,technicianId=order.allocation.technicianId) {
  const result=await request('/technician/actions',{method:'POST',role:'technician',body:{workOrderId:order.id,technicianId,action,requestId}});
  assert.equal(result.status,expected,JSON.stringify(result.body));return result.body;
}
async function resolve(order,key) {await act(order,'acknowledge');await act(order,'start');return act(order,'resolve',key);}
async function occupyMechanical() {
  const a=(await create()).workOrder;
  const b=(await create()).workOrder;
  assert.equal(a.allocation.kind,'assigned');assert.equal(b.allocation.kind,'assigned');return [a,b];
}
before(start);
after(async()=>{await stop();await runtime.dispose();});
beforeEach(async()=>{
  await query('TRUNCATE action_receipts,events,reports,drafts,assignments,work_orders,maintenance_history,technician_skills,technicians,assets RESTART IDENTITY CASCADE');
  await runtime.runPromise(seed);
});
test('context normalizes identifiers and returns synthetic history',async()=>{
  const result=await request('/assets/pump%20p%20101');assert.equal(result.status,200);assert.equal(result.body.asset.id,'P-101');assert.equal(result.body.history.length,1);
  assert.equal((await request('/assets/Q-123')).status,400);assert.equal((await request('/assets/P-999')).status,404);
});
test('unknowns are persisted and never allocate capacity',async()=>{
  const before=await state();const prepared=await prepare({facts:{equipment:'unknown',fireOrSmoke:'yes'}});
  assert.equal(prepared.kind,'manual-review');assert.equal(prepared.draft.assessment.knownPriority,'CRITICAL');assert.equal((await state()).assignments.length,before.assignments.length);
  const result=await confirm(prepared.draft);assert.equal(result.workOrder.allocation.kind,'held');assert.equal(result.workOrder.priority,'CRITICAL');
  assert.equal((await state()).reports[0].report.facts.equipment,'unknown');
});
test('unclassified reports and unknown assets never dispatch',async()=>{
  const result=await confirm((await prepare({category:'unclassified'})).draft);assert.equal(result.workOrder.allocation.kind,'held');assert.equal(result.workOrder.priority,null);
  const unknown=await request('/intake/prepare',{method:'POST',body:{asset:'P-999',category:'mechanical-leak',observations:'x',facts}});assert.equal(unknown.status,404);
});
test('HTTP schema rejects missing fields and invalid fact values',async()=>{
  for(const input of [{asset:'P-101'}, {asset:'P-101',category:'mechanical-leak',observations:' ',facts}, {asset:'P-101',category:'mechanical-leak',observations:'x',facts:{...facts,leak:false}}]) assert.equal((await request('/intake/prepare',{method:'POST',body:input})).status,400);
  assert.equal((await state()).workOrders.length,0);
});
test('expiry prevents mutation and checks database wall time after dispatcher lock',async()=>{
  const prepared=await prepare();await query("UPDATE drafts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[prepared.draft.id]);
  await confirm(prepared.draft,undefined,410);assert.equal((await state()).workOrders.length,0);
  const delayed=await prepare();await query("UPDATE drafts SET expires_at=clock_timestamp()+interval '150 milliseconds' WHERE id=$1",[delayed.draft.id]);
  let release;
  const blocker=runtime.runPromise(Effect.gen(function*(){const sql=yield* PgClient.PgClient;return yield* sql.withTransaction(Effect.gen(function*(){yield* sql`SELECT pg_advisory_xact_lock(71190324)`;yield* Effect.tryPromise(()=>new Promise(r=>{release=r;}));}));}));
  while(!release) await delay(5);
  const confirmation=confirm(delayed.draft,undefined,410);await delay(250);release();await blocker;await confirmation;
  assert.equal((await state()).workOrders.length,0);
});
test('confirmation retry returns exact receipt and conflicting decisions fail',async()=>{
  const draft=(await prepare()).draft;const original=await confirm(draft);const snapshot=await state();
  assert.deepEqual(await confirm(draft),original);assert.deepEqual(await state(),snapshot);
  await confirm(draft,{kind:'no-duplicate-expected'},409);
});
test('default confirmation rechecks duplicate candidates from concurrent preparation',async()=>{
  const first=(await prepare()).draft;const second=(await prepare()).draft;
  await confirm(first,{kind:'no-duplicate-expected'});
  const failure=await confirm(second,{kind:'no-duplicate-expected'},409);assert.equal(failure.code,'DuplicateDecisionRequired');assert.equal(failure.candidates.length,1);
  assert.equal((await state()).workOrders.length,1);
});
test('same issue adds one immutable observation and raises urgency without reassignment',async()=>{
  const initial=(await create()).workOrder;const prepared=await prepare({facts:{personnelHazard:'yes'}});assert.equal(prepared.kind,'duplicate-decision-required');
  const decision={kind:'same-issue',workOrderId:initial.id};const result=await confirm(prepared.draft,decision);
  assert.equal(result.operation,'report-added');assert.equal(result.workOrder.reportCount,2);assert.equal(result.workOrder.priority,'CRITICAL');assert.deepEqual(result.workOrder.allocation,initial.allocation);
  await confirm(prepared.draft,decision);assert.equal((await state()).reports.length,2);
  const low=await confirm((await prepare()).draft,{kind:'same-issue',workOrderId:initial.id});assert.equal(low.workOrder.priority,'CRITICAL');
});
test('manual review never clears through later complete duplicate observations',async()=>{
  const held=(await create({facts:{vibration:'unknown'}})).workOrder;
  const updated=await confirm((await prepare({facts:{personnelHazard:'yes'}})).draft,{kind:'same-issue',workOrderId:held.id});
  assert.equal(updated.workOrder.priority,'CRITICAL');assert.equal(updated.workOrder.allocation.kind,'held');assert.equal((await state()).assignments.length,0);
});
test('new occurrences remain separate and resolved candidates become stale',async()=>{
  const order=(await create()).workOrder;const prepared=await prepare();await resolve(order);
  await confirm(prepared.draft,{kind:'same-issue',workOrderId:order.id},409);
  const fresh=await confirm(prepared.draft,{kind:'new-occurrence'});assert.notEqual(fresh.workOrder.id,order.id);assert.equal((await state()).workOrders.length,2);
});
test('skill matching and least-recent assignment choose available eligible technicians',async()=>{
  const mechanical=(await create()).workOrder;assert.equal(mechanical.allocation.technicianId,'Tech-01');
  const electrical=(await create({category:'electrical-fault'})).workOrder;assert.equal(electrical.allocation.technicianId,'Tech-02');
  await resolve(mechanical);const other=(await create()).workOrder;assert.equal(other.allocation.technicianId,'Tech-03');
});
test('queued critical work escalates once and resolution atomically drains priority order',async()=>{
  const [busy]=await occupyMechanical();const low=(await create()).workOrder;const high=(await create({facts:{equipment:'unavailable'}})).workOrder;const critical=(await create({facts:{fireOrSmoke:'yes'}})).workOrder;
  assert.equal(critical.allocation.kind,'queued');assert.equal(critical.allocation.escalationRequired,true);assert.deepEqual((await state()).queue,[critical.id,high.id,low.id]);
  const release=await resolve(busy);assert.equal(release.assignments[0].workOrderId,critical.id);
  const snapshot=await state();assert.equal(snapshot.workOrders.find(w=>w.id===critical.id).allocation.kind,'assigned');assert.equal(snapshot.events.filter(e=>e.workOrderId===critical.id&&e.action==='ESCALATION_REQUIRED').length,1);
  assert.equal(snapshot.assignments.filter(a=>a.releasedAt===null&&a.technicianId===busy.allocation.technicianId).length,1);
});
test('queue uses FIFO and stable identifiers for timestamp ties',async()=>{
  const [busy1,busy2]=await occupyMechanical();const a=(await create()).workOrder;const b=(await create()).workOrder;
  assert.deepEqual((await state()).queue,[a.id,b.id]);
  const older=await resolve(busy1);assert.equal(older.assignments[0].workOrderId,a.id);
  const c=(await create()).workOrder;await query("UPDATE work_orders SET created_at='2026-01-01T00:00:00Z' WHERE id=ANY($1::text[])",[[b.id,c.id]]);
  assert.deepEqual((await state()).queue,[b.id,c.id].sort());
  const next=await resolve(busy2);assert.equal(next.assignments[0].workOrderId,[b.id,c.id].sort()[0]);
});
test('queued incompatible work does not block compatible lower-priority work',async()=>{
  await create({asset:'C-201',category:'abnormal-vibration'});const critical=(await create({asset:'C-201',category:'abnormal-vibration',facts:{fireOrSmoke:'yes'}})).workOrder;
  assert.equal(critical.allocation.kind,'queued');const electrical=(await create({category:'electrical-fault'})).workOrder;assert.equal(electrical.allocation.technicianId,'Tech-02');
});
test('duplicate urgency changes queue order without creating another assignment',async()=>{
  await occupyMechanical();const a=(await create()).workOrder;const b=(await create()).workOrder;
  await confirm((await prepare({facts:{equipment:'unavailable'}})).draft,{kind:'same-issue',workOrderId:b.id});assert.deepEqual((await state()).queue,[b.id,a.id]);
});
test('separate credentials reject technician actions and missing credentials',async()=>{
  const order=(await create()).workOrder;
  const body={requestId:'blocked',workOrderId:order.id,technicianId:order.allocation.technicianId,action:'acknowledge'};
  assert.equal((await request('/technician/actions',{method:'POST',body})).status,403);
  assert.equal((await request('/state',{role:'none'})).status,401);
  assert.equal((await request('/intake/prepare',{role:'technician',method:'POST',body:{asset:'P-101',category:'mechanical-leak',observations:'x',facts}})).status,403);
});
test('invalid transitions and technician mismatch do not mutate state',async()=>{
  const order=(await create()).workOrder;const original=await state();await act(order,'start','invalid-start',409);await act(order,'acknowledge','wrong-tech',409,'Tech-02');assert.deepEqual(await state(),original);
});
test('technician receipts replay after resolution and closure without releasing twice',async()=>{
  const order=(await create()).workOrder;const acknowledgement=await act(order,'acknowledge','ack-receipt');await act(order,'start','start-receipt');const resolved=await act(order,'resolve','resolve-receipt');await act({...order,allocation:order.allocation},'close','close-receipt');
  const before=await state();assert.deepEqual(await act(order,'acknowledge','ack-receipt'),acknowledgement);assert.deepEqual(await act(order,'resolve','resolve-receipt'),resolved);assert.deepEqual(await state(),before);
  await act(order,'acknowledge','new-late-ack',409);await act(order,'start','ack-receipt',409);
});
test('database assignment failure rolls back resolution, capacity, receipts, and events',async()=>{
  const [busy]=await occupyMechanical();await create();await act(busy,'acknowledge');await act(busy,'start');
  const before=await state();await query("CREATE FUNCTION fail_test_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic assignment failure'; END $$");await query('CREATE TRIGGER fail_assignment BEFORE INSERT ON assignments FOR EACH ROW EXECUTE FUNCTION fail_test_assignment()');
  try {const failure=await act(busy,'resolve','failed-resolution',503);assert.match(failure.message,/unknown/);assert.deepEqual(await state(),before);} finally {await query('DROP TRIGGER fail_assignment ON assignments');await query('DROP FUNCTION fail_test_assignment()');}
  const result=await act(busy,'resolve','failed-resolution');assert.equal(result.assignments.length,1);
});
test('concurrent confirmation of one draft persists one report and one receipt',async()=>{
  const draft=(await prepare()).draft;const results=await Promise.all(Array.from({length:5},()=>confirm(draft)));for(const result of results) assert.deepEqual(result,results[0]);
  const snapshot=await state();assert.equal(snapshot.workOrders.length,1);assert.equal(snapshot.assignments.length,1);assert.equal(snapshot.reports.length,1);
});
test('two concurrent reports cannot allocate the same free technician',async()=>{
  await query("DELETE FROM technician_skills WHERE technician_id='Tech-03'");
  const drafts=await Promise.all([prepare(),prepare()]);const results=await Promise.all(drafts.map(d=>confirm(d.draft)));
  assert.equal(results.filter(r=>r.workOrder.allocation.kind==='assigned').length,1);assert.equal(results.filter(r=>r.workOrder.allocation.kind==='queued').length,1);assert.equal((await state()).assignments.length,1);
});
test('concurrent intake and resolution preserve queued priority and capacity',async()=>{
  const [busy]=await occupyMechanical();const waiting=(await create({facts:{equipment:'unavailable'}})).workOrder;await act(busy,'acknowledge');await act(busy,'start');const incoming=(await prepare()).draft;
  await Promise.all([confirm(incoming),act(busy,'resolve','race-resolution')]);const snapshot=await state();assert.equal(snapshot.workOrders.find(w=>w.id===waiting.id).allocation.kind,'assigned');assert.equal(snapshot.assignments.filter(a=>a.releasedAt===null).length,2);assert.equal(snapshot.queue.length,1);
});
test('API restart retains durable draft and mutation receipts',async()=>{
  const first=(await prepare()).draft;const confirmed=await confirm(first);const pending=(await prepare({category:'electrical-fault'})).draft;const before=await state();await stop();await start();assert.deepEqual(await state(),before);assert.deepEqual(await confirm(first),confirmed);assert.equal((await confirm(pending)).workOrder.allocation.kind,'assigned');
});

test('lost response after commit retries the persisted receipt without another mutation',async()=>{
  const draft=(await prepare()).draft;
  const proxy=createServer((incoming,outgoing)=>{
    const upstream=httpRequest(`${base}/intake/confirm`,{method:'POST',headers:incoming.headers},response=>{
      response.resume();
      response.on('end',()=>outgoing.destroy());
    });
    upstream.on('error',()=>outgoing.destroy());
    incoming.pipe(upstream);
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  try {
    const address=proxy.address();assert.equal(typeof address,'object');assert.notEqual(address,null);
    await assert.rejects(fetch(`http://127.0.0.1:${address.port}/`,{method:'POST',headers:{'x-voiceops-tool-key':toolKey,'content-type':'application/json'},body:JSON.stringify({draftId:draft.id,decision:{kind:'new-occurrence'}}),signal:AbortSignal.timeout(3000)}));
    const before=await state();assert.equal(before.workOrders.length,1);
    const retry=await confirm(draft);assert.equal(retry.workOrder.id,before.workOrders[0].id);assert.deepEqual(await state(),before);
  } finally {await new Promise(resolve=>proxy.close(resolve));}
});
test('retryable SQL failure restarts the full transaction and commits one logical mutation',async()=>{
  const draft=(await prepare()).draft;
  await query('CREATE SEQUENCE test_retry_sequence');
  await query("CREATE FUNCTION transient_test_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('test_retry_sequence')=1 THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='synthetic serialization retry'; END IF; RETURN NEW; END $$");
  await query('CREATE TRIGGER transient_report BEFORE INSERT ON reports FOR EACH ROW EXECUTE FUNCTION transient_test_report()');
  try {const result=await confirm(draft);const snapshot=await state();assert.equal(snapshot.workOrders.length,1);assert.equal(snapshot.reports.length,1);assert.equal(snapshot.assignments.length,1);assert.equal(result.workOrder.id,snapshot.workOrders[0].id);} finally {await query('DROP TRIGGER transient_report ON reports');await query('DROP FUNCTION transient_test_report()');await query('DROP SEQUENCE test_retry_sequence');}
});
test('append-only reports and events reject ordinary updates and deletes',async()=>{
  await create();const before=await state();
  await assert.rejects(query("UPDATE events SET reason='changed'"));await assert.rejects(query('DELETE FROM reports'));
  assert.deepEqual(await state(),before);
});

test('demo seed is idempotent and the real technician CLI resolves queued work',async()=>{
  await runtime.runPromise(seedDemo);await runtime.runPromise(seedDemo);const seeded=await state();assert.equal(seeded.workOrders.length,2);assert.equal(seeded.assignments.filter(a=>a.releasedAt===null).length,2);
  const queued=(await create({facts:{equipment:'unavailable'}})).workOrder;assert.equal(queued.allocation.kind,'queued');
  const command=spawn(process.execPath,['dist/tools/technician.js','resolve','demo-busy-mechanical','Tech-03','demo-cli-resolve'],{env:{...process.env,VOICEOPS_URL:base,TECHNICIAN_API_KEY:technicianKey}});
  let output='';command.stdout.on('data',chunk=>{output+=chunk.toString();});command.stderr.on('data',chunk=>{output+=chunk.toString();});
  const [code]=await once(command,'exit');assert.equal(code,0,output);
  const response=JSON.parse(output);assert.equal(response.status,200);assert.equal(response.result.workOrder.lifecycle,'RESOLVED');
  assert.deepEqual(response.result.assignments.map(a=>({workOrderId:a.workOrderId,technicianId:a.technicianId})),[{workOrderId:queued.id,technicianId:'Tech-03'}]);
  const current=await state();assert.equal(current.workOrders.find(w=>w.id===queued.id).allocation.technicianId,'Tech-03');
});
test('reported performance degradation while operating derives medium priority',async()=>{
  const result=await prepare({category:'performance-degradation'});
  assert.equal(result.draft.assessment.kind,'eligible');assert.equal(result.draft.assessment.priority,'MEDIUM');
});

test('minor defects without a higher reported condition derive low priority',async()=>{
  const result=await prepare({facts:{leak:'minor'}});assert.equal(result.draft.assessment.priority,'LOW');
});
test('database constraints independently prevent duplicate active technician and order capacity',async()=>{
  const [first]=await occupyMechanical();const queued=(await create()).workOrder;
  await assert.rejects(query('INSERT INTO assignments(work_order_id,technician_id) VALUES ($1,$2)',[queued.id,first.allocation.technicianId]),error=>error.reason.constraint==='one_active_job_per_technician');
  await assert.rejects(query('INSERT INTO assignments(work_order_id,technician_id) VALUES ($1,$2)',[first.id,'Tech-02']),error=>error.reason.constraint==='one_active_technician_per_job');
  assert.equal((await state()).assignments.length,2);
});
test('concurrent resolution with one action key releases and reallocates exactly once',async()=>{
  const [busy]=await occupyMechanical();await create();await act(busy,'acknowledge');await act(busy,'start');
  const results=await Promise.all([act(busy,'resolve','same-resolution'),act(busy,'resolve','same-resolution')]);assert.deepEqual(results[0],results[1]);
  const snapshot=await state();assert.equal(snapshot.events.filter(e=>e.workOrderId===busy.id&&e.action==='CAPACITY_RELEASED').length,1);assert.equal(snapshot.assignments.length,3);assert.equal(snapshot.assignments.filter(a=>a.releasedAt===null).length,2);
});
test('priority rank cannot be null or inconsistent with the reported priority',async()=>{
  const order=(await create({facts:{fireOrSmoke:'yes'}})).workOrder;
  await assert.rejects(query('UPDATE work_orders SET priority_rank=NULL WHERE id=$1',[order.id]),error=>error.reason._tag==='ConstraintError');
  await assert.rejects(query('UPDATE work_orders SET priority_rank=3 WHERE id=$1',[order.id]),error=>error.reason._tag==='ConstraintError');
  const held=(await create({facts:{equipment:'unknown'}})).workOrder;
  await assert.rejects(query('UPDATE work_orders SET priority_rank=0 WHERE id=$1',[held.id]),error=>error.reason._tag==='ConstraintError');
});

async function limitedServer(settings, check) {
  await stop();
  try { await start(settings); await check(); } finally { await stop(); await start(); }
}
async function rateRequest(path, { method = 'GET', role = 'operator', raw, credential, forwarded } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json',
      [role === 'operator' ? 'x-voiceops-tool-key' : 'x-voiceops-tech-key']: credential ?? (role === 'operator' ? toolKey : technicianKey),
      ...(forwarded ? { 'x-forwarded-for': forwarded } : {}) },
    ...(raw === undefined ? {} : { body: raw }), signal: AbortSignal.timeout(5000)
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}
function rateHeaders(response, limit, remaining) {
  assert.equal(response.headers.get('ratelimit-limit'), String(limit));
  assert.equal(response.headers.get('ratelimit-remaining'), String(remaining));
  assert.match(response.headers.get('ratelimit-reset'), /^[1-9][0-9]*$/);
  if (response.status === 429) assert.equal(response.headers.get('retry-after'), response.headers.get('ratelimit-reset'));
  else assert.equal(response.headers.get('retry-after'), null);
}
test('rate limits charge malformed writes, preserve authentication precedence and recover', async () => {
  await limitedServer({ RATE_LIMIT_WINDOW_SECONDS: '1', RATE_LIMIT_ALL_PER_WINDOW: '3', RATE_LIMIT_WRITES_PER_WINDOW: '1' }, async () => {
    const malformed = await rateRequest('/intake/prepare', { method: 'POST', raw: '{' });
    assert.equal(malformed.status, 400); rateHeaders(malformed, 1, 0);
    const blocked = await rateRequest('/intake/confirm', { method: 'POST', raw: '{' });
    assert.equal(blocked.status, 429); rateHeaders(blocked, 1, 0);
    assert.equal(blocked.body.code, 'RateLimited'); assert.equal(blocked.body.message, 'Request rate limit exceeded.');
    assert.equal((await rateRequest('/intake/prepare', { method: 'POST', raw: '{', credential: 'invalid' })).status, 401);
    assert.equal((await rateRequest('/intake/prepare', { method: 'POST', raw: '{', credential: technicianKey })).status, 403);
    const read = await rateRequest('/assets/P-101'); assert.equal(read.status, 200); rateHeaders(read, 3, 1);
    assert.equal((await rateRequest('/assets/P-101')).status, 200);
    const rejected = await rateRequest('/assets/P-101', { forwarded: '192.0.2.1' });
    assert.equal(rejected.status, 429); rateHeaders(rejected, 3, 0);
    assert.equal((await rateRequest('/state', { role: 'technician' })).status, 200);
    const publicResponse = await fetch(`${base}/openapi.json`);
    assert.equal(publicResponse.status, 200); assert.equal(publicResponse.headers.get('ratelimit-limit'), null);
    const contract = await publicResponse.json();
    for (const path of Object.values(contract.paths)) for (const operation of Object.values(path)) assert.ok(operation.responses['429']);
    await delay(1100);
    const recovered = await rateRequest('/assets/P-101'); assert.equal(recovered.status, 200); rateHeaders(recovered, 3, 2);
  });
});
test('rate admission gives exactly one concurrent request the final slot and isolates role quotas', async () => {
  await limitedServer({ RATE_LIMIT_ALL_PER_WINDOW: '2', RATE_LIMIT_WRITES_PER_WINDOW: '1' }, async () => {
    assert.equal((await rateRequest('/assets/P-101', { credential: 'invalid' })).status, 401);
    assert.equal((await rateRequest('/assets/P-101', { credential: technicianKey })).status, 403);
    assert.equal((await rateRequest('/assets/P-101')).status, 200);
    const raced = await Promise.all(Array.from({ length: 8 }, (_, index) => rateRequest('/assets/P-101', { forwarded: `192.0.2.${index}` })));
    assert.equal(raced.filter(result => result.status === 200).length, 1);
    assert.equal(raced.filter(result => result.status === 429).length, 7);
    for (const result of raced) rateHeaders(result, 2, 0);
    const failure = await rateRequest('/work-orders/missing', { role: 'technician' });
    assert.equal(failure.status, 404); rateHeaders(failure, 2, 1);
    assert.equal((await rateRequest('/state', { role: 'technician' })).status, 200);
    assert.equal((await rateRequest('/state', { role: 'technician' })).status, 429);
  });
});
test('rate rejection prevents confirmation and technician mutation without database changes', async () => {
  const prepared = await prepare();
  const order = (await create({ category: 'electrical-fault' })).workOrder;
  const beforeState = await state();
  const beforeDrafts = await query('SELECT * FROM drafts ORDER BY id');
  await limitedServer({ RATE_LIMIT_ALL_PER_WINDOW: '10', RATE_LIMIT_WRITES_PER_WINDOW: '1' }, async () => {
    assert.equal((await rateRequest('/intake/prepare', { method: 'POST', raw: '{}' })).status, 400);
    assert.equal((await rateRequest('/technician/actions', { role: 'technician', method: 'POST', raw: '{}' })).status, 400);
    const confirmation = await rateRequest('/intake/confirm', { method: 'POST', raw: JSON.stringify({ draftId: prepared.draft.id, decision: { kind: 'new-occurrence' } }) });
    assert.equal(confirmation.status, 429); rateHeaders(confirmation, 1, 0);
    const action = await rateRequest('/technician/actions', { role: 'technician', method: 'POST', raw: JSON.stringify({ workOrderId: order.id, technicianId: order.allocation.technicianId, action: 'acknowledge', requestId: 'rate-blocked-action' }) });
    assert.equal(action.status, 429); rateHeaders(action, 1, 0);
    assert.deepEqual(await state(), beforeState);
    assert.deepEqual(await query('SELECT * FROM drafts ORDER BY id'), beforeDrafts);
    assert.deepEqual(await query('SELECT * FROM action_receipts'), []);
  });
});
test('rate defaults apply when optional environment settings are absent', async () => {
  await limitedServer({ RATE_LIMIT_WINDOW_SECONDS: undefined, RATE_LIMIT_ALL_PER_WINDOW: undefined, RATE_LIMIT_WRITES_PER_WINDOW: undefined }, async () => {
    const read = await rateRequest('/assets/P-101');
    assert.equal(read.status, 200); rateHeaders(read, 120, 119);
    assert.ok(Number(read.headers.get('ratelimit-reset')) <= 60);
    const write = await rateRequest('/intake/prepare', { method: 'POST', raw: '{}' });
    assert.equal(write.status, 400); rateHeaders(write, 30, 29);
  });
});
