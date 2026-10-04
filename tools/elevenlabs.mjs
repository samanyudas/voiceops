import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuration, toolNames, validateOfficialRequests } from './elevenlabs-config.mjs';

const directory = resolve('artifacts/elevenlabs');
const stateFile = resolve(directory, 'state.json');
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function apiClient(key, fetcher = fetch) {
  if (typeof key !== 'string' || !key.trim() || /\s/.test(key)) throw new Error('Configure ELEVENLABS_API_KEY in the ignored .env file.');
  return async (method, path, body) => {
    if (typeof path !== 'string' || !path.startsWith('/v1/convai/')) throw new Error('ElevenLabs requests require a fixed-origin conversation API path.');
    let response;
    try {
      response = await fetcher(`https://api.elevenlabs.io${path}`, {
        method, headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new Error('ElevenLabs request did not return a known outcome. No automatic retry.'); }
    if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${response.status}. Response body omitted.`);
    try { return await response.json(); } catch { throw new Error('ElevenLabs returned an unreadable response. No automatic retry.'); }
  };
}
export function resourceDefinitions(bundle) {
  return [
    ...bundle.tools.map(request => ({ key: request.tool_config.name, path: '/v1/convai/tools', readPath: '/v1/convai/tools/', name: request.tool_config.name, request, idField: 'id' })),
    { key: 'agent', path: '/v1/convai/agents/create', readPath: '/v1/convai/agents/', name: bundle.agent.name, request: bundle.agent, idField: 'agent_id' },
    ...bundle.tests.map(({ key, request }) => ({ key, path: '/v1/convai/agent-testing/create', readPath: '/v1/convai/agent-testing/', name: request.name, request, idField: 'id' })),
  ];
}
export async function provision({ env, state, save, api }) {
  const base = await configuration(env);
  const digest = fingerprint(base);
  if (state.fingerprint && state.fingerprint !== digest) throw new Error('Configuration changed. Use a new state directory after reviewing existing cloud resources.');
  state.fingerprint = digest;
  state.resources ??= {};
  await save(state);
  for (const key of [...toolNames, 'agent', ...base.tests.map(test => test.key)]) {
    const known = state.resources[key];
    if (known?.id) continue;
    if (known?.pending) throw new Error(`Resource ${key} has an uncertain creation outcome. Inspect ElevenLabs and adopt its ID before resume.`);
    const ids = Object.fromEntries(toolNames.map(name => [name, state.resources[name]?.id]));
    const resource = resourceDefinitions(await configuration(env, ids)).find(entry => entry.key === key);
    state.resources[key] = { pending: true, name: resource.name, requestFingerprint: fingerprint(resource.request) };
    await save(state);
    const result = await api('POST', resource.path, resource.request);
    const id = result[resource.idField];
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Creation returned no valid resource identifier. Inspect ElevenLabs before resume.');
    state.resources[key] = { ...state.resources[key], pending: false, id };
    await save(state);
  }
  return state;
}
export function matchesRequest(expected, actual) {
  if (expected === null || typeof expected !== 'object') return expected === actual;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => matchesRequest(value, actual[index]));
  return actual !== null && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => matchesRequest(value, actual[key]));
}
export async function adopt({ state, key, id, api, save, bundle }) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id ?? '')) throw new Error('Supply a valid remote identifier with --id.');
  const resource = resourceDefinitions(bundle).find(entry => entry.key === key);
  if (!resource || !state.resources?.[key]?.pending) throw new Error('Only an uncertain pending resource can be adopted.');
  const remote = await api('GET', resource.readPath + encodeURIComponent(id));
  const name = key === 'agent' ? remote.name : remote.tool_config?.name ?? remote.name;
  if (name !== state.resources[key].name) throw new Error('Remote resource name does not match the pending creation.');
  if (!matchesRequest(resource.request, remote)) throw new Error('Remote resource configuration does not match the pending creation.');
  state.resources[key] = { ...state.resources[key], pending: false, id };
  await save(state);
}
export function summarizeInvocation(result, expectedIds) {
  if (!Array.isArray(result.test_runs) || result.test_runs.length !== expectedIds.length
      || expectedIds.some(id => result.test_runs.filter(run => run.test_id === id).length !== 1)) {
    throw new Error('Invocation does not contain exactly the expected five test runs.');
  }
  const statuses = result.test_runs.map(run => run.status);
  if (statuses.some(status => !['pending', 'passed', 'failed', 'cancelled'].includes(status))) throw new Error('Invocation contains an unknown test status.');
  return { id: result.id, total: statuses.length, pending: statuses.filter(status => status === 'pending').length,
    passed: statuses.filter(status => status === 'passed').length, failed: statuses.filter(status => status === 'failed').length,
    cancelled: statuses.filter(status => status === 'cancelled').length };
}
export async function runTests({ state, api, save, resume = false, delay = ms => new Promise(done => setTimeout(done, ms)), polls = 60 }) {
  const expectedIds = Object.entries(state.resources ?? {}).filter(([key]) => !toolNames.includes(key) && key !== 'agent').map(([, entry]) => entry.id);
  if (!state.resources?.agent?.id || expectedIds.length !== 5 || expectedIds.some(id => !id)) throw new Error('Provision the agent and exactly five tests before a live test run.');
  if (resume && !state.invocation?.id) throw new Error('No invocation identifier exists. Inspect ElevenLabs after an uncertain start.');
  if (!resume) {
    if (state.invocation?.pending) throw new Error('An uncertain or unfinished invocation exists. Inspect ElevenLabs before another paid run.');
    state.invocation = { pending: true };
    await save(state);
    const result = await api('POST', `/v1/convai/agents/${encodeURIComponent(state.resources.agent.id)}/run-tests`, {
      tests: expectedIds.map(test_id => ({ test_id })), repeat_count: 1,
    });
    if (typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id)) throw new Error('Test start returned no valid invocation identifier. Inspect ElevenLabs before another paid run.');
    state.invocation.id = result.id;
    await save(state);
  }
  for (let attempt = 0; attempt < polls; attempt++) {
    const result = await api('GET', `/v1/convai/test-invocations/${encodeURIComponent(state.invocation.id)}`);
    if (result.id !== state.invocation.id) throw new Error('Invocation identifier does not match the saved test run.');
    const summary = summarizeInvocation(result, expectedIds);
    state.invocation.summary = summary;
    if (!summary.pending) state.invocation.pending = false;
    await save(state);
    if (!summary.pending) return summary;
    await delay(2_000);
  }
  throw new Error('Tests remain pending. Resume with --resume. No new run was started.');
}
export async function saveState(value, file = stateFile) {
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, file);
}
export async function main(argv = process.argv.slice(2), env = process.env) {
  const [mode, ...args] = argv;
  const allowed = new Set(['--live', '--resume', '--openapi', '--resource', '--id']);
  const flags = {};
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index])) throw new Error('Unknown option. Use prepare, provision --live, adopt --live, or run-tests --live.');
    const flag = args[index];
    if (flags[flag]) throw new Error('Duplicate option.');
    flags[flag] = ['--live', '--resume'].includes(flag) ? true : args[++index];
    if (!flags[flag]) throw new Error('An option value is missing.');
  }
  if (!['prepare', 'provision', 'adopt', 'run-tests'].includes(mode)) throw new Error('Use prepare, provision --live, adopt --live, or run-tests --live.');
  const bundle = await configuration(env);
  if (flags['--openapi']) validateOfficialRequests(JSON.parse(await readFile(flags['--openapi'], 'utf8')), bundle);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (mode === 'prepare') {
    await writeFile(resolve(directory, 'prepared.json'), JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600 });
    console.log('Prepared three tools, one agent, and five mocked simulation tests. No cloud requests.');
    return;
  }
  if (!flags['--live']) throw new Error('Cloud writes and paid test runs require the explicit --live flag.');
  const api = apiClient(env.ELEVENLABS_API_KEY);
  const lock = resolve(directory, 'state.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); } catch { throw new Error('Another operation owns state.lock. Inspect it before removing a stale lock.'); }
  try {
    let state;
    try { state = JSON.parse(await readFile(stateFile, 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('State is unreadable. Preserve it before recovery.', { cause: error });
      state = {};
    }
    if (mode === 'provision') {
      await provision({ env, state, save: saveState, api });
      console.log('Provisioned three tools, one agent, and five tests. IDs are in ignored artifacts/elevenlabs/state.json.');
    } else if (mode === 'adopt') {
      const ids = Object.fromEntries(toolNames.map(name => [name, state.resources?.[name]?.id]));
      await adopt({ state, key: flags['--resource'], id: flags['--id'], api, save: saveState, bundle: await configuration(env, ids) });
      console.log('Adopted the verified remote resource identifier.');
    } else {
      const summary = await runTests({ state, api, save: saveState, resume: flags['--resume'] });
      console.log(`Mocked conversational tests: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.cancelled} cancelled.`);
      if (summary.passed !== 5) process.exitCode = 1;
    }
  } finally {
    await handle.close();
    await rm(lock);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
