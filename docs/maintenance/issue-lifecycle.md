# Release-aware issue follow-up

The workflow tracks bugs with both `bug` and `release-tracking` labels.
The opt-in label means a maintainer has confirmed that the report describes one complete, release-verifiable fix.
Labels that contain `summary`, `spec`, `partial`, or `security` exclude an issue.
Those words in the issue title also exclude it.
The workflow never closes an issue solely because it is old or because a PR merged.

A PR links a complete fix with an exact standalone line in its body:

```text
Refs #123
```

Quoted references, fenced examples, prose references, and closing keywords do not opt an issue into tracking.
Closing keywords trigger one warning on the PR.
The warning cannot prevent GitHub from closing an issue if the PR author keeps those keywords.

## State changes

Each merged PR reference creates a separate bot-authored fix record with the merge commit SHA.
The workflow preserves all fix records and adds `pending-release`.
The daily schedule also checks merged PRs to recover missed events.

A confirmation request requires a published release that is neither a draft nor a prerelease.
The release must have at least one uploaded, nonempty asset.
GitHub's compare API must prove that every tracked merge SHA is an ancestor of the same release tag, or equals that tag's commit.
A release name, release date, or local test result does not prove inclusion.
This check proves tag ancestry, not the contents or provenance of a release asset.

After that check, the bot asks the reporter to test the release.
It adds `awaiting-release-confirmation` and removes `pending-release`.
A new merged fix prevents an earlier request from closing the issue until a stable release contains all tracked fixes and a new request is posted.
Any human comment at or after a confirmation request stops automatic closure for that issue.
Bot comments do not stop the timer.

An unanswered request closes after 14 days with the `not_planned` state reason.
Closure does not assert that the reporter verified the fix.
Immediately before closure, the workflow reads the issue and all comments again.
A reply that races with closure is recovered by the comment event or the next daily run.

A closure receipt records the exact GitHub issue event ID.
A receipt requires exactly one new state transition after the pre-closure snapshot.
Intervening transitions prevent automatic attribution and require maintainer recovery.
A later human reply reopens the issue only if its most recent state transition matches that bot closure receipt.
Manual closures and unrelated bot closures remain closed.
If execution stops between closure and its receipt, a maintainer must reopen the issue.
This conservative failure behavior prevents the workflow from claiming another actor's closure.

## Execution and permissions

The workflow runs on PR changes, published releases, new issue comments, and a daily schedule.
The schedule also detects releases created with `GITHUB_TOKEN`, which do not trigger another release workflow.
All runs share one concurrency group and do not cancel a running job.
GitHub can replace a pending run with a newer pending run, so scheduled reconciliation remains necessary.

The workflow checks out the repository's default branch and disables persisted checkout credentials.
It never checks out PR code or executes PR text.
It requires read access to repository contents and write access to issues and PR comments.
Its three lifecycle labels are separate from the repository's five triage labels.

Manual runs default to dry-run mode.
Dry runs read GitHub state and log planned writes without sending them.
A dry run does not simulate records that it would have posted, so a new merge may require a second pass to preview the later confirmation request.
The script also defaults to dry-run mode unless `DRY_RUN=false` is set explicitly.
The script requires `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_EVENT_NAME`, and `GITHUB_EVENT_PATH` when run from the command line.

The workflow uses append-only markers authored by `github-actions[bot]`.
It ignores markers posted by humans or other bots.
It reads every page of issues, PRs, releases, comments, and issue events.
Retries do not duplicate fix records or confirmation requests.
A missing comparison, failed API call, or missing release proof stops progress without assuming a fix shipped.

## Local checks

Run the contract tests with Node 24:

```sh
node --test tests/issue-lifecycle.test.mjs
```

The tests inject a GitHub client and make no network requests.
They check ancestry decisions, protected issues, retries, human replies, closure receipts, pagination, and dry-run behavior.
They provide local contract evidence only.
They do not prove that a real release contains a fix or that a live workflow has run.
