// VoiceOps demo page. Every card is rendered from a real backend response.
// Play mode types the operator's words instead of speaking them; Live mode
// streams microphone audio to the hosted ElevenLabs agent.

const STEPS = ['Call', 'Understand', 'Decide', 'Confirm', 'Dispatch', 'Resolve'];
const LIFECYCLE = ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const SCRIPT = {
  operator: "Pump P-101 has a mechanical leak. It's unavailable. The leak is minor. No fire or smoke, nobody is at risk, vibration and temperature are normal. This is a new occurrence.",
  assetId: 'P-101',
  prepare: {
    asset: 'P-101', category: 'mechanical-leak', observations: 'A minor seal leak. The pump is unavailable.',
    facts: { equipment: 'unavailable', leak: 'minor', fireOrSmoke: 'no', personnelHazard: 'no', vibration: 'normal', temperature: 'normal' }
  }
};

const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const shortId = id => (id.length > 24 ? id.slice(0, 8) : id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------- step rail and cards ----------

const cards = new Array(STEPS.length).fill(null);
const status = new Array(STEPS.length).fill('todo');
let viewing = 0;

const flow = $('flow');
const fill = document.createElement('div');
fill.className = 'fill';
flow.append(fill);
STEPS.forEach((name, index) => {
  const item = document.createElement('li');
  item.innerHTML = `<button class="step" data-index="${index}"><div class="ring"></div><span>${name}</span></button>`;
  flow.append(item);
});
flow.addEventListener('click', event => {
  const button = event.target.closest('.step');
  if (!button || !cards[button.dataset.index]) return;
  viewing = Number(button.dataset.index);
  render();
});

function setStep(index, state, card) {
  status[index] = state;
  if (card) cards[index] = card;
  viewing = index;
  render();
}

function render() {
  const last = status.reduce((acc, s, i) => (s === 'todo' ? acc : i), 0);
  fill.style.width = `calc(${last / (STEPS.length - 1)} * (100% - 18px))`;
  flow.querySelectorAll('.step').forEach((button, i) => {
    button.className = `step ${status[i] === 'todo' ? '' : status[i]} ${i === viewing ? 'viewing' : ''}`;
  });
  const card = cards[viewing];
  const element = $('card');
  element.className = `card ${status[viewing] === 'fail' ? 'fail' : ''}`;
  element.innerHTML = card
    ? `<div class="fade"><div class="m">Step ${viewing + 1} of 6 · ${STEPS[viewing]}</div><h2>${card.title}</h2>${card.body}${out(card.out, card.call)}</div>`
    : `<div class="m">Ready</div><h2>Press Play to watch a fault report go through the system.</h2><p>Pump P-101 is leaking and can't run. Every step below calls the real backend and Postgres.</p>`;
}

function out(items = [], call) {
  const parts = items.map(([k, v]) => `<span><i>${esc(k)}</i> ${esc(v)}</span>`);
  if (call) parts.push(`<span><span class="tag ${call.status < 400 ? 'real' : 'err'}">${call.source === 'voice-agent' ? 'voice agent' : 'real'}</span> ${esc(call.method)} ${esc(call.path)} · ${call.status} · ${call.ms} ms</span>`);
  return parts.length ? `<div class="out">${parts.join('')}</div>` : '';
}

function failCard(index, title, error) {
  setStep(index, 'fail', { title, body: `<p>${esc(error.message)}</p>`, call: error.call });
}

function resetRun() {
  cards.fill(null);
  status.fill('todo');
  viewing = 0;
  render();
}

// ---------- backend calls through the demo server ----------

class CallError extends Error {
  constructor(message, call) { super(message); this.call = call; }
}

async function api(method, path, body) {
  const started = performance.now();
  const response = await fetch(`/demo/api${path}`, {
    method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json().catch(() => null);
  const ms = Number(response.headers.get('x-demo-latency-ms') ?? Math.round(performance.now() - started));
  const call = { method, path, status: response.status, ms, source: 'ui' };
  if (!response.ok) throw new CallError(`${method} ${path} returned HTTP ${response.status}: ${result?.error ?? result?.message ?? JSON.stringify(result)}`, call);
  return { result, call };
}

const runId = () => crypto.randomUUID().slice(0, 8);

// ---------- shared stage renderers ----------

function understandCard(context, call) {
  const open = context.openWorkOrders;
  return {
    title: `The agent looks up ${esc(context.asset.id)}`,
    body: `<p>It's the ${esc(context.asset.name.toLowerCase())}. ${open.length ? `There ${open.length === 1 ? 'is' : 'are'} ${open.length} job${open.length === 1 ? '' : 's'} already open on it, so the system will check for a duplicate.` : 'No jobs are open on it.'}</p>`,
    out: [['asset', context.asset.id], ['open jobs', open.length], ['last note', context.history[0]?.note ?? 'none']],
    call
  };
}

function decideCard(prepared, call) {
  const a = prepared.draft.assessment;
  const eligible = a.kind === 'eligible';
  return {
    title: eligible ? `Rules set the priority to ${a.priority}` : 'Rules hold it for manual review',
    body: `<p>${eligible ? `Fixed rules, not an AI guess, decide the priority from the reported facts. The job needs a <b>${esc(a.requiredSkill)}</b> technician.` : 'Some facts are unknown, so the rules refuse to guess a priority.'}</p>
      <ul class="reasons">${a.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`,
    out: [['priority', eligible ? a.priority : a.knownPriority ?? 'unknown'], ['skill', eligible ? a.requiredSkill : 'n/a'], ['next', prepared.kind], ['draft expires', new Date(prepared.draft.expiresAt).toLocaleTimeString()]],
    call
  };
}

function confirmCard(prepared, confirmation, decision, call) {
  const duplicate = prepared.kind === 'duplicate-decision-required';
  return {
    title: confirmation.operation === 'created' ? 'A work order is created' : 'The report is added to the open job',
    body: `<p>${duplicate ? `The agent asked whether this repeats job <b>${esc(prepared.draft.duplicateCandidates[0]?.id ?? '')}</b>. The operator said it's ${decision.kind === 'same-issue' ? 'the same issue' : 'a new fault'}.` : 'Nothing similar is open, so the operator just confirms.'} The order, the report, and its first events are saved in one database transaction.</p>`,
    out: [['work order', shortId(confirmation.workOrder.id)], ['operation', confirmation.operation], ['lifecycle', confirmation.workOrder.lifecycle]],
    call
  };
}

function techsHtml(state, highlight) {
  return `<div class="techs">${state.technicians.map(t => {
    const job = state.assignments.find(a => a.technicianId === t.id && a.releasedAt === null);
    return `<div class="tech ${t.id === highlight ? 'hl' : ''}">${esc(t.id)}<small>${esc(t.skills.join(' · '))}</small><small>${job ? `busy · ${esc(shortId(job.workOrderId))}` : 'free'}</small></div>`;
  }).join('')}</div>`;
}

function dispatchCard(order, state, skill, call) {
  const alloc = order.allocation;
  if (alloc.kind === 'assigned') return {
    title: `Assigned to ${esc(alloc.technicianId)}`,
    body: `<p>The dispatcher picked a free technician with the <b>${esc(skill)}</b> skill. A database constraint guarantees nobody holds two active jobs.</p>${techsHtml(state, alloc.technicianId)}`,
    out: [['allocation', 'assigned'], ['technician', alloc.technicianId]], call
  };
  if (alloc.kind === 'queued') return {
    title: 'Waiting for the right technician',
    body: `<p>Every technician with the <b>${esc(skill)}</b> skill is busy, so the job waits in line, ordered by priority then arrival time. It will be assigned the moment one is free.</p>${techsHtml(state)}`,
    out: [['allocation', 'queued'], ['queue position', state.queue.indexOf(order.id) + 1]], call
  };
  return {
    title: 'Held for manual review',
    body: `<p>The job is saved but not dispatched, because the rules couldn't establish its urgency. This proof of concept has no release action, so the run ends here.</p>`,
    out: [['allocation', alloc.kind], ['reasons', (alloc.reasons ?? []).join('; ')]], call
  };
}

// ---------- the dispatch and technician sequence (shared by both modes) ----------

async function technicianAct(order, action, technicianId, tag) {
  const { result, call } = await api('POST', '/technician/actions', { requestId: `demo-${tag}-${action}-${runId()}`, workOrderId: order, technicianId, action });
  return { result, call };
}

// Free a technician with the needed skill by finishing their current job.
// Prefer the open job the operator was asked about, so the story stays on one asset.
async function releaseTechnician(skill, ownOrder, preferred = []) {
  const { result: state } = await api('GET', '/state');
  const skilled = new Set(state.technicians.filter(t => t.skills.includes(skill)).map(t => t.id));
  const candidates = state.assignments.filter(a => a.releasedAt === null && skilled.has(a.technicianId) && a.workOrderId !== ownOrder);
  const busy = candidates.find(a => preferred.includes(a.workOrderId)) ?? candidates[0];
  if (!busy) return null;
  const current = state.workOrders.find(w => w.id === busy.workOrderId)?.lifecycle;
  const needed = { ASSIGNED: ['acknowledge', 'start', 'resolve'], ACKNOWLEDGED: ['start', 'resolve'], IN_PROGRESS: ['resolve'] }[current] ?? [];
  let call;
  for (const action of needed) ({ call } = await technicianAct(busy.workOrderId, action, busy.technicianId, 'release'));
  return { technicianId: busy.technicianId, workOrderId: busy.workOrderId, call };
}

async function dispatchAndResolve(confirmation, skill, confirmCall, related = []) {
  const id = confirmation.workOrder.id;
  let { result: state } = await api('GET', '/state');
  let order = confirmation.workOrder;
  setStep(4, order.allocation.kind === 'assigned' ? 'done' : 'now', dispatchCard(order, state, skill, confirmCall));
  if (order.allocation.kind === 'held') return;
  if (confirmation.operation === 'report-added') {
    cards[4].body += '<p>The report joined the existing job, which keeps its current technician and lifecycle.</p>';
    status[4] = 'done';
    render();
    return;
  }

  if (order.allocation.kind === 'queued') {
    await pace();
    const released = await releaseTechnician(skill, id, related);
    if (!released) throw new CallError('No technician with the needed skill can be released.', undefined);
    const view = await api('GET', `/work-orders/${id}`);
    ({ result: state } = await api('GET', '/state'));
    order = view.result;
    setStep(4, 'done', {
      ...dispatchCard(order, state, skill, released.call),
      body: `<p>${esc(released.technicianId)} finished their previous job <b>${esc(shortId(released.workOrderId))}</b>. In the same transaction that released them, the queue handed them this job.</p>${techsHtml(state, released.technicianId)}`
    });
  }
  if (order.allocation.kind !== 'assigned') throw new CallError(`Expected an assignment but the job is ${order.allocation.kind}.`, undefined);

  await pace();
  const tech = order.allocation.technicianId;
  const reached = [];
  for (const action of ['acknowledge', 'start', 'resolve', 'close']) {
    const { result, call } = await technicianAct(id, action, tech, 'job');
    reached.push(result.workOrder.lifecycle);
    const closed = result.workOrder.lifecycle === 'CLOSED';
    setStep(5, closed ? 'done' : 'now', {
      title: closed ? 'The job is closed' : `${esc(tech)}: ${action}`,
      body: `<p>${closed ? `${esc(tech)} acknowledged, started, resolved, and closed the job. Each step was checked against the allowed transitions and written to an append-only event log.` : 'The technician moves the job through its lifecycle.'}</p>
        <div class="lifecycle">${LIFECYCLE.map(l => `<span class="${l === 'ASSIGNED' || reached.includes(l) ? 'on' : ''}">${l}</span>`).join('')}</div>`,
      out: [['lifecycle', result.workOrder.lifecycle], ['technician', tech]], call
    });
    if (!closed) await sleep(900);
  }
  const final = await api('GET', '/state');
  const events = final.result.events.filter(e => e.workOrderId === id);
  cards[5].out.push(['events recorded', events.length]);
  render();
}

// ---------- Play mode ----------

let mode = 'play';
let running = false;
let paused = false;
let advance = null;

async function pace() {
  if (mode !== 'play') return;
  await new Promise(resolve => {
    advance = resolve;
    if (!paused) setTimeout(() => { if (!paused) resolve(); }, 2800);
  });
  advance = null;
}

async function playScenario() {
  running = true;
  resetRun();
  let index = 0;
  try {
    setStep(0, 'done', {
      title: 'An operator reports a fault',
      body: `<p class="quote">“${esc(SCRIPT.operator)}”</p><p>In Play mode these words are typed, not spoken. Switch to Live voice to say them yourself.</p>`,
      out: [['asset', SCRIPT.assetId], ['voice', 'simulated']]
    });
    await pace();
    index = 1;
    const asset = await api('GET', `/assets/${SCRIPT.assetId}`);
    setStep(1, 'done', understandCard(asset.result, asset.call));
    await pace();
    index = 2;
    const prepared = await api('POST', '/intake/prepare', SCRIPT.prepare);
    setStep(2, 'done', decideCard(prepared.result, prepared.call));
    await pace();
    index = 3;
    const decision = prepared.result.kind === 'duplicate-decision-required' ? { kind: 'new-occurrence' } : { kind: 'no-duplicate-expected' };
    const confirmed = await api('POST', '/intake/confirm', { draftId: prepared.result.draft.id, decision });
    setStep(3, 'done', confirmCard(prepared.result, confirmed.result, decision, confirmed.call));
    await pace();
    index = 4;
    const assessment = prepared.result.draft.assessment;
    await dispatchAndResolve(confirmed.result, assessment.kind === 'eligible' ? assessment.requiredSkill : 'none', confirmed.call, prepared.result.draft.duplicateCandidates.map(c => c.id));
  } catch (error) {
    const active = status.indexOf('now');
    failCard(active >= 0 ? active : index, 'This step failed', error);
  } finally {
    running = false;
    paused = false;
    $('play').textContent = 'Play again';
  }
}

$('play').addEventListener('click', () => {
  if (!running) { $('play').textContent = 'Pause'; void playScenario(); return; }
  paused = !paused;
  $('play').textContent = paused ? 'Resume' : 'Pause';
  if (!paused && advance) advance();
});
$('next').addEventListener('click', () => {
  if (!running) { paused = true; $('play').textContent = 'Resume'; void playScenario(); return; }
  paused = true;
  $('play').textContent = 'Resume';
  if (advance) advance();
});

// ---------- Live voice mode ----------

let live = null;
let liveSince = Date.now();
let livePrepared = null;
const transcript = [];

function renderCall() {
  setStep(0, live ? 'now' : 'done', {
    title: live ? 'You are talking to the agent' : 'The call ended',
    body: transcript.length ? transcript.slice(-8).map(t => `<p class="turn"><i>${t.role}</i>${esc(t.text)}</p>`).join('') : '<p>Describe the problem. The agent will ask about anything it needs.</p>',
    out: [['voice', 'live · ElevenLabs'], ['conversation', live?.conversationId ?? 'ended']]
  });
}

// Tool calls made by the hosted agent reach the backend through the demo
// server's relay, which reports them here.
async function onAgentCall(trace) {
  if (mode !== 'live' || Date.parse(trace.at) < liveSince) return;
  const call = { ...trace };
  try {
    if (trace.status >= 400) throw new CallError(`The agent's ${trace.method} ${trace.path} returned HTTP ${trace.status}: ${JSON.stringify(trace.response)}`, call);
    if (trace.path.startsWith('/assets/')) setStep(1, 'done', understandCard(trace.response, call));
    else if (trace.path === '/intake/prepare') { livePrepared = trace.response; setStep(2, 'done', decideCard(trace.response, call)); }
    else if (trace.path === '/intake/confirm' && livePrepared) {
      setStep(3, 'done', confirmCard(livePrepared, trace.response, trace.request.decision, call));
      const a = livePrepared.draft.assessment;
      await dispatchAndResolve(trace.response, a.kind === 'eligible' ? a.requiredSkill : 'none', call, livePrepared.draft.duplicateCandidates.map(c => c.id));
    }
  } catch (error) {
    failCard(trace.path === '/intake/confirm' ? 4 : trace.path === '/intake/prepare' ? 2 : 1, 'This step failed', error);
  }
}

function pcmFormat(name) {
  const match = /^pcm_(\d+)$/.exec(name ?? '');
  return match ? Number(match[1]) : null;
}

function toBase64(int16) {
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function startCall() {
  const response = await fetch('/demo/signed-url');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const context = new AudioContext();
  const socket = new WebSocket(body.signedUrl);
  const session = { socket, stream, context, conversationId: null, playAt: 0, sources: [], inputRate: 16000, outputRate: 16000 };
  live = session;
  liveSince = Date.now();
  livePrepared = null;
  transcript.length = 0;
  resetRun();
  renderCall();

  const worklet = `registerProcessor('tap', class extends AudioWorkletProcessor {
    process(inputs) { if (inputs[0][0]) this.port.postMessage(inputs[0][0].slice()); return true; }
  });`;
  await context.audioWorklet.addModule(URL.createObjectURL(new Blob([worklet], { type: 'text/javascript' })));
  const source = context.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(context, 'tap');
  source.connect(tap);
  let pending = [];
  tap.port.onmessage = ({ data }) => {
    if (socket.readyState !== WebSocket.OPEN || !session.conversationId) return;
    // Downsample to the agent's input rate and convert to 16-bit PCM.
    const ratio = context.sampleRate / session.inputRate;
    for (let i = 0; i < data.length / ratio; i++) pending.push(Math.max(-1, Math.min(1, data[Math.floor(i * ratio)] ?? 0)));
    if (pending.length < session.inputRate / 10) return;
    const pcm = Int16Array.from(pending, s => s * 0x7fff);
    pending = [];
    socket.send(JSON.stringify({ user_audio_chunk: toBase64(pcm) }));
  };

  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    switch (message.type) {
      case 'conversation_initiation_metadata': {
        const meta = message.conversation_initiation_metadata_event;
        session.inputRate = pcmFormat(meta.user_input_audio_format) ?? 16000;
        session.outputRate = pcmFormat(meta.agent_output_audio_format);
        if (!session.outputRate) { stopCall(`Unsupported agent audio format ${meta.agent_output_audio_format}. Configure the agent for PCM output.`); return; }
        session.conversationId = meta.conversation_id;
        $('call-state').textContent = 'Listening';
        renderCall();
        break;
      }
      case 'ping':
        socket.send(JSON.stringify({ type: 'pong', event_id: message.ping_event.event_id }));
        break;
      case 'user_transcript':
        transcript.push({ role: 'you', text: message.user_transcription_event.user_transcript });
        renderCall();
        break;
      case 'agent_response':
        transcript.push({ role: 'agent', text: message.agent_response_event.agent_response });
        renderCall();
        break;
      case 'audio': playChunk(session, message.audio_event.audio_base_64); break;
      case 'interruption':
        session.sources.forEach(s => s.stop());
        session.sources = [];
        session.playAt = 0;
        break;
    }
  };
  socket.onclose = () => { if (live === session) stopCall(); };
  socket.onerror = () => stopCall('The voice connection failed.');
}

function playChunk(session, base64) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const buffer = session.context.createBuffer(1, pcm.length, session.outputRate);
  buffer.getChannelData(0).set(Float32Array.from(pcm, s => s / 0x8000));
  const node = session.context.createBufferSource();
  node.buffer = buffer;
  node.connect(session.context.destination);
  session.playAt = Math.max(session.playAt, session.context.currentTime);
  node.start(session.playAt);
  session.playAt += buffer.duration;
  session.sources.push(node);
  node.onended = () => { session.sources = session.sources.filter(s => s !== node); };
}

function stopCall(error) {
  const session = live;
  live = null;
  if (session) {
    session.stream.getTracks().forEach(t => t.stop());
    if (session.socket.readyState <= WebSocket.OPEN) session.socket.close();
    void session.context.close();
    renderCall();
  }
  $('call').textContent = 'Start call';
  $('call').classList.remove('stop');
  $('call-state').textContent = error ?? 'Microphone off';
  if (error) setStep(0, 'fail', { title: 'The call failed', body: `<p>${esc(error)}</p>` });
}

$('call').addEventListener('click', () => {
  if (live) { stopCall(); return; }
  $('call').textContent = 'End call';
  $('call').classList.add('stop');
  $('call-state').textContent = 'Connecting';
  startCall().catch(error => stopCall(error.message));
});

// ---------- modes, status, and technical details ----------

function setMode(next) {
  if (running || live) return;
  mode = next;
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('on', tab.dataset.mode === next));
  $('live').hidden = next !== 'live';
  $('play').hidden = $('next').hidden = next !== 'play';
  $('source').innerHTML = next === 'play'
    ? '<span class="tag sim">simulated voice</span> <span class="tag real">real backend</span>'
    : '<span class="tag real">live voice</span> <span class="tag real">real backend</span>';
  resetRun();
  if (next === 'live') setStep(0, 'todo', { title: 'Start a call and describe a fault', body: '<p>Speak to the agent. Each step lights up when the agent actually calls the backend.</p>' });
}
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

$('details-toggle').addEventListener('click', () => {
  $('details').hidden = !$('details').hidden;
  $('details-toggle').textContent = $('details').hidden ? 'Show technical details' : 'Hide technical details';
});

const events = new EventSource('/demo/events');
events.onmessage = ({ data }) => {
  const trace = JSON.parse(data);
  const item = document.createElement('li');
  item.innerHTML = `<details><summary><span class="tag ${trace.status < 400 ? 'real' : 'err'}">${trace.status}</span><b>${esc(trace.method)} ${esc(trace.path)}</b><span>${trace.ms} ms</span><span>${trace.source === 'voice-agent' ? 'voice agent' : 'demo page'}</span><span>${new Date(trace.at).toLocaleTimeString()}</span></summary><pre>${esc(JSON.stringify({ request: trace.request, response: trace.response }, null, 2))}</pre></details>`;
  $('traces').prepend(item);
  if (trace.source === 'voice-agent') void onAgentCall(trace);
};

async function checkStatus() {
  const config = await fetch('/demo/config').then(r => r.json()).catch(() => null);
  const backend = await fetch('/demo/api/state').then(r => r.ok).catch(() => false);
  $('backend-status').className = `pill ${backend ? 'ok' : 'bad'}`;
  $('backend-status').lastChild.textContent = backend ? 'Backend + Postgres' : 'Backend offline';
  const voice = config?.liveVoice;
  $('voice-status').className = `pill ${voice ? 'ok' : 'off'}`;
  $('voice-status').lastChild.textContent = voice ? 'Voice agent ready' : 'Voice not configured';
  document.querySelector('[data-mode="live"]').disabled = !voice;
}

setMode('play');
void checkStatus();
setInterval(checkStatus, 10000);
