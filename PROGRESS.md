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

## Issue 13 test database preflight

The branch is `fix/13-test-database-preflight`.
Current main at `7035bc0` already contains PR 14's query override rejection.
This follow-up completes validation before E2E runner startup and removes duplicated test database rules.
It supersedes the earlier unpushed candidate handoff for issue 13.
Production database configuration remains unchanged.

The installed Effect Postgres driver parses the URL authority and then replaces the host, port, and database from query parameters.
A controlled reproduction confirmed one connection to an ephemeral loopback sentinel after the old guard approved a different target.
No remote or ordinary database was contacted.
On current main, the new regressions failed because E2E started before validation and both guards accepted a bare query delimiter.
An additional malformed-URL probe showed that Node's original error printed the synthetic password.
The failing logs are `artifacts/issue-13/regression-before.log` and `artifacts/issue-13/malformed-before.log`.

One pure typed validator now checks the E2E wrapper and both database suites.
It returns valid URLs unchanged and emits fixed errors for invalid or missing configuration.
It rejects query and fragment delimiters, including empty ones.
The wrapper checks configuration even when no runner is installed.
The regression commit precedes the implementation commit.

On 2026-10-06, Node 24.21.0 and npm 12.2.0 passed clean installation, `npm run verify` with all 80 offline tests, and all 22 evaluations.
Both real entry-point regressions rejected 15 unsafe or missing configurations each with zero sentinel connections.
Sequential acceptance passed all 32 integration tests and all 38 tester-army E2E tests against a separate local Postgres 18.6 cluster and `voiceops_issue13_test` database.
The E2E run is `01a10e9c-3374-7acd-9bfa-0216eee62f86`.
The logs are under `artifacts/issue-13/`, and the full E2E reports are under `artifacts/e2e/`.
An additional integration case and E2E case passed with `postgresql:`, `localhost`, and encoded credential characters.
The dedicated test cluster stopped after verification.

An independent GPT-6 Sol reviewer found no actionable issues and repeated the build and all three guard regressions successfully.
The reviewer inspected the failing and passing logs, full E2E report, source-package log, and local decision trail.
The attempted Claude review returned no verdict because of repeated API errors, so model-family diversity was reduced.
The committed implementation archive installed cleanly and passed all 80 offline tests and repository checks.

The risk class is medium because the change affects test command validation and diagnostic output.
Live PR CI remains pending.
Maintainer review and release tracking opt-in remain required before merge.
No merge, release, or hosted voice verification is claimed.

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

## HEAD rate-limit repair

Independent review found that Effect also routes HEAD through GET handlers.
Candidate `82af644` incorrectly charged those reads to the write budget.
The real HTTP regression failed before the repair because the first HEAD response advertised the write limit rather than the all-request limit.
The failing log is `/tmp/voiceops-rate-head-before.log`.

GET and HEAD now consume only the all-request budget.
Other admitted methods continue to consume both applicable budgets.
The regression proves that HEAD preserves the write slot before exhaustion and remains available after write exhaustion.
HEAD still consumes the all-request budget and receives 429 when that budget is full.
The mixed exhaustion, authentication, and OpenAPI test now uses a 60-second window.
A separate minimal one-second test checks recovery without a long request sequence crossing the window boundary.

All six targeted real HTTP rate-limit cases passed on Node 24.21.0 against the same isolated synthetic Postgres database.
The passing log is `/tmp/voiceops-rate-head-after.log`.
`npm run verify` passed lint, strict type checks, build, all 80 offline tests, selftest, and repository policy checks after the repair.
Its log is `/tmp/voiceops-rate-head-verify.log`.
The integration suite now contains 38 cases, including six rate-limit cases.
Final full acceptance, maintenance evaluations, independent repair review, and committed source packaging remain pending.

### Final independent verification

Independent review reproduced the HEAD admission defect through the compiled HTTP server.
Commit `bbe4141` corrected HEAD classification and added a regression that failed before the correction.
The final review found no remaining correctness defects or comment suppressions.
Model the Domain kept admission state in four bounded counters.
Prove It Works required actual HTTP, Postgres, concurrency, startup, and packaged-checkout evidence.

On Node 24.21.0 and npm 12.2.0, the final sequential acceptance run passed all 38 integration tests and 38 E2E cases.
The E2E run is `01a116b5-c4b2-7c63-b318-a668cb736f00`.
All 22 evaluations passed, and the committed source archive installed and passed verification with 80 offline tests in a fresh checkout.
Logs are `/tmp/voiceops-rate-final-acceptance.log`, `/tmp/voiceops-rate-final-eval.log`, and `/tmp/voiceops-rate-final-package.log`.
The HEAD before-and-after logs are `/tmp/voiceops-rate-head-before.log` and `/tmp/voiceops-rate-head-after.log`.

The remaining test gaps are staggered window resets and simultaneous exhaustion of both budgets.
The short recovery test can still fail if the runner stalls across its one-second window.
No defect was observed in those cases.
The feature is submitted in [PR 17](https://github.com/samanyudas/voiceops/pull/17) for maintainer review.
Hosted CI was in progress when the PR was checked.
Hosted voice, release, and merge remain unverified.

## PR 15 conflict resolution

On 2026-10-10, PR 15 incorporated main at `57d084c` on the local `resolve/pr15-conflicts` branch.
The only conflict was in this file, where both branches appended progress records.
Both records are preserved exactly, and the test code merged without manual edits.
The shared test database validator and main's rate-limit fixture settings remain present in both database suites.

Node 24.21.0 and npm 12.2.0 passed clean installation, `npm run verify` with 81 offline tests, and all 22 maintenance evaluations.
Sequential `npm run test:acceptance` passed all 38 integration tests and all 38 E2E tests against an isolated local Postgres 18.6 cluster.
The database was `voiceops_pr15_test` on port 55445, and the cluster stopped after verification.
The E2E run is `01a12370-2ecc-7490-a014-1c615ae1186d`, with reports under `artifacts/e2e/` in `/tmp/voiceops-pr15-conflicts`.
The logs are `/tmp/voiceops-pr15-install.log`, `/tmp/voiceops-pr15-verify.log`, `/tmp/voiceops-pr15-eval.log`, and `/tmp/voiceops-pr15-acceptance.log`.
Conflict-marker and whitespace checks passed.

The resolution itself is low risk because it preserves documentation and introduces no new behavior.
The underlying PR remains medium risk as recorded above.
Hosted CI for the updated branch, maintainer review, release, and hosted voice remain unverified.
The requested scope is conflict resolution; PR 15 remains open.

## Demo page

On 2026-10-10, branch `feat/demo-ui` added a browser demo page in `demo/` and a local demo server in `tools/demo.ts`.
The guide is [docs/demo-ui.md](docs/demo-ui.md).
The demo server holds both backend credentials, records forwarded calls, and streams them to the page.
An optional tool relay forwards only operator routes, so the hosted agent's calls appear on the page.
The backend source did not change.

Node 24.21.0 and npm 12.2.0 passed `npm run verify` with 81 offline tests.
The page was exercised in a browser against the real backend and a local Postgres 18.1 cluster on port 5433.
On freshly seeded data, Play created a HIGH P-101 job with a duplicate question, queued it, released Tech-03, assigned Tech-03, and closed the job.
A repeated fresh run passed after the final edits.
Curl checks confirmed that the relay forwards operator calls, rejects technician routes with 404, and adds no credential.
The trace stream contained no credential header.
Agent-style relay calls lit the Live mode steps through to a closed job.

Live microphone audio was not exercised because no ElevenLabs credentials exist on this machine.
The signed URL endpoint returned HTTP 401 for a fake key, which shows only that the route exists.
The ElevenLabs WebSocket message handling follows the documented agent protocol but is unverified.
No integration or E2E test covers the demo server yet.

### Independent demo verification

On 2026-10-10, a second session checked commit `5a67619` on Node 24.21.0 and npm 12.2.0 against a fresh database on the local Postgres 18.1 cluster.
Play on freshly seeded data produced a HIGH P-101 job that was queued, assigned to Tech-03 after its seeded job resolved, and closed.
`GET /state` showed the same ten events, from NEW through QUEUED, ASSIGNED, and CLOSED.
A second run was assigned at once, as the guide states.
With the backend stopped, the page failed the Understand step with HTTP 502 and showed "Backend offline".
The page rendered without overflow at 390 pixels wide.
`selftest`, `check:repo`, `eval`, `package:source`, and `check:package` passed, and the package contains `demo/` and `tools/demo.ts`.

`npm run verify` failed twice with 80 of 81 tests passing.
The failure was `tests/server-config.test.mjs`, once with two sentinel connections and once with a 3-second spawn timeout.
The same test passed three times in isolation, so it is a load-dependent flake in a backend test this branch does not change.

Two defects were found and then fixed in the same session.

- The demo server accepted cross-site requests. A `text/plain` POST with `Origin: https://evil.example` resolved a job through `/demo/api/technician/actions` using the server-held technician key, and the trace labelled it "demo page". The demo server now rejects a request whose `Host` is not its own address, and a write whose `Origin` is not its own page. `tests/demo-server.test.mjs` failed with `cross-site write rejected`, actual 200 and expected 403, before the fix and passes after it. Against the real stack, the same POST returned 403 and Tech-01's job stayed IN_PROGRESS. The page's own calls and the tool relay still returned 200.
- Pause did not cancel a step that was already waiting. Pause pressed 0.3 seconds into Play let the Understand call run at 2.8 seconds. After the fix, only Call had completed 4.5 seconds after Pause, and Resume continued to Understand.

The demo server now reports its bound port, so `DEMO_PORT=0` works for the test.
The flaky `server-config` test remains open for a separate branch.

### Review fixes

On 2026-10-10, an independent review of `9e1c99b` requested changes, and this session fixed the confirmed findings.

- A malformed request line such as `GET //[` crashed the demo server, taking down both ports. Reproduced on the relay port with exit code 1. Both handlers now return 400, and the test checks that the server is still running afterwards.
- Live mode repeated technician writes after the event stream reconnected. Reproduced in a browser through a proxy that dropped the stream: after the reconnect, the old page replayed a confirm and resolved Tech-01's unrelated job. The page now handles each trace once, runs agent calls in order, and accepts a confirm only for the draft it prepared. The same run with the fixed page left Tech-01's job IN_PROGRESS, and a call made after the reconnect still reached the page.
- The relay now rejects a call without the operator credential with 401 before forwarding it.
- `/demo/` requests whose `Sec-Fetch-Site` is `cross-site` or `same-site` are rejected.
- `tests/demo-server.test.mjs` now covers other localhost ports, lookalike origins, other methods, the relay, unlisted routes, and malformed URLs. All five guard mutations from the review now fail the test.
- The priority in the Decide card is escaped. A second Start call click while connecting no longer starts a second session; a double click sent one signed URL request.
- The guide now states that Live mode may resolve an unrelated seeded job to free a technician.

Not changed: the audio downsampling, Safari's suspended audio, and the microphone tap. They remain unverified without ElevenLabs credentials.
