# Managed startup for public repository uploads

**Application deployed; execution worker disabled.** The existing Vultr web application was updated. No server was created or resized. The operator has no separate execution host. This is a managed-startup preview with real local-container verification. It is not yet a publicly verified arbitrary-code hosting service or a hosted real-model investigation service.

## Developer flow

Upload and review source → **Let Wisprno start it** → select a prepared runtime and entry file → **Review launch configuration** → approve execution → **Start agent** → watch actual worker events → validate the responding bridge and source identity → map and investigate.

The developer does not start a laptop service or deploy a target manually. The existing companion and direct server connection remain available. Startup does not create an investigation or authorize model spending. The UI retains a browser-scoped managed job across reloads. Another browser cannot inspect, connect to or stop that job. Stop sandbox is blocked while an investigation is active; first stop or finish the investigation. A candidate awaiting approval counts as active.

Managed hosting adds source transfer, sandbox startup and readiness checks. Prepared immutable images avoid repeating dependency installation. Events record actual timestamps; the UI does not invent progress or predict startup duration. Startup failure, missing bridge, and full investigation compatibility are separate outcomes.

## Supported launch boundary

The first profiles execute a selected Python entry file or JavaScript/TypeScript entry file using Node. Every profile pins an installed image by immutable SHA-256 image ID. The worker never pulls an image at launch, accepts Dockerfiles or shell commands from the browser, or runs repository package-install hooks. Runtime images must contain `/usr/bin/timeout` and their declared interpreter.

Profiles can contain reviewed framework dependencies, but only standard-library profiles were tested in this change. Unknown external imports receive a preparation-time explanation. Dynamic imports and environment-dependent behavior remain runtime unknowns. A selected source bundle remains limited to 80 files and 200 KB; this is not a copy of an arbitrary repository or dependency tree. Omitted source can prevent startup. The optional discovery manifest remains data, never launch authority.

The entry must listen on `127.0.0.1:8080` using `PORT` and accept a generated `WISPRNO_TARGET_TOKEN` (`TARGET_ADMIN_TOKEN` is also supplied). It must expose the existing `wisprno.bridge.v1` runtime contract and report its actual source hashes. Wisprno does not fabricate tool semantics, initial records or normal-call expectations. Starting the process is not enough to pass preflight.

**Current sandboxes have no network or provider keys.** `MODEL_PROVIDER=stub` is a hint, not a mode-switch guarantee: external model calls are blocked by the network namespace regardless of target behavior. Only targets with their own explicit offline/stub behavior can complete scripted investigations. Real-mode readiness continues to reject them. A metered provider gateway tied to explicit launch consent is required before this path can host real-model investigations. The direct and companion paths retain their existing real-model support and spend controls.

## Separate Vultr execution host

The web application must not receive Docker-socket access. A separate worker exposes a bearer-protected loopback control API. The web application uses its own loopback endpoint, optionally forwarded through an operator-maintained private SSH tunnel. Worker credentials live in a mode-0600 `results/ui/managed-worker.json` on the web host. They are never returned to browsers, mounted into targets or passed as target environment variables. The worker host must not contain the web application's `.env`, provider credentials, Tiger credentials or deployment SSH key.

Public mode requires an operator-declared dedicated execution host, a rootless daemon, `runsc`, and working memory/CPU/PID cgroup limits. It refuses normal Docker as the public sandbox. This is a fail-closed configuration check, not a proof that the host is dedicated or free of vulnerabilities. Docker documents the privilege risk of granting a web service daemon access; gVisor documents its rootless and syscall-isolation boundaries. [Docker security](https://docs.docker.com/engine/security/), [Docker rootless](https://docs.docker.com/engine/security/rootless/), [gVisor rootless](https://gvisor.dev/docs/user_guide/rootless/), [gVisor architecture](https://gvisor.dev/docs/architecture_guide/intro/).

No host port is published for a target. The worker transports only the allowlisted investigation HTTP routes through bounded `docker exec` requests to the target's container-local loopback. Target sessions must have been created through that worker. Source is mounted read-only; no Docker socket, home directory, provider secret or other target state is mounted.

Fixed limits: one CPU, 256 MB memory with no extra swap, 64 processes, bounded file descriptors, a 64 MB temporary filesystem, read-only root, non-root UID, all Linux capabilities dropped and no privilege escalation. Network is `none`. A container-local watchdog ends execution after 1,800 seconds even if the worker stops. A worker timer also cleans up expired containers. There is a configured concurrency limit and a maximum of 100 retained launch records. Operators must archive old launch artifacts before accepting more once that bound is reached. No record is deleted to disguise a failure.

The worker persists startup events, exact launch plan and state beneath its configured root. After a worker restart, existing jobs are marked interrupted and their labelled containers are removed. Target requests are not replayed. Start requests are bound to a frozen plan and deduplicated by the web application; if a start response is lost, the UI reports uncertain execution rather than automatically launching again.

## Activation is a separate acceptance step

No commands below have been applied to Vultr. The service template is `deploy/vultr/managed/wisprno-worker.service`. Before installing it, an operator must approve/provide a separate execution host, install and verify rootless Docker plus runsc, prepare runtime images, set the actual service UID/socket paths, and configure the private transport. The current shared Wisprno host must not be repurposed as the public executor. No new resource or cloud spending approval has been inferred.

Worker private JSON configuration:

```json
{
  "root": "/var/lib/wisprno-worker/jobs",
  "docker": "/usr/bin/docker",
  "runtime": "runsc",
  "mode": "public-sandbox",
  "dedicatedHost": true,
  "maxJobs": 1,
  "port": 4531,
  "controlToken": "GENERATE_PRIVATELY_32_RANDOM_BYTES_AS_HEX",
  "profiles": [
    {
      "id": "python-stdlib",
      "name": "Reviewed Python standard library",
      "language": "python",
      "image": "sha256:PIN_THE_INSTALLED_IMAGE_ID",
      "modules": ["os", "json", "http", "uuid", "hashlib", "copy"]
    }
  ]
}
```

The placeholders deliberately do not form a runnable production configuration. Run the worker with `node scripts/managed-worker.ts /etc/wisprno-worker/worker.json`. Both the config file and control token stay private. The web-side JSON contains only `{"url":"http://127.0.0.1:4531","token":"PRIVATE_MATCHING_CONTROL_TOKEN"}` and must be 0600.

Before enabling public uploads, verify the actual Vultr/runsc deployment, adversarial filesystem/network isolation, cgroup enforcement and cleanup on worker death. The local `runc` tests do not establish those properties for public hosting. Then implement and validate the separate metered provider path if real-model hosted testing is required. Deployment and public activation remain unauthorized in this session.

## Local verification

`npm run check` includes deterministic launch-plan and public-sandbox prerequisite tests without Docker/network access. `RUN_MANAGED_CONTAINER_TESTS=1 node scripts/verify-managed.ts` explicitly starts only independently constructed synthetic Node and Python fixtures in local containers. It expects installed `node:24-bookworm-slim` and `python:3.12-slim-bookworm` images, resolves their immutable IDs, checks container limits, runs the existing full scripted investigation and removes its labelled containers. It never contacts Vultr or a model provider.

`node scripts/serve-managed-fixture.ts` starts a local browser-verification server; containers start only when the UI approves. Its metadata is written to `/tmp/wisprno-managed-browser.json`. This is explicitly `local-verification` mode, not a public sandbox. Local source staging uses a private directory under the home folder so desktop Docker/Colima can access the mount; production uses the worker's private state directory.
