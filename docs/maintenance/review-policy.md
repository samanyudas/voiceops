# Review and merge policy

## Classify risk

| Class | Examples | Required review |
| --- | --- | --- |
| Low | Prose, examples, or isolated policy tests with no behavior change | Independent review and passing CI |
| Medium | API behavior, dependencies, schema additions, or workflow tooling | Maintainer review and affected integration tests |
| High | Credentials, workflow permissions, migrations, dispatch concurrency, or safety policy | Maintainer approval and direct evidence for the affected boundary |

The current maintenance change is high risk because it adds privileged issue automation and release workflows.
Agents can prepare PRs and repair checks.
They must not approve their own work or silently dismiss review findings.

## Specialist review

Greptile, CodeRabbit, Cursor Bugbot, and Macroscope provide additional review when their apps are enabled.
Repository configuration does not install an app or establish a successful review.
Inspect actual check results and findings before merge.
Do not treat a neutral bot check as proof that findings are resolved.

Blacksmith is a CI runner provider, not a code reviewer.
This personal repository uses GitHub-hosted runners.

## Merge and release

Keep automatic merge disabled during this project's initialization.
Require passing CI and resolved discussions when branch protection is available.
Record any account-plan limitation rather than claim enforcement that GitHub rejects.
Stable release publication is a separate, explicit maintainer action.
Passing build checks do not approve a release or operational deployment.
