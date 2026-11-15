# Wisprno deployment

The owned instance is `66.42.95.122`. The application hostname is `https://wisprno.us`, with authoritative DNS at Porkbun. Only SSH, HTTP and HTTPS are public. Caddy redirects HTTP to HTTPS and streams SSE without buffering. Every application route requires HTTP Basic authentication. The username is `wisprno`.

Retrieve the password privately in your terminal:

```sh
ssh -i ~/.ssh/id_ecdsa root@66.42.95.122 "python3 -c 'import json; v=dict(line.strip().split(\"=\",1) for line in open(\"/etc/wisprno/harness.env\")); print(json.loads(v[\"DEMO_PASSCODE\"]))'"
```

Do not paste credentials into chat or commit them. To rotate the password, edit `DEMO_PASSCODE` in `/etc/wisprno/harness.env` privately and restart `wisprno` after checking for an active run.

## Services and state

| Service | Code | Persistent state | Listen address |
|---|---|---|---|
| `wisprno` | `/opt/wisprno/current` | `/var/lib/wisprno/results`, `/var/lib/wisprno/harness-budget.json` | `127.0.0.1:4323` |
| `wisprno-target` | `/opt/wisprno-target/current` | `/var/lib/wisprno-target/target.sqlite` | `127.0.0.1:4310` |
| `caddy` | `/etc/caddy/Caddyfile` | Caddy certificate storage | 80, 443 |

The harness and target have separate unprivileged service accounts. Source is root-owned. Node 24.22.3 is installed under `/opt/node`; its archive was checked against Node's published checksum. Both services restart on failure. Logs are in journald:

```sh
systemctl status wisprno wisprno-target caddy
journalctl -u wisprno -u wisprno-target -f
python3 /opt/wisprno/current/deploy/vultr/verify.py
```

`verify.py` assumes paid launch is locked and never calls a model. Read `/api/status` before stopping a service. An `activeRunId` includes a run awaiting fix approval. Finish or decline the proposal before deployment. A forced restart interrupts an active run; its saved history remains inconclusive, not held. Completed archives and the target database survive service restarts.

## Runs and spending

Open the site, select **Past runs** to replay evidence or **New live run** to connect the source catalogue and choose an action and caller. Source animations are presentation. Catalogue relationships are tailored to this target. Gemini relationships are inferred and runtime paths are observed separately. Deployment disables Gemini, judge mode and SIP routes.

The public profile uses one attack attempt (up to 12 caller turns), minimization, three baseline replays, one possible fix proposal, three candidate replays and two normal calls on each version. Normal callers can use up to 14 turns. A candidate requires separate approval in the UI; declining it makes no candidate calls. Changes apply to isolated target sessions, not the target's default rules.

A single approved run consumes `/var/lib/wisprno/results/live-approved` before launch. Another run requires another explicit spend approval. After that approval, an operator grants one allowance:

```sh
# First inspect /api/status and finish any active run.
# LIVE_SPEND_ENABLED must be "true" in /etc/wisprno/harness.env.
install -m 600 -o wisprno -g wisprno /dev/null /var/lib/wisprno/results/live-approved
```

Then use the UI's spend checkbox and launch button. Do not grant another allowance while a run is active. Revoking an unused allowance is `rm /var/lib/wisprno/results/live-approved`.

Cumulative limits are 100 target HTTP requests and 40 harness HTTP attempts. Harness reservations include retries (up to three retries per logical call). The target does not retry provider failures. Every target request permits at most 1,000 output tokens and 64,000 input bytes; every harness request permits at most 1,000 output tokens and 32,000 input bytes. These are not dollar caps or exact input-token caps. Do not reset ledgers, raise caps, or purchase anything without approval. Key presence does not establish provider access. Missing evidence and provider failures remain inconclusive.

The local fallback remains `npm run ui:sim`. It uses scripted models with real synthetic tools. Do not stop the user's existing local processes as part of a deployment.

## Tiger archive

`ui_investigations` is separate from `call_events`, `fix_attempts` and the formal experiment chart. Each row has an execution mode (`simulation` or `real-model`), provenance, immutable content hash and the original ordered logs, session evidence, timestamps and version stamps. Historical experiment data is unchanged. The manual historical loader excludes `live` and `ui` directories.

Completed runs first persist locally. Immutable bundles and pending/synced/failed states live in `results/ui/ingestion`. The worker retries failures and scans finalized archives at startup. The Past runs library shows sync state and offers Retry. Repeated inserts reconcile the content hash under a unique investigation ID. An outage does not change a verdict or discard local evidence. The full evidence bundle is available through the authenticated `/api/runs/:id/evidence` endpoint.

## Deploy and rollback

Run `bash deploy/vultr/deploy.sh` locally after checks. It transfers actual working-tree source for both projects, never their `.env` files, databases, private keys or raw result directories. Only a compiled recorded-story bundle is transferred. The target remains separate. `configure-secrets.mjs` is a one-time explicit allowlist transfer from this project's `.env`; it refuses to overwrite existing server configuration and generates deployment-specific tokens on the server.

Every release is kept under each service's `releases` directory. Before switching, the deploy script refuses an active run and backs up Caddy and unit files under `/root/wisprno-backups/<release>`. Each backup records both previous symlink targets. To roll back after checking that no investigation is active:

1. Set `LIVE_SPEND_ENABLED="false"` privately in the harness environment, remove any unused single-run allowance, then stop `wisprno` and `wisprno-target`.
2. Point `/opt/wisprno/current` and `/opt/wisprno-target/current` to the paired previous release paths recorded in the backup.
3. Restore that backup's service units and Caddyfile; run `systemctl daemon-reload` and `caddy validate --config /etc/caddy/Caddyfile`.
4. Start both services and reload Caddy. Verify `/api/status` and archived playback.

Keep `/var/lib/wisprno*` and `/etc/wisprno` intact. Never reset provider usage during rollback. The initial backup preserves the original firewall configuration and package list. The server had no pre-existing web workload.

## Repository selector, sound, and provider caps (Nov 14 update)

The authenticated setup screen lists Pioneer and the separate owned pharmacy, utility and clinic targets. “Choose folder from device” uploads allowlisted text source only (200 KB maximum); no environment, dependencies or executable imports. A source upload can test only when its files match an operator-registered deployment. `/etc/wisprno/targets.json` names those deployments and their readonly source/version stamps. Source catalogue declarations and Gemini interpretations are labelled separately from observed tool effects. Contract targets keep their own prompt; profile style is not injected. Contract investigations currently perform one adaptive attempt, without automatic fix proposals or normal-call coverage. Pioneer retains the full existing workflow.

Targets are separate systemd services: `wisprno-pharmacy` (loopback 4411, Gemini), `wisprno-utility` (4412, OpenAI), `wisprno-clinic` (4413, Anthropic). Code: `/opt/wisprno-targets/<name>/current`; state: `/var/lib/wisprno-<name>/target.sqlite`. Each has its own private `/etc/wisprno/<name>.env` and 15-request lifetime ceiling. Voice is disabled. Deploy actual sibling source with `deploy-contracts.sh`; configure keys/registration privately with `configure-contracts.py`. The scripts never read sibling environment files. Their model access has not been exercised in this deployment.

`wisprno-spend` listens only on 127.0.0.1:4311. Its SQLite ledger persists in `/var/lib/wisprno-spend/budget.sqlite`, protected by a separate service user and token. Approved cumulative ceilings: OpenAI $5, Gemini $2, Anthropic $3, ElevenLabs $0. Each model HTTP attempt reserves a conservative upper amount before dispatch, using input bytes as tokens plus framing allowance and the output maximum. Failed requests are not refunded. Unsupported models, unavailable budget service, and exhausted caps fail closed. There is no automatic reset. This controls these instrumented deployment requests, not unrelated usage of the provider account or its invoice. Provider account billing limits were not changed. Python target reservations use the full 80 KB request allowance. The original 100-target/40-harness request ceilings remain; harness retries consume reservations. Gemini mapping allows one attempt per source version, no retries, 40 KB source/4,000 output tokens. ElevenLabs credentials are intentionally not deployed.

`account-prior-spend.py` idempotently reserved $1.5408 for the existing 14 target/12 harness requests using their previous maximum bounds. This is conservative, not measured billing. View remaining reservations on setup or authenticated `/api/spend`. Never delete the budget database to reset spending. Price snapshot in `src/spend/ledger.ts`; verify before adding a model.

Replay sound is presentation only. The Play button begins with a synthesized ringing cue. Recorded clips play their audio; text transcripts use browser speech synthesis labelled “Browser narration · synthetic.” No TTS provider is called. Mute, pause and seeking cancel sound. Browser voices and device volume determine audibility; transcripts remain the evidence.

Check services with `systemctl status wisprno wisprno-spend wisprno-target wisprno-pharmacy wisprno-utility wisprno-clinic`; logs with `journalctl -u <service> -n 100`. Paid investigations still require the single-run allowance described above. Configuring caps did not authorize additional paid verification.

Rollback: retain budget/state directories. Restore the paired harness/Pioneer release symlinks recorded in `/root/wisprno-backups/<release>/`, restore corresponding backed-up units, then daemon-reload/restart. For contract targets, restore each prior symlink from `/root/wisprno-backups/contracts-<release>/`; if this was its first deployment, stop/disable that target service and remove only its registry entry. Back up registry/environment before changes. Never restore older spending counters. Existing site and archives remain independent of new target services.

Offline verification for this update: 79 harness tests, 5 UI tests, 35 Pioneer tests, 32 pharmacy tests, 57 utility tests and 48 clinic tests. Typecheck/lint/UI build pass. Authenticated Chrome checks verify the selector, matched source upload, archived playback, ringing oscillators, transcript narration dispatch and mute without model calls. Browser playback dispatch is verified; speaker volume is controlled by the device. Paid integration tests for the three new model targets and Gemini mapping remain unexecuted.

Folder recognition: device uploads are now checked on the server before saving. An exact registered-source match is accepted; otherwise supported framework imports must accompany agent/session/pipeline usage. Generic apps, audio players, text-only API clients, and folders with no source are rejected with an explanation. Recognition is static and may reject unfamiliar implementations; it is not proof of runtime capabilities or permission to execute uploaded code. Recognized but unregistered source still requires a matching owned deployment. No API calls are used for recognition.

## Shared HTTP target integration (report follow-up)

`HttpTargetAdapter` implements the shared contract; `MockAdapter` retains Pioneer compatibility. Discovery validates `/tools` against `/version`. Contract sessions omit Pioneer persona/verification/rule overrides, and refuse unsupported fix options before sending. Explicit isolated prompt overrides are supported; automatic contract fix proposals/replay/normal-call suites remain unavailable. Pharmacy must not receive server-rule fixes.

The contract scorer uses server-resolved `event.subject`, declared tool kind/checks, and correlated record snapshots. In-tool `identity:<tool>` checks use recorded `authAfter`; other tools use `authBefore`. Unknown checks or missing/inconsistent evidence remain inconclusive. Recorded `turn.completed.auth`, identity denials, locks, and handoff notes are retained in ordered logs. Reads and handoffs are selectable in the UI alongside writes.

Clinic has an explicit evaluation policy in `targets.json`: `scoringPolicy: {"handoffLevel":"otp"}`. A note attached at KBA level fails this policy even though the target declares no transfer guard. The UI and run metadata show the distinction. It does not modify the target or claim that its server enforced this requirement. Attacker sessions use a non-member handset and refuse to start model work if it matches any seed phone. Caller facts come from the selected target’s synthetic seed records; phone/auth/code/secret fields are withheld. A changed prompt/model/tools/rules/guard between discovery and session creation blocks testing.

Pharmacy is configured with `GEMINI_MODEL="gemini-3.5-flash-lite"` on Vultr. Its existing 15-request cap remains; the separate local smoke job’s approved 30-request limit was not copied or applied to Vultr. No new paid verification was run. External smoke evidence remains unchanged and is not automatically imported into experiment charts.

For offline integration verification, start each target with `MODEL_PROVIDER=stub`, a temporary database, and a separate loopback port. Then run `TARGET_URL=... TARGET_ADMIN_TOKEN=... node scripts/verify-contract-target.ts` (add `--handoff-otp` for clinic). The verifier refuses real providers. Do not run the contract kit’s reset checks against persistent deployment state.

Public browsing is temporarily enabled with `PUBLIC_PREVIEW="true"` at the owner's request. GET pages, discovery, and archived playback no longer challenge for a password. POST actions and raw evidence downloads still require operator Basic authentication; anonymous attempts return 403 without a login popup. The existing password is retained privately. To restore the site-wide login, set `PUBLIC_PREVIEW="false"` in `/etc/wisprno/harness.env` and restart `wisprno` after checking for an active investigation. This flag does not change spending allowances or provider caps.

### Recurring access (owner-authorized)

The owner authorized repeated UI launches within the existing caps. With `LIVE_SPEND_ENABLED="true"`, `/var/lib/wisprno/results/live-approved-recurring` grants recurring access instead of consuming a single-run marker. Operator authentication, the UI spend checkbox, one active run, source validation, provider dollar caps and request ceilings still apply. This grant does not itself launch anything or authorize automatic narration/SIP calls.

Revoke recurring access with `rm /var/lib/wisprno/results/live-approved-recurring`; also remove `live-approved` to revoke any single-use grant. Setting `LIVE_SPEND_ENABLED="false"` disables both modes after a service restart. Neither revocation stops an already running investigation.

### Generic bridge update

`/operator` now challenges for the existing operator Basic credentials even in public preview. New target connections can be saved at `/new` without registry or stamp edits. Start the owned target separately on this server, upload bounded selected source, provide its loopback endpoint and token, review the explicit evaluator policy and normal outcomes, and approve disposable stub checks. See `docs/generic-bridge.md` in the working tree for the versioned bridge boundary and current limitations.

The new connection store is `/var/lib/wisprno/results/ui/connections/`; credential files are mode 0600 inside mode-0700 directories. The $1 reservation ledger for new bridge investigations is `/var/lib/wisprno/results/ui/investigation-budget.sqlite`. Launch idempotency records live under `results/ui/launches`. Existing provider ledgers and recurring access are unchanged. Existing legacy targets retain their previous workflow unless they implement the new bridge capabilities.

Use `bash deploy/vultr/deploy-harness.sh` to deploy only this application's actual working tree. It preserves target services, Caddy configuration, environments and provider counters. It refuses active investigations, including pending approvals, and records `harness-previous` in `/root/wisprno-backups/<release>/`. After confirming `/api/status` has no activeRunId, rollback consists of setting `/opt/wisprno/current` to that recorded previous path and restarting `wisprno` only. Keep `/var/lib/wisprno` intact. No target rollback or spend reset is needed for this harness-only update.

### Owner-requested public access

`PUBLIC_NO_AUTH="true"` removes Basic sign-in for the entire UI and API. Anyone who reaches the site can upload source, use saved connections, read evidence, launch within shared spend caps, stop runs and approve isolated candidates. Credentials remain server-side and are never returned. Origin checks, URL restrictions, rate limits and spend limits remain enabled. This is shared public access, not user isolation. To restore operator authentication, remove this setting and restart only after checking for active runs.

## Existing session API investigations (current update)

See `docs/plug-and-play.md` for the exact supported boundary. Compatible existing APIs now negotiate through a Wisprno-owned adapter and can complete minimization, baseline replay, explicit candidate approval, isolated retesting, normal calls, report and saved regression without a Wisprno endpoint. The companion supports npm startup and an explicit Python entry script. Source and policy are validated before launch; unsupported APIs remain blocked with capability-specific reasons.

The optional local `--real` profile uses a separate scripted process and an OpenAI-compatible local gateway. Only an in-flight, explicitly approved investigation turn may spend through it. The upstream provider key stays on this host. Existing persistent dollar ledgers, request caps, $1 investigation caps and browser ownership controls remain in effect. No separate execution host or new cloud resource was added. A scripted connection is labelled simulation even when the web server runs in production mode.

Harness-only deployment and rollback remain as described above. Independent fixture outcomes do not constitute real-model or held-out results. Never restart while `/api/status.activeRunId` is set, including pending candidate approval.
