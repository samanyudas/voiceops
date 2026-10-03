# Contribute to VoiceOps

## Establish the baseline

Use Node 24.21.0 and npm 12.2.0.
Clone the repository and install the locked dependencies.

```sh
npm ci --ignore-scripts
npm run verify
```

If your shell exposes another toolchain, use the pinned wrapper for each npm command.

```sh
npx --yes --package=node@24.21.0 --package=npm@12.2.0 -- npm ci --ignore-scripts
npx --yes --package=node@24.21.0 --package=npm@12.2.0 -- npm run verify
```

For an older checkout, restore build, type checks, and characterization tests before a broad change.
Record any existing failure before implementation.

## Define the change

Read the relevant issue, spec, glossary, ADRs, and implementation.
Search open and closed issues and PRs for related work.
For a substantial change, write acceptance criteria and a spec first.
Name the affected behavior, non-goals, risk class, and verification commands.
Keep one active task per agent.

## Implement and verify

For a bug, reproduce the user path before editing.
Add a regression test at the highest useful boundary.
Show that the test detects the defect and passes with the change.
Preserve legitimate inputs and other callers.

```sh
npm run verify
npm run eval
git diff --check
```

Use real Postgres for locking and assignment claims when the backend exists.
Use a real ElevenLabs conversation for voice behavior claims when the agent exists.
Describe unverified behavior explicitly.

## Open a pull request

Use the PR template and record the observed results.
Choose a risk class from [review policy](docs/maintenance/review-policy.md).
Request an independent review and inspect specialist findings.
Explain why each finding is fixed or rejected.

Reference issues on separate lines with `Refs #123`.
For bugs, confirm that the issue carries `release-tracking` before merge.
Avoid closing keywords that remove the report before a stable release reaches its reporter.
Partial fixes must remain explicitly partial.

Keep version changes and release publication separate from feature work.
Never edit a generated changelog manually.
Never add an agent as a commit co-author automatically.

## Finish the session

Update PROGRESS.md with the branch, verification results, next step, and blockers.
Commit intentional changes or list the uncommitted diff.
Remove temporary artifacts with `npm run clean` when they are no longer needed.

Read [agent contributions](docs/AI-CONTRIBUTIONS.md), [releases](docs/maintenance/releases.md), and [issue lifecycle](docs/maintenance/issue-lifecycle.md) for detailed rules.
