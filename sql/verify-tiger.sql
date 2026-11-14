-- Run through Tiger MCP after loading. Compare these to the loader's source manifest.
SELECT 'call_events' AS relation, count(*) AS rows FROM call_events
UNION ALL SELECT 'fix_attempts', count(*) FROM fix_attempts
UNION ALL SELECT 'call_metrics_hourly', count(*) FROM call_metrics_hourly;

SELECT dataset, strategy, count(DISTINCT source_file) AS files, count(*) AS events,
  count(*) FILTER (WHERE event_type='run.end') AS runs
FROM call_events GROUP BY dataset, strategy ORDER BY dataset, strategy;

SELECT strategy, decision, count(*) AS fixes FROM fix_attempts
GROUP BY strategy, decision ORDER BY strategy, decision;

SELECT verdict, count(*) AS runs FROM call_events WHERE event_type='run.end'
GROUP BY verdict ORDER BY verdict;

SELECT sum(attempts) AS attempts, sum(breaches) AS breaches, sum(held) AS held,
  sum(inconclusive) AS inconclusive, sum(untested) AS untested,
  sum(normal_attempts) AS normal_attempts, sum(normal_completions) AS normal_completions,
  sum(judged_attempts) AS judged_attempts, sum(inferred_disclosures) AS inferred_disclosures
FROM call_metrics_hourly;

SELECT hypertable_name, num_dimensions FROM timescaledb_information.hypertables
WHERE hypertable_name='call_events';
SELECT view_name, materialized_only FROM timescaledb_information.continuous_aggregates
WHERE view_name='call_metrics_hourly';
