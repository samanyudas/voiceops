import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const BOT = 'github-actions[bot]';
const DAY = 86_400_000;
const PREFIX = 'voiceops-release-v1';
const pendingLabel = 'pending-release';
const waitingLabel = 'awaiting-release-confirmation';

export function references(body = '') {
  const numbers = new Set();
  let fence;
  for (const line of body.split(/\r?\n/)) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = undefined;
      continue;
    }
    const match = !fence && line.match(/^Refs #([1-9]\d*)[ \t]*$/);
    if (match && Number.isSafeInteger(Number(match[1]))) numbers.add(Number(match[1]));
  }
  return [...numbers];
}

export function closingKeywords(body = '') {
  return /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[\w.-]+\/[\w.-]+)?#\d+|\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+https:\/\/github\.com\/[^\s]+\/issues\/\d+/i.test(body);
}

export function eligible(issue) {
  const labels = issue.labels.map(label => (typeof label === 'string' ? label : label.name).toLowerCase());
  return !issue.pull_request && labels.includes('bug') && labels.includes('release-tracking') &&
    !labels.some(label => /(?:summary|spec|partial|security)/i.test(label)) &&
    !/\b(summary|spec|specification|partial|security)\b/i.test(issue.title);
}

export function marker(record) {
  return `<!-- ${PREFIX} ${JSON.stringify(record)} -->`;
}

export function records(comments) {
  return comments.flatMap(comment => {
    if (comment.user?.login !== BOT || comment.user?.type !== 'Bot') return [];
    const match = comment.body.match(new RegExp(`<!-- ${PREFIX} (.+) -->`));
    if (!match) return [];
    try {
      const record = JSON.parse(match[1]);
      return [{ ...record, comment }];
    } catch { return []; }
  });
}

export function stable(release) {
  return !release.draft && !release.prerelease && Boolean(release.published_at) &&
    release.assets?.some(asset => asset.state === 'uploaded' && asset.size > 0);
}

export function humanAfter(comments, date) {
  return comments.some(comment => comment.user?.type === 'User' && Date.parse(comment.created_at) >= Date.parse(date));
}

export function createClient({ token, repository, dryRun = true, fetchImpl = fetch, log = console.log }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
  const base = `https://api.github.com/repos/${repository}`;
  async function request(method, path, body) {
    if (method !== 'GET' && dryRun) {
      log(JSON.stringify({ dryRun: true, method, path, body }));
      return null;
    }
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  return {
    dryRun, request, plan: operation => log(JSON.stringify({ dryRun: true, ...operation })),
    async list(path) {
      const result = [];
      for (let page = 1; ; page++) {
        const batch = await request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
        result.push(...batch);
        if (batch.length < 100) return result;
      }
    },
  };
}

export async function run({ api, eventName, event, now = new Date() }) {
  const write = (method, path, body) => api.dryRun
    ? api.plan?.({ method, path, body })
    : api.request(method, path, body);
  const comment = (number, body) => write('POST', `/issues/${number}/comments`, { body });
  const commentsFor = number => api.list(`/issues/${number}/comments`);
  const label = (number, name) => write('POST', `/issues/${number}/labels`, { labels: [name] });
  async function removeLabel(issue, name) {
    if (issue.labels.some(value => (value.name ?? value) === name)) {
      await write('DELETE', `/issues/${issue.number}/labels/${encodeURIComponent(name)}`);
    }
  }
  async function track(pr) {
    if (!pr.merged_at || !/^[a-f0-9]{40}$/i.test(pr.merge_commit_sha ?? '')) return;
    for (const number of references(pr.body ?? '')) {
      const issue = await api.request('GET', `/issues/${number}`);
      if (!eligible(issue) || issue.state !== 'open') continue;
      const history = records(await commentsFor(number));
      if (!history.some(record => record.kind === 'fix' && record.sha === pr.merge_commit_sha)) {
        await comment(number, `PR #${pr.number} merged. This issue remains open until a stable release contains the fix.\n\n${marker({ kind: 'fix', pr: pr.number, sha: pr.merge_commit_sha })}`);
      }
      if (!history.some(record => record.kind === 'ask' && record.shas?.includes(pr.merge_commit_sha))) await label(number, pendingLabel);
    }
  }
  if (eventName === 'pull_request_target') {
    const pr = event.pull_request;
    if (closingKeywords(`${pr.title}\n${pr.body ?? ''}`)) {
      const history = records(await commentsFor(pr.number));
      if (!history.some(record => record.kind === 'warning')) {
        await comment(pr.number, `Closing keywords can close issues before users receive a release. Use a standalone line such as \`Refs #123\` for release-tracked bugs.\n\n${marker({ kind: 'warning' })}`);
      }
    }
    await track(pr);
    return;
  }

  // Reconcile missed merge events as well as token-created release events.
  if (eventName !== 'issue_comment') {
    for (const pr of await api.list('/pulls?state=closed&sort=updated&direction=desc')) await track(pr);
  }
  const issues = eventName === 'issue_comment'
    ? [await api.request('GET', `/issues/${event.issue.number}`)]
    : await api.list('/issues?state=all&labels=release-tracking');
  const releases = eventName === 'issue_comment' ? [] : (await api.list('/releases')).filter(stable)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const comparisons = new Map();
  async function contains(release, sha) {
    const key = `${sha}...${encodeURIComponent(release.tag_name)}`;
    if (!comparisons.has(key)) {
      const comparison = await api.request('GET', `/compare/${key}`);
      comparisons.set(key, ['ahead', 'identical'].includes(comparison.status) && comparison.merge_base_commit?.sha === sha);
    }
    return comparisons.get(key);
  }
  for (let issue of issues) {
    if (!eligible(issue)) continue;
    let comments = await commentsFor(issue.number);
    let history = records(comments);
    const fixes = history.filter(record => record.kind === 'fix');
    const asks = history.filter(record => record.kind === 'ask');
    const ask = asks.at(-1);
    if (issue.state === 'closed') {
      const closure = history.filter(record => record.kind === 'closed').at(-1);
      if (!closure || !ask) continue;
      const transitions = (await api.list(`/issues/${issue.number}/events`)).filter(item => ['closed', 'reopened'].includes(item.event));
      const last = transitions.at(-1);
      if (last?.event === 'closed' && last.actor?.login === BOT && last.actor?.type === 'Bot' &&
          last.id === closure.event && closure.ask === ask.comment.id &&
          humanAfter(comments, ask.comment.created_at)) {
        await write('PATCH', `/issues/${issue.number}`, { state: 'open' });
        await removeLabel(issue, waitingLabel);
      }
      continue;
    }
    if (!fixes.length) continue;
    // Any human response to a request ends automatic closure for this issue.
    if (asks.some(value => humanAfter(comments, value.comment.created_at))) {
      await removeLabel(issue, waitingLabel);
      continue;
    }
    const shas = [...new Set(fixes.map(fix => fix.sha))].sort();
    if (!ask || JSON.stringify(ask.shas) !== JSON.stringify(shas)) {
      for (const release of releases) {
        if (!(await Promise.all(shas.map(sha => contains(release, sha)))).every(Boolean)) continue;
        await comment(issue.number, `@${issue.user.login}, the stable release [${release.tag_name}](${release.html_url}) contains the tracked fixes. Can you test it and report whether this bug is resolved? Any human reply stops automatic closure. Without a reply, this issue will close after 14 days. A later reply will reopen an issue closed by this follow-up.\n\n${marker({ kind: 'ask', shas, release: release.id })}`);
        await label(issue.number, waitingLabel);
        await removeLabel(issue, pendingLabel);
        break;
      }
      continue;
    }
    await label(issue.number, waitingLabel);
    await removeLabel(issue, pendingLabel);
    if (now - new Date(ask.comment.created_at) < 14 * DAY) continue;
    // Re-read before closure to catch replies and maintainer changes during this run.
    issue = await api.request('GET', `/issues/${issue.number}`);
    comments = await commentsFor(issue.number);
    history = records(comments);
    if (!eligible(issue) || issue.state !== 'open' || humanAfter(comments, ask.comment.created_at) ||
        history.filter(value => value.kind === 'ask').at(-1)?.comment.id !== ask.comment.id ||
        history.some(value => value.kind === 'fix' && !shas.includes(value.sha))) continue;
    await write('PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: 'not_planned' });
    if (!api.dryRun) {
      const transitions = (await api.list(`/issues/${issue.number}/events`)).filter(item => ['closed', 'reopened'].includes(item.event));
      const closed = transitions.at(-1);
      if (closed?.event === 'closed' && closed.actor?.login === BOT && closed.actor?.type === 'Bot') {
        await comment(issue.number, `Closed this release confirmation request after 14 days without a human reply. Reply if the bug remains and this follow-up will reopen the issue.\n\n${marker({ kind: 'closed', ask: ask.comment.id, event: closed.id })}`);
      }
    }
    await removeLabel(issue, waitingLabel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const api = createClient({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY, dryRun: process.env.DRY_RUN !== 'false' });
  await run({ api, eventName: process.env.GITHUB_EVENT_NAME, event });
}
