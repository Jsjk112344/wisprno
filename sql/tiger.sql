-- Apply through Tiger MCP to the existing DEV service. No scheduled jobs or retention.
CREATE TABLE IF NOT EXISTS call_events (
  time timestamptz NOT NULL,
  source_file text NOT NULL,
  source_line integer NOT NULL CHECK (source_line > 0),
  run_id text NOT NULL,
  strategy text CHECK (strategy IN ('prompt', 'checks')),
  round integer,
  agent_version text,
  version_hash text,
  version_stamp jsonb,
  test_case text,
  dataset text NOT NULL,
  run_kind text,
  phase text NOT NULL,
  event_type text NOT NULL,
  speaker text,
  text text,
  tool_name text,
  tool_decision text,
  verdict text CHECK (verdict IN ('breached', 'held', 'inconclusive', 'untested')),
  evidence_tier text,
  normal_completed boolean,
  inferred_disclosed boolean,
  annotations jsonb NOT NULL,
  raw_event jsonb NOT NULL,
  PRIMARY KEY (time, source_file, source_line)
);
SELECT create_hypertable('call_events', by_range('time'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS call_events_source ON call_events (source_file, source_line);
CREATE INDEX IF NOT EXISTS call_events_run ON call_events (run_id, time);

CREATE TABLE IF NOT EXISTS fix_attempts (
  source_file text NOT NULL,
  source_index integer NOT NULL,
  round integer NOT NULL,
  strategy text NOT NULL CHECK (strategy IN ('prompt', 'checks')),
  version text,
  target_failure text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accepted', 'rejected', 'undecided')),
  reasons jsonb NOT NULL,
  replay_fails integer,
  replay_runs integer,
  replay_inconclusive integer,
  raw_fix jsonb NOT NULL,
  PRIMARY KEY (source_file, source_index),
  CHECK (replay_fails >= 0 AND replay_fails <= replay_runs),
  CHECK (replay_inconclusive >= 0 AND replay_inconclusive <= replay_runs)
);

CREATE MATERIALIZED VIEW IF NOT EXISTS call_metrics_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 hour', time) AS bucket,
  strategy, agent_version, version_hash, test_case, dataset, phase, run_kind,
  count(*) AS attempts,
  count(*) FILTER (WHERE verdict = 'breached') AS breaches,
  count(*) FILTER (WHERE verdict = 'held') AS held,
  count(*) FILTER (WHERE verdict = 'inconclusive') AS inconclusive,
  count(*) FILTER (WHERE verdict = 'untested') AS untested,
  count(*) FILTER (WHERE run_kind = 'normal') AS normal_attempts,
  count(*) FILTER (WHERE normal_completed IS TRUE) AS normal_completions,
  count(*) FILTER (WHERE run_kind = 'normal' AND normal_completed IS NULL) AS normal_unknown,
  count(*) FILTER (WHERE inferred_disclosed IS NOT NULL) AS judged_attempts,
  count(*) FILTER (WHERE inferred_disclosed IS TRUE) AS inferred_disclosures
FROM call_events
WHERE event_type = 'run.end'
GROUP BY bucket, strategy, agent_version, version_hash, test_case, dataset, phase, run_kind
WITH NO DATA;
