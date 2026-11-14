# Backend integration

The active interchange is Wisprno's ordered `Story`/`UiEvent` contract in `src/loop/story.ts`. No separate browser scorer computes authorization from transcript wording.

| UI operation | Backend |
| --- | --- |
| Connect local target | `GET /api/discovery`: target health, local tool catalogue, available rules, source hashes |
| Optional Gemini map | `POST /api/discovery/analyze`: explicit `approved: true`, one bounded request, exact source citations, source-hash cache |
| Start test | `POST /api/live`: mode `loop`, validated configuration, explicit spend flag outside simulation |
| Stream investigation | `GET /api/live/:id/stream`: original sequenced story/events/done/error messages |
| Recover run | `GET /api/runs/:id`: current run or durable archive; incomplete archived runs are interrupted |
| Approve/decline | `POST /api/live/:id/decision`: exact candidate ID and boolean decision; stale/duplicate decisions rejected |
| Save regression | `POST /api/tests`: originating run ID; server stores its minimized lines, scenario, version and failure signature |
| Retrieve tests | `GET /api/tests` |
| Recorded stories | `GET /api/stories` |

Discovery reads only the configured local target's public tool and rule modules through `src/adapter/discovery.ts`. It does not clone repositories, authenticate with GitHub, run arbitrary scanners or read environment files.

Live results include correlated backend record and tool identifiers, source timestamps, per-session run IDs, prompt hashes, candidate versions and actual trial totals. Missing correlated records cannot become a breach. Inconclusive attempts cannot become a final held result. Candidate rules are submitted to the mock only after explicit approval; test acceptance still depends on measured replay and normal-call results.

The normal suite includes the action under test. These are demo-sized checks, separate from the experiment's statistical acceptance protocol. Source logs and saved regressions are git-ignored under `results/`.

The browser's presentation clock is deliberately paced. Raw source timestamps remain in the event references and server archive. Arbitrary imported stories and user-attached recordings are unverified; audio playback is not presented as synchronized with edited event times.
