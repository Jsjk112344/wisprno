import pg from 'pg';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { readInputs } from './input.ts';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export function connection() {
  const env = new URL('../../.env', import.meta.url);
  if (existsSync(env)) loadEnvFile(env);
  if (!process.env.TIGER_DATABASE_URL) throw new Error('Set TIGER_DATABASE_URL in Wisprno’s .env');
  // Honor explicit libpq sslmode semantics (pg otherwise aliases require to verify-full).
  // verify-full/verify-ca and any sslrootcert supplied by the user remain unchanged.
  const url = new URL(process.env.TIGER_DATABASE_URL);
  if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('uselibpqcompat', 'true');
  return new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000,
    application_name: 'faultline-archive', statement_timeout: 120000 });
}

export function* archiveBatches(rows: readonly unknown[], maxBytes = 64 * 1024): Generator<string> {
  let batch: string[] = [], bytes = 2;
  for (const row of rows) {
    const encoded = JSON.stringify(row), size = Buffer.byteLength(encoded) + 1;
    if (batch.length && (bytes + size > maxBytes || batch.length >= 100)) {
      yield '[' + batch.join(',') + ']'; batch = []; bytes = 2;
    }
    batch.push(encoded); bytes += size;
  }
  if (batch.length) yield '[' + batch.join(',') + ']';
}

export async function loadArchive(client: pg.Client, input: ReturnType<typeof readInputs>, progress?: (table: string, staged: number, total: number) => void) {
  const inserted: Record<string, number> = {};
  await client.query('BEGIN');
  try {
    // Serializes loaders, including attempts to import a changed timestamp at an existing line.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('faultline-archive-v1'))");
    for (const [table, rows, key] of [
      ['call_events', input.events, 'source_file, source_line'],
      ['fix_attempts', input.fixes, 'source_file, source_index'],
    ] as const) {
      await client.query(`CREATE TEMP TABLE stage_${table} (LIKE ${table}) ON COMMIT DROP`);
      let staged = 0;
      for (const batch of archiveBatches(rows)) {
        const result = await client.query(`INSERT INTO stage_${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, [batch]);
        staged += result.rowCount ?? 0;
        progress?.(table, staged, rows.length);
      }
      if (table === 'call_events') {
        const duplicate = await client.query(`SELECT s.run_id FROM stage_call_events s JOIN call_events d USING (run_id)
          WHERE s.source_file <> d.source_file LIMIT 1`);
        if (duplicate.rowCount) throw new Error('A run was already imported from another source file. Nothing imported.');
      }
      const changed = await client.query(`SELECT s.source_file FROM stage_${table} s JOIN ${table} d USING (${key})
        WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(d) LIMIT 1`);
      if (changed.rowCount) throw new Error(`Previously imported content changed: ${changed.rows[0].source_file}. Nothing imported.`);
      const result = await client.query(`INSERT INTO ${table} SELECT * FROM stage_${table} ON CONFLICT DO NOTHING`);
      inserted[table] = result.rowCount ?? 0;
      const verified = await client.query(`SELECT count(*)::integer AS n FROM stage_${table} s JOIN ${table} d USING (${key}) WHERE to_jsonb(s) = to_jsonb(d)`);
      if (verified.rows[0].n !== rows.length) throw new Error(`Source reconciliation failed for ${table}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  // Historical archive: explicitly refresh all buckets, including the final partial hour.
  // No scheduled policy, retention, model work, or service provisioning.
  await client.query("CALL refresh_continuous_aggregate('call_metrics_hourly', NULL, NULL)");
  const counts = await client.query(`SELECT 'call_events' AS name, count(*)::integer AS rows FROM call_events
    UNION ALL SELECT 'fix_attempts', count(*)::integer FROM fix_attempts
    UNION ALL SELECT 'call_metrics_hourly', count(*)::integer FROM call_metrics_hourly`);
  return { inserted, database: counts.rows };
}

export const metricsQuery = `SELECT strategy, agent_version, version_hash, test_case,
  sum(attempts)::integer AS attempts, sum(breaches)::integer AS breaches,
  sum(held)::integer AS held, sum(inconclusive)::integer AS inconclusive,
  sum(untested)::integer AS untested, sum(judged_attempts)::integer AS judged_attempts,
  sum(inferred_disclosures)::integer AS inferred_disclosures
FROM call_metrics_hourly WHERE dataset = 'experiment' AND phase = 'test' AND run_kind = 'attempt'
GROUP BY strategy, agent_version, version_hash, test_case ORDER BY strategy, agent_version, test_case`;

export async function chartData(client: pg.Client) {
  const metrics = await client.query(metricsQuery);
  const normals = await client.query(`SELECT strategy, agent_version, version_hash,
    sum(normal_attempts)::integer AS attempts, sum(normal_completions)::integer AS completions,
    sum(normal_unknown)::integer AS unknown
    FROM call_metrics_hourly WHERE dataset='experiment' AND run_kind='normal'
    GROUP BY strategy, agent_version, version_hash ORDER BY strategy, agent_version, version_hash`);
  return { metrics: metrics.rows, normals: normals.rows };
}
