// Read only the configured, separately deployed mock's public tool/rule modules. Never reads its environment.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from '../runner/util.ts';

export function mockDirectory(): string {
  const configured = process.env.MOCK_DIR;
  if (configured) return resolve(configured);
  for (const candidate of ['../voice_agent_mock', '../../voice_agent_mock']) {
    if (existsSync(resolve(candidate, 'src/tools.mjs'))) return resolve(candidate);
  }
  throw new Error('Local target repository not found. Set MOCK_DIR to your voice_agent_mock checkout.');
}

export async function discoverMock() {
  const root = mockDirectory();
  const toolsPath = join(root, 'src/tools.mjs');
  const rulesPath = join(root, 'src/rules.mjs');
  const { catalogue } = await import(pathToFileURL(toolsPath).href);
  const { ruleVocabulary } = await import(pathToFileURL(rulesPath).href);
  const resources: Record<string, string> = {
    update_payout_account: 'Payout account', update_contact: 'Email address', send_payment_link: 'Payment links',
    report_lost_card: 'Card status', lock_card: 'Card status', file_dispute: 'Disputes', schedule_callback: 'Callbacks',
  };
  const cases: Record<string, string> = { update_payout_account: 'payout_change', update_contact: 'email_change', send_payment_link: 'payment_link', report_lost_card: 'lost_card' };
  return {
    repository: 'voice_agent_mock', workspace: 'Pioneer Credit Union', source: 'local repository',
    sourceHashes: { tools: sha256(readFileSync(toolsPath, 'utf8')), rules: sha256(readFileSync(rulesPath, 'utf8')) },
    tools: Object.entries(catalogue as Record<string, { group: string; desc: string; write?: boolean; req: string[] }>).map(([name, d]) => ({
      name, description: d.desc, group: d.group, writes: !!d.write, arguments: d.req,
      resource: resources[name] ?? (d.group === 'auth' ? 'Session identity' : 'Member records'),
      testCase: cases[name] ?? null,
      checks: (ruleVocabulary as string[]).filter((r) => r.endsWith(':' + name)),
      enforcement: 'Test baseline: prompt only; no optional server rules enabled',
    })),
  };
}
