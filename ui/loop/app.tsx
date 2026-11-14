// Faultline loop UI: the split permission-map design, driven by recorded or live Story event logs.
// Playback only reads the story's events; every number on screen is a count of those events.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { NodeId, ServerStatus, Story, UiEvent, Verdict } from '../../src/loop/story.ts';
import { EDGES, Icon, NODES, NodeIcon } from './geometry.tsx';
import { judgeStart, judgeTurn, startLive, streamLive, fetchStatus, decideFix } from './live.ts';
import {
  TIER_LABEL, aggregate, chipCount, pace, count, mmss, reduce, sortEvents, storyTag, suiteTotals,
  type RecordEv, type SayEv, type Ev,
} from './reduce.ts';

declare global {
  interface Window {
    FAULTLINE_STORIES?: Story[];
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
    webkitAudioContext?: typeof AudioContext;
  }
}

const GO_LIVE = 'Run `npm run faultline -- ui` to go live';

// Shown only when the build embedded no stories: generic labels, no numbers.
const EMPTY: Story = {
  id: 'none', title: 'No recorded runs', kind: 'recorded', layer: 'evidence', transport: 'text', tier: 'transcript-only',
  map: {
    workspace: 'No target', repo: 'no repository', agent: { label: 'Agent', sub: 'Voice agent' },
    details: { label: 'Known details', sub: '—' }, identity: { label: 'Identity check', sub: '—' },
    approval: { label: 'Approval', prompt: 'Unknown', enforced: 'Enforced', rule: '—' },
    payout: { label: 'Write tool', sub: '—', tool: '—' }, other: { label: 'Other tools', sub: '—', tools: [] },
    record: { label: 'Record', field: '—', initial: '—' }, nodesCount: 9, toolsCount: 0,
  },
  threats: [], caller: { name: 'No caller', short: 'Caller', tactic: '—', initials: '—' }, events: [], duration: 1,
  markers: [], version: { before: '—' }, sources: [], notes: ['No stories were embedded in this build.'],
};

// Deep link: #story=<id or index>&t=<seconds>&drawer=<finding|repo|bench> (also used for headless screenshots).
const hash = new URLSearchParams(typeof location === 'undefined' ? '' : location.hash.slice(1));
const DRAWERS = ['bench', 'repo', 'finding'] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');
const VERDICT_ICON: Record<Verdict, string> = { breached: '×', held: '✓', inconclusive: '?', untested: '○' };

function Dots({ values, total }: { values: Verdict[]; total: number }) {
  const n = Math.max(total, values.length);
  return (
    <div className="dots" aria-label={`${count(values, 'breached')} breached, ${count(values, 'held')} held, ${count(values, 'inconclusive')} inconclusive, ${n - values.length} not yet run`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={values[i] ?? 'untested'}>
          {values[i] === 'breached' ? '×' : values[i] === 'held' ? '✓' : values[i] === 'inconclusive' ? '?' : ''}
        </i>
      ))}
    </div>
  );
}

/** "X of N" with inconclusive shown separately (never folded into a pass). */
function suiteLine(values: Verdict[], total: number, what: Verdict) {
  const inc = count(values, 'inconclusive');
  const pending = Math.max(0, total - values.length);
  return `${count(values, what)} of ${Math.max(total, values.length)}${inc ? ` · ${inc} inconclusive` : ''}${pending ? ` · ${pending} to run` : ''}`;
}

function App() {
  const recorded = useMemo(() => {
    const list = window.FAULTLINE_STORIES ?? [];
    return list.length ? list : [EMPTY];
  }, []);
  const [selected, setSelected] = useState(() => {
    const wanted = hash.get('story');
    if (!wanted) return 0;
    const byId = recorded.findIndex((item) => item.id === wanted);
    return byId >= 0 ? byId : Math.min(recorded.length - 1, Math.max(0, Number(wanted) || 0));
  });
  const [mode, setMode] = useState<'recorded' | 'live' | 'judge'>('recorded');
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [liveStory, setLiveStory] = useState<Story | null>(null);
  const [judgeStory, setJudgeStory] = useState<Story | null>(null);
  const [judgeId, setJudgeId] = useState<string | null>(null);
  const [t, setT] = useState(() => Math.max(0, Number(hash.get('t')) || 0));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sound, setSound] = useState(true); // pressing Play is the user gesture browsers need for audio
  const [drawer, setDrawer] = useState<null | 'bench' | 'repo' | 'node' | 'finding'>(
    () => DRAWERS.find((name) => name === hash.get('drawer')) ?? null);
  const [findingId, setFindingId] = useState<string | null>(null);
  const [node, setNode] = useState<NodeId | null>(null);
  const [otherTool, setOtherTool] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [input, setInput] = useState('');
  const [toastText, setToastText] = useState('');
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [menu, setMenu] = useState(false);
  const [details, setDetails] = useState(false);
  const [mapping, setMapping] = useState<number | null>(null);
  useEffect(() => {
    if (mapping === null || mapping < 0 || mapping >= 4) return;
    const timer = window.setTimeout(() => setMapping(mapping + 1), 1100);
    return () => window.clearTimeout(timer);
  }, [mapping]);
  const [liveRunning, setLiveRunning] = useState(false);
  const [following, setFollowing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savedTests, setSavedTests] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('faultline-tests') ?? '[]') as string[]; } catch { return []; }
  });
  const soundRef = useRef(false);
  const lastT = useRef(Math.max(0, Number(hash.get('t')) || 0));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioStop = useRef<number | undefined>(undefined);
  const closeStream = useRef<(() => void) | null>(null);

  const growing = mode !== 'recorded';
  const rawStory = mode === 'live' && liveStory ? liveStory : mode === 'judge' && judgeStory ? judgeStory : recorded[selected];
  // Live and judge events go through the paced playback queue; the playhead follows the queue, not the raw `at`.
  const queue = useMemo(() => growing ? pace(rawStory.events, mode === 'live') : null, [rawStory, growing, mode]);
  const story = useMemo(() => queue ? { ...rawStory, events: queue.events } : rawStory, [rawStory, queue]);
  const events = useMemo(() => queue ? queue.events : sortEvents(story.events), [story, queue]);
  const queueEnd = queue ? Math.max(0, queue.end - 0.01) : 0;
  const duration = queue ? Math.max(1, queue.end) : Math.max(story.duration, 0.1);
  const view = useMemo(() => reduce(story, events, t, mode === 'judge'), [story, events, t, mode]);
  const totals = useMemo(() => suiteTotals(events), [events]);
  const firstBreachAt = useMemo(() => events.find((e) => e.type === 'record' && e.verdict === 'breached')?.at ?? null, [events]);
  const served = status !== null;

  const toast = useCallback((text: string) => {
    setToastText(text);
    window.setTimeout(() => setToastText(''), 2500);
  }, []);

  const stopAudio = useCallback(() => {
    window.speechSynthesis?.cancel();
    window.clearTimeout(audioStop.current);
    audioRef.current?.pause();
  }, []);

  useEffect(() => { void fetchStatus().then(setStatus); }, []);
  useEffect(() => { soundRef.current = sound; if (!sound) stopAudio(); }, [sound, stopAudio]);
  useEffect(() => () => closeStream.current?.(), []);
  useEffect(() => { if (!playing) stopAudio(); }, [playing, stopAudio]);

  // Pause presentation at each breached record. Live evidence collection continues in the background.
  useEffect(() => {
    if (growing ? !following : !playing) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const step = (now - previous) / 1000 * speed;
      previous = now;
      setT((current) => {
        const next = Math.min(growing ? queueEnd : duration, current + step);
        const breach = events.find((e) => e.type === 'record' && e.verdict === 'breached' && e.at > current && e.at <= next);
        if (breach) {
          setPlaying(false); setFollowing(false);
          return breach.at;
        }
        if (growing) return Math.max(current, next);
        if (next >= duration) setPlaying(false);
        return next;
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [playing, speed, growing, following, duration, queueEnd, events]);

  // One audio element per source (a SIP story's source is the whole mixed call). During playback it is kept in
  // sync with the playhead (seeked when a line starts and it has drifted); for the shortest-call playlist each clip
  // stops at its end.
  const playClip = useCallback((say: SayEv, onEnd?: () => void) => {
    if (!say.audio) return false;
    const url = story.audio?.[say.audio.src];
    if (!url) return false;
    window.clearTimeout(audioStop.current);
    let audio = audioRef.current;
    if (!audio || audio.dataset.src !== url) {
      audio?.pause();
      audio = new Audio(url);
      audio.dataset.src = url;
      audioRef.current = audio;
    }
    const clip = audio;
    if (onEnd || clip.paused || Math.abs(clip.currentTime - say.audio.start) > 0.75) clip.currentTime = say.audio.start;
    clip.playbackRate = onEnd ? 1 : speed;
    void clip.play().catch(() => undefined);
    if (onEnd) audioStop.current = window.setTimeout(() => { clip.pause(); onEnd(); },
      Math.max(0.1, say.audio.end - say.audio.start) * 1000);
    return true;
  }, [story, speed]);

  const synthesise = useCallback((text: string, speaker: 'red' | 'agent', queue = false) => {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith('en'));
    utterance.voice = voices[speaker === 'red' ? 0 : Math.min(1, voices.length - 1)] ?? null;
    utterance.pitch = speaker === 'red' ? 0.8 : 1.12;
    utterance.rate = 1.07;
    if (!queue) window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  // A recorded story with one whole-call recording (SIP) plays it continuously, locked to the playhead, so pauses,
  // ringing and the agent's thinking time are heard as they happened.
  const callUrl = !growing && story.transport === 'sip' && story.audio ? Object.values(story.audio).find(Boolean) : undefined;
  useEffect(() => {
    if (!callUrl) return;
    if (!playing || !sound) { audioRef.current?.pause(); return; }
    let audio = audioRef.current;
    if (!audio || audio.dataset.src !== callUrl) {
      audio?.pause();
      audio = new Audio(callUrl);
      audio.dataset.src = callUrl;
      audioRef.current = audio;
    }
    audio.playbackRate = speed;
    if (Math.abs(audio.currentTime - t) > 0.6) audio.currentTime = t;
    if (audio.paused && t < (audio.duration || Infinity)) void audio.play().catch(() => undefined);
  }, [callUrl, playing, sound, speed, t]);

  // Sound for events crossed by the playhead: recorded audio when the story has it; synthesised voice only for
  // text-mode stories (which have no audio); never synthesise a SIP call.
  useEffect(() => {
    if (t < lastT.current) { stopAudio(); lastT.current = t; return; }
    const crossed = events.filter((e) => e.at > lastT.current && e.at <= t);
    lastT.current = t;
    if (!playing && !growing) return;
    if (!soundRef.current) return;
    for (const e of crossed) {
      if (e.type === 'say') {
        if (callUrl) continue; // the whole call is already playing
        if (e.audio && playClip(e)) continue;
        if (story.transport === 'text') synthesise(e.text, e.speaker);
      }
      if (e.type === 'record') {
        try {
          const Context = window.AudioContext ?? window.webkitAudioContext;
          const context = new Context();
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.connect(gain); gain.connect(context.destination);
          oscillator.frequency.setValueAtTime(180, context.currentTime);
          gain.gain.setValueAtTime(0.12, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
          oscillator.start(); oscillator.stop(context.currentTime + 0.2);
          window.setTimeout(() => void context.close(), 300);
        } catch { /* no audio */ }
      }
    }
  }, [t, events, playing, growing, story, callUrl, playClip, synthesise, stopAudio]);

  const seek = useCallback((at: number) => {
    setPlaying(false); stopAudio(); setT(at);
    if (growing) setFollowing(false);
  }, [growing, stopAudio]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDrawer(null); setNode(null); setMenu(false); setMapping(null); }
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? '';
      if (event.code === 'Space' && !['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(tag)) {
        event.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const loadStory = (index: number) => {
    if (playing) { toast('Pause before changing caller'); return; }
    closeStream.current?.(); closeStream.current = null;
    setMapping(null); setLiveRunning(false); setMode('recorded'); setSelected(index); setDrawer(null); setNode(null);
    stopAudio(); lastT.current = 0; setT(0);
  };

  const togglePlay = () => {
    setMenu(false); setDrawer(null); setNode(null);
    if (growing) { setFollowing((f) => !f); return; }
    if (t >= duration || t === 0) setT(Math.min(1, duration));
    setPlaying((p) => !p);
  };

  const runLive = async (liveMode: 'loop' | 'sip') => {
    setMenu(false);
    if (!served) { toast(GO_LIVE); return; }
    try {
      closeStream.current?.();
      setPlaying(false); stopAudio();
      const { id } = await startLive(liveMode);
      setLiveRunId(id);
      setLiveStory(null); setLiveRunning(true); setFollowing(true); lastT.current = 0; setT(0);
      closeStream.current = streamLive(id, (message) => {
        if (message.kind === 'story') {
          setLiveStory({ ...message.story, kind: 'live', events: [] } as Story);
          setMode('live');
        } else if (message.kind === 'event') {
          setLiveStory((current) => current && !current.events.some((e) => e.seq === message.event.seq)
            ? { ...current, events: [...current.events, message.event] } : current);
        } else if (message.kind === 'done') {
          setLiveRunning(false); toast(`Live run ${message.verdict}: ${message.summary}`);
        } else {
          setLiveRunning(false); toast(`Live run error: ${message.message}`);
        }
      }, (reason) => { setLiveRunning(false); toast(reason); });
      toast(liveMode === 'sip' ? 'Placing SIP call' : 'Live loop started');
    } catch (error) {
      setLiveRunning(false);
      toast(error instanceof Error ? error.message : String(error));
    }
  };

  const startJudge = async () => {
    if (!served) { toast(GO_LIVE); return; }
    if (mode === 'judge') { setMode('recorded'); setT(0); return; }
    try {
      setPlaying(false); stopAudio(); setDrawer(null); setBusy(true);
      const session = await judgeStart();
      setJudgeId(session.id);
      setJudgeStory({ ...session.story, events: session.events } as Story);
      setMode('judge'); setFollowing(true); setInput(''); lastT.current = 0; setT(0);
      toast('Judge connected · real target session');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  const sendTurn = async (text = input) => {
    if (!text.trim() || !judgeId || !judgeStory || busy) return;
    setBusy(true);
    try {
      const reply = await judgeTurn(judgeId, text.trim());
      setJudgeStory((current) => {
        if (!current) return current;
        const last = current.events.reduce((m, e) => Math.max(m, e.at), 0);
        const lastSeq = current.events.reduce((m, e) => Math.max(m, e.seq), 0);
        const added: UiEvent[] = [];
        // The judge's own words, if the server does not echo them back as an event.
        if (!reply.events.some((e) => e.type === 'say' && e.speaker === 'red')) {
          added.push({ seq: lastSeq + 1, at: last + 0.1, runId: judgeId, source: 'caller', type: 'say', speaker: 'red',
            turn: view.turns + 1, text: text.trim(), heardBy: 'text', route: ['caller-agent'] });
        }
        const minAt = reply.events.reduce((m, e) => Math.min(m, e.at), Infinity);
        const shift = Number.isFinite(minAt) && minAt <= last + 0.1 ? last + 0.2 - minAt : 0;
        for (const e of reply.events) added.push({ ...e, at: e.at + shift });
        return { ...current, events: [...current.events, ...added] };
      });
      setFollowing(true); setInput('');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  const listen = () => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) { toast('Microphone unavailable. Type your turn.'); return; }
    try {
      const recognition = new Recognition();
      recognition.lang = 'en-US'; recognition.interimResults = false;
      recognition.onresult = (event: any) => { setInput(event.results[0][0].transcript); setListening(false); };
      recognition.onerror = () => { setListening(false); toast('Microphone unavailable. Type your turn.'); };
      recognition.onend = () => setListening(false);
      recognition.start(); setListening(true);
    } catch { toast('Microphone unavailable. Type your turn.'); }
  };

  const saveTest = (id: string) => {
    if (!savedTests.includes(id)) {
      const next = [...savedTests, id];
      setSavedTests(next);
      try { localStorage.setItem('faultline-tests', JSON.stringify(next)); } catch { /* private window */ }
    }
    toast('Saved as regression test');
  };

  const playShortest = () => {
    const lines = view.shortest?.lines ?? events.find((e): e is Ev<'shortest'> => e.type === 'shortest')?.lines;
    if (!lines?.length) { toast('No shortest call recorded'); return; }
    const says = lines.map((line) => events.find((e): e is SayEv => e.type === 'say' && e.speaker === 'red' && e.text === line));
    const clips = says.filter((say): say is SayEv => !!say?.audio && !!story.audio?.[say.audio.src]);
    stopAudio();
    if (clips.length === lines.length) {
      const next = (i: number) => { if (i < clips.length) playClip(clips[i], () => next(i + 1)); };
      next(0); toast(story.voiced ? 'Playing shortest call · TTS voices' : 'Playing recorded shortest call');
    } else if (story.transport === 'text' && window.speechSynthesis) {
      lines.forEach((line) => synthesise(line, 'red', true));
      toast('Playing shortest call · synthesised voice');
    } else toast('No recorded audio for these lines');
  };

  // ---- Derived presentation ------------------------------------------------------------------------------------
  const map = story.map;
  const proposed = rawStory.events.findLast((e) => e.type === 'proposal');
  const pendingFix = proposed?.type === 'proposal' && !rawStory.events.some((e) => e.type === 'decision' && e.candidate === proposed.candidate) ? proposed : null;
  const reviewFix = async (approved: boolean) => {
    if (!liveRunId || !pendingFix) return;
    setBusy(true);
    try { await decideFix(liveRunId, pendingFix.candidate, approved); setFollowing(true); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const judge = mode === 'judge';
  const shrinking = view.phase === 'Shrink';
  const lastFinding = view.findings.at(-1);
  const hasFinding = view.findings.length > 0;
  const finding = view.findings.find((f) => f.finding === findingId) ?? lastFinding
    ?? events.find((e): e is RecordEv => e.type === 'record') ?? null;
  const lastSay = view.history.at(-1);
  const speaking = (playing || (growing && following)) && !!lastSay && t - lastSay.at < 4;
  const fixedServer = view.fixed?.kind === 'server-check';
  const breachOpen = hasFinding && !view.fixed;
  const breachFlash = breachOpen && !!lastFinding && t - lastFinding.at >= 0 && t - lastFinding.at < 1.6;
  const afterTotal = (version: string | null | undefined) => totals.after.get(version ?? '?') ?? 0;
  const normalTotal = (version: string | null | undefined) => totals.normal.get(version ?? '?') ?? 0;
  const gate = view.fixed ? aggregate(view.acceptedAfter) : 'untested';
  const recordedShortest = recorded[selected].events.find((e): e is Ev<'shortest'> => e.type === 'shortest');
  const ended = !growing && t >= duration;
  const threatState = (tool: string, fallback: Verdict): Verdict => view.status[tool] ?? (ended ? fallback : 'untested');
  const synthVoice = sound && story.transport === 'text' && !!view.say && !view.say.audio;

  const labels: Record<NodeId, { label: string; sub: string; role: string }> = {
    details: { label: map.details.label, sub: map.details.sub, role: 'INPUT' },
    tactic: { label: view.tactic, sub: 'inferred', role: 'RED’S TACTIC' },
    caller: { label: judge ? 'Your call' : story.caller.short, sub: judge ? 'Judge' : story.caller.tactic, role: 'CALLER' },
    agent: { label: map.agent.label, sub: map.agent.sub, role: 'AGENT' },
    identity: { label: map.identity.label, sub: map.identity.sub, role: 'PERMISSION' },
    approval: { label: map.approval.label, role: 'PERMISSION',
      sub: view.fixed ? (fixedServer ? map.approval.enforced : `${map.approval.enforced} (prompt)`) : map.approval.prompt },
    payout: { label: map.payout.label, sub: map.payout.sub, role: 'WRITE TOOL' },
    other: { label: map.other.label, role: 'WRITE TOOLS',
      sub: map.other.tools.includes(view.currentTool) && view.currentTool !== map.payout.tool ? view.currentTool : map.other.sub },
    record: { label: map.record.label, sub: view.record, role: 'ACCOUNT RECORD' },
  };

  const headline = judge ? 'Your turn.' : shrinking ? 'Keep only what breaks.' : view.pivoted ? 'Another way in.'
    : view.fixed ? (fixedServer ? 'Same call. Enforced.' : 'Same call. Patched.')
    : t === 0 ? 'Every permission. Every path.' : 'Follow the breach.';
  const eyebrow = judge ? 'HUMAN CHALLENGER' : mode === 'live' ? 'LIVE RUN' : t === 0 ? 'THREAT MODEL' : 'RECORDED RUN';
  const mapStatus = mode === 'live' ? (liveRunning ? 'Live' : t < queueEnd ? 'Live · replaying queue' : 'Live run ended') : judge ? 'Judge' : playing ? 'Playing' : t ? 'Paused' : 'Ready';

  const openNode = (id: NodeId) => {
    setNode(id);
    if (id === 'record' && hasFinding && lastFinding) { setFindingId(lastFinding.finding); setDrawer('finding'); }
    else setDrawer('node');
  };

  function renderNode(id: NodeId) {
    if (!details && (id === 'details' || id === 'tactic')) return null;
    const revealAt: Record<NodeId, number> = { details: 0, tactic: 0, caller: 0, agent: 1, payout: 2, other: 2, identity: 3, approval: 3, record: 4 };
    if (mapping !== null && mapping < revealAt[id]) return null;
    const [x, y] = NODES[id];
    const info = labels[id];
    const danger = id === 'record' && !!lastFinding && lastFinding.verdict === 'breached' && view.status[lastFinding.tool] === 'breached';
    const active = Object.entries(view.recent).some(([edge, at]) => t - (at ?? -99) < 2.5 && edge.includes(id));
    const prompt = id === 'approval' && !fixedServer;
    const sub = info.sub.length > 20 ? info.sub.slice(0, 18) + '…' : info.sub;
    return (
      <g key={id} className={`node ${id} ${danger ? 'danger' : ''} ${active && (playing || growing) ? 'active' : ''} ${prompt ? 'prompt' : ''} ${id === 'approval' && fixedServer ? 'enforced' : ''} ${node === id ? 'selected' : ''}`}
        transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={`${info.label}, ${info.sub}`}
        onClick={() => openNode(id)} onKeyDown={(event) => { if (event.key === 'Enter') openNode(id); }}>
        <rect className="node-face" x="-90" y="-38" width="180" height="76" rx="11" />
        <title>{info.role}: {info.label}. {info.sub}</title>
        <NodeIcon node={id} />
        <text className="node-title" x="-29" y="-5">{info.label.length > 16 ? info.label.slice(0, 15) + '…' : info.label}</text>
        <text className={`node-sub ${id === 'tactic' ? 'inferred' : ''}`} x="-29" y="16">{sub}</text>
        {((id === 'caller' && speaking && view.speaker === 'red') || (id === 'agent' && speaking && view.speaker === 'agent')) &&
          <rect className="speaking-frame" x="-95" y="-43" width="190" height="86" rx="14" />}
        {id === 'approval' && view.fixed && (
          <g transform="translate(78,-36)">
            <circle r="10" fill={fixedServer ? '#97d3b9' : '#c5aa8c'} />
            <text className="check-symbol" y="4" textAnchor="middle">✓</text>
          </g>
        )}
        {danger && lastFinding && (
          <g className="finding-badge" transform="translate(-44,-66)">
            <rect width="88" height="22" rx="6" />
            <text x="44" y="15" textAnchor="middle">✕ {lastFinding.finding}</text>
          </g>
        )}
      </g>
    );
  }

  // Replay metric: before; a candidate's own after-replay; the accepted fix's after vs before.
  const before = view.suites.before;
  const showReplay = before.length > 0 || view.testing !== null;
  const acceptedShown = !!view.fixed && view.testing === view.fixed.candidate;
  const candidate = !acceptedShown && view.testing ? view.testing : null;
  const stripValues = view.testing ? view.suites.after : before;
  const stripTotal = view.testing ? afterTotal(view.testing) : totals.before;

  const chips = shrinking ? chipCount(view, events) : 0;
  const removedByTurn = new Map(view.removeSteps.map((step) => [step.turn, step.kept]));
  const thinkingWho = view.thoughtWho;
  const replayAt = events.find((e) => e.type === 'phase' && e.value === 'Replay')?.at ?? events.find((e) => e.type === 'trial')?.at;
  const fixAt = events.find((e) => e.type === 'fix' && e.accepted)?.at ?? events.find((e) => e.type === 'fix')?.at;
  const storyFixes = events.filter((e): e is Ev<'fix'> => e.type === 'fix');
  const accepted = storyFixes.find((f) => f.accepted) ?? null;
  const findingThreat = finding ? story.threats.find((threat) => threat.tool === finding.tool) : undefined;
  const ref = finding?.ref;

  const breachPaused = !!lastFinding && lastFinding.verdict === 'breached' && t === lastFinding.at;
  const stage = breachPaused ? 'Breach' : view.pivoted ? 'Next route' : view.fixed ? 'Retest' : view.fix ? 'Fix' : shrinking ? 'Shrink' : showReplay ? 'Replay' : lastFinding?.verdict === 'breached' ? 'Breach' : t === 0 ? 'Map' : 'Attack';
  const guidance: Record<string, [string, string]> = {
    Map: ['What can this agent change?', `A caller asks the agent to use ${map.payout.label}, changing ${map.record.label}’s record. Follow the check between the agent and tool; select a node for its evidence.`],
    Attack: ['Can this caller cross the check?', 'Follow the caller through the agent to the write tool. A spoken promise alone is not proof of a breach.'],
    Breach: ['The call breached this permission.', breachPaused ? 'Playback is paused. Inspect the action and its evidence below before continuing.' : 'The changed record stays visible while the investigation moves toward a reproducible test.'],
    Shrink: ['Which caller lines caused the breach?', 'Remove a line, replay the call, and keep it only if the breach needs it. This isolates a reproducible test.'],
    Replay: ['Does the same attack work again?', 'Repeat the saved call against the same target version. Each result below is one trial; missing evidence stays inconclusive.'],
    Fix: ['Does this proposed check close the route?', view.fix?.rationale ?? 'Compare the candidate against the saved attack and normal calls.'],
    Retest: ['Does the fix hold without blocking normal callers?', 'Compare attack replays and normal calls for the accepted version. This result covers the tested route only.'],
    'Next route': ['One fix does not cover every action.', 'Test another permission. Earlier results remain attached to the version and route that produced them.'],
  };
  const mapSteps = ['Repository selected', 'Agent entry point', 'Tools and actions', 'Permission checks', 'Records and effects'];

  const notesBlock = story.notes.length > 0 && (
    <div className="report-section">
      <span className="eyebrow">NOTES <small>caveats</small></span>
      <ul className="story-notes">{story.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
    </div>
  );
  const sourcesBlock = story.sources.length > 0 && (
    <div className="report-section">
      <span className="eyebrow">SOURCES</span>
      {story.sources.map((source) => (
        <div className="data-row" key={source.path}><span>{source.path}</span><code title={source.sha256}>{source.sha256.slice(0, 12)}</code></div>
      ))}
    </div>
  );

  return (
    <div className={`app-shell split-loop ${details ? 'show-details' : 'focused'}`}>
      <header className="topbar flex items-center justify-between">
        <div className="brand">
          <span className="brand-mark">ϟ</span>faultline<span className="brand-dot">.</span>
          <span className="divider" />
          <span className="workspace">{map.workspace}</span>
          <span className="demo-tag">{judge ? 'live · judge' : storyTag(story)}</span>
        </div>
        <div className="header-actions flex items-center gap-2">
          <button className="quiet" onClick={() => { setPlaying(false); setFollowing(false); stopAudio(); setMapping(-1); }}><Icon name="branch" />Map repository</button>
          <button className="quiet" aria-pressed={details} onClick={() => setDetails(!details)}>{details ? 'Focus view' : 'Explore details'}</button>
          <button className="quiet" onClick={() => setDrawer('bench')}><Icon name="chart" /><span>Benchmarks</span></button>
          <button className={'quiet ' + (judge ? 'chosen' : '')} onClick={() => void startJudge()} disabled={!served || busy || (!judge && !status?.mock.up)}
            title={!served ? GO_LIVE : !status?.mock.up && !judge ? 'Mock target is not reachable' : 'Talk to the real target yourself'}>
            <Icon name="phone" /><span>Judge mode</span>
          </button>
          <button className="icon-button" onClick={() => setSound(!sound)} aria-label={sound ? 'Mute sound' : 'Enable sound'}>
            <Icon name={sound ? 'volume' : 'mute'} />
          </button>
        </div>
      </header>
      <div className="body-layout">
        <aside className="rail">
          <div className="rail-top">
            <span className="eyebrow">REPOSITORY</span>
            <button className="repo" onClick={() => setDrawer('repo')}>
              <Icon name="branch" />
              <span>{map.repo}<small><i className="green-dot" />{served ? (status?.mock.up ? 'Connected' : 'Target down') : 'Recorded'}</small></span>
              <Icon name="chevron" size={14} />
            </button>
          </div>
          <section className="rail-section">
            <div className="section-head"><span className="eyebrow">THREATS</span><span className="count">{pad2(story.threats.length)}</span></div>
            {story.threats.map((threat) => {
              const state = threatState(threat.tool, threat.status);
              const found = view.findings.find((f) => f.tool === threat.tool);
              return (
                <button key={threat.tool} className={`threat-row ${threat.tool === view.threatTool ? 'current' : ''}`} onClick={() => {
                  setOtherTool(threat.tool);
                  setNode(threat.tool === map.payout.tool ? 'payout' : 'other');
                  if (found) { setFindingId(found.finding); setDrawer('finding'); } else setDrawer('node');
                }}>
                  <span className={'threat-icon ' + state}>{VERDICT_ICON[state]}</span>
                  <span>{threat.label}<small>{state}</small></span>
                  {found && <span className="tiny-arrow">↗</span>}
                </button>
              );
            })}
          </section>
          <section className="rail-section callers">
            <div className="section-head"><span className="eyebrow">CALLERS</span><span className="count">{pad2(recorded.length)}</span></div>
            <div className="caller-list">
              {recorded.map((item, i) => (
                <button className={'persona ' + (i === selected && mode === 'recorded' ? 'active' : '')} key={item.id} onClick={() => loadStory(i)} title={item.title}>
                  <span className="avatar">{item.caller.initials}</span>
                  <span>{item.caller.name}<small>{item.caller.tactic} · {item.transport === 'sip' ? 'SIP' : 'text'}</small></span>
                  {i === selected && mode === 'recorded' && <i className="selected-dot" />}
                </button>
              ))}
            </div>
          </section>
          <div className="rail-bottom">
            <span className="status-dot" />
            {mode === 'live' ? 'Live run' : judge ? 'Judge session' : `${recorded[0] === EMPTY ? 0 : recorded.length} recorded run${recorded.length === 1 ? '' : 's'}`}
            <small>the scammer your voice<br />agent hasn’t met yet.</small>
          </div>
        </aside>
        <main className="main-area">
          <div className="arena-bar">
            <div>
              <div className="eyebrow">{eyebrow}</div>
              <h1>{headline}</h1>
            </div>
            <div className="workflow" aria-label="Workflow">
              {['Map', 'Attack', 'Breach', 'Shrink', 'Replay', 'Fix', 'Retest'].map((step) => <span key={step} className={stage === step ? 'current' : ''}>{step}</span>)}
            </div>
            <div className={`run-wrap ${served ? 'served' : 'playback-only'}`}>
              {served ? (
                <button className="run-button" onClick={() => setMenu(!menu)} disabled={liveRunning} aria-haspopup="menu" aria-expanded={menu}>
                  <Icon name="play" size={16} />{liveRunning ? 'Running…' : 'Run attack'}<Icon name="down" size={14} />
                </button>
              ) : (
                <button className="run-button" onClick={togglePlay} title={GO_LIVE}>
                  <Icon name={playing ? 'pause' : 'play'} size={16} />
                  {playing ? 'Pause' : t > 0 && t < duration ? 'Continue' : 'Replay attack'}
                </button>
              )}
              {menu && served && (
                <div className="run-menu" role="menu">
                  <button role="menuitem" onClick={() => { setMenu(false); if (mode !== 'recorded') loadStory(selected); else togglePlay(); }}>
                    <Icon name={playing ? 'pause' : 'play'} size={14} />{playing ? 'Pause recording' : 'Play recording'}<small>{story.title}</small>
                  </button>
                  <button role="menuitem" onClick={() => void runLive('loop')} disabled={!status?.mock.up}
                    title={status?.mock.up ? '' : 'Mock target is not reachable'}>
                    <Icon name="arrow" size={14} />Run loop (mock, text)<small>{status?.sim ? 'simulated models · $0' : 'uses model API calls'}</small>
                  </button>
                  {(() => {
                    const reason = !status?.sip.workerUp ? 'SIP worker is not running' : status.sip.callsLeft === 0 ? 'No approved calls left' : '';
                    return (
                      <button role="menuitem" onClick={() => void runLive('sip')} disabled={!!reason} title={reason}>
                        <Icon name="phone" size={14} />Place SIP call
                        <small>{reason || `${status?.sip.callsLeft} call${status?.sip.callsLeft === 1 ? '' : 's'} left · $${status?.sip.reservedUsd.toFixed(2)} of $${status?.sip.approvedUsd.toFixed(2)} reserved`}</small>
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
          <section className={`stage-guide ${breachPaused ? 'breach-guide' : ''}`} aria-live="polite">
            <div><span className="eyebrow">{stage} · {TIER_LABEL[story.tier]}</span><h2>{guidance[stage][0]}</h2><p>{guidance[stage][1]}</p>
              {stage === 'Breach' && lastFinding && <div className="evidence-change"><b>{lastFinding.tool}</b><span>{lastFinding.subject} · {lastFinding.field}</span><del>{lastFinding.before}</del><strong>→ {lastFinding.after}</strong><small>{TIER_LABEL[lastFinding.tier]}</small></div>}
              {showReplay && <p>Attack breaches: {suiteLine(stripValues, stripTotal, 'breached')}{view.suites.normal.length > 0 ? ` · Normal calls held: ${suiteLine(view.suites.normal, normalTotal(view.testing), 'held')}` : ''}</p>}
            </div>
            <div className="guide-actions">
              {pendingFix && liveRunId && <><p>{pendingFix.rationale}</p><code>{pendingFix.rules.join(", ")}</code><button className="run-button" disabled={busy} onClick={() => void reviewFix(true)}>Approve &amp; retest</button><button className="quiet" disabled={busy} onClick={() => void reviewFix(false)}>Decline candidate</button></>}
              {hasFinding && <button className="quiet" onClick={() => { setFindingId(lastFinding?.finding ?? null); setDrawer('finding'); }}>Inspect evidence <Icon name="chevron" /></button>}
              {!judge && <button className="run-button" onClick={togglePlay}>{playing || (growing && following) ? 'Pause' : breachPaused ? 'Continue investigation' : t === 0 ? 'Watch attack' : ended ? 'Replay investigation' : 'Continue'}<Icon name="arrow" /></button>}
            </div>
          </section>
          <div className="graph-wrap">
            {mapping !== null && <section className="mapping-panel" aria-label="Repository mapping preview">
              <div><span className="eyebrow">GitHub connection · interaction preview</span><h2>{mapping < 0 ? 'Connect a repository. Reveal its permissions.' : mapSteps[mapping]}</h2>
                <p>{map.repo} · Uses this target’s saved map. No GitHub connection or repository scan is performed.</p>
                <ol>{mapSteps.map((label, index) => <li key={label} className={mapping >= index ? 'revealed' : ''}>{mapping >= index ? '✓' : index + 1} {label}</li>)}</ol>
              </div>
              <div className="guide-actions">{mapping < 0 ? <button className="run-button" onClick={() => { seek(0); setMapping(0); }}>Preview connection <Icon name="branch" /></button> : mapping === 4 ? <button className="run-button" onClick={() => setMapping(null)}>Explore map <Icon name="arrow" /></button> : <button className="quiet" onClick={() => setMapping(4)}>Skip animation</button>}
                <button className="quiet" onClick={() => setMapping(null)}>Close preview</button></div>
            </section>}
            {/* Red vignette while a recorded breach stands (until a fix is accepted); it flares when the breach lands. */}
            <div className={`breach-vignette${breachOpen ? ' on' : ''}${breachFlash ? ' flash' : ''}`} aria-hidden="true" />
            <div className="graph-heading">
              <span className="map-label"><Icon name="layers" size={14} />Permission map <span>{map.nodesCount} nodes · {map.toolsCount} tools</span></span>
              <div className="map-status"><i className={playing || liveRunning || (growing && following && t < queueEnd) ? 'pulsing' : ''} />{mapStatus}</div>
            </div>
            <div className="graph-metrics">
              <div>
                <small>{judge ? 'YOUR TURNS' : shrinking || view.shortest ? 'SHORTEST CALL' : 'CALLER TURNS'}</small>
                <strong>
                  {judge ? view.turns : view.shortest ? (view.shortest.from === view.shortest.turns
                    ? <>{view.shortest.turns}<span className="out-of"> lines, all needed</span></>
                    : <><em>{view.shortest.from}</em><span className="metric-arrow">→</span>{view.shortest.turns}</>)
                    : pad2(view.turns)}
                </strong>
              </div>
              <div>
                <small>{judge ? 'RED’S BEST' : 'FIRST BREACH'}</small>
                <strong>{judge ? (recordedShortest ? recordedShortest.turns : '—') : view.first !== null ? mmss(view.first) : '—:—'}</strong>
              </div>
              <div>
                <small>FINDINGS</small>
                <strong>{pad2(view.findings.length)}</strong>
              </div>
              {showReplay && (
                <div className="replay-metric">
                  <small>{acceptedShown ? 'BEFORE → AFTER' : candidate ? `CANDIDATE ${candidate} · BREACHES` : 'REPLAY · BREACHES'}</small>
                  <strong>
                    {acceptedShown
                      ? <><em>{count(before, 'breached')}</em><span className="metric-arrow">→</span>{count(view.acceptedAfter, 'breached')}<span className="out-of"> of {Math.max(stripTotal, view.acceptedAfter.length)}</span></>
                      : <>{count(stripValues, 'breached')}<span className="out-of"> of {Math.max(stripTotal, stripValues.length)}</span></>}
                  </strong>
                  <Dots values={stripValues} total={stripTotal} />
                  {stripValues.length < stripTotal && <small className="normal-result">{stripValues.length} tested</small>}
                  {count(stripValues, 'inconclusive') > 0 && <small className="normal-result inconclusive-text">{count(stripValues, 'inconclusive')} inconclusive</small>}
                  {view.suites['normal-before'].length > 0 && (
                    <small className={'normal-result ' + (count(view.suites['normal-before'], 'inconclusive') ? 'inconclusive-text' : '')}>
                      Normal calls before {suiteLine(view.suites['normal-before'], totals['normal-before'], 'held')}
                    </small>
                  )}
                  {view.suites.normal.length > 0 && (
                    <small className={'normal-result ' + (count(view.suites.normal, 'inconclusive') ? 'inconclusive-text' : '')}>
                      ✓ Normal calls {suiteLine(view.suites.normal, normalTotal(view.testing), 'held')}
                    </small>
                  )}
                </div>
              )}
            </div>
            <div className={'canvas' + (firstBreachAt !== null && t >= firstBreachAt && t < firstBreachAt + 0.6 ? ' breach-freeze' : '')}>
              <svg className="graph" viewBox={details ? `${600 - 600 / zoom} ${255 - 255 / zoom} ${1200 / zoom} ${510 / zoom}` : `${710 - 480 / zoom} ${255 - 215 / zoom} ${960 / zoom} ${430 / zoom}`} role="img"
                aria-label="Voice agent permission map. Fixed nodes with directional attack paths.">
                <defs>
                  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#3c4149" opacity=".48" /></pattern>
                  <marker id="arrow-grey" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#545a65" /></marker>
                  <marker id="arrow-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#f17669" /></marker>
                </defs>
                <rect className="red-territory" x="10" y="48" width="430" height="390" rx="22" />
                <rect className="blue-territory" x="490" y="48" width="700" height="390" rx="22" />
                <text className="zone-label red-label" x="32" y="77">{judge ? 'JUDGE' : 'RED'}</text>
                <text className="zone-label" x="512" y="77">{map.workspace.toUpperCase()}</text>
                {(Object.entries(EDGES) as [keyof typeof EDGES, (typeof EDGES)[keyof typeof EDGES]][]).map(([id, edge]) => {
                  if (!details && ['details-caller', 'tactic-caller', 'feedback'].includes(id)) return null;
                  if (mapping !== null && mapping < 4) return null;
                  const passes = view.passes[id] ?? 0;
                  if (!details && passes === 0 && ['agent-caller', 'identity-agent', 'approval-agent', 'leak'].includes(id)) return null;
                  const age = t - (view.recent[id] ?? -999);
                  const hot = age < 2 && (playing || growing);
                  const back = id === 'feedback' || id === 'agent-caller' || id === 'leak';
                  const opacity = Math.max(0.16, 1 - age / 22);
                  return (
                    <g key={id} aria-label={id.replaceAll('-', ' to ')} className={'edge ' + (id === 'feedback' || id === 'leak' ? 'inferred-edge' : '')}>
                      <title>{id.replaceAll('-', ' → ')}: {passes ? 'observed in this run' : 'possible access, not yet observed'}</title>
                      <path d={edge.d} className="edge-base" markerEnd="url(#arrow-grey)" />
                      {passes > 0 && (
                        <>
                          <path d={edge.d} className={`edge-trail ${back ? 'return' : ''} ${view.fixed && id === 'agent-approval' ? 'held-edge' : ''}`} style={{ opacity }} markerEnd="url(#arrow-hot)" />
                          {hot && <circle r="4.5" className={back ? 'return-particle' : 'particle'}><animateMotion dur="1.35s" repeatCount="indefinite" path={edge.d} /></circle>}
                          <g className="pass-count" transform={`translate(${edge.x},${edge.y})`}>
                            <rect x="-12" y="-10" width="24" height="19" rx="6" />
                            <text textAnchor="middle" y="4">{passes}</text>
                          </g>
                        </>
                      )}
                      {id === 'feedback' && <text className="edge-label" x="274" y="480">adapt <tspan className="inferred">· inferred</tspan></text>}
                      {id === 'leak' && passes > 0 && <text className="edge-label" x="403" y="164">spoken leak · inferred</text>}
                    </g>
                  );
                })}
                {(Object.keys(NODES) as NodeId[]).map(renderNode)}
                {view.fixed && (
                  <g className={'closed-gate ' + (gate === 'breached' ? 'breached' : gate === 'held' ? '' : 'pending')} transform="translate(748,150)">
                    <rect x="-5" y="-14" width="10" height="28" rx="3" />
                    <text x="0" y="-22" textAnchor="middle">{gate === 'held' ? 'HELD' : gate === 'breached' ? 'BREACHED' : gate === 'inconclusive' ? 'UNSURE' : 'FIX'}</text>
                  </g>
                )}
              </svg>
            </div>
            <p className="map-scroll-hint">Swipe the map to follow the route →</p>
            <div className="graph-footer">
              <div className="legend">
                <span><i className="line" />Possible access</span>
                <span><i className="line coral" />Observed path</span>
                <span><i className="line dashed" />Prompt only</span>
                <span><i className="line mint" />Enforced</span>
                {story.notes.length > 0 && (
                  <button className="notes-link" onClick={() => setDrawer('repo')} title={story.notes.join('\n')}>
                    ⚠ {story.notes.length} note{story.notes.length === 1 ? '' : 's'}
                  </button>
                )}
              </div>
              <div className="zoom-controls">
                <button onClick={() => setZoom(Math.max(0.85, zoom - 0.1))} aria-label="Zoom out">−</button>
                <button onClick={() => setZoom(1)} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom(Math.min(1.4, zoom + 0.1))} aria-label="Zoom in">+</button>
              </div>
            </div>
          </div>
          <div className="live-strip">
            <div className={'speaker-avatar ' + (view.speaker === 'agent' ? 'agent' : '')}>
              {view.speaker === 'agent' ? <Icon name="phone" size={20} /> : judge ? 'YOU' : story.caller.initials}
            </div>
            <div className="caption-area">
              <div className="speaker-meta">
                <b>{view.speaker === 'agent' ? map.agent.label.toUpperCase() : judge ? 'JUDGE' : story.caller.name.toUpperCase()}</b>
                <span>{speaking ? 'Speaking' : view.speaker ? 'Caption' : 'Ready'}</span>
                {view.say?.heardBy === 'stt' && <span className="meta-chip">heard via STT</span>}
                {view.say?.audio && story.audio?.[view.say.audio.src] && <span className="meta-chip">{story.voiced ? 'voiced by TTS · words as recorded' : 'recorded audio'}</span>}
                {synthVoice && <span className="meta-chip">synthesised voice</span>}
                {view.keys && <span className="meta-chip">DTMF {view.keys.digits}</span>}
              </div>
              <div className="caption" aria-live="polite" title={view.caption}>{view.caption || (judge ? 'Say your first line.' : 'The map is ready. Make the first call.')}</div>
            </div>
            <div className={'waveform ' + (speaking ? 'talking' : '') + ' ' + (view.speaker === 'agent' ? 'agent' : '')} aria-hidden="true">
              {Array.from({ length: 23 }, (_, i) => (
                <i key={i} style={{ '--h': 8 + (Math.sin(i * 1.7) + 1) * 13 + 'px', '--delay': -i * 0.08 + 's' } as CSSProperties} />
              ))}
            </div>
          </div>
          <div className="thinking-line">
            <span className="thinking-spark">✦</span>
            <b>{thinkingWho}</b>
            <span className="thought-text" title={view.thought}>{view.thought}</span>
            {thinkingWho === 'BLUE' && view.fix && <small className="fix-kind">{view.fix.kind === 'server-check' ? 'server check' : 'prompt edit'} · {view.fix.candidate}</small>}
            <small>{thinkingWho === 'HARNESS' ? 'harness' : 'inferred'}</small>
            {shrinking && chips > 0 && (
              <div className="turn-chips">
                {Array.from({ length: chips }, (_, i) => {
                  const kept = removedByTurn.get(i + 1);
                  return <span key={i} className={kept === false ? 'removed' : kept === true ? 'needed' : ''} title={kept === true ? 'needed: removing it stopped the breach' : kept === false ? 'removed' : 'not tried yet'}>{i + 1}</span>;
                })}
              </div>
            )}
            {served && status?.mock.up && ended && !judge && (
              <button onClick={() => void startJudge()}>Take the phone <Icon name="arrow" size={15} /></button>
            )}
          </div>
          {judge ? (
            <form className="judge-input" onSubmit={(event) => { event.preventDefault(); void sendTurn(); }}>
              <button type="button" onClick={listen} className={'quiet ' + (listening ? 'coral-text' : '')}><Icon name="phone" />{listening ? 'Listening…' : 'Microphone'}</button>
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Say your next turn…" aria-label="Judge utterance" disabled={busy} />
              <button type="submit" className="run-button" disabled={!input.trim() || busy}>{busy ? 'Waiting…' : 'Send'} <Icon name="arrow" /></button>
              <span className="judge-verdict">{view.verdict?.verdict ?? view.status[view.threatTool] ?? 'untested'}</span>
            </form>
          ) : (
            <div className="timeline">
              <button className="play-circle" onClick={togglePlay} aria-label={playing ? 'Pause playback' : 'Play playback'}>
                <Icon name={playing || (growing && following) ? 'pause' : 'play'} size={15} />
              </button>
              <span className="timecode">{mmss(t)} <small>/ {mmss(duration)}</small></span>
              <div className="timeline-track">
                <input aria-label="Replay timeline" type="range" min="0" max={duration} step=".1" value={Math.min(t, duration)}
                  onChange={(event) => seek(+event.target.value)} style={{ '--progress': `${Math.min(100, t / duration * 100)}%` } as CSSProperties} />
                <div className="timeline-labels">
                  {story.markers.map((marker, i) => (
                    <button key={i} style={{ left: `${Math.min(100, marker.at / duration * 100)}%` }} onClick={() => seek(marker.at)} className={marker.breach ? 'breach-marker' : ''}>
                      {marker.breach ? '◆ ' : ''}{marker.label}
                    </button>
                  ))}
                </div>
              </div>
              <button className="speed" onClick={() => setSpeed((s) => s === 1 ? 2 : s === 2 ? 4 : 1)} aria-label="Playback speed">{speed}×</button>
              <button className="icon-button" aria-label="Restart" onClick={() => { seek(0); setDrawer(null); }}><Icon name="reset" size={17} /></button>
            </div>
          )}
        </main>
      </div>
      {toastText && <div className="toast" role="status"><Icon name="check" />{toastText}</div>}
      {drawer && (
        <div className="drawer-layer">
          <button className="drawer-backdrop" aria-label="Close panel" onClick={() => setDrawer(null)} />
          <aside className={'drawer ' + (drawer === 'bench' ? 'wide' : '')} role="dialog" aria-modal="true"
            aria-label={drawer === 'bench' ? 'Benchmarks' : drawer === 'repo' ? 'Repository' : drawer === 'node' ? 'Node details' : 'Finding details'}>
            <div className="drawer-head">
              <span className="eyebrow">{drawer === 'bench' ? 'EARLIER RUNS' : drawer === 'repo' ? 'REPOSITORY' : drawer === 'node' ? 'ACCESS DETAILS' : 'FINDING REPORT'}</span>
              <button className="icon-button" onClick={() => setDrawer(null)} aria-label="Close details"><Icon name="close" /></button>
            </div>
            {drawer === 'repo' && (
              <>
                <h2>Map the target.</h2>
                <button className="run-button" onClick={() => { setDrawer(null); setPlaying(false); setFollowing(false); stopAudio(); setMapping(-1); }}>Preview repo connection <Icon name="branch" /></button>
                <div className="repo-large">
                  <Icon name="branch" size={28} />
                  <h3>{map.repo}</h3>
                  <span>{map.workspace}</span>
                  <div className="repo-facts">
                    <span>{map.toolsCount} tools</span><span>{map.nodesCount} nodes</span><span>{story.threats.length} threats</span>
                  </div>
                </div>
                <div className="data-row"><span>Agent</span><b>{map.agent.label} · {map.agent.sub}</b></div>
                <div className="data-row"><span>Primary write</span><code>{map.payout.tool}</code></div>
                <div className="data-row"><span>Other writes</span><b>{map.other.tools.join(', ') || '—'}</b></div>
                <div className="data-row"><span>Record</span><b>{map.record.label} · {map.record.field}</b></div>
                <div className="data-row"><span>Evidence</span><b>{TIER_LABEL[story.tier]} · {story.transport === 'sip' ? 'SIP call' : 'text mode'}</b></div>
                <div className="data-row"><span>Target version</span><b>{story.version.before}</b></div>
                {notesBlock}
                {sourcesBlock}
              </>
            )}
            {drawer === 'bench' && (
              <>
                <h2>Earlier runs.</h2>
                <div className="bench-caption">{map.workspace} · {story.title}</div>
                {story.benchmarks?.length ? (
                  <table className="benchmark">
                    <thead><tr><th>Method</th><th>Breaches</th><th>Turns</th><th>After fix</th></tr></thead>
                    <tbody>
                      {story.benchmarks.map((row, i) => (
                        <tr key={row.label}><td>{i === 0 && <i className="red-dot" />}{row.label}</td><td>{row.breaches}</td><td>{row.turns}</td><td>{row.afterFix}</td></tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div className="bench-caption">No benchmark rows recorded for this run.</div>}
                <h3 className="drawer-subhead">Call history</h3>
                {recorded.filter((item) => item !== EMPTY).map((item, i) => (
                  <button className="history-row" key={item.id} onClick={() => loadStory(i)}>
                    <Icon name="play" />
                    <span>{item.title}<small>{item.id} · {storyTag(item)} · {mmss(item.duration)}</small></span>
                    <Icon name="arrow" />
                  </button>
                ))}
              </>
            )}
            {drawer === 'node' && node && (
              <>
                <h2>{labels[node].label}</h2>
                <span className="node-detail-role">{labels[node].role}</span>
                {node === 'other' ? (
                  <>
                    <div className="tool-list">
                      {map.other.tools.map((tool) => (
                        <button key={tool} className={(otherTool ?? map.other.tools[0]) === tool ? 'selected' : ''} onClick={() => setOtherTool(tool)}>
                          <code>{tool}</code><Icon name="chevron" size={15} />
                        </button>
                      ))}
                    </div>
                    <div className="data-row"><span>Access</span><b>Write</b></div>
                    <div className="data-row"><span>Status</span><b>{threatState(otherTool ?? map.other.tools[0] ?? '', story.threats.find((x) => x.tool === (otherTool ?? map.other.tools[0]))?.status ?? 'untested')}</b></div>
                    <div className="data-row"><span>Group</span><b>{map.other.sub}</b></div>
                  </>
                ) : node === 'approval' ? (
                  <>
                    <div className="permission-preview">
                      <span className={fixedServer ? 'solid-check' : 'hollow-check'}>✓</span>
                      <h3>{view.fixed ? labels.approval.sub : map.approval.prompt}</h3>
                    </div>
                    <div className="data-row"><span>Rule</span><b>{map.approval.rule}</b></div>
                    <div className="data-row"><span>Protects</span><code>{map.payout.tool}</code></div>
                    {view.fixed && <div className="data-row"><span>Fix</span><b>{view.fixed.candidate} · {view.fixed.kind}</b></div>}
                    {fixAt !== undefined && (
                      <button className="primary-full" onClick={() => { seek(view.fixed ? (firstBreachAt ?? 0) : fixAt); setDrawer(null); }}>
                        {view.fixed ? 'View original breach' : 'Jump to fix'}<Icon name="arrow" />
                      </button>
                    )}
                  </>
                ) : node === 'record' ? (
                  <>
                    <div className="data-row"><span>{map.record.field}</span><b>{view.record}</b></div>
                    <div className="data-row"><span>Initial</span><b>{map.record.initial}</b></div>
                    <div className="data-row"><span>Verdict</span><b>{view.status[view.threatTool] ?? 'untested'}</b></div>
                  </>
                ) : (
                  <>
                    <div className="data-row"><span>Type</span><b>{labels[node].role}</b></div>
                    <div className="data-row"><span>Detail</span><b>{labels[node].sub}</b></div>
                    {node === 'payout' && <code className="code-block">{map.payout.tool}</code>}
                    {node === 'details' && <div className="data-row"><span>Subject</span><b>{map.record.label}</b></div>}
                    {node === 'tactic' && <div className="data-row"><span>Source</span><b>Model reasoning · inferred</b></div>}
                    {node === 'agent' && <div className="data-row"><span>Version</span><b>{story.version.before}{story.version.model ? ` · ${story.version.model}` : ''}</b></div>}
                  </>
                )}
              </>
            )}
            {drawer === 'finding' && (finding ? (
              <>
                <div className="finding-top">
                  <span className="severity">{finding.verdict.toUpperCase()}</span>
                  <span>{finding.finding} · {finding.runId}</span>
                </div>
                <h2>{findingThreat?.label ?? finding.label ?? finding.tool}</h2>
                <div className="evidence-verdict">{VERDICT_ICON[finding.verdict]} {finding.verdict} <span>{TIER_LABEL[finding.tier]}</span></div>
                <div className="evidence-record">
                  <span>{finding.subject}</span>
                  <small>{finding.field}</small>
                  <s>{finding.before}</s>
                  <strong>{finding.after}</strong>
                </div>
                <code className="code-block">{finding.tool}</code>
                {finding.label && <div className="data-row"><span>Rule</span><code>{finding.label}</code></div>}
                <div className="data-row"><span>Record changed</span><b className={finding.before !== finding.after ? 'coral-text' : ''}>{finding.before !== finding.after ? 'Yes' : 'No'}</b></div>
                {finding.turn !== undefined && <div className="data-row"><span>Caller turn</span><b>{finding.turn}</b></div>}
                <div className="data-row"><span>Target version</span><b>{story.version.before}</b></div>
                {story.version.model && <div className="data-row"><span>Model</span><b>{story.version.model}</b></div>}
                {story.version.promptHash && <div className="data-row"><span>Prompt hash</span><code>{story.version.promptHash}</code></div>}
                {ref && <div className="data-row"><span>Source</span><code>{ref.file}{ref.line ? `:${ref.line}` : ''}</code></div>}
                {ref?.t && <div className="data-row"><span>Logged at</span><b>{ref.t}</b></div>}
                <div className="report-section">
                  <span className="eyebrow">SHORTEST CALL</span>
                  {(() => {
                    const shortest = events.find((e): e is Ev<'shortest'> => e.type === 'shortest');
                    return (
                      <button className="short-call" onClick={playShortest} disabled={!shortest}>
                        <Icon name="play" />
                        <b>{shortest ? (shortest.from === shortest.turns ? `${shortest.turns} lines, all needed` : `${shortest.from} → ${shortest.turns} lines`) : `${finding.turn ?? '—'} turns · not shrunk`}</b>
                        {shortest && <span>{shortest.fails} of {shortest.runs} still breach · ▶ Play call</span>}
                      </button>
                    );
                  })()}
                  {totals.before > 0 && (
                    <>
                      <div className="report-rate">{count(before, 'breached')} <small>of {totals.before}{before.length < totals.before ? ` · ${before.length} replayed so far` : ''}</small></div>
                      <Dots values={before} total={totals.before} />
                      {count(before, 'inconclusive') > 0 && <small className="inconclusive-text">{count(before, 'inconclusive')} inconclusive (not counted as held)</small>}
                    </>
                  )}
                </div>
                <div className="report-section">
                  <span className="eyebrow">BLUE’S FIX <small>inferred</small></span>
                  {storyFixes.length === 0 ? <h3>No fix recorded in this run.</h3> : storyFixes.map((fix) => (
                    <div key={fix.seq} className={'fix-candidate ' + (fix.accepted ? 'accepted' : 'rejected')}>
                      <h3>{fix.rationale}</h3>
                      <small>{fix.candidate} · {fix.kind === 'server-check' ? 'server check' : 'prompt edit'} · {fix.accepted ? 'accepted' : 'rejected'}</small>
                      {fix.rules.map((rule, i) => <code className="code-block" key={i}>{rule}</code>)}
                      {!fix.accepted && fix.reasons.length > 0 && <ul className="story-notes">{fix.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
                    </div>
                  ))}
                  {accepted && view.fixed ? (
                    <div className="fix-result">
                      <div><small>Before</small><b>{count(before, 'breached')} of {totals.before}</b></div>
                      <div><small>After</small><b className="mint-text">{view.acceptedAfter.length >= afterTotal(accepted.candidate) ? `${count(view.acceptedAfter, 'breached')} of ${afterTotal(accepted.candidate)}` : `${view.acceptedAfter.length} tested`}</b></div>
                      {view.acceptedNormal.length > 0 && <span>✓ Normal calls {suiteLine(view.acceptedNormal, normalTotal(accepted.candidate), 'held')}</span>}
                    </div>
                  ) : fixAt !== undefined && (
                    <button className="secondary-full" onClick={() => { seek(fixAt); setPlaying(true); setDrawer(null); }}>Play fix & replay <Icon name="arrow" /></button>
                  )}
                </div>
                {notesBlock}
                {sourcesBlock}
                <div className="finding-actions">
                  <button className="primary-full" onClick={() => saveTest(finding.finding)}>
                    <Icon name={savedTests.includes(finding.finding) || view.saved.includes(finding.finding) ? 'check' : 'plus'} />
                    {savedTests.includes(finding.finding) || view.saved.includes(finding.finding) ? 'Saved as test' : 'Save as test'}
                  </button>
                  <button className="secondary-full" disabled={replayAt === undefined} onClick={() => { if (replayAt !== undefined) { seek(replayAt); setPlaying(true); setDrawer(null); } }}>
                    <Icon name="play" />Replay
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>No finding yet.</h2>
                <div className="bench-caption">No backend record changed in this run up to {mmss(t)}.</div>
                {notesBlock}
              </>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}

if (typeof document !== 'undefined') createRoot(document.getElementById('root')!).render(<App />);
