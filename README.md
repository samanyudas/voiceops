# VoiceOps

**Report an equipment fault by voice. Get a prioritized, dispatched, and tracked work order.**

[![CI](https://github.com/samanyudas/voiceops/actions/workflows/ci.yml/badge.svg)](https://github.com/samanyudas/voiceops/actions/workflows/ci.yml)
![Node 24](https://img.shields.io/badge/node-24.21-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Effect 4](https://img.shields.io/badge/Effect-4.0-000000)
![Postgres 18](https://img.shields.io/badge/Postgres-18-4169E1?logo=postgresql&logoColor=white)
![ElevenLabs Agents](https://img.shields.io/badge/ElevenLabs-Agents-000000)

VoiceOps turns a spoken maintenance report into a work order.
An operator describes the problem to an ElevenLabs voice agent.
The agent gathers the facts and confirms the request.
A transactional backend then decides priority, checks for duplicates, and assigns a qualified technician or queues the work.

The language model talks to the operator.
Every operational decision comes from deterministic rules in the backend.

## Demo

[![VoiceOps demo: a spoken emergency report becomes a dispatched and closed work order](docs/demo-preview.gif)](docs/demo.mp4)

▶ **[Watch the full demo with audio](docs/demo.mp4)**

A human operator reports a significant leak with a person in danger on pump P-101.
The agent verifies the asset, asks for the missing facts, and asks whether this is the same fault as an open job.
Then it asks for explicit confirmation.
The backend rates the report CRITICAL and queues it with escalation because no mechanic is free.
When a mechanic is released, the work order is assigned, worked, resolved, and closed.

## Highlights

- **Voice intake with guardrails.** The agent never guesses an asset, a diagnosis, or a technician. Unreported facts stay `unknown` and are never treated as safe.
- **Deterministic decisions.** Pure policy functions own priority, skill matching, duplicate detection, and lifecycle transitions.
- **Confirmation before every change.** Preparation returns an expiring draft. Nothing is created until the operator explicitly agrees.
- **A durable queue in Postgres.** Work waits by priority, then age. Resolving a job releases capacity and assigns the next compatible job in the same transaction.
- **Safe under concurrency and retries.** An advisory lock, database constraints, and idempotency receipts prevent double booking and duplicate work orders.
- **Full audit trail.** Every decision writes an append-only event with its reason.

## How it works

```mermaid
flowchart LR
  Operator([Operator voice]) --> Agent[ElevenLabs agent]
  Agent -->|get_maintenance_context| Context[Verify asset and history]
  Agent -->|prepare_work_order| Draft[Expiring draft with priority and duplicates]
  Draft --> Consent{Operator confirms?}
  Consent -->|confirm_work_order| Backend[Transactional backend]
  Backend --> Held[Held for manual review]
  Backend --> Assigned[Assigned to a free technician]
  Backend --> Queued[Queued, with escalation if CRITICAL]
  Tech([Technician CLI]) -->|resolve| Release[Release capacity]
  Release --> Assigned
```

The agent has three tools and no technician permissions.
Technicians acknowledge, start, resolve, and close work through a separate CLI with a separate credential.

### Priority rules

The highest matching rule wins. Missing facts never lower a priority.

| Priority | Reported conditions |
| --- | --- |
| **CRITICAL** | Personnel hazard, fire or smoke, or a significant leak |
| **HIGH** | Equipment unavailable, severe vibration, or severe temperature |
| **MEDIUM** | Abnormal vibration or temperature, or degraded performance while operating |
| **LOW** | A defect with no higher condition |

A report with unknown facts or an unclassified fault is held for manual review instead of being dispatched.

### Work order lifecycle

```mermaid
stateDiagram-v2
  direction LR
  [*] --> NEW
  NEW --> VALIDATED
  VALIDATED --> PRIORITIZED
  PRIORITIZED --> ASSIGNED
  ASSIGNED --> ACKNOWLEDGED
  ACKNOWLEDGED --> IN_PROGRESS
  IN_PROGRESS --> RESOLVED
  RESOLVED --> CLOSED
  CLOSED --> [*]
```

Queued work stays `PRIORITIZED` until a compatible technician frees up.
Capacity is taken at `ASSIGNED` and released at `RESOLVED`.

## Tech stack

| Layer | Technology |
| --- | --- |
| Voice | ElevenLabs Agents with webhook tools and a stored secret |
| API | TypeScript 7, Effect 4 `HttpApi` and `Schema` |
| Data | Postgres 18 with `@effect/sql-pg` migrations |
| Demo | Browser page with Play and Live voice modes, plus a local tool relay |
| Testing | Node test runner, real Postgres integration tests, tester-army E2E |

## Quick start

You need Node 24.21.0, npm 12.2.0, and Docker.

1. Create an ignored `.env` file with synthetic credentials.

   ```dotenv
   POSTGRES_PASSWORD=replace-with-a-local-password
   DATABASE_URL=postgres://voiceops:replace-with-a-local-password@127.0.0.1:5432/voiceops
   TOOL_API_KEY=replace-with-a-random-operator-secret
   TECHNICIAN_API_KEY=replace-with-a-different-random-technician-secret
   PORT=3000
   ```

2. Start Postgres, seed the demo data, and run the API.

   ```sh
   docker compose up -d --wait
   npm ci --ignore-scripts
   npm run build
   npm run seed
   npm start
   ```

3. In a second terminal, start the demo page and open <http://127.0.0.1:4173>.

   ```sh
   npm run demo
   ```

   Press **Play** to watch a typed report go through the real backend.
   To speak to the agent, follow [the demo page guide](docs/demo-ui.md).

4. Work a job from the technician CLI.

   ```sh
   npm run technician -- state
   npm run technician -- resolve demo-busy-mechanical Tech-03 demo-resolve-001
   ```

The seed data has three assets (P-101, C-201, V-301) and three technicians.
Tech-01 and Tech-03 start busy, so a mechanical report queues until one of them resolves a job.
Tech-02 is free for electrical work.

## Testing

```sh
npm run verify   # lint, type checks, build, 82 offline tests, policy checks
npm run eval     # repository policy evaluation

export TEST_DATABASE_URL=postgres://voiceops:synthetic-test-password@127.0.0.1:5432/voiceops_test
npm run test:integration   # 38 tests over real HTTP and Postgres
npm run test:e2e           # 38 acceptance cases with the real server and CLIs
```

The database suites reset a dedicated database whose name ends in `_test`.
Run them one at a time.
The integration suite covers queue order, concurrent intake and resolution, rollback on failure, retries, and the technician CLI.
See [the E2E guide](docs/e2e.md) for the full coverage matrix.

To check a release archive, commit first, then run `npm run package:source` and `npm run check:package`.
The check installs and verifies the archive in a temporary directory.

### Voice agent checks

The hosted agent is tested with five conversational scenarios in [`resources/elevenlabs/scenarios.json`](resources/elevenlabs/scenarios.json).
They cover complete intake, a missing asset, an unknown asset, an emergency, and ambiguous facts.
All five pass in ElevenLabs simulation.
The same scenarios also ran as live conversations against the real backend.
See [the ElevenLabs guide](docs/elevenlabs.md) to provision the agent and run the scenarios.

## Evidence

| Record | What it shows |
| --- | --- |
| [Live voice demo](docs/evidence/live-voice-demo.json) | Tool calls and the persisted CRITICAL work order from the recorded call |
| [Simulation results](docs/evidence/voice-evals.json) | All five ElevenLabs scenarios passing |
| [Earlier live conversation](docs/evidence/live-conversation.json) | A queued electrical job assigned after capacity was released |
| [Backend verification](docs/evidence/backend.md) | Test runs, packaging checks, and limits |

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | HTTP API, pure policy, transactional services, schemas, and database modules |
| `tests/` | Offline contracts, real Postgres integration tests, and E2E acceptance tests |
| `tools/` | Server, seed, technician CLI, demo server, and ElevenLabs setup |
| `demo/` | Browser demo page |
| `resources/elevenlabs/` | Agent prompt and conversational scenarios |
| `docs/` | Guides, specs, ADRs, and verification evidence |

## Documentation

- [Backend guide](docs/backend.md) and [API contract](docs/backend-api.md)
- [Demo page guide](docs/demo-ui.md)
- [ElevenLabs guide](docs/elevenlabs.md)
- [Architecture](docs/ARCHITECTURE.md) and [design decisions](docs/adr/)
- [Product spec](docs/specs/voiceops.md)
- [Contributing](CONTRIBUTING.md), [support](SUPPORT.md), and [security](SECURITY.md)

## Scope and limits

- All equipment, technicians, history, and work orders are fictional.
- The backend never diagnoses equipment, dispatches real people, or contacts emergency services.
- Verbal confirmation is handled by the voice agent. The backend cannot independently prove that a person consented.
- Live voice needs the local backend and a public HTTPS tunnel.
