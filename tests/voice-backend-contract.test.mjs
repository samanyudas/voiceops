import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from 'effect';
import { OpenApi } from 'effect/http-api';
import { Api } from '../dist/src/api/definition.js';
import { AssetContext, Prepared, ConfirmationResult } from '../dist/src/domain/models.js';
import { MissingRecord } from '../dist/src/domain/errors.js';
import { assess } from '../dist/src/policy/maintenance.js';
import { checkBackendContract, configuration, toolNames, validateMockResponses } from '../tools/elevenlabs-config.mjs';

const env = { VOICEOPS_PUBLIC_URL: 'https://voiceops.example.com', ELEVENLABS_TOOL_SECRET_ID: 'offline_secret_locator' };
const document = OpenApi.fromApi(Api);

test('hosted tools and every simulation response match the compiled backend contract', async () => {
  const bundle = await configuration(env);
  checkBackendContract(document, bundle);
  validateMockResponses(document, bundle);
  const schemas = [AssetContext, Prepared, ConfirmationResult];
  const ids = bundle.agent.conversation_config.agent.prompt.tool_ids;
  let checked = 0;
  for (const scenario of bundle.tests) {
    for (const [id, mocks] of Object.entries(scenario.request.tool_mock_overrides)) {
      const index = ids.indexOf(id);
      assert(index >= 0, id);
      for (const mock of mocks) {
        const value = JSON.parse(mock.mock_result);
        Schema.decodeUnknownSync(mock.is_error ? MissingRecord : schemas[index])(value);
        checked++;
      }
    }
  }
  assert.equal(checked, 13);
});

test('mock preparation uses the actual deterministic priority and uncertainty rules', async () => {
  const bundle = await configuration(env);
  const prepareId = bundle.agent.conversation_config.agent.prompt.tool_ids[toolNames.indexOf('prepare_work_order')];
  let checked = 0;
  for (const scenario of bundle.tests) {
    for (const mock of scenario.request.tool_mock_overrides[prepareId] ?? []) {
      const { draft } = JSON.parse(mock.mock_result);
      assert.deepEqual(draft.assessment, assess(draft.report), scenario.key);
      checked++;
    }
  }
  assert.equal(checked, 4);
});

test('backend contract validation rejects a missing required context field', async () => {
  const bundle = await configuration(env);
  const contextId = bundle.agent.conversation_config.agent.prompt.tool_ids[0];
  const mock = bundle.tests[0].request.tool_mock_overrides[contextId][0];
  const response = JSON.parse(mock.mock_result);
  delete response.openWorkOrders;
  mock.mock_result = JSON.stringify(response);
  assert.throws(() => validateMockResponses(document, bundle), /Schema mismatch/);
});
