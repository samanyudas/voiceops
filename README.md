# VoiceOps

VoiceOps is a synthetic voice-to-work-order proof of concept.
An operator reports observations and confirms a prepared request.
The backend validates facts, calculates priority, checks duplicates, and assigns a compatible technician or queues the work.
Resolution releases capacity and assigns waiting work in the same Postgres transaction.

The project separates language understanding from deterministic operational control.
All equipment, technicians, history, and work orders are fictional.
The backend and technician CLI run locally.
Hosted ElevenLabs configuration and five mocked conversational scenarios are prepared.
Five live ElevenLabs simulations passed.
A hosted audio conversation with synthetic operator speech called the real backend and created queued work.
The technician CLI then released capacity and assigned that work to Tech-02.
The hosted webhook demonstration needs the temporary local backend and HTTPS tunnel.

```mermaid
flowchart TD
  Operator[Operator voice] --> Agent[ElevenLabs hosted agent]
  Agent --> Context[Verify asset and history]
  Agent --> Draft[Prepare expiring draft]
  Draft --> Confirm[Operator confirms summary]
  Confirm --> Backend[Transactional backend]
  Backend --> Held[Hold incomplete observations]
  Backend --> Dispatch[Priority and skill matching]
  Dispatch --> Assigned[Assign available technician]
  Dispatch --> Queue[Queue without capacity]
  Technician[Technician CLI resolves work] --> Backend
  Backend --> Reassign[Release capacity and drain queue]
```

## Watch the demonstration

[Watch the 44.8-second recorded demonstration](docs/demo.mp4).
The video combines actual hosted conversation audio with verified backend states.
The operator speech is computer-generated.
[The live conversation record](docs/evidence/live-conversation.json) contains the persisted report and reassignment result.
[The live simulation record](docs/evidence/voice-evals.json) contains the five-scenario result.

## Start here

Use Node 24.21.0 and npm 12.2.0.
Check the actual executable versions before installation.
The lockfile pins application and development dependencies.

```sh
npm ci --ignore-scripts
npm run verify
```

The verification command runs lint, type checks, compilation, offline tests, a built-tool selftest, and repository policy checks.
Run the separate integration suite against a dedicated local Postgres database.

```sh
TEST_DATABASE_URL=postgres://voiceops:synthetic-test-password@127.0.0.1:5432/voiceops_test npm run test:integration
```

Integration tests reset that synthetic test database.
They check real HTTP requests, durable receipts, queue ordering, concurrency, rollback, and the technician CLI.
They do not skip when Postgres is unavailable.

Follow [the backend guide](docs/backend.md) to start Postgres, seed the demonstration, and run the server.
Use [the API contract](docs/backend-api.md) for preparation, confirmation, and technician actions.
Follow [the ElevenLabs guide](docs/elevenlabs.md) for offline configuration and later live provisioning.

## Demonstrate the workflow

The demo seed starts two mechanical technicians with work in progress.
An electrical report can assign Tech-02 immediately.
A mechanical report queues until the technician CLI resolves an existing job.
The resolution response includes the waiting job's new assignment.

Priority follows explicit rules.
Unknown observations remain unknown and can require manual review.
Duplicate reports append observations only after an explicit same-issue decision.
Verbal confirmation remains model-mediated and does not independently prove human consent.
The backend never diagnoses equipment, dispatches real personnel, or contacts emergency services.

## Repository layout

| Location | Purpose |
| --- | --- |
| `src/` | Effect HTTP API, pure policy, transactional services, schemas, and database modules |
| `tests/` | Offline contracts, maintenance gates, and real Postgres integration tests |
| `tools/` | Server, seed, technician CLI, voice setup, and repository maintenance commands |
| `resources/` | Synthetic voice prompt and mocked conversation scenarios |
| `docs/` | Specs, ADRs, agent guidance, maintenance policy, and verification evidence |
| `.github/` | Issue forms, PR template, CI, and release workflows |

Use the [accepted spec](docs/specs/voiceops.md) and [issue 1](https://github.com/samanyudas/voiceops/issues/1) for product requirements.
Use [PROGRESS.md](PROGRESS.md) for the current state.
Use [CONTRIBUTING.md](CONTRIBUTING.md) for verification and PR requirements.

## Source packaging

Commit the intended source before packaging.

```sh
npm run package:source
npm run check:package
```

The source archive contains the exact committed revision.
The package check extracts it, installs dependencies, and runs verification in a temporary directory.
VoiceOps has no desktop application or DMG artifact.

## Support and security

Read [SUPPORT.md](SUPPORT.md) for issue reporting.
Read [SECURITY.md](SECURITY.md) for private vulnerability reports.
All equipment, technician records, and examples must remain synthetic.
