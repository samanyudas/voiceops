# Issue tracker: GitHub

Issues and specs live in GitHub Issues.
Use the `gh` CLI for issue operations.

## Repository

Repository: samanyudas/voiceops.
URL: https://github.com/samanyudas/voiceops.
Visibility: private.
Pass `--repo samanyudas/voiceops` to issue and label commands in this workspace.
Resolve the target from the configured Git remote or an explicit repository supplied by the user.
Use the verified repository for every issue operation.

## Conventions

- Create an issue with a title, a Markdown body, and the required triage label.
- Write multiline bodies to a temporary file and pass that file through `--body-file`.
- Read the issue body, labels, and comments before an update.
- List issues with state and label filters appropriate to the task.
- Apply the label strings from `triage-labels.md`.
- Publish a spec by creating a GitHub issue.
- Read a referenced ticket through `gh issue view` with comments.

## Pull requests as a request surface

PRs as a request surface: no.
