# VoiceOps progress

## Objective

Implement the accepted synthetic voice-to-work-order proof of concept.

## Current state

Branch: feat/backend-implementation.
The backend implements Effect HttpApi, Schema, services, Postgres migrations, durable drafts, receipts, and technician commands.
Pure policy derives eligibility, urgency, skill matching, duplicate decisions, and valid lifecycle transitions.
One Postgres advisory lock serializes allocation and release transactions.
Active assignments are the only technician capacity source.
The seed reproduces three assets, three technicians, history, and two jobs with occupied capacity.
The hosted voice configuration belongs to the parallel integration branch.

## Verification

The baseline passed all 45 maintenance checks before implementation.
Final Node 24.21.0 verification passed all 61 policy, credential-boundary, and maintenance tests.
The final real HTTP and Postgres suite passed all 32 tests on Node 24.21.0, npm 12.2.0, and Postgres 18.6.
This includes expiry after a lock wait, duplicate branches, manual holds, priority and FIFO order, races, rollback, persistence, retries, and CLI reassignment.
Lint, strict type checks, build, selftest, repository policy, Compose configuration, and whitespace checks pass.
The Linux Postgres CI job is configured but cannot run before the parent publishes this branch.
No live ElevenLabs conversation, voice test, recording, or production readiness claim exists.

## Blockers

The ElevenLabs API key remains pending at the user's request.
The backend credential boundary does not independently enforce human consent or personal technician identity.
The PoC has no manual-review release action.

## Next step

Integrate the verified backend commit with the hosted voice configuration.
The parent will combine the separately owned voice setup and request an independent review before publication.
