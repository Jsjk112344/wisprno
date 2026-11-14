# Hero UI handoff

The supplied design is now connected to the existing local Faultline target. See [README.md](README.md) for launch commands and [INTEGRATION.md](INTEGRATION.md) for endpoints.

The runtime does not use the old payout rehearsal, fixed phase times, predetermined 20-trial counts, or local-only approval state. Agent presentation, selected attack, test case, discovery, proposal approval and regression saving all reach the server.

The original avatars, discovery layout, permission graph, adjacent record proof and evidence drawer remain. The proof panel labels the originating finding separately from candidate retest results: approving a fix does not erase the original breach or imply the record was restored.

The app uses real mock tools and records in simulation mode, but simulated models are not evidence about real model robustness. Live text tests require configured model keys and explicit model-spend authorization in the UI. The frontend does not place real telephone calls. Recorded SIP evidence is available when existing result logs contain it.

GitHub OAuth and arbitrary repository analysis are outside this local-target integration. Local discovery enumerates the separately deployed mock's exported tool catalogue and rule vocabulary.
