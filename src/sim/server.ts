// The real mock server in-process (loopback, temp DB) with the simulated target, plus sim harness models. No network.
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../runner/context.ts';

export async function startSimServer(dir: string, limit: number, mockDir = resolve(process.env.MOCK_DIR ?? '../voice_agent_mock')) {
  const { server } = await import(pathToFileURL(join(mockDir, 'src', 'server.mjs')).href);
  const { Store } = await import(pathToFileURL(join(mockDir, 'src', 'store.mjs')).href);
  const { simTarget } = await import('./target.ts');
  const store = new Store(join(dir, 'mock.sqlite'));
  const token = randomBytes(32).toString('hex');
  const app = server({ store, provider: simTarget({ reserve: () => store.reserve(limit) }), adminToken: token, requestLimit: limit });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
  const cfg = loadConfig({
    TARGET_URL: `http://127.0.0.1:${app.address().port}`, TARGET_ADMIN_TOKEN: token, CONCURRENCY: process.env.CONCURRENCY ?? '8', TARGET_REQUEST_CAP: '20000', RESULTS_DIR: dir,
    TESTER_MODEL: 'sim:tester', CALLER_MODEL: 'sim:caller', FIXER_MODEL: 'sim:fixer', JUDGE_MODEL: 'sim:judge', EXAM_TESTER_MODEL: 'sim:exam-tester',
  });
  return { app, store, cfg };
}
