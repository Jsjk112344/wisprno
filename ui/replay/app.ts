import { replayAt, type GraphEvent, type ReplayRun, type ReplayState } from '../../src/replay/translate.ts';

const runs: ReplayRun[] = JSON.parse(document.getElementById('faultline-runs')!.textContent!);
const root = document.getElementById('root')!;
const icons: Record<string, string> = {
  play: 'M8 4l12 8-12 8z', pause: 'M8 5v14M16 5v14', reset: 'M4 9a8 8 0 1 1 0 7M4 3v6h6',
  close: 'M6 6l12 12M6 18L18 6', layers: 'M12 3l10 6-10 6L2 9zM2 14l10 6 10-6',
  file: 'M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8',
  phone: 'M7 3l4 5-3 3c2 3 3 4 6 6l3-3 4 4c-2 6-7 4-12-1S2 5 7 3',
};
function icon(name: string, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] ?? icons.file}"/></svg>`;
}
// Static shell only. Recorded strings are always assigned through textContent.
root.innerHTML = `<div class="app-shell replay-app">
  <header class="topbar flex items-center justify-between">
    <div class="brand"><span class="brand-mark">ϟ</span>wisprno<span class="brand-dot">.</span><span class="divider"></span><span class="workspace" id="target-name"></span><span class="demo-tag">synthetic deployment</span></div>
    <button class="quiet" data-action="sources">${icon('file')}Source evidence</button>
  </header>
  <div class="body-layout">
    <aside class="rail">
      <div class="eyebrow">RECORDED RUNS</div><div id="run-list" class="run-list"></div>
      <div class="rail-section"><div class="section-head"><span class="eyebrow">EVIDENCE</span></div><div class="tier-card"><b id="tier-label"></b><span id="tier-description"></span></div></div>
      <div class="rail-section"><div class="section-head"><span class="eyebrow">OBSERVED TOOLS</span><span id="tool-count" class="count"></span></div><div id="tool-list"></div></div>
      <div class="rail-bottom"><span class="status-dot"></span>Recorded evidence loaded<small>Robustness testing of<br>our own deployed agents.</small></div>
    </aside>
    <main class="main-area">
      <div class="arena-bar"><div><div class="eyebrow">RECORDED ACCESS MAP</div><h1 id="run-title"></h1></div><div class="replay-context" id="transport-label"></div><button class="run-button" id="main-play" data-action="play">${icon('play')}<span>Play recorded run</span></button></div>
      <div class="graph-wrap">
        <div class="graph-heading"><div class="map-label">${icon('layers',16)}Observed paths<span id="map-detail"></span></div><div class="map-status" id="map-status"></div></div>
        <div class="graph-metrics"><div><small id="turn-label">CALLER TURNS</small><strong id="turns">00</strong></div><div><small>TOOL CALLS</small><strong id="calls">00</strong></div><div><small>CONFIRMED EFFECTS</small><strong id="effects">00</strong></div><div class="replay-metric"><small id="result-label">RECORDED FINDINGS</small><strong id="findings">00</strong></div></div>
        <div class="canvas"><svg class="graph" id="graph" viewBox="0 0 1230 580" role="group" aria-label="Observed access graph"></svg></div>
        <div class="graph-footer"><div class="legend"><span><i class="line"></i>Observed connection</span><span><i class="line coral"></i>Traversed event</span><span><i class="line mint"></i>Effect confirmed</span></div><span class="graph-hint">Select a node to inspect its evidence</span></div>
      </div>
      <div class="live-strip"><div class="speaker-avatar" id="speaker-icon">${icon('file')}</div><div class="caption-area"><div class="speaker-meta"><b id="speaker-name"></b><span id="source-time"></span></div><p class="caption" id="caption"></p></div><button class="quiet evidence-button" id="proof-button" data-action="proof">View evidence →</button></div>
      <div class="thinking-line replay-note"><span class="thinking-spark">✦</span><b id="note-label">RECORDING</b><span id="note"></span></div>
      <div class="replay-controls"><button class="icon-button replay-toggle" data-action="play" id="play-toggle" aria-label="Play replay">${icon('play')}</button><span class="replay-time" id="replay-time"></span><div class="replay-track"><input id="replay-position" type="range" min="0" max="1" step="0.01" value="0" aria-label="Replay position"><div id="markers" class="replay-markers"></div></div><button class="quiet speed-button" data-action="speed" id="speed" aria-label="Playback speed">1×</button><button class="icon-button" data-action="reset" aria-label="Restart replay">${icon('reset')}</button></div>
      <div class="replay-provenance"><span id="run-id"></span><span>Paced replay · original timestamps preserved</span></div>
    </main>
  </div>
  <div id="drawer-shade" class="replay-shade" hidden></div><aside id="evidence-drawer" class="replay-drawer" hidden aria-label="Replay evidence"><button class="icon-button close-drawer" data-action="close" aria-label="Close evidence">${icon('close')}</button><div id="drawer-content"></div></aside>
</div>`;

function byId<T extends HTMLElement = HTMLElement>(id: string) { return document.getElementById(id)! as T; }
function setText(id: string, text: unknown) { byId(id).textContent = String(text ?? ''); }
function element(tag: string, className: string, text?: unknown) {
  const e = document.createElement(tag); e.className = className;
  if (text !== undefined) e.textContent = String(text);
  return e;
}
const svgNS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attributes: Record<string, string | number>, text?: unknown) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = String(text);
  return node;
}
const short = (s: unknown, max = 30) => String(s ?? '').length > max ? String(s).slice(0, max - 1) + '…' : String(s ?? '');
const formatTime = (n: number) => `${Math.floor(n / 60).toString().padStart(2, '0')}:${Math.floor(n % 60).toString().padStart(2, '0')}`;
const json = (x: unknown) => x === undefined ? 'Not recorded' : JSON.stringify(x, null, 2);
const tierNames = { 'backend-record': 'Tier 1 · Backend record', 'tool-call-artifact': 'Tier 2 · Tool + artifact', 'transcript-only': 'Tier 3 · Transcript only' };
const statusNames = { untested: 'Ready to replay', breached: 'Backend-confirmed breach', held: 'No recorded rule violation', inconclusive: 'Inconclusive', completed: 'Effect confirmed · call complete' };
let selected = 0;
let at = 0;
let playing = false;
let speed = 1;
let previousFrame = 0;
let currentState: ReplayState;
let drawerMode: string | null = null;
const run = () => runs[selected];

function selectRun(index: number) {
  selected = index; at = 0; playing = false; previousFrame = 0; closeDrawer();
  const r = run();
  setText('target-name', r.target); setText('run-title', r.title);
  setText('turn-label', r.sourceKind === 'backend-probe' ? 'TOOL TURNS' : 'CALLER TURNS');
  setText('tier-label', tierNames[r.tier]);
  setText('tier-description', r.tier === 'backend-record' ? 'Auth state and record before / after' : r.tier === 'tool-call-artifact' ? 'Tool arguments matched to a hashed file' : 'No independently confirmed action effect');
  setText('transport-label', r.transport === 'sip' ? 'Direct local SIP · recorded audio call' : r.sourceKind === 'backend-probe' ? 'Recorded backend probe · dialogue unavailable' : 'Recorded text call');
  setText('run-id', r.id);
  const list = byId('run-list'); list.replaceChildren();
  runs.forEach((item, index) => {
    const button = element('button', 'threat-row replay-run' + (selected === index ? ' current' : ''));
    button.dataset.run = String(index); button.setAttribute('aria-pressed', String(selected === index));
    const mark = element('span', 'threat-icon ' + (item.outcome === 'breached' ? 'breached' : 'held'), item.outcome === 'breached' ? '×' : '✓');
    const label = element('span', 'run-label', item.title);
    label.append(element('small', '', item.target), element('small', '', item.outcome === 'breached' ? 'Backend-confirmed failure' : 'Recorded smoke call'));
    button.append(mark, label); list.append(button);
  });
  const tools = [...new Set(r.events.filter((e) => e.type === 'tool').map((e) => e.tool!))];
  byId('tool-list').replaceChildren(...tools.map((tool) => element('code', 'observed-tool', tool)));
  setText('tool-count', tools.length);
  const slider = byId<HTMLInputElement>('replay-position'); slider.max = String(r.duration); slider.value = '0';
  const markers = byId('markers'); markers.replaceChildren();
  for (const e of r.events.filter((e) => e.type === 'record' || e.type === 'verdict')) {
    const button = element('button', 'replay-marker ' + (e.finding ? 'breach-marker' : ''), e.finding ? 'Breach' : e.type === 'record' ? 'Effect' : 'End');
    button.dataset.seek = String(e.at); button.style.left = `${e.at / r.duration * 100}%`;
    button.title = `${e.recordedAt} · ${e.text ?? e.tool ?? e.type}`; markers.append(button);
  }
  paint();
}

const nodeIcons: Record<string, string> = {
  caller: 'M-10 14v-5a10 10 0 0 1 20 0v5M0-3a7 7 0 1 0 0-14 7 7 0 0 0 0 14',
  agent: 'M-12-9h24v23h-24zM-5-2v5M5-2v5M-5 9h10M0-16v6',
  identity: 'M0-16l13 6v10c0 9-13 16-13 16S-13 9-13 0v-10zM-6 0l4 4 8-9',
  tool: 'M-13-10l8 8 6-6-8-8M-4-1l15 15M7 13l5-5',
  record: 'M-12-12c0-6 24-6 24 0s-24 6-24 0v23c0 6 24 6 24 0v-23M-12 0c0 6 24 6 24 0',
  file: 'M-10-15H4l7 7v24h-21zM3-15v8h8M-5 0h11M-5 6h11',
  plan: 'M-9-13h18v26H-9zM-5-6h10M-5 0h10M-5 6h6',
};
const edges: Record<string, string> = {
  'input-caller': 'M165 150 C245 150 235 285 270 285',
  'plan-caller': 'M165 425 C235 425 235 315 270 315',
  'caller-agent': 'M370 285 L490 285', 'agent-caller': 'M490 315 L370 315',
  'agent-identity': 'M530 245 L530 165', 'identity-agent': 'M550 165 L550 245',
  'agent-tool': 'M590 295 L775 295', 'tool-record': 'M875 295 L1050 295',
};
function graph(state: ReplayState) {
  const r = run(); const graph = byId('graph') as unknown as SVGSVGElement;
  graph.replaceChildren();
  const defs = svg('defs', {});
  const pattern = svg('pattern', { id: 'dots', width: 18, height: 18, patternUnits: 'userSpaceOnUse' });
  pattern.append(svg('circle', { cx: 1, cy: 1, r: 0.7, fill: '#343943', opacity: 0.5 })); defs.append(pattern);
  for (const [name, color] of [['grey', '#555d69'], ['hot', '#ee8675'], ['mint', '#9ad5bd']]) {
    const marker = svg('marker', { id: 'arrow-' + name, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
    marker.append(svg('path', { d: 'M0 0L10 5L0 10z', fill: color })); defs.append(marker);
  }
  graph.append(defs, svg('rect', { width: 1230, height: 580, fill: 'url(#dots)' }),
    svg('rect', { class: 'trust-zone', x: 455, y: 35, width: 750, height: 505, rx: 24 }),
    svg('text', { class: 'zone-label', x: 1180, y: 62, 'text-anchor': 'end' }, r.target.toUpperCase()),
    svg('text', { class: 'zone-label', x: 35, y: 62 }, r.sourceKind === 'backend-probe' ? 'RECORDED TOOL CLIENT' : 'UNTRUSTED CALLER INPUT'));
  const visible = new Set(['caller-agent', 'agent-caller', 'agent-tool', 'tool-record']);
  if (r.callerId) visible.add('input-caller');
  const hasIdentity = r.events.some((e) => e.type === 'identity');
  if (hasIdentity) { visible.add('agent-identity'); visible.add('identity-agent'); }
  const hasPlan = r.events.some((e) => e.type === 'thought');
  const hasDtmf = r.events.some((e) => e.raw.type === 'caller.dtmf');
  if (hasPlan || hasDtmf) visible.add('plan-caller');
  if (r.sourceKind === 'backend-probe') visible.delete('agent-caller');
  for (const key of visible) {
    const group = svg('g', { 'data-edge': key });
    group.append(svg('path', { d: edges[key], class: 'edge-base', 'marker-end': 'url(#arrow-grey)' }));
    const count = state.passes[key] ?? 0;
    if (count) {
      const confirmed = key === 'tool-record' && state.status !== 'breached';
      group.append(svg('path', { d: edges[key], class: 'edge-trail' + (confirmed ? ' held-edge' : ''),
        'marker-end': confirmed ? 'url(#arrow-mint)' : 'url(#arrow-hot)' }));
      if (playing && at - (state.recent[key] ?? -99) < 1.5) {
        const particle = svg('circle', { r: 4, class: 'particle' });
        particle.append(svg('animateMotion', { dur: '1.1s', repeatCount: 'indefinite', path: edges[key] })); group.append(particle);
      }
    }
    graph.append(group);
  }
  const record = state.records.at(-1);
  const tool = state.toolCalls.at(-1);
  const hasBreach = state.findings.length > 0;
  function node(id: string, x: number, y: number, title: string, subtitle: string, role: string, shape: string, className = '') {
    const group = svg('g', { class: `node replay-node ${className}`, transform: `translate(${x},${y})`,
      tabindex: 0, role: 'button', 'aria-label': `${title}. ${subtitle}. Inspect evidence`, 'data-node': id });
    group.append(svg('title', {}, `${title} — ${subtitle}`), svg('text', { class: 'node-role', y: -66, 'text-anchor': 'middle' }, role));
    if (id === 'caller' || id === 'agent') group.append(svg('circle', { class: 'halo', r: 58 }), svg('circle', { class: 'node-face', r: 48 }));
    else group.append(svg('rect', { class: 'node-face', x: -46, y: -42, width: 92, height: 84, rx: 19 }));
    group.append(svg('path', { d: nodeIcons[shape], fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svg('text', { class: 'node-title', y: 76, 'text-anchor': 'middle' }, short(title, 27)),
      svg('text', { class: 'node-sub', y: 96, 'text-anchor': 'middle' }, short(subtitle, 34)));
    if (id === 'record' && hasBreach) {
      const badge = svg('g', { class: 'finding-badge', transform: 'translate(34,-42)' });
      badge.append(svg('rect', { x: -21, y: -12, width: 42, height: 24, rx: 8 }), svg('text', { y: 4, 'text-anchor': 'middle' }, '× ' + state.findings.length)); group.append(badge);
    }
    graph.append(group);
  }
  if (r.callerId) node('input', 115, 150, 'Caller ID', r.callerId + ' · asserted', 'RECORDED INPUT', 'file');
  if (hasPlan || hasDtmf) node('plan', 115, 425, hasPlan ? 'Tester plan' : 'DTMF', hasPlan ? state.plan || 'No plan yet' : state.current && r.events.filter((e) => e.at <= at && e.raw.type === 'caller.dtmf').at(-1)?.text || 'Not received yet', 'RECORDED INPUT', 'plan');
  node('caller', 320, 295, r.sourceKind === 'backend-probe' ? 'Tool client' : 'Synthetic caller', r.sourceKind === 'backend-probe' ? 'Direct backend probe' : r.transport === 'sip' ? 'Baresip · local SIP' : 'Recorded caller turns', r.sourceKind === 'backend-probe' ? 'PROBE' : 'CALLER', 'caller', 'caller');
  node('agent', 540, 295, r.sourceKind === 'backend-probe' ? 'Mock backend' : r.target, r.sourceKind === 'backend-probe' ? 'No model run recorded' : 'Own deployed voice agent', 'OWN DEPLOYMENT', 'agent', 'agent');
  if (hasIdentity) node('identity', 540, 115, 'Verified identity', state.identity, 'BACKEND AUTH STATE', 'identity', state.auth?.level === 'otp' ? 'enforced' : '');
  node('tool', 825, 295, tool?.tool ?? 'Observed tools', tool ? tool.proof?.verdict ?? 'Tool output captured' : 'Waiting for invocation', 'TOOL CALL', 'tool', record ? hasBreach ? 'danger' : 'enforced' : '');
  const recordValue = record ? record.source === 'artifact' ? 'Message JSON · SHA-256 verified' : short(Object.values(record.after as object).join(', '), 31)
    : r.initialRecord ? short(String(r.initialRecord.contact ?? r.initialRecord.payout_account), 31) : 'No artifact observed yet';
  node('record', 1100, 295, record?.subject ?? r.initialRecord?.name ?? 'Observable output', recordValue, r.tier === 'backend-record' ? 'BACKEND RECORD' : 'FILE ARTIFACT', r.tier === 'backend-record' ? 'record' : 'file', record ? hasBreach ? 'danger' : 'enforced' : '');
}

function paint() {
  const r = run(); currentState = replayAt(r, at); const state = currentState;
  byId('root').dataset.playing = String(playing); byId('root').dataset.runId = r.id; byId('root').dataset.status = state.status;
  setText('map-detail', `${r.events.filter((e) => e.type === 'tool').length} tool events · ${r.tier === 'backend-record' ? 'backend records' : 'file artifacts'}`);
  const status = byId('map-status'); status.textContent = statusNames[state.status]; status.className = 'map-status result-' + state.status;
  setText('turns', String(state.callerTurns).padStart(2, '0')); setText('calls', String(state.toolCalls.length).padStart(2, '0'));
  setText('effects', String(state.records.length).padStart(2, '0')); setText('findings', String(state.findings.length).padStart(2, '0'));
  setText('speaker-name', state.speaker === 'red' ? 'RECORDED CALLER' : state.speaker === 'agent' ? 'RECORDED AGENT' : r.sourceKind === 'backend-probe' ? 'RECORDED TOOL PROBE' : 'RECORDING');
  setText('caption', state.caption || (r.sourceKind === 'backend-probe' ? 'No caller dialogue was recorded. Follow the backend tool events.' : 'Replay the recorded call and follow the observed access.'));
  byId('speaker-icon').className = 'speaker-avatar' + (state.speaker === 'agent' ? ' agent' : '');
  byId('speaker-icon').innerHTML = icon(state.speaker ? 'phone' : 'file');
  const captionTime = state.captionAt ?? state.current?.recordedAt;
  setText('source-time', captionTime ? `${new Date(captionTime).toISOString().slice(11,23)} UTC` : '');
  const lastRecord = state.records.at(-1);
  setText('note-label', state.plan ? 'RECORDED PLAN' : lastRecord ? 'EVIDENCE' : 'RECORDING');
  setText('note', state.plan || (lastRecord?.proof?.explanation) || r.warnings[0] || 'Only events from the selected recording are replayed.');
  const proof = byId<HTMLButtonElement>('proof-button'); proof.disabled = !state.records.length;
  setText('replay-time', `${formatTime(at)} / ${formatTime(r.duration)}`);
  byId<HTMLInputElement>('replay-position').value = String(at);
  setText('speed', `${speed}×`);
  byId('play-toggle').innerHTML = icon(playing ? 'pause' : 'play'); byId('play-toggle').setAttribute('aria-label', playing ? 'Pause replay' : 'Play replay');
  byId('main-play').innerHTML = icon(playing ? 'pause' : 'play') + `<span>${playing ? 'Pause replay' : at >= r.duration ? 'Replay recording' : 'Play recorded run'}</span>`;
  graph(state);
}

function detail(title: string, value: unknown, content = byId('drawer-content')) {
  const section = element('section', 'proof-section'); section.append(element('h3', 'eyebrow', title));
  const pre = element('pre', 'proof-value', typeof value === 'string' ? value : json(value)); section.append(pre); content.append(section);
}
function openDrawer(mode: string) {
  drawerMode = mode; const r = run(); const content = byId('drawer-content'); content.replaceChildren();
  content.append(element('div', 'eyebrow', 'RECORDED EVIDENCE'), element('h2', '', mode === 'sources' ? 'Source recording' : mode === 'identity' ? 'Verified identity' : mode === 'record' || mode === 'proof' ? 'Observed effect' : mode === 'tool' ? 'Tool invocation' : mode === 'input' ? 'Caller ID assertion' : mode === 'plan' ? 'Recorded input' : 'Session context'));
  const record = currentState.records.at(-1);
  const tool = currentState.toolCalls.at(-1);
  if (mode === 'proof' || mode === 'record') {
    if (!record) detail('Status', 'No effect has been observed at this point in the recording.');
    else {
      detail('Evidence tier', tierNames[r.tier]); detail('Source timestamp', record.recordedAt); detail('Tool', record.tool);
      if (record.source === 'backend') {
        detail('Finding', record.finding ?? 'No rule violation recorded');
        detail('Verified caller at write', record.proof?.authBefore); detail('Target record', record.subject);
        detail('Before', record.before); detail('After', record.after);
      } else {
        detail('Artifact', record.artifact?.path); detail('SHA-256', record.artifact?.sha256); detail('Saved message', record.after);
        detail('Scope', 'Tool arguments and file contents match. This smoke call does not establish a caller-ID policy bypass.');
      }
      detail('Evidence basis', record.proof?.explanation); detail('Tool arguments', record.proof?.args ?? tool?.args);
    }
  } else if (mode === 'tool') { detail('Tool', tool?.tool); detail('Arguments', tool?.args); detail('Recorded result', tool?.proof); }
  else if (mode === 'identity') { detail('Backend-authenticated identity', currentState.identity); detail('Auth state', currentState.auth); }
  else if (mode === 'input') {
    detail('Observed caller ID', r.callerId); detail('Identity assurance', 'Asserted input. Caller ID is not proof of account ownership.');
    detail('SIP context', r.rawEvents.find((e) => e.type === 'caller.id')?.sip ?? r.rawEvents[0].sip);
  } else if (mode === 'plan') {
    detail('Recorded plan', currentState.plan || 'No model plan was recorded.');
    detail('DTMF events', r.events.filter((e) => e.at <= at && e.raw.type === 'caller.dtmf').map((e) => e.proof));
  } else {
    detail('Run ID', r.id); detail('Recording type', r.sourceKind === 'backend-probe' ? 'Direct backend tool probe; no conversational model run' : r.transport);
    detail('Evidence tier', tierNames[r.tier]); detail('Version', r.version);
    detail('Original event span', `${(r.sourceDurationMs / 1000).toFixed(3)} seconds. Playback uses presentation pacing; original timestamps are preserved.`);
    if (r.warnings.length) detail('Recording notes', r.warnings);
    detail('Source files and hashes', r.sources);
  }
  byId('drawer-shade').hidden = false; byId('evidence-drawer').hidden = false;
}
function closeDrawer() { drawerMode = null; byId('drawer-shade').hidden = true; byId('evidence-drawer').hidden = true; }
function seek(next: number) { playing = false; at = Math.min(run().duration, Math.max(0, next)); paint(); if (drawerMode) openDrawer(drawerMode); }
function toggle() { if (!playing && at >= run().duration) at = 0; playing = !playing; previousFrame = performance.now(); paint(); }

root.addEventListener('click', (event) => {
  const target = (event.target as Element).closest<HTMLElement>('[data-action],[data-run],[data-node],[data-seek]');
  if (!target) return;
  if (target.dataset.run !== undefined) { selectRun(Number(target.dataset.run)); return; }
  if (target.dataset.node) { playing = false; paint(); openDrawer(target.dataset.node); return; }
  if (target.dataset.seek) { seek(Number(target.dataset.seek)); return; }
  switch (target.dataset.action) {
    case 'play': toggle(); break;
    case 'speed': speed = speed === 4 ? 1 : speed * 2; paint(); break;
    case 'reset': seek(0); break;
    case 'close': closeDrawer(); break;
    case 'sources': playing = false; paint(); openDrawer('sources'); break;
    case 'proof': playing = false; paint(); openDrawer('proof'); break;
  }
});
byId('drawer-shade').addEventListener('click', closeDrawer);
byId('replay-position').addEventListener('input', (event) => seek(Number((event.target as HTMLInputElement).value)));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawer();
  const focus = document.activeElement;
  if ((event.key === 'Enter' || event.key === ' ') && focus?.hasAttribute('data-node')) {
    event.preventDefault(); playing = false; paint(); openDrawer((focus as HTMLElement).dataset.node!);
  } else if (event.code === 'Space' && !['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(focus?.tagName ?? '')) { event.preventDefault(); toggle(); }
});
function frame(now: number) {
  if (playing) {
    at = Math.min(run().duration, at + Math.max(0, now - previousFrame) / 1000 * speed);
    if (at >= run().duration) playing = false;
    paint();
  }
  previousFrame = now; requestAnimationFrame(frame);
}
selectRun(0); requestAnimationFrame(frame);
