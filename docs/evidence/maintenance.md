# Maintenance evidence

This record separates observed checks from configured workflows and unavailable external services.
This record covers the maintenance baseline at its merge revision.
See [PROGRESS.md](../../PROGRESS.md) for later product work.

## Local verification

| Check | Evidence | Result |
| --- | --- | --- |
| Locked installation | npm 12.2.0 wrapper with npm install --ignore-scripts | Passed, zero audit vulnerabilities |
| Complete maintenance verification | npm run verify under the npm 12.2.0 wrapper | Passed 45 tests, lint, type checks, build, selftest, and repository checks |
| Command-boundary rejection | CLI fixture adds Date.now to a policy, then repairs it | Invalid checkout rejected, repaired checkout accepted |
| Issue-follow-up contracts | Built-in Node tests with injected GitHub responses | Passed without external notifications |
| Independent review | Fresh reviewer found opt-in, closure-attribution, trigger-syntax, and indexed-randomness defects | Follow-up review found no remaining serious defects and independently passed 45 tests |
| Runtime failure and repair | Default npm 11.19.1 failed the engine requirement | Pinned npm 12.2.0 installed and verified successfully |

## GitHub configuration

At the maintenance merge, main required four compatibility checks and the package check.
The original configuration also required one approving review and resolved conversations.
At merge time, the live protection response had no required approving-review rule.
The guarded merge used the exact independently verified head without an administrator bypass.
The rules apply to administrators and prohibit force pushes and deletion.
The GitHub protection API accepted these settings.

The [first live CI run](https://github.com/samanyudas/voiceops/actions/runs/37081229312) passed all four compatibility jobs and source-package verification.
It tested revision e5c8a7b.
The [review-fix CI run](https://github.com/samanyudas/voiceops/actions/runs/37082084172) also passed all five jobs at 5c925c8.
The clean source archive from 5c925c8 installed dependencies and passed all 45 tests locally.
Check the latest PR revision separately from this recorded run.
The release environment exists, but required reviewers and wait timers were rejected by the account plan.
Those environment protections are not enforced.
CodeRabbit activated on PR 3 and provided a free-plan summary, not a full line review.
[PR 3](https://github.com/samanyudas/voiceops/pull/3) merged at `978e491e0f23ccf2dea5e06a46ad6b1b430131d9`.
[Post-merge CI](https://github.com/samanyudas/voiceops/actions/runs/37110981770) passed all five jobs.
[The issue-lifecycle dry run](https://github.com/samanyudas/voiceops/actions/runs/37111041151) passed on main without issue mutations.
[Issue 2](https://github.com/samanyudas/voiceops/issues/2) closed after these checks.

## Product acceptance gate

On 2026-10-04, GitHub accepted `postgres-integration` as an additional required check for main.
Readback confirmed strict checks, administrator enforcement, and required conversation resolution.
The five existing required checks remain in place.
No approving-review requirement exists in the live branch protection response.
The documented maintainer approval requirement still applies to high-risk changes.

## User checklist status

| Requirement | State | Evidence or remaining work |
| --- | --- | --- |
| Structured repository | Implemented | TypeScript module directories, tools, tests, and focused docs |
| Agent navigation documents | Implemented | AGENTS.md, contribution guide, AI contribution guide, glossary, ADRs |
| Document structure | Locally verified | Required-document, local-link, punctuation, and instruction-size checks |
| New issue templates | Implemented | Bug and feature forms, with blank issues disabled |
| Specialist PR review | Partial | CodeRabbit free-plan summary observed; full review and other app activation remain unverified |
| CI and compatibility | Post-merge run passed | Four runtime/platform jobs, source packaging, and cleanup at 978e491 |
| Clear task specification | Implemented | Accepted product spec and maintenance issue 2 |
| Instructions and context | Implemented | Short map and task contract |
| Inspect code before decisions | Observed | Empty repository inspected; reference workflow read before adaptation |
| Real application verification | Separate product evidence | Maintenance tests alone do not prove the product workflow |
| Repeated mistakes become checks | Locally verified | Policy and privileged-checkout gates with violating fixtures |
| Rules and skills evaluated | Partial | Deterministic gate evals exist; controlled model ablation remains unrun |
| Cloud and parallel scaling | Conditional | Local verification first; isolated worktrees used for this task |
| Strict code and architecture rules | Locally verified | Strict compiler, lint, import boundaries, trusted workflow checks |
| Reduced human review or automatic merge | Deliberately deferred | Automatic merge disabled; high-risk changes require review |
| Verification before broad changes | Observed | Maintenance baseline established before product implementation |

## Unverified outcomes

No stable release was published for this task.
No reporter was asked to validate a release.
No unanswered real reporter issue was closed.
Contract tests cover those decisions, but they are not live release evidence.
No controlled model ablation study ran.
CodeRabbit summary activation is observed.
Greptile, Cursor Bugbot, and Macroscope activation remains unverified.
Blacksmith's documented setup does not support a personal repository.

## Reproduce

Run the commands in CONTRIBUTING.md on a clean checkout.
Use npm run package:source and npm run check:package for a committed source archive.
Use the dry-run workflow to inspect real issue state without mutation.
The original local wrapper requested Node 24, but that request alone did not prove its runtime version.
The CI jobs used actions/setup-node with the recorded Node versions.
Later product verification records the actual local Node executable and version.
