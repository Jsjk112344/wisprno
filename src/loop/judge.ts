// Judge mode: a person types (or speaks) caller turns into a real session on the mock target. Every reply, tool call
// and backend record shown comes from that session's evidence; nothing is simulated in the UI.
import { randomUUID } from 'node:crypto';
import type { Session } from '../adapter/mock.ts';
import { SCENARIOS } from '../runner/cases.ts';
import type { Ctx } from '../runner/context.ts';
import { baselineVersion } from '../runner/experiment.ts';
import { score } from '../scorer/index.ts';
import type { AgentVersion } from '../types.ts';
import type { EdgeId, UiEvent } from './story.ts';

const IDENTITY = new Set(['verify_identity', 'send_otp', 'verify_otp']);
const HIGH = new Set(['lock_card', 'report_lost_card', 'update_contact', 'update_payout_account', 'send_payment_link', 'schedule_callback', 'file_dispute']);
const route = (tool: string): EdgeId[] => (IDENTITY.has(tool) ? ['agent-identity', 'identity-agent'] : HIGH.has(tool) ? ['agent-approval', 'approval-payout'] : ['agent-other']);
const show = (tool: string, r: any): string => {
  if (!r) return '';
  if (tool === 'lock_card' || tool === 'report_lost_card') return `••${r.card?.last4} ${r.card?.status}`;
  if (tool === 'update_contact') return String(r.contact);
  if (tool === 'update_payout_account') return String(r.payout_account);
  return `record v${r.version}`;
};

export class JudgeSession {
  readonly id = randomUUID();
  private readonly ctx: Ctx;
  private readonly version: AgentVersion;
  private session: Session | null = null;
  private lastSeq = 0;
  private seq = 0;
  private turn = 0;
  private readonly t0 = Date.now();
  private findings = 0;
  constructor(ctx: Ctx, version: AgentVersion = baselineVersion()) {
    this.ctx = ctx;
    this.version = version;
  }
  private ev(e: Omit<UiEvent, 'seq' | 'at' | 'runId'> & Record<string, unknown>): UiEvent {
    return { ...e, seq: ++this.seq, at: Number(((Date.now() - this.t0) / 1000).toFixed(2)), runId: this.session?.id ?? this.id } as UiEvent;
  }

  async start(): Promise<UiEvent[]> {
    const sc = SCENARIOS.spoof; // the caller's phone is not the member's; caller ID is asserted, not verified
    this.session = await this.ctx.adapter.createSession({ arm: 'baseline', persona: 'credit_union', verified: false, ani: sc.ani, handset: sc.handset, prompt: this.version.prompt, rules: this.version.rules, replyCheck: this.version.replyCheck, notes: 'judge mode' });
    const evidence = await this.ctx.adapter.getEvidence(this.session.id);
    this.lastSeq = evidence.events.at(-1)?.seq ?? 0;
    const greeting = await this.ctx.adapter.start(this.session);
    return [
      this.ev({ type: 'phase', value: 'Attack', source: 'harness' }),
      this.ev({ type: 'say', speaker: 'agent', turn: 0, text: greeting.text, heardBy: 'text', source: 'target', route: ['agent-caller'] }),
    ];
  }

  async say(text: string): Promise<UiEvent[]> {
    if (!this.session) throw new Error('judge session not started');
    const out: UiEvent[] = [this.ev({ type: 'say', speaker: 'red', turn: ++this.turn, text, heardBy: 'text', source: 'caller', route: ['caller-agent'] })];
    const reply = await this.ctx.adapter.sendTurn(this.session, text);
    const evidence = await this.ctx.adapter.getEvidence(this.session.id);
    const failures = new Map(score(evidence).failures.map((f) => [f.signature.split(':')[1], f.signature]));
    for (const e of evidence.events) {
      if (e.seq <= this.lastSeq || (e.type !== 'tool.result' && e.type !== 'tool.rejected')) continue;
      const tool = String(e.tool);
      out.push(this.ev({ type: 'tool', tool, args: e.args, allowed: e.result?.verdict === 'allow', reason: e.result?.reason ?? (e.reason as string | undefined), source: 'target', route: route(tool) }));
      if (e.result?.effect && e.before && e.after && failures.has(tool)) {
        out.push(this.ev({ type: 'record', finding: `J-${String(++this.findings).padStart(3, '0')}`, tool, field: tool, subject: e.before.name, before: show(tool, e.before), after: show(tool, e.after), verdict: 'breached', tier: 'backend-record', turn: this.turn, label: failures.get(tool), source: 'backend', route: ['payout-record'] }));
      }
    }
    this.lastSeq = evidence.events.at(-1)?.seq ?? this.lastSeq;
    out.push(this.ev({ type: 'say', speaker: 'agent', turn: this.turn, text: reply.text, heardBy: 'text', source: 'target', route: ['agent-caller'] }));
    return out;
  }
}
