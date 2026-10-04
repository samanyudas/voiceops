# VoiceOps progress

## Objective

Implement the accepted synthetic voice-to-work-order proof of concept.

## Current state

The backend is on main.
The backend implements Effect HttpApi, Schema, services, Postgres migrations, durable drafts, receipts, and technician commands.
Pure policy derives eligibility, urgency, skill matching, duplicate decisions, and valid lifecycle transitions.
One Postgres advisory lock serializes allocation and release transactions.
Active assignments are the only technician capacity source.
The seed reproduces three assets, three technicians, history, and two jobs with occupied capacity.
The hosted voice configuration is integrated with three tools and five mocked conversational scenarios.
PR 9 merged into main at 42fcd009 after independent verification.
All six required CI jobs passed before that merge.

## Verification

The baseline passed all 45 maintenance checks before implementation.
Combined Node 24.21.0 verification passed all 77 policy, credential-boundary, voice-contract, and maintenance tests.
The final real HTTP and Postgres suite passed all 32 tests on Node 24.21.0, npm 12.2.0, and Postgres 18.6.
On 2026-10-04, a fresh independent verifier repeated the 77 offline tests, 32 integration tests, and clean source-package verification.
Seven additional HTTP and CLI checks passed without a public-path defect.
This includes expiry after a lock wait, duplicate branches, manual holds, priority and FIFO order, races, rollback, persistence, retries, and CLI reassignment.
Lint, strict type checks, build, selftest, repository policy, Compose configuration, and whitespace checks pass.
The combined suite checks every voice mock against the compiled API schemas and actual priority policy.
An observed technician CLI truncation now has a failing-before and passing-after HTTP regression.
A separate scripted HTTP demo assigned electrical work immediately, queued mechanical work, and reassigned it after the actual technician CLI released capacity.
All six product CI jobs passed on PR 9 at 0cd6200, including real Postgres integration and source packaging.
The committed source archive also installed and passed all 77 tests locally.
Five live ElevenLabs mocked simulations passed with zero failures or cancellations.
An actual hosted audio conversation used computer-generated operator speech and called all three webhook tools successfully.
The resulting HIGH-priority electrical work order queued, then assigned Tech-02 after the actual technician CLI released capacity.
No human microphone, subjective audio-quality, or production readiness claim exists.

## Blockers

The user supplied an ElevenLabs API key, stored only in the ignored local environment file.
The user approved both credential destinations explicitly.
The workspace secret, three tools, agent, and five scenarios are provisioned.
The temporary tunnel and local backend must run for hosted webhook calls.
The backend credential boundary does not independently enforce human consent or personal technician identity.
The PoC has no manual-review release action.

## Handoff

The backend and recorded demo are available on main.
The 44.8-second demonstration is in docs/demo.mp4.
Main requires all six product CI jobs, including the real Postgres integration test.
Keep the temporary backend and tunnel available while reviewing the hosted agent.

## PR 7 compiler repair

The repair for PR 7's `dependabot/npm_and_yarn/typescript-7.0.2` branch includes main's Node 26 type update.
PR 7's direct TypeScript 7 dependency fails npm peer resolution and removes the compiler API used by repository policy checks.
The repair uses Microsoft's official aliases for the TypeScript 7 compiler and TypeScript 6 API.
On 2026-10-04, lockfile generation and clean `npm ci --ignore-scripts` passed on Node 24.21.0 and npm 12.2.0.
`npm run verify` passed lint, strict type checks, build, all 77 tests, selftest, and repository policy checks.
`npm run eval` passed all 22 maintenance gate evaluations, and `git diff --check` passed.
The TypeScript 7 build passed all 32 integration tests against an isolated synthetic Postgres database.
Inspect PR 7's current CI and independent review before merge.
PR 7 remains open for a maintainer decision.

## Agent-facing wording

The voice prompt and the three webhook tool descriptions now follow Simplified Technical English rules.
The prompt now uses one verb, "retrieve", for both backend lookups.
The `prepare_work_order` description says "draft", which matches the prompt and the API field.
Every tool description now has a full sentence with a subject instead of a fragment.
The `confirm_work_order` description names both outcomes: a created work order or a report added to an existing one.
Error messages already used short, active sentences, so they did not change.
On 2026-10-04, offline preparation included the new text, and `npm run verify` passed all 77 tests.
The STE linter reports 0 hard findings in the prompt.
The provisioned ElevenLabs agent still uses the earlier text until someone provisions it again.
The five live mocked scenarios did not run against the new wording.
