import test from 'node:test';
import assert from 'node:assert/strict';
import { closingKeywords, createClient, eligible, marker, records, references, run, stable } from '../tools/issue-lifecycle.mjs';

const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const bot = { login: 'github-actions[bot]', type: 'Bot' };
const human = { login: 'reporter', type: 'User' };
const start = '2026-01-01T00:00:00Z';
const due = new Date('2026-01-15T00:00:00Z');
const issue = () => ({ number: 1, title: 'Crash on save', state: 'open', labels: ['bug', 'release-tracking'], user: human });
const fix = value => ({ kind: 'fix', pr: 2, sha: value });
const ask = () => ({ kind: 'ask', shas: [sha], release: 3 });
const release = () => ({ id: 3, tag_name: 'v1.0.0', html_url: 'https://github.com/example/repo/releases/tag/v1.0.0', published_at: start, draft: false, prerelease: false, assets: [{ state: 'uploaded', size: 1 }] });
const comment = (record, id = 1, created_at = start, user = bot) => ({ id, body: marker(record), created_at, user });

function fixture(options = {}) {
  const state = {
    issue: issue(), comments: [], pulls: [], releases: [], events: [], status: 'ahead', writes: [], reads: [], ...options,
  };
  let id = 100;
  const api = {
    dryRun: Boolean(options.dryRun),
    async list(path) {
      state.reads.push(path);
      if (path.startsWith('/pulls?')) return structuredClone(state.pulls);
      if (path.startsWith('/issues?')) return [structuredClone(state.issue)];
      if (path === '/releases') return structuredClone(state.releases);
      if (path.endsWith('/comments')) {
        options.beforeComments?.(state);
        return structuredClone(state.comments);
      }
      if (path.endsWith('/events')) return structuredClone(state.events);
      throw new Error(`Unexpected list ${path}`);
    },
    async request(method, path, body) {
      if (method === 'GET') {
        if (path === '/issues/1') return structuredClone(state.issue);
        if (path.startsWith('/compare/')) return { status: state.status, merge_base_commit: { sha: state.compareSha ?? path.split('/')[2].split('...')[0] } };
        throw new Error(`Unexpected GET ${path}`);
      }
      state.writes.push({ method, path, body });
      if (path.endsWith('/comments')) state.comments.push({ id: id++, body: body.body, user: bot, created_at: options.writeTime ?? due.toISOString() });
      if (method === 'PATCH') {
        state.issue.state = body.state;
        state.events.push({ id: id++, event: body.state === 'closed' ? 'closed' : 'reopened', actor: bot, created_at: due.toISOString() });
        options.afterPatch?.(state);
      }
      if (method === 'POST' && path.endsWith('/labels')) state.issue.labels = [...new Set([...state.issue.labels, ...body.labels])];
      if (method === 'DELETE') state.issue.labels = state.issue.labels.filter(value => value !== decodeURIComponent(path.split('/').at(-1)));
    },
  };
  const execute = (eventName = 'schedule', event = {}) => run({ api, eventName, event, now: options.now ?? due });
  return { state, api, execute };
}

const merged = (value = sha) => ({ number: 2, title: 'Fix crash', body: 'Refs #1', merged_at: start, merge_commit_sha: value });
const asksIn = state => records(state.comments).filter(value => value.kind === 'ask');
const patches = state => state.writes.filter(value => value.method === 'PATCH');

test('references require an exact standalone line outside fenced examples', () => {
  assert.deepEqual(references('Related #8\nRefs #1\nRefs #1\nRefs #2 and #3\n> Refs #4\n```md\nRefs #5\n```\nRefs #6'), [1, 6]);
  for (const text of ['Fixes #1', 'Closes org/repo#2', 'Resolved https://github.com/a/b/issues/3']) assert.ok(closingKeywords(text));
  assert.equal(closingKeywords('Refs #1'), false);
});

test('eligibility requires opt-in bugs and excludes protected reports', () => {
  assert.ok(eligible(issue()));
  for (const name of ['summary', 'spec', 'partial-fix', 'security']) assert.equal(eligible({ ...issue(), labels: [...issue().labels, name] }), false);
  assert.equal(eligible({ ...issue(), labels: ['bug'] }), false);
  assert.equal(eligible({ ...issue(), labels: ['release-tracking'] }), false);
  assert.equal(eligible({ ...issue(), title: 'Summary of bugs' }), false);
  assert.equal(eligible({ ...issue(), pull_request: {} }), false);
});

test('only github-actions bot markers are trusted', () => {
  assert.equal(records([comment(fix(sha), 1, start, human)]).length, 0);
  assert.equal(records([comment(fix(sha), 1, start, { ...bot, login: 'other[bot]' })]).length, 0);
  assert.equal(records([{ ...comment(fix(sha)), body: '<!-- voiceops-release-v1 invalid -->' }]).length, 0);
});

test('merged references retain every fix and retries do not duplicate markers', async () => {
  const f = fixture();
  await f.execute('pull_request_target', { pull_request: merged() });
  await f.execute('pull_request_target', { pull_request: merged() });
  await f.execute('pull_request_target', { pull_request: merged(otherSha) });
  assert.deepEqual(records(f.state.comments).map(value => value.sha), [sha, otherSha]);
  assert.ok(f.state.issue.labels.includes('pending-release'));
  assert.equal(patches(f.state).length, 0);
});

test('closing keyword warning is idempotent', async () => {
  const f = fixture();
  const pr = { ...merged(), merged_at: null, body: 'Fixes #1' };
  await f.execute('pull_request_target', { pull_request: pr });
  await f.execute('pull_request_target', { pull_request: pr });
  assert.equal(records(f.state.comments).filter(value => value.kind === 'warning').length, 1);
});

test('schedule repairs a missed merge event and asks only after ancestry proof', async () => {
  const f = fixture({ pulls: [merged()], releases: [release()] });
  await f.execute();
  await f.execute();
  assert.equal(asksIn(f.state).length, 1);
  assert.ok(f.state.issue.labels.includes('awaiting-release-confirmation'));
  assert.ok(!f.state.issue.labels.includes('pending-release'));
});

test('prereleases, drafts, and releases without uploaded assets cannot qualify', async () => {
  for (const change of [{ prerelease: true }, { draft: true }, { assets: [] }, { assets: [{ state: 'new', size: 1 }] }]) {
    const candidate = { ...release(), ...change };
    assert.equal(stable(candidate), false);
    const f = fixture({ comments: [comment(fix(sha))], releases: [candidate] });
    await f.execute('release');
    assert.equal(asksIn(f.state).length, 0);
  }
});

test('diverged, behind, and wrong merge-base comparisons do not prove release inclusion', async () => {
  for (const change of [{ status: 'diverged' }, { status: 'behind' }, { compareSha: otherSha }]) {
    const f = fixture({ comments: [comment(fix(sha))], releases: [release()], ...change });
    await f.execute();
    assert.equal(asksIn(f.state).length, 0);
  }
});

test('all tracked fixes must occur in the same stable release', async () => {
  const f = fixture({ comments: [comment(fix(sha)), comment(fix(otherSha), 2)], releases: [release()], compareSha: sha });
  await f.execute();
  assert.equal(asksIn(f.state).length, 0);
});

test('unasked issues never close even after long inactivity', async () => {
  const f = fixture({ comments: [comment(fix(sha))] });
  await f.execute();
  assert.equal(patches(f.state).length, 0);
});

test('unanswered requests close at 14 days, not sooner, and do not close twice', async () => {
  const early = fixture({ comments: [comment(fix(sha)), comment(ask(), 2)], now: new Date(due - 1) });
  await early.execute();
  assert.equal(patches(early.state).length, 0);
  const f = fixture({ comments: [comment(fix(sha)), comment(ask(), 2)] });
  await f.execute();
  await f.execute();
  assert.equal(patches(f.state).length, 1);
  assert.equal(f.state.issue.state, 'closed');
  assert.ok(records(f.state.comments).some(value => value.kind === 'closed'));
});

test('any human reply stops closure, including a reply found on the final read', async () => {
  const reply = { id: 3, body: 'Still checking', user: { ...human, login: 'maintainer' }, created_at: '2026-01-02T00:00:00Z' };
  for (const finalRead of [false, true]) {
    let reads = 0;
    const f = fixture({ comments: [comment(fix(sha)), comment(ask(), 2), ...(finalRead ? [] : [reply])], beforeComments(state) {
      if (finalRead && ++reads === 2) state.comments.push(reply);
    } });
    await f.execute();
    assert.equal(patches(f.state).length, 0);
  }
});

test('bot replies do not stop closure', async () => {
  const f = fixture({ comments: [comment(fix(sha)), comment(ask(), 2), { id: 3, body: 'bot note', user: bot, created_at: '2026-01-02T00:00:00Z' }] });
  await f.execute();
  assert.equal(f.state.issue.state, 'closed');
});

test('a new unreleased fix stops an older confirmation from closing', async () => {
  const f = fixture({ comments: [comment(fix(sha)), comment(ask(), 2), comment(fix(otherSha), 3)] });
  await f.execute();
  assert.equal(patches(f.state).length, 0);
});

test('late human replies reopen only this workflow closure event', async () => {
  const f = fixture({ comments: [comment(fix(sha)), comment(ask(), 2)] });
  await f.execute();
  f.state.comments.push({ id: 999, body: 'Still broken', user: human, created_at: '2026-01-16T00:00:00Z' });
  await f.execute('issue_comment', { issue: { number: 1 } });
  assert.equal(f.state.issue.state, 'open');
  await f.execute();
  assert.equal(f.state.issue.state, 'open');
});

test('manual closures and unrelated bot closures never reopen', async () => {
  for (const actor of [human, bot]) {
    const f = fixture({ comments: [comment(fix(sha)), comment(ask(), 2)] });
    await f.execute();
    f.state.events.push({ id: 800, event: 'reopened', actor: human, created_at: due.toISOString() }, { id: 801, event: 'closed', actor, created_at: due.toISOString() });
    f.state.comments.push({ id: 999, body: 'Still broken', user: human, created_at: '2026-01-16T00:00:00Z' });
    await f.execute('issue_comment', { issue: { number: 1 } });
    assert.equal(f.state.issue.state, 'closed');
  }
});

test('intervening state transitions cannot be adopted as this workflow closure', async () => {
  const f = fixture({ comments: [comment(fix(sha)), comment(ask(), 2)], afterPatch(state) {
    state.events.push({ id: 800, event: 'reopened', actor: human }, { id: 801, event: 'closed', actor: bot });
  } });
  await f.execute();
  assert.equal(records(f.state.comments).some(value => value.kind === 'closed'), false);
  f.state.comments.push({ id: 999, body: 'Still broken', user: human, created_at: '2026-01-16T00:00:00Z' });
  await f.execute('issue_comment', { issue: { number: 1 } });
  assert.equal(f.state.issue.state, 'closed');
});

test('dry-run orchestration performs no writes for merges, requests, or closure', async () => {
  for (const options of [{ pulls: [merged()], releases: [release()] }, { comments: [comment(fix(sha))], releases: [release()] }, { comments: [comment(fix(sha)), comment(ask(), 2)] }]) {
    const f = fixture({ ...options, dryRun: true });
    await f.execute();
    assert.deepEqual(f.state.writes, []);
  }
});

test('HTTP client paginates comments and refuses writes in dry-run', async () => {
  const calls = [];
  const plans = [];
  const api = createClient({ repository: 'example/repo', token: 'test-token', log: value => plans.push(value), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => url.endsWith('page=1') ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }] };
  } });
  assert.equal((await api.list('/issues/1/comments')).length, 101);
  await api.request('POST', '/issues/1/comments', { body: 'Never send this' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(value => value.options.method === 'GET'));
  assert.equal(plans.length, 1);
});

test('unterminated fenced examples cannot create references', () => {
  assert.deepEqual(references('Refs #1\n```text\nRefs #2'), [1]);
  assert.deepEqual(references('~~~\nRefs #2\n~~~\nRefs #3\r\nRefs #99999999999999999999'), [3]);
});

test('protected or opted-out issues never get changed', async () => {
  for (const extra of [{ labels: ['bug'] }, { labels: ['bug', 'release-tracking', 'partial'] }, { title: 'Spec for fixes' }]) {
    const f = fixture({ issue: { ...issue(), ...extra }, pulls: [merged()], comments: [comment(fix(sha)), comment(ask(), 2)], releases: [release()] });
    await f.execute();
    assert.deepEqual(f.state.writes, []);
  }
});

test('dry-run warning and reopening perform no writes', async () => {
  const warning = fixture({ dryRun: true });
  await warning.execute('pull_request_target', { pull_request: { ...merged(), body: 'Fixes #1' } });
  assert.deepEqual(warning.state.writes, []);
  const f = fixture({ comments: [comment(fix(sha)), comment(ask(), 2)] });
  await f.execute();
  f.state.comments.push({ id: 999, body: 'Still broken', user: human, created_at: '2026-01-16T00:00:00Z' });
  f.api.dryRun = true;
  f.state.writes = [];
  await f.execute('issue_comment', { issue: { number: 1 } });
  assert.deepEqual(f.state.writes, []);
  assert.equal(f.state.issue.state, 'closed');
});

test('a human response on the second comments page stops closure', async () => {
  const allComments = [comment(fix(sha)), comment(ask(), 2), ...Array.from({ length: 98 }, (_, i) => ({ id: i + 3, body: 'note', user: bot, created_at: start })), { id: 101, body: 'Still broken', user: human, created_at: '2026-01-02T00:00:00Z' }];
  const writes = [];
  const api = createClient({ repository: 'example/repo', token: 'test-token', dryRun: false, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    const query = new URL(url).searchParams;
    if (options.method !== 'GET') writes.push(options);
    let data;
    if (path.endsWith('/pulls') || path.endsWith('/releases')) data = [];
    else if (path.endsWith('/issues')) data = [issue()];
    else if (path.endsWith('/comments')) data = query.get('page') === '1' ? allComments.slice(0, 100) : allComments.slice(100);
    else throw new Error(`Unexpected path ${path}`);
    return { ok: true, status: 200, json: async () => data };
  } });
  await run({ api, eventName: 'schedule', event: {}, now: due });
  assert.deepEqual(writes, []);
});
