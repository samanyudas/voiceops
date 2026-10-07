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

## Tester-army E2E acceptance coverage

The local branch is `test/tester-army-e2e`.
The branch adds and uses `e2e@0.17.0` for all implemented HTTP routes, the seed CLI, every technician CLI command, and offline ElevenLabs configuration.
The runner uses the `api` platform, one worker, zero retries, bounded cleanup, and no model provider or browser engine.
`npm run typecheck` includes the E2E configuration, fixtures, and tests.
`npm run test:acceptance` runs the existing Postgres integration suite and the tester-army suite sequentially.
The existing `postgres-integration` CI job runs integration and E2E sequentially against an isolated Postgres service and uploads reports before cleanup.
The source-package CI job retains its `verify` and `postgres-integration` dependencies.
[The flow matrix](docs/e2e.md) maps the implemented paths and the retained deep transaction tests.

The E2E work reproduced one product defect in the actual cleanup command.
`npm run clean` deleted synthetic pending resource IDs, invocation checkpoints, and the operation lock in an isolated fixture.
The failing-before test raised `ENOENT` when opening the fixture's `artifacts/elevenlabs/state.json`.
The repaired cleaner preserves the complete `artifacts/elevenlabs/` directory and removes other generated files and directories.
The regression checks retained contents, private file permissions, generated-output removal, and repeat cleanup.
[Issue 12](https://github.com/samanyudas/voiceops/issues/12) tracks this confirmed defect and remains open for delivery and release verification.
This reproduction does not establish why this checkout currently has no hosted configuration or checkpoint.

On 2026-10-05, clean `npm ci --ignore-scripts` passed on Node 24.21.0 and npm 12.2.0.
After the guard repair below, `npm run verify` passed lint, strict application and E2E type checks, build, all 79 offline tests, selftest, and repository policy checks.
`npm run eval` passed all 22 maintenance gate evaluations.
`npm run test:acceptance` passed all 32 integration tests and all 38 tester-army E2E tests against the isolated local Postgres 18.6 database.
The E2E suite contains 29 backend cases and nine offline voice and cleanup cases.
The final full E2E run identifier is `01a1096b-a1e0-7ac3-a899-0604d8c050c4`.
Its JSON, JUnit, and Markdown reports are under `artifacts/e2e/`.
The final sequential acceptance log is `artifacts/e2e-checks/guard-repair-acceptance.log`.
The failing cleanup report is preserved under `artifacts/e2e-attempts/cleanup-before/`.
An earlier test assertion used `DraftExpired` instead of the implemented `ExpiredDraft` code, and the final public HTTP 410 test now passes.
The E2E runtime also accepts empty HTTP error bodies and recreates its database runtime after runner reloads.
A later independent review confirmed the database URL guard defect, which is repaired and recorded below.

The risk class is medium because this branch adds a dependency and workflow tooling and repairs cleanup behavior.
Independent review, maintainer review, and live CI verification remain required before merge.
The branch has no PR or published artifact from this task.
Source packaging still needs a committed candidate because `package:source` archives `HEAD` rather than the uncommitted working tree.
The current checkout has no local ElevenLabs API key, public webhook configuration, or provisioning checkpoint available for this task.
No cloud provisioning, paid simulation, or new hosted audio conversation ran.
The earlier voice recordings remain historical evidence, and live voice against this branch remains unverified.
[The E2E decision record](docs/evidence/e2e-decisions.tsv) preserves the choices, failing evidence, and verification limits.

## Test database guard repair and CI gate correction

This section supersedes the earlier E2E handoff and CI job description for the current uncommitted candidate.
Independent inspection found a second defect in both database test entry points.
The guard validated the URL authority and path, but the installed Postgres driver replaces them with `host`, `port`, and `dbname` query parameters.
Both real entry points accepted a synthetic localhost URL with `host=127.0.0.2` and reached server startup instead of rejecting the configuration.
The controlled reproduction used an unbound loopback override and no remote or ordinary database.
Both regression assertions failed with `host query override must fail at the configuration guard`.
The failing-before log is `artifacts/e2e-attempts/database-target-before/guard.log`.
[Issue 13](https://github.com/samanyudas/voiceops/issues/13) tracks the confirmed guard defect, with independent final verification pending.

Both guards now require a Postgres URL, a `localhost` or `127.0.0.1` host, and a simple database name ending in `_test`.
Both guards reject all URL query parameters, fragments, and encoded or multi-segment database paths before creating a runtime or starting a server.
Production database URL handling and application code are unchanged.
Two subprocess regression tests exercise the real integration and tester-army entry points with 11 unsafe or missing configurations each.
Each test requires the configuration diagnostic and a nonzero exit, and asserts zero database connections to its loopback sentinel.
The passing-after log is `artifacts/e2e-checks/database-target-after.log`.

The existing `postgres-integration` CI job now runs integration and tester-army E2E sequentially, with reports uploaded before cleanup.
The separate `backend-e2e` job was removed because the currently required checks do not include that new context.
The package job retains its existing `verify` and `postgres-integration` dependencies.
This change makes an E2E failure fail the existing required database check instead of relying on a skipped dependent package job.
No remote branch-protection setting was changed.
Live execution of the revised CI job remains unverified.

On 2026-10-05, Node 24.21.0 and npm 12.2.0 passed `npm run verify` with all 79 offline tests, lint, strict type checks, build, selftest, and repository policy checks.
`npm run eval` passed all 22 maintenance evaluations.
Sequential `npm run test:acceptance` passed all 32 integration tests and all 38 tester-army cases against local synthetic Postgres 18.6.
The final full E2E run is `01a1096b-a1e0-7ac3-a899-0604d8c050c4`, with reports under `artifacts/e2e/`.
The logs are `artifacts/e2e-checks/guard-repair-verify.log`, `guard-repair-eval.log`, and `guard-repair-acceptance.log`.
An additional positive smoke passed one integration case and one E2E case using `postgresql:` with `localhost` against the same dedicated test database.
Its log is `artifacts/e2e-checks/guard-repair-local-postgresql.log`, and its E2E report is in `artifacts/e2e-checks/local-postgresql/`.
The full acceptance run used `postgres:` with `127.0.0.1`.

The earlier author report remains archived under `artifacts/e2e-independent/author-run/`.
The candidate remains medium risk and requires a new independent review after this repair.
The parent owns issue tracking, candidate commits, source packaging, PR operations, and final handoff.
No commit, PR, merge, source-package claim, hosted call, or paid simulation was made during this repair.
The local ElevenLabs credential and hosted-state limitations remain unchanged.

## Independent E2E verification and candidate packaging

On 2026-10-05, a fresh Luna 6 reviewer independently installed and verified the repaired candidate.
Node 24.21.0 and npm 12.2.0 passed all 79 offline tests, lint, application and E2E type checks, build, selftest, and repository policy checks.
All 22 maintenance evaluations passed.
The reviewer created a separate synthetic local Postgres test database and ran the acceptance suites sequentially.
All 32 integration tests and all 38 tester-army E2E tests passed.
The authoritative independent run is `01a10973-640d-7680-82c1-1166e3d76276`.
The report records zero skips, flaky results, run errors, secondary errors, and model tokens.
All 38 attempt cleanup records are complete, and no backend or runner process remains.
Independent logs and report copies are under `artifacts/e2e-independent/final/`.
The earlier repaired author report is archived under `artifacts/e2e-independent/repair-author-run/`.

The independent trail review identified one weak historical evidence pointer.
The inherited 28-case report was observed during pickup, but its raw report was not retained.
Use the retained independent 38-case report for the current verification claim.
Earlier pending decisions remain as history and are superseded by later verification rows.
Prove It Works required actual HTTP, CLI, database, and runner evidence.
Sequence Work into Verifiable Units kept each confirmed defect behind failing-before and passing-after checks.

The next step is to commit the reviewed candidate locally and verify its source archive.
The current `artifacts/e2e/` reports remain available for review.
Hosted voice, live execution of the revised GitHub workflow, and maintainer approval remain unverified.
This task has not pushed, opened a PR, merged, provisioned cloud resources, or made paid voice calls.

## Authenticated API rate limits

The candidate branch is `feat/api-rate-limits` in `/private/tmp/voiceops-rate-limits`.
[Issue 16](https://github.com/samanyudas/voiceops/issues/16) tracks this medium-risk behavior change.
Each server instance now owns four bounded fixed-window counters for operator and technician all-request and write budgets.
The default is 120 requests and 30 writes per role per 60 seconds.
These defaults are initial protection settings, not measured capacity.
The selected design uses existing authenticated roles and avoids caller-controlled identity maps or database work during admission.

Authentication runs before admission, and admission runs before payload decoding and service work.
Admitted malformed input and business failures consume budget.
Rejected requests return 429 with the stable `RateLimited` code, rate metadata, and `Retry-After` without mutation.
Effect pre-response handlers also attach rate metadata to admitted encoded errors.
The public OpenAPI path remains outside the operational budgets, and its generated contract lists 429 on all six routes.
Startup validates three optional environment settings before database access or listening.
Existing fast acceptance fixtures use explicit high finite quotas to preserve their original behavioral focus.

On 2026-10-08, Node 24.21.0 and npm 12.2.0 passed `npm run verify` with 80 offline tests, lint, strict type checks, build, selftest, and repository policy checks.
`npm run eval` passed all 22 maintenance evaluations.
Sequential `npm run test:acceptance` passed 36 integration tests and 38 tester-army E2E tests against isolated synthetic Postgres at port 55439.
Four added real HTTP cases check exhaustion, recovery, role and write isolation, authentication precedence, admitted error metadata, concurrent admission, unchanged rejected mutations, OpenAPI, and default settings.
The offline startup test checks 16 invalid configurations and zero connections to a local database sentinel.
The full E2E run is `01a116ad-d5ad-7285-8798-97b3de17b9ad`, with reports under `artifacts/e2e/`.
Author gate logs are `/tmp/voiceops-rate-verify.log`, `/tmp/voiceops-rate-eval.log`, and `/tmp/voiceops-rate-acceptance.log`.

Fixed windows allow bursts across boundaries, restarting resets budgets, and each replica receives its own budgets.
Shared role credentials give callers a shared budget rather than personal quotas.
Unauthenticated traffic and the public OpenAPI route still need separate perimeter protection if required by deployment.
Independent review, committed source-package verification, maintainer review, and release remain pending.
No remote service, hosted voice, paid simulation, push, PR, or merge ran during implementation.
