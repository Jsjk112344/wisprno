# Faultline archive chart

The main UI links to this panel through **Tiger Data outcomes** on setup and past runs. The panel reads `call_metrics_hourly` in Tiger Data. It never imports the engine, scorer, adapter, or model providers.

1. Apply `sql/tiger.sql` with Tiger MCP or `tiger db query <service-id> --file sql/tiger.sql` against the intended existing DEV service. Confirm the service is free or obtain spending approval first; do not create, resize, or upgrade a service automatically.
2. Set `TIGER_DATABASE_URL` in this repository's git-ignored `.env`. URL-encode special characters in the password. Restart the UI server after changing its environment. `sslmode=require` uses libpq's encrypted-connection semantics; use `verify-full` with a trusted root certificate for certificate and hostname verification.
3. Inspect sources offline: `npm run tiger:load -- --dry-run`.
4. Load: `npm run tiger:load`. Repeat to verify zero inserted rows. The transaction checks existing content and refuses changed source rows or relocated duplicate runs. Uploads use small UTF-8 byte-limited batches with progress output. A failed import rolls back its rows. It then refreshes all historical aggregate buckets after a successful commit.
5. Open **Tiger Data outcomes** in the main UI (`/tiger`), or run `npm run tiger:chart` and open http://127.0.0.1:4318. Connection failures appear with a retry button; they never fall back to fabricated data. The connection string stays on the server; the browser receives aggregate counts only.

`npm run check` remains offline and needs neither the database nor `.env`. The new unit tests use temporary synthetic files. `npm run tiger:load` reads saved files and performs database writes; it never starts a call or a model run.

## Data and interpretation

The loader reads `results/**/events/*.jsonl` and `results/sip/*/events.jsonl`, recursively excluding `sim` and `identity`. It imports fixes from `results/summary/{prompt,checks}/round-*.json`, reads their version context and the exam version IDs, and attaches existing `.judge.json` and `normal.json` sidecars. Sidecar content and provenance are retained in `annotations`; source events are unchanged in `raw_event`.

The initial archive contains 3,223 event files, 64,620 nonblank event lines, and 24 fix attempts. The loader reports current source counts on every invocation and verifies that every staged row matches the stored row. Additional historical database rows are reported in total counts, not silently deleted.

Only terminal `run.end` events contribute to the aggregate. Tool `allow` decisions are separate from run verdicts. Run `fail` maps to `breached`, `pass` to `held`; `inconclusive` and `untested` remain distinct. Evidence tier describes the available evidence source; it does not turn a missing outcome into a pass. A setup failure with no start event is marked `none`.

The chart defaults to the five tool-action cases in the experiment test phase. Recorded breach rates use all attempted test calls as their denominator, including inconclusive calls, and display held and inconclusive counts alongside each rate. Versions with no conclusive outcomes show no plotted rate or interval; an all-inconclusive group is not displayed as a zero-breach success. Inferred disclosure rates use only calls with an existing cached judgment and explicitly show the number not judged. Recorded and inferred numerators are never added together. Normal completion comes from saved completion flags, not the held verdict or copied round summary totals.

Each exact version stamp has its own hash; unknown stamps stay unknown. A version number belongs to its strategy. Pilot, exam, replay, minimisation, and SIP data remain in the archive but are excluded from the default comparison. In particular, all 720 exam attempts in this archive are inconclusive. Wilson intervals are descriptive; adaptive and repeated calls are not independent randomized trials.

The continuous aggregate includes an hourly bucket because Timescale continuous aggregates require a time bucket on the hypertable's partition column. The panel sums the hourly counts by strategy, exact version, and test case. There is no automatic refresh, retention, or billing-changing policy; the loader refreshes after a successful import. [Tiger documentation](https://www.tigerdata.com/docs/build/continuous-aggregates/create-a-continuous-aggregate).

## Judge explanation

“Faultline records timestamped call events, so we can preserve what happened in order and compare outcomes as agent versions change. Tiger Data stores those events in a hypertable and rolls completed attempts into an hourly aggregate for this chart. The chart compares recorded breaches for prompt fixes and server checks as ‘x of n,’ keeps inconclusive calls visible, and labels model-judged disclosures separately as inferred.”

## Run library

Choose **Past runs** in the main UI to open locally saved investigations and curated recordings. Each entry labels simulation versus live text or SIP, the target and caller, version, event count, and completion status. Interrupted runs remain inconclusive. **New live run** opens setup; the server's simulation/live mode remains explicit and paid model requests still require approval. Completed archives replay locally without opening a live event stream. An active investigation must finish before a new run starts on that server.

New UI runs are saved under `results/ui/runs`; they are not automatically added to the experiment comparison. The Tiger loader reads the experiment sources described above, so a UI replay does not manufacture a new experimental trial.

## Verified cloud load

Verified on 2026-11-14 against existing DEV service `ezldmegc1s`: 64,620 events, 24 fix attempts, and 178 hourly aggregate rows. A second full load inserted zero event or fix rows. All 3,223 source run endings reconcile with aggregate attempts. The hypertable and continuous aggregate were confirmed through Timescale metadata; an actual MCP database query also succeeded. See [verification output](../../results/summary/tiger-verification.json).

The main UI and chart were checked in a browser, including archive replay without a live stream, starting a new run from history, active-run protection, connection-error recovery, and recorded/inferred evidence switching. No new model or SIP runs were performed for this verification.
