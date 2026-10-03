# VoiceOps progress

## Objective

Establish repository maintenance before implementing the accepted voice workflow.

## Current state

Branch: chore/maintenance-foundation.
The accepted spec and ADRs are on main at fbecc8d.
Maintenance tooling, templates, and workflows are implemented on this branch.
No application behavior is implemented.

## Verification

Pinned local verification passes 45 tests, lint, type checks, build, selftest, and repository checks.
Live CI passed four compatibility jobs and source-package verification at 5c925c8.
Local source-package verification passed for that committed source with all 45 tests.
Independent review found no remaining serious defects in the review fixes.
Model ablation benchmarks and real stable-release follow-up are not run.

## Blockers

CodeRabbit provided a free-plan summary, which does not include a full line review.
Greptile, Cursor Bugbot, and Macroscope activation remains unverified.
Blacksmith does not support this personal repository under its documented setup.
The release environment exists, but the account plan rejected required reviewers and wait timers.
High-risk workflow changes require maintainer review before merge.

## Next step

PR 3 awaits maintainer approval before the workflows become active on main.
Then implement the accepted product spec in small verified units.
