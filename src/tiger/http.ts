import { connection, chartData } from './database.ts';
export function tigerError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === '28P01') return { code, error: 'Tiger Data rejected the database password. Update TIGER_DATABASE_URL in Faultline’s .env, then restart the UI server. This request could not verify cloud data.' };
  if (code === '42P01' || code === '42883') return { code, error: 'Tiger Data is reachable, but the archive schema or aggregate is missing. Apply sql/tiger.sql, then run npm run tiger:load.' };
  return { code: code ?? 'TIGER_UNAVAILABLE', error: 'Tiger Data is unavailable. Check TIGER_DATABASE_URL and service access. No database credentials are sent to the browser.' };
}
export async function tigerMetrics() {
  let client: ReturnType<typeof connection> | undefined;
  try {
    client = connection(); await client.connect();
    return { status: 200, body: { ...await chartData(client), source: 'Tiger Data', checkedAt: new Date().toISOString() } };
  } catch (e) { return { status: 503, body: tigerError(e) }; }
  finally { await client?.end().catch(() => {}); }
}
