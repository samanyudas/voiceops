import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBackendContract, configuration, factsSchema, publicBackendUrl, secretLocator, toolNames, validateJsonSchema, validateMockResponses } from '../tools/elevenlabs-config.mjs';
import { adopt, apiClient, provision, runTests, saveState, summarizeInvocation } from '../tools/elevenlabs.mjs';
const env = { VOICEOPS_PUBLIC_URL: 'https://voiceops.example.com', ELEVENLABS_TOOL_SECRET_ID: 'secret_locator_001' };

test('public webhook URLs reject local addresses, credentials, and insecure destinations', () => {
  for (const value of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://service.local', 'https://service.internal', 'https://sam:token@example.com', 'https://example.com/api', 'https://example.com?key=secret', 'https://example.com:8080']) assert.throws(() => publicBackendUrl(value));
  assert.equal(publicBackendUrl(env.VOICEOPS_PUBLIC_URL + '/'), env.VOICEOPS_PUBLIC_URL);
  for (const value of ['', 'Bearer secret', 'secret\nvalue', null]) assert.throws(() => secretLocator(value));
});
test('agent tools expose only context, preparation, and confirmation using stored secret locators', async () => {
  const bundle = await configuration(env);
  assert.deepEqual(bundle.tools.map(tool => tool.tool_config.name), toolNames);
  assert.deepEqual(bundle.tools.map(tool => tool.tool_config.api_schema.method), ['GET', 'POST', 'POST']);
  assert.deepEqual(bundle.tools.map(tool => tool.tool_config.api_schema.url), [env.VOICEOPS_PUBLIC_URL + '/assets/{assetId}', env.VOICEOPS_PUBLIC_URL + '/intake/prepare', env.VOICEOPS_PUBLIC_URL + '/intake/confirm']);
  for (const tool of bundle.tools) {
    assert.deepEqual(tool.tool_config.api_schema.request_headers, { 'x-voiceops-tool-key': { secret_id: env.ELEVENLABS_TOOL_SECRET_ID } });
    assert.equal(tool.tool_config.follow_redirects, false);
  }
  for (const [field, schema] of Object.entries(factsSchema.properties)) {
    assert(schema.enum.includes('unknown'), field);
    assert(!('default' in schema), field);
  }
  assert.equal(bundle.agent.conversation_config.agent.prompt.enable_parallel_tool_calls, false);
  assert.match(bundle.agent.conversation_config.agent.prompt.prompt, /explicit verbal confirmation before every confirm_work_order/);
  assert.match(bundle.agent.conversation_config.agent.prompt.prompt, /answer to the duplicate question is not confirmation/);
  assert.match(bundle.agent.conversation_config.agent.prompt.prompt, /model-mediated/);
  assert.doesNotMatch(JSON.stringify(bundle.tools), /x-voiceops-technician/);
});
test('five scenarios isolate all tools with mocked fallback errors and explicit behavioral criteria', async () => {
  const ids = Object.fromEntries(toolNames.map((name, index) => [name, `tool_${index}`]));
  const bundle = await configuration(env, ids);
  assert.deepEqual(bundle.tests.map(test => test.key), ['complete-intake', 'missing-asset', 'unknown-asset', 'emergency', 'ambiguous-facts']);
  assert.equal(bundle.tests.length, 5);
  for (const { request } of bundle.tests) {
    assert.equal(request.type, 'simulation');
    assert.deepEqual(request.tool_mock_config, { mocking_strategy: 'all', fallback_strategy: 'raise_error' });
    assert(request.success_conditions.length >= 3);
    assert(Object.keys(request.tool_mock_overrides).every(id => Object.values(ids).includes(id)));
  }
  assert(bundle.tests[0].request.success_conditions.some(text => text.includes('only after')));
  assert(bundle.tests[3].request.success_conditions.some(text => text.includes('queued')));
  assert(bundle.tests[4].request.success_conditions.some(text => text.includes('unknown')));
});
test('provision resumes completed resources without duplicate POST requests', async () => {
  const state = {};
  const calls = [];
  const api = async (method, path) => { calls.push([method, path]); return { id: `resource_${calls.length}`, agent_id: `agent_${calls.length}` }; };
  await provision({ env, state, save: async () => {}, api });
  assert.equal(calls.length, 9);
  await provision({ env, state, save: async () => {}, api });
  assert.equal(calls.length, 9);
  await assert.rejects(provision({ env: { ...env, VOICEOPS_PUBLIC_URL: 'https://changed.example.com' }, state, save: async () => {}, api }), /Configuration changed/);
});
test('uncertain resource creation blocks automatic retry until verified adoption', async () => {
  const state = {};
  let writes = 0;
  const api = async () => { writes++; throw new Error('Uncertain outcome.'); };
  await assert.rejects(provision({ env, state, save: async () => {}, api }));
  assert.equal(state.resources.get_maintenance_context.pending, true);
  await assert.rejects(provision({ env, state, save: async () => {}, api }), /uncertain creation/);
  assert.equal(writes, 1);
  const bundle = await configuration(env);
  await assert.rejects(adopt({ state, key: toolNames[0], id: 'remote_1', api: async () => ({ tool_config: { name: 'unrelated' } }), save: async () => {}, bundle }), /does not match/);
  await adopt({ state, key: toolNames[0], id: 'remote_1', api: async () => bundle.tools[0], save: async () => {}, bundle });
  assert.equal(state.resources.get_maintenance_context.id, 'remote_1');
  assert.equal(state.resources.get_maintenance_context.pending, false);
});
test('API errors omit response bodies and credentials, and credentials stay on the fixed origin', async () => {
  let observed;
  const request = apiClient('do-not-print-this-key', async (url, options) => {
    observed = { url, options };
    return { ok: false, status: 401, json: () => { throw new Error('do-not-print-this-key'); } };
  });
  await assert.rejects(request('GET', '/v1/convai/tools'), error => error.message === 'ElevenLabs returned HTTP 401. Response body omitted.');
  assert.equal(observed.url, 'https://api.elevenlabs.io/v1/convai/tools');
  assert.equal(observed.options.redirect, 'error');
  assert.equal(observed.options.headers['xi-api-key'], 'do-not-print-this-key');
  await assert.rejects(request('GET', '@untrusted.example/v1/convai/tools'), /fixed-origin/);
  const failing = apiClient('do-not-print-this-key', async () => { throw new Error('do-not-print-this-key'); });
  await assert.rejects(failing('GET', '/v1/convai/tools'), error => !error.message.includes('do-not-print-this-key'));
});
test('test results require exactly five known runs and cannot count missing or repeated results as a pass', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const result = { id: 'invocation_1', test_runs: ids.map(test_id => ({ test_id, status: 'passed' })) };
  assert.equal(summarizeInvocation(result, ids).passed, 5);
  assert.throws(() => summarizeInvocation({ ...result, test_runs: result.test_runs.slice(1) }, ids));
  assert.throws(() => summarizeInvocation({ ...result, test_runs: ids.map(() => ({ test_id: 'a', status: 'passed' })) }, ids));
  assert.throws(() => summarizeInvocation({ ...result, test_runs: ids.map(test_id => ({ test_id, status: 'completed' })) }, ids));
});
test('paid test runs persist invocation state and resume polling without another POST', async () => {
  const state = { resources: { agent: { id: 'agent_1' }, ...Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(key => [key, { id: key }])) } };
  let starts = 0;
  let pending = true;
  const api = async method => {
    if (method === 'POST') { starts++; return { id: 'invocation_1' }; }
    return { id: 'invocation_1', test_runs: ['a', 'b', 'c', 'd', 'e'].map(test_id => ({ test_id, status: pending ? 'pending' : 'passed' })) };
  };
  await assert.rejects(runTests({ state, api, save: async () => {}, polls: 1, delay: async () => {} }), /remain pending/);
  await assert.rejects(runTests({ state, api, save: async () => {} }), /unfinished invocation/);
  pending = false;
  assert.equal((await runTests({ state, api, save: async () => {}, resume: true })).passed, 5);
  assert.equal(starts, 1);
});
test('state writes preserve IDs with private file permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voiceops-elevenlabs-'));
  try {
    const file = join(directory, 'state.json');
    await saveState({ resources: { agent: { id: 'agent_1' } } }, file);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).resources.agent.id, 'agent_1');
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('backend integration hook rejects route and bounded-fact contract drift', async () => {
  const bundle = await configuration(env);
  const document = { paths: {
    '/assets/{assetId}': { get: {} },
    '/intake/confirm': { post: {} },
    '/intake/prepare': { post: { requestBody: { content: { 'application/json': { schema: {
      properties: { category: { enum: bundle.tools[1].tool_config.api_schema.request_body_schema.properties.category.enum }, facts: { properties: Object.fromEntries(Object.entries(factsSchema.properties).map(([key, value]) => [key, { enum: value.enum }])) } },
    } } } } } },
  } };
  checkBackendContract(document, bundle);
  delete document.paths['/intake/confirm'];
  assert.throws(() => checkBackendContract(document, bundle), /Backend route/);
  document.paths['/intake/confirm'] = { post: {} };
  document.paths['/intake/prepare'].post.requestBody.content['application/json'].schema.properties.facts.properties.leak.enum = ['none', 'minor', 'significant'];
  assert.throws(() => checkBackendContract(document, bundle), /fact choices differ for leak/);
});

test('mock response validation rejects a missing backend context field and a fabricated error type', async () => {
  const bundle = await configuration(env);
  const response = schema => ({ content: { 'application/json': { schema } } });
  const document = {
    components: { schemas: { MissingRecord: { type: 'object', required: ['_tag', 'code', 'message'], properties: {
      _tag: { const: 'MissingRecord' }, code: { type: 'string' }, message: { type: 'string' },
    }, additionalProperties: false } } },
    paths: {
      '/assets/{assetId}': { get: { responses: {
        200: response({ type: 'object', required: ['asset', 'history', 'openWorkOrders'] }),
        404: response({ $ref: '#/components/schemas/MissingRecord' }),
      } } },
      '/intake/prepare': { post: { responses: { 200: response({}) } } },
      '/intake/confirm': { post: { responses: { 200: response({}) } } },
    },
  };
  validateMockResponses(document, bundle);
  const contextMock = bundle.tests[0].request.tool_mock_overrides.offline_get_maintenance_context[0];
  const validContext = contextMock.mock_result;
  const context = JSON.parse(validContext);
  delete context.openWorkOrders;
  contextMock.mock_result = JSON.stringify(context);
  assert.throws(() => validateMockResponses(document, bundle), /mock.complete-intake.get_maintenance_context/);
  contextMock.mock_result = validContext;
  bundle.tests[2].request.tool_mock_overrides.offline_get_maintenance_context[0].mock_result = JSON.stringify({ _tag: 'UnknownAsset', assetId: 'P-999' });
  assert.throws(() => validateMockResponses(document, bundle), /mock.unknown-asset.get_maintenance_context/);
});
test('response schema checks enforce report identifiers, assessment branches, assignment timestamps, and held reasons', () => {
  const shapes = [
    [{ type: 'object', required: ['assetId'], properties: { assetId: { type: 'string' } } }, { assetId: 'P-101' }, { asset: 'P-101' }],
    [{ anyOf: [
      { type: 'object', required: ['kind', 'priority', 'requiredSkill', 'reasons'], properties: { kind: { const: 'eligible' } } },
      { type: 'object', required: ['kind', 'knownPriority', 'missing', 'reasons'], properties: { kind: { const: 'manual-review' } } },
    ] }, { kind: 'manual-review', knownPriority: null, missing: ['leak'], reasons: ['Unknown leak.'] }, { kind: 'manual-review', priority: null, reasons: [] }],
    [{ type: 'object', required: ['workOrderId', 'technicianId', 'allocatedAt'], properties: { allocatedAt: { type: 'string' } } }, { workOrderId: 'WO-1', technicianId: 'Tech-01', allocatedAt: '2026-10-03T00:00:00Z' }, { workOrderId: 'WO-1', technicianId: 'Tech-01', assignedAt: '2026-10-03T00:00:00Z' }],
    [{ type: 'object', required: ['kind', 'reasons'], properties: { kind: { const: 'held' }, reasons: { type: 'array', items: { type: 'string' } } } }, { kind: 'held', reasons: ['Unknown facts.'] }, { kind: 'held' }],
  ];
  for (const [schema, valid, invalid] of shapes) {
    validateJsonSchema({}, schema, valid);
    assert.throws(() => validateJsonSchema({}, schema, invalid), /Schema mismatch/);
  }
});
test('emergency and ambiguous mocks preserve the reported observations and backend outcomes', async () => {
  const bundle = await configuration(env);
  const emergency = JSON.parse(bundle.tests[3].request.tool_mock_overrides.offline_prepare_work_order[0].mock_result);
  assert.match(emergency.draft.report.observations, /Significant active leak/);
  assert.match(emergency.draft.report.observations, /personnel in danger/);
  assert.equal(emergency.draft.assessment.priority, 'CRITICAL');
  const routine = JSON.parse(bundle.tests[0].request.tool_mock_overrides.offline_prepare_work_order[0].mock_result);
  assert.equal(routine.draft.assessment.priority, 'LOW');
  assert.deepEqual(routine.draft.assessment.reasons, ['Reported equipment operates without an explicit urgent condition.']);
  const held = JSON.parse(bundle.tests[4].request.tool_mock_overrides.offline_confirm_work_order[0].mock_result);
  assert.equal(held.workOrder.lifecycle, 'VALIDATED');
  assert.deepEqual(held.workOrder.allocation.reasons, ['Required facts remain unknown or the category is unclassified.']);
});
