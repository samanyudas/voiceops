# VoiceOps progress

## Objective

Implement the accepted synthetic voice-to-work-order proof of concept.

## Current state

Branch: feat/voiceops-backend.
The backend implements Effect HttpApi, Schema, services, Postgres migrations, durable drafts, receipts, and technician commands.
Pure policy derives eligibility, urgency, skill matching, duplicate decisions, and valid lifecycle transitions.
One Postgres advisory lock serializes allocation and release transactions.
Active assignments are the only technician capacity source.
The seed reproduces three assets, three technicians, history, and two jobs with occupied capacity.
The hosted voice configuration is integrated with three tools and five mocked conversational scenarios.
PR 3 merged into main at 978e491.
All five main CI jobs and the issue-lifecycle dry run passed.

## Verification

The baseline passed all 45 maintenance checks before implementation.
Combined Node 24.21.0 verification passed all 77 policy, credential-boundary, voice-contract, and maintenance tests.
The final real HTTP and Postgres suite passed all 32 tests on Node 24.21.0, npm 12.2.0, and Postgres 18.6.
This includes expiry after a lock wait, duplicate branches, manual holds, priority and FIFO order, races, rollback, persistence, retries, and CLI reassignment.
Lint, strict type checks, build, selftest, repository policy, Compose configuration, and whitespace checks pass.
The combined suite checks every voice mock against the compiled API schemas and actual priority policy.
An observed technician CLI truncation now has a failing-before and passing-after HTTP regression.
A separate scripted HTTP demo assigned electrical work immediately, queued mechanical work, and reassigned it after the actual technician CLI released capacity.
The Linux Postgres CI job is configured but has not run on GitHub for this branch yet.
No live ElevenLabs conversation, voice test, recording, or production readiness claim exists.

## Blockers

The user supplied an ElevenLabs API key, stored only in the ignored local environment file.
Automatic approval review requires explicit approval for transferring the backend tool credential to ElevenLabs and the Cloudflare tunnel.
Cloud resource creation and live tests wait for that approval.
The backend credential boundary does not independently enforce human consent or personal technician identity.
The PoC has no manual-review release action.

## Next step

Verify the committed source archive and publish the product PR for live CI and maintainer review.
Then provision the hosted agent and run live tests after the pending credential-transfer approval.
