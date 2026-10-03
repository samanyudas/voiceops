# Security policy

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/samanyudas/voiceops/security/advisories/new) when available.
If that form is unavailable, request a private channel from the maintainer without posting exploit details or credentials.
Do not include secrets in public issues, PRs, or workflow logs.

## Project boundary

VoiceOps is an unreleased synthetic proof of concept.
It does not provide an operational safety system.
There are no supported production releases yet.

## Contributor requirements

Keep tokens outside tracked files.
Use example values in environment samples.
Validate external input at API and database boundaries.
Use parameterized SQL when the backend exists.
Keep workflow tokens at the least required permission.
Privileged workflows must execute trusted default-branch code only.
Review changes to workflows, authentication, persistence, and dispatch rules as high risk.
