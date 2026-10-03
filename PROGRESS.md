# VoiceOps progress

## Objective

Establish repository maintenance before implementing the accepted voice workflow.

## Current state

Branch: chore/maintenance-foundation.
The accepted spec and ADRs are on main at fbecc8d.
Maintenance tooling, templates, and workflows are implemented on this branch.
No application behavior is implemented.

## Verification

Pinned local verification passes 42 tests, lint, type checks, build, selftest, and repository checks.
Live CI and source-package verification remain pending.
A source-package check must verify the exact committed source.
Model ablation benchmarks and real stable-release follow-up are not run.

## Blockers

External review apps need account-level enablement.
Blacksmith does not support this personal repository under its documented setup.
High-risk workflow changes require maintainer review before merge.

## Next step

Run source-package verification and live PR checks, then record the evidence.
Then implement the accepted product spec in small verified units.
