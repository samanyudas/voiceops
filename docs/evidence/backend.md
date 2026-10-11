# Backend verification evidence

The combined product branch implements the accepted synthetic maintenance workflow.
This record separates backend verification from the later hosted voice results.

## Actual runtime

The verifier checked Node v24.21.0 and npm 12.2.0 using explicit executable paths.
The owned local Postgres container reports PostgreSQL 18.6.
Locked installation passed with zero reported audit vulnerabilities.

## Observed checks

| Check | Result |
| --- | --- |
| Combined `npm run verify` | Passed all 77 tests, lint, strict type checks, compilation, selftest, and repository gates |
| `npm run test:integration` | Passed all 32 tests against real HTTP and Postgres, with no skipped tests |
| Voice response contracts | All 13 mock responses match compiled backend schemas |
| Voice assessment contracts | All four preparation fixtures match actual deterministic policy output |
| Official ElevenLabs schemas | Offline preparation passed validation against the downloaded official OpenAPI document |
| Separate manual demonstration | Scripted operator HTTP requests and the actual technician CLI proved immediate assignment and queued reassignment |
| Whitespace | `git diff --check` passed |

The database tests include receipt replay, draft expiry after a lock wait, duplicate decisions, manual holds, queue ordering, concurrency, and restart persistence.
They also inject an assignment failure, drop a response after commit, and raise SQLSTATE 40001 to verify rollback and retries.
The database independently rejects conflicting active assignments and incorrect priority ranks.

The manual demonstration recorded an electrical work order assigned to Tech-02.
A HIGH-priority mechanical work order initially queued.
The technician CLI resolved existing work and the backend assigned the waiting order to Tech-03.
See [the synthetic demo record](backend-demo.json).
The original demo exposed truncated nested CLI output.
The CLI now prints complete JSON, and its regression test parses the exact returned assignment identifiers.

## Review and repairs

An independent read-only reviewer inspected transaction ownership, receipts, duplicate updates, uncertainty, authentication, migrations, packaging, and CI.
The review found operating performance degradation incorrectly classified as LOW.
An HTTP reproduction failed before the fix and passed afterward with MEDIUM.
The same reconciliation restored minor-only leaks to LOW under the accepted table.

The review also found that PostgreSQL accepts a CHECK expression that returns NULL.
The rank constraint now uses `IS NOT DISTINCT FROM` with the expected priority rank.
A direct database regression reproduced the old constraint gap and passed against the corrected fresh schema.
The reviewer found no additional serious public-path defect before these final corrections.
The final combined verification and CLI output fix ran under the root verifier.
The independent reviewer did not execute those suites.

## Fresh independent verification

On 2026-10-04, a fresh verifier inspected the complete product diff at 0cd6200 against main at 978e491.
The verifier used a separate checkout and test database.
The baseline passed 45 tests.
The product passed 77 offline tests and 32 real HTTP and Postgres tests without skips.
The packaged source passed installation and all 77 offline tests in a clean extracted checkout.
Seven additional HTTP and CLI checks covered the full lifecycle, receipt replay, duplicate holds, escalation history, and credential rejection.
The verifier found no public-path defect.
The final documentation delta and current GitHub checks still require separate confirmation.

## Evidence limits

The later live verification passed all five mocked ElevenLabs simulations.
See [the simulation result](voice-evals.json).
An actual audio conversation called all three webhook tools without tool errors.
Its persisted report queued and then assigned Tech-02 after the technician CLI released capacity.
See [the conversation record](live-conversation.json).
The operator audio was computer-generated, with no human microphone.
A later human microphone conversation reported an emergency through the demo page.
Its CRITICAL work order queued with escalation, was assigned to Tech-03, and closed.
See [the live voice record](live-voice-demo.json) and [the demonstration](../demo.mp4).
No audio quality, production readiness, throughput, or multi-facility scalability result exists.
The PoC uses one facility dispatcher lock.
The backend cannot independently prove verbal consent or personal technician identity.
Manual-review holds have no supervisor release action in this PoC.
The source archive from 75d1007 installed and passed all 77 tests in a clean extracted checkout.
[Product CI](https://github.com/samanyudas/voiceops/actions/runs/37113514927) passed all six jobs at 0cd6200.
Later evidence-only revisions require their own current CI result.
