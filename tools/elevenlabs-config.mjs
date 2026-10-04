import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';

const resources = new URL('../resources/elevenlabs/', import.meta.url);
export const toolNames = ['get_maintenance_context', 'prepare_work_order', 'confirm_work_order'];
export const categories = ['abnormal-vibration', 'temperature-issue', 'mechanical-leak', 'electrical-fault', 'instrumentation-fault', 'performance-degradation', 'unclassified'];
const literal = (description, values) => ({ type: 'string', description, ...(values ? { enum: values } : {}) });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
export const factsSchema = object({
  equipment: literal('Reported operating status. Preserve uncertainty as unknown.', ['operating', 'unavailable', 'unknown']),
  leak: literal('Reported leak significance. Preserve uncertainty as unknown.', ['none', 'minor', 'significant', 'unknown']),
  fireOrSmoke: literal('Reported fire or smoke. Silence means unknown.', ['yes', 'no', 'unknown']),
  personnelHazard: literal('Reported personnel hazard. Silence means unknown.', ['yes', 'no', 'unknown']),
  vibration: literal('Reported vibration severity. Silence means unknown.', ['normal', 'abnormal', 'severe', 'unknown']),
  temperature: literal('Reported temperature severity. Silence means unknown.', ['normal', 'abnormal', 'severe', 'unknown']),
});
export const prepareSchema = object({
  asset: literal('The asset identifier reported by the operator.'),
  category: literal('Observed category, not a diagnosis. Use unclassified when unclear.', categories),
  observations: literal('The operator observations, without invented details.'),
  facts: factsSchema,
});
export const confirmSchema = object({
  draftId: literal('The exact draft identifier returned by preparation.'),
  decision: object({
    kind: literal('The explicit duplicate decision after verbal confirmation.', ['no-duplicate-expected', 'new-occurrence', 'same-issue']),
    workOrderId: literal('An actual duplicate candidate identifier. Include only for same-issue.'),
  }, ['kind']),
});

export function publicBackendUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('VOICEOPS_PUBLIC_URL must be an HTTPS origin.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port && url.port !== '443'
      || isIP(hostname) || !hostname.includes('.') || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('VOICEOPS_PUBLIC_URL must be a public HTTPS origin without credentials, paths, or IP addresses.');
  }
  return url.origin;
}
export function secretLocator(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new Error('ELEVENLABS_TOOL_SECRET_ID must identify an existing ElevenLabs secret, not its value.');
  }
  return { secret_id: value };
}
export async function configuration(env, ids = {}) {
  const origin = publicBackendUrl(env.VOICEOPS_PUBLIC_URL);
  const secret = secretLocator(env.ELEVENLABS_TOOL_SECRET_ID);
  const tools = [
    { name: toolNames[0], description: 'Verify the reported asset and retrieve synthetic maintenance history. Unknown assets return an error. This does not mutate work.', method: 'GET', path: '/assets/{assetId}', path_params_schema: { assetId: literal('The operator-reported asset identifier. Never invent an identifier.') } },
    { name: toolNames[1], description: 'Prepare an expiring proposal from observations. Returns draft, assessment, and duplicateCandidates. Does not create or assign work.', method: 'POST', path: '/intake/prepare', request_body_schema: prepareSchema },
    { name: toolNames[2], description: 'Create or update work only after explicit verbal confirmation of this draft and duplicate decision. Returns operation, workOrder, and assignments. Backend owns dispatch.', method: 'POST', path: '/intake/confirm', request_body_schema: confirmSchema },
  ].map(({ name, description, method, path, ...schema }) => ({ tool_config: {
    type: 'webhook', name, description, response_timeout_secs: 20, follow_redirects: false,
    execution_mode: 'immediate', tool_error_handling_mode: 'passthrough',
    api_schema: { url: origin + path, method, request_headers: { 'x-voiceops-tool-key': secret }, ...schema },
  } }));
  const prompt = await readFile(new URL('prompt.txt', resources), 'utf8');
  const agent = {
    name: 'VoiceOps synthetic maintenance PoC', tags: ['voiceops', 'synthetic-poc'],
    conversation_config: {
      agent: { first_message: 'Which asset needs maintenance, and what did you observe?', language: 'en', prompt: {
        prompt, temperature: 0, enable_parallel_tool_calls: false,
        tool_ids: toolNames.map(name => ids[name] ?? `offline_${name}`),
      } },
      conversation: { max_duration_seconds: 300 },
    },
  };
  const fixtures = JSON.parse(await readFile(new URL('scenarios.json', resources), 'utf8'));
  const tests = fixtures.map(({ key, mocks, ...spec }) => ({ key, request: {
    ...spec, type: 'simulation', simulation_max_turns: 16,
    tool_mock_config: { mocking_strategy: 'all', fallback_strategy: 'raise_error' },
    tool_mock_overrides: Object.fromEntries(Object.entries(mocks).map(([name, responses]) => [ids[name] ?? `offline_${name}`, responses])),
  } }));
  return { tools, agent, tests };
}

export function validateJsonSchema(document, schema, value, path = "value") {
  const validate = (schema, value, path) => {
    if (schema.$ref) return validate(document.components.schemas[schema.$ref.split('/').at(-1)], value, path);
    if (schema.anyOf || schema.oneOf) {
      if ((schema.anyOf ?? schema.oneOf).some(option => { try { validate(option, value, path); return true; } catch { return false; } })) return;
      throw new Error(`Schema mismatch at ${path}.`);
    }
    const fail = () => { throw new Error(`Schema mismatch at ${path}.`); };
    if ('const' in schema && value !== schema.const || schema.enum && !schema.enum.includes(value)) fail();
    if (schema.type === 'null' && value !== null) fail();
    if (schema.type === 'string' && (typeof value !== 'string' || schema.minLength && value.length < schema.minLength || schema.maxLength && value.length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value))) fail();
    if (schema.type === 'boolean' && typeof value !== 'boolean') fail();
    if (['integer', 'number'].includes(schema.type) && (typeof value !== 'number' || !Number.isFinite(value) || schema.type === 'integer' && !Number.isInteger(value) || value < schema.minimum || value > schema.maximum)) fail();
    if (schema.type === 'array') {
      if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) fail();
      value.forEach((entry, index) => validate(schema.items ?? {}, entry, `${path}[${index}]`));
    }
    if (schema.type === 'object') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
      for (const key of schema.required ?? []) if (!(key in value)) fail();
      for (const [key, entry] of Object.entries(value)) {
        const property = schema.properties?.[key] ?? schema.additionalProperties;
        if (property === false) fail();
        if (property && property !== true) validate(property, entry, `${path}.${key}`);
      }
    }
  };
  validate(schema, value, path);
}

export function validateOfficialRequests(document, bundle) {
  const validate = (schema, value, path) => validateJsonSchema(document, schema, value, path);
  for (const request of bundle.tools) validate({ $ref: '#/components/schemas/ToolRequestModel' }, request, 'tool');
  validate({ $ref: '#/components/schemas/Body_Create_Agent_v1_convai_agents_create_post' }, bundle.agent, 'agent');
  for (const test of bundle.tests) validate({ $ref: '#/components/schemas/CreateSimulationTestRequest' }, test.request, `test.${test.key}`);
}

export function checkBackendContract(document, bundle) {
  const dereference = schema => {
    if (schema?.$ref) {
      const resolved = schema.$ref.slice(2).split('/').reduce((value, key) => value?.[key], document);
      if (!resolved) throw new Error('Backend OpenAPI contains an unresolved schema reference.');
      return dereference(resolved);
    }
    return schema;
  };
  const choices = schema => {
    const resolved = dereference(schema);
    if (resolved?.enum) return resolved.enum;
    if ('const' in (resolved ?? {})) return [resolved.const];
    if (resolved?.anyOf || resolved?.oneOf) return (resolved.anyOf ?? resolved.oneOf).flatMap(choices);
    return [];
  };
  for (const { tool_config: tool } of bundle.tools) {
    const path = new URL(tool.api_schema.url).pathname.replaceAll('%7B', '{').replaceAll('%7D', '}');
    if (!document.paths?.[path]?.[tool.api_schema.method.toLowerCase()]) throw new Error(`Backend route does not match ${tool.name}.`);
  }
  const input = dereference(document.paths['/intake/prepare'].post.requestBody?.content?.['application/json']?.schema);
  const facts = dereference(input?.properties?.facts);
  if (!input || !facts) throw new Error('Backend preparation schema is missing report facts.');
  for (const [field, schema] of Object.entries(factsSchema.properties)) {
    if (JSON.stringify([...choices(facts.properties?.[field])].sort()) !== JSON.stringify([...schema.enum].sort())) throw new Error(`Backend fact choices differ for ${field}.`);
  }
  if (JSON.stringify([...choices(input.properties?.category)].sort()) !== JSON.stringify([...categories].sort())) throw new Error('Backend fault categories differ from the voice-tool schema.');
}

export function validateMockResponses(document, bundle) {
  const ids = bundle.agent.conversation_config.agent.prompt.tool_ids;
  const toolsById = Object.fromEntries(bundle.tools.map((tool, index) => [ids[index], tool.tool_config]));
  for (const test of bundle.tests) {
    for (const [id, mocks] of Object.entries(test.request.tool_mock_overrides)) {
      const tool = toolsById[id];
      if (!tool) throw new Error('A simulation mock references an unknown voice tool.');
      const path = new URL(tool.api_schema.url).pathname.replaceAll('%7B', '{').replaceAll('%7D', '}');
      const responses = document.paths?.[path]?.[tool.api_schema.method.toLowerCase()]?.responses;
      if (!responses) throw new Error(`Backend responses are missing for ${tool.name}.`);
      for (const mock of mocks) {
        const schemas = Object.entries(responses)
          .filter(([status]) => mock.is_error ? /^[45][0-9]{2}$/.test(status) : status === '200')
          .map(([, response]) => response.content?.['application/json']?.schema)
          .filter(Boolean);
        if (!schemas.length) throw new Error(`Backend response schema is missing for ${tool.name}.`);
        validateJsonSchema(document, { anyOf: schemas }, JSON.parse(mock.mock_result), `mock.${test.key}.${tool.name}`);
      }
    }
  }
}
