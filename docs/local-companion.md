# Connect a laptop agent without deploying it to Vultr

The companion is deployed at **https://wisprno.us**. HTTPS pairing, source validation, disposable contract checks and dynamic mapping have been verified with an independent synthetic fixture. This verification did not launch a paid investigation.

## Browser workflow

1. Start an owned synthetic voice agent on your computer. Wisprno detects the native runtime API or an existing tools/session HTTP API. Existing APIs without verified isolation and policy capabilities currently support connection and mapping only; full investigation remains unavailable for that adapter. Use a private `http://127.0.0.1:<port>` endpoint. The companion does not install dependencies, import your repository, execute manifest commands or start the agent for you.
2. In New analysis, select your repository folder and upload the reviewed bounded source set.
3. At Connect target, choose **On my computer**. Download the readable companion script. Node.js 24 or later is required; it has no third-party dependencies.
4. In the download folder, run the displayed `node wisprno-companion.mjs --server <Wisprno origin>` command. Enter the target endpoint in the terminal. Wisprno first tries without credentials. Only an authentication rejection prompts for the agent’s access key, with hidden input. Agents without authentication need no key. Alternatively provide a token through an explicitly named environment variable with `--token-env`; never put its value in a command argument.
5. Click **Create pairing code**, then paste it into the terminal prompt. The code is private, single-use and expires after ten minutes. Keep the terminal open. A connected status appears in the browser.
6. Confirm ownership, click Check connection, review the evaluator policy and normal-call expectations, then Validate & save target. Only explicitly disposable stub checks run during this step. Open the map and follow the existing persona, objective and explicit spend-approval flow.
7. The investigation, fix approval and reports use the existing engine. Stop investigation prevents further work; a dispatched request can finish. Revoke laptop access prevents new relay requests. Neither can undo an action or charge that already occurred.

For development from this repository, use `npm run companion -- --server http://127.0.0.1:4321 --target http://127.0.0.1:<target-port>`. This command intentionally does not load any `.env` file. Start the local UI separately with `npm run ui:start` for scripted testing, or use the existing real-mode command with its spend controls.

**On the Wisprno server** preserves the existing direct endpoint and credential flow. An agent on another host, arbitrary HTTPS targets, SIP/PSTN, automatic framework instrumentation and arbitrary repository execution are outside this companion boundary.

## Transport and credentials

The companion opens only outbound HTTP(S) requests to Wisprno and loopback requests to the one explicitly selected local target. It never opens an inbound listening port. Production relay origin is restricted to `https://wisprno.us`; local development accepts `http://127.0.0.1:<port>`. Redirects are refused. The relay is not an arbitrary URL proxy: it allows only the normalized health, catalogue, version, readiness, budget, bridge and isolated-session endpoints.

The target admin token stays in the companion process. Target session bearer tokens stay in a local session table; distinct opaque handles cross the relay. Target response strings are scrubbed for those known bearer secrets. Transcripts, source selections, authorization context and backend evidence intentionally reach Wisprno; use synthetic data. This is not a promise that arbitrary target responses cannot contain other sensitive information.

A browser gets a random HttpOnly, SameSite=Strict pairing cookie, Secure on HTTPS. This requires no account or sign-in screen. Session storage retains only a non-secret pairing ID for the selected source; pairing codes and target credentials are never stored there. Laptop connections and their investigations are scoped to that browser, including discovery, launch, decisions, stop, evidence and regression playback. Existing shared server targets retain their existing public access policy. Losing the cookie requires a new pairing; the UI cannot recover private evidence from another browser. This is scoped companion access, not a general multi-user account system.

Pairing records live at `results/ui/companions/<id>.json`, mode 0600 in a mode-0700 directory. Worker credentials are stored as hashes on the server. A scoped internal relay credential is held privately by the server and never returned in a browser response. The terminal saves its worker credential, server and target origin to `~/.wisprno/companion.json` (0600), never the target bearer token. Use `--state <path>` for a separate pairing. Pairings expire after 24 hours. To pair again, revoke the old pairing and remove its local state file.

## Disconnect and restart behavior

Restarting the same command with the same state file reconnects an unexpired pairing. Server pairing records survive a Wisprno restart; online status is not fabricated from disk. A restarted companion has no previous target-session tokens. Existing calls may therefore become inconclusive and should not be resumed as if their execution were known. New investigations create fresh isolated sessions.

Jobs are delivered at most once. A timed-out or disconnected target call is never replayed automatically. Result delivery may retry up to three times with the same job ID; the server acknowledges duplicate results without invoking the target again. Pending jobs are bounded to 32 per pairing, request bodies to 300 KB and target responses to 2 MB. There is one worker poll per pairing. Queued mutations are rejected if the investigation stops before dispatch. A lost response can leave execution uncertain; this remains an error/inconclusive outcome, not a held verdict.

Real-model calls still require the existing spend confirmation, $1 investigation reservation and stricter cumulative caps. The bridge must enforce its declared provider bounds. The companion cannot independently enforce an arbitrary target's provider billing. Pairing is not model-spend approval. No real-model calls or production deployment are part of the implementation checks.

## Start an npm agent with temporary access settings

Download the current companion. From the owned project directory, run:

```sh
node ~/Downloads/wisprno-companion.mjs --server https://wisprno.us --start
```

This is an explicit local execution command. It runs the project's existing `npm start`, with a chosen local port and fresh random `ADMIN_TOKEN` and `TARGET_ADMIN_TOKEN` environment values. It does not inspect `.env`, install dependencies, or change repository files. The project itself executes its normal startup code, which may read its own configuration or contact providers. Connection probes themselves are read-only and make no model calls. Only run a trusted synthetic project.

The project must honor `PORT` and one of those access-key variables. Starting the agent does not establish evidence or investigation compatibility. The existing-API adapter still cannot perform the full investigation. The companion never removes authentication from a previously running service. Ctrl+C terminates the process group it started. An already-occupied requested port is rejected; unrelated processes are never stopped. Windows process-tree cleanup has not been verified.
