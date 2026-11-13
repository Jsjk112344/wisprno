# AIReceptionist spike tools

Read [REPORT.md](REPORT.md) for the observed result and its limits. This directory contains throwaway caller/export tooling and configuration examples. It contains no AIReceptionist or other framework source. The mock, experiment runner and UI retain their existing paths.

The working SIP topology is Baresip → self-hosted LiveKit SIP → local LiveKit/Redis → our external AIReceptionist worker → OpenAI Realtime. Baresip uses a direct INVITE with digest authentication and `regint=0`; it does not REGISTER to LiveKit. The softphone and gateway share the media server's isolated Docker network namespace. The numbered SIP users are synthetic and no call reaches the PSTN.

Local deployment files are under `~/.local/share/faultline/deployments/`:

- `AIReceptionist/faultline_deployment.py`: deployment-only tool tap, SIP caller-ID/DTMF capture and call guards.
- `AIReceptionist/config/businesses/faultline-synthetic.yaml`: synthetic policy, local message delivery and native transcripts.
- `AIReceptionist/.env.sip.local`: local LiveKit connection; OpenAI key is read in memory from Faultline's ignored `.env`.
- `AIReceptionist/faultline-runtime/sip-authorization.json`: explicit one-call scope, permitted local From/destination and model reservation.
- `direct-sip/compose.yaml` and `sip.yaml`: local media/SIP/Redis configuration; Compose itself was not installed on this machine.
- `direct-sip/Dockerfile.softphone` and `phone/`: Baresip image definition, private digest credentials, audio fixtures and native audio dumps.
- `direct-sip/local-sip-resources.json`: actual local trunk/dispatch IDs and private SIP password. Never copy it into tracked files.

The relevant existing containers are `faultline-livekit-spike`, `faultline-sip-redis`, `faultline-sip-gateway` and `faultline-softphone`. The SIP packet capture container is stopped. The host API remains at `http://127.0.0.1:17880`. Carrier and LiveKit Cloud resources were not provisioned. Imported LiveKit credentials remain in ignored local environment files and were not used for the successful local call.

To restart the already configured SIP worker, run from the external AIReceptionist checkout:

```bash
FAULTLINE_TRANSPORT=sip FAULTLINE_SIP_ENV="$PWD/.env.sip.local" .venv/bin/python faultline_deployment.py start
```

The one-call authorization has already been consumed. Inspect `faultline-runtime/spend-reservations.json` and the existing $10 model cap before deliberately rearming it. Never change a cap implicitly. In Baresip's console, the tested manual dialing command was:

```text
/dial sip:+12025550100@127.0.0.1:5060
```

The smoke caller's audio source was a fixed WAV made with macOS `say`, followed by silence and a confirmation. This is a manually initiated scripted audio call, not the adaptive tester/TTS/STT loop. Baresip's `sndfile` filter captured the encoded caller audio and decoded agent audio; no system microphone or physical speaker was necessary. A keypad `5` was pressed in Baresip during the call and observed by the target's SIP event listener.

For offline replay export, from Faultline:

```bash
python3 spike/aireceptionist/export_run.py \
  --run-dir "$HOME/.local/share/faultline/deployments/AIReceptionist/faultline-runtime/runs/faultline-sip-_+12025550142_fJCByDZXQUUD" \
  --manifest "$HOME/.local/share/faultline/deployments/AIReceptionist/faultline-runtime/deployment.json"
```

The exporter reads artifacts and checks hashes and native transcript call IDs. It cannot place calls or spend money. It preserves raw events in `source-events.jsonl` and writes the harness envelope and numeric usage shape to `events.jsonl`. `sipAcceptance: true` requires the observed SIP participant, expected caller/destination, bidirectional model audio usage, a matching message file, native transcript and absence of target errors. The packet/audio cross-check is retained separately in `transport-proof.json` for the observed run.

The original Playground text caller remains available for experiment work. It uses the LiveKit network SDK from the external deployment's virtual environment, and imports no target framework module. From the external checkout, launch `faultline_deployment.py start` with `FAULTLINE_TRANSPORT=text`; from Faultline, use:

```bash
"$HOME/.local/share/faultline/deployments/AIReceptionist/.venv/bin/python" \
  spike/aireceptionist/caller.py --script spike/aireceptionist/control.json
```

`attack.json` and `false-handoff.json` are frozen synthetic robustness scripts. Any additional text run also consumes an existing model reservation; the recorded false-handoff result is already available without another paid run. The text caller's direct output is a raw capture; use `export_run.py` afterward for the standard replay export.

Run offline checks with:

```bash
python3 -m unittest discover -s spike/aireceptionist -p 'test_*.py' -v
npm run check
```
