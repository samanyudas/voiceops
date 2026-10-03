# Evaluate repository guidance and gates

## Deterministic gate evaluation

Run `npm run eval`.
The fixtures contain valid policy, invalid effects, invalid dependencies, unsafe assertions, and unsafe workflow patterns.
The CLI test creates a temporary checkout, adds an invalid policy, verifies rejection, repairs it, and verifies acceptance.
This demonstrates a failure-to-pass cycle at the command boundary.

Run `npm run test` for issue follow-up contracts.
Those tests verify repeated events, release inclusion, human replies, dry-run writes, and pagination.
Fake GitHub responses isolate policy behavior without notifying real reporters.

## Agent evaluation protocol

Use five fixed tasks for a future model evaluation:

1. Locate the accepted priority policy and its verification boundary.
2. Diagnose a policy fixture that imports a database module.
3. Prepare a PR for a partial fix without closing its report.
4. Resume a task from PROGRESS.md without repeating completed work.
5. Explain why an unrelated stable release cannot trigger reporter confirmation.

Fix one model and reasoning setting for all runs.
Fix task wording, revision, tools, environment, budget, and scoring before the first run.
Run a baseline with all guidance and verification available.
Remove exactly one component per variant and restore the baseline between variants.
Repeat each task at least three times per variant.

Score success only when the frozen acceptance criteria pass.
Record completion, time, token or cost data when available, and raw failure logs.
Separate environment failures from incorrect decisions.
Reserve final evaluation tasks from prompt tuning.

No controlled model ablation result exists yet.
Deterministic gate tests must not be described as that result.
