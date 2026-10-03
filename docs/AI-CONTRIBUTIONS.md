# Contribute with an agent

## Start with evidence

Read AGENTS.md, PROGRESS.md, the issue, and relevant domain guidance.
Inspect the implementation before proposing a change.
Run the baseline commands before editing.
Give the agent the objective, acceptance criteria, scope limits, and available verification tools.

## Keep verification independent

Reproduce bugs through the real user path when that path exists.
Test the affected behavior rather than private implementation details.
Use an independent reviewer for substantial changes.
The reviewer must inspect the diff and evidence without relying on the author's conclusions.
Report failing and passing commands, runtime details, and evidence gaps.

## Record state

Keep one active task per agent.
Use isolated worktrees for concurrent edits.
Update PROGRESS.md at a session boundary or material change.
Record the objective, branch, completed work, remaining work, blockers, and verification results.
Do not treat a previous passing result as proof after relevant changes.

## Encode repeated failures

Turn a recurring mistake into a compiler rule, lint rule, boundary check, test, or CI requirement.
Run the rule against a violating fixture and a valid fixture.
Keep judgment rules in focused guidance when a deterministic check cannot express them.

## Evaluate changes to guidance

The repository policy fixtures are deterministic gate evaluations.
They are not model performance benchmarks.
For an agent ablation study, fix the model, tasks, prompts, tools, environment, budget, and scoring.
Change one component per variant and repeat trials.
Record raw failures, completion rate, runtime, and cost when available.
Do not describe an unrun study as successful.

## Scale after reliability

Run one local task through its acceptance test before adding cloud or parallel execution.
Use one branch per worker and integrate only verified results.
Automatic merge remains disabled until review requirements and repeated release evidence justify it.
High-risk work always requires a maintainer decision.
