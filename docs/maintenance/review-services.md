# Review service activation

Repository configuration provides review instructions and triggers.
It does not install an app, grant repository access, or confirm a paid subscription.

| Service | Repository configuration | Required external action |
| --- | --- | --- |
| Greptile | Automatic review on PR creation and push | Install the GitHub app and enable this repository |
| CodeRabbit | Assertive review and automatic PR review | Connect GitHub and grant repository access |
| Cursor Bugbot | Correctness instructions | Enable this repository through Cursor's Bugbot settings |
| Macroscope | Correctness instructions | Authorize repository access and complete account setup |
| Blacksmith | GitHub-hosted runners remain selected | Move to an eligible organization before considering Blacksmith |

## Verify activation

Open a PR and inspect actual check runs and bot findings.
Record the app name, result, and unresolved findings in the PR.
Neutral checks do not prove that findings are resolved.
Require the provider's failure setting when unresolved findings must block merge.

The current token cannot enumerate GitHub App installations.
Activation remains unverified until real review output exists.
Do not post review-trigger comments without authorization to contact the service.

## Official setup references

- [Greptile setup](https://www.greptile.com/docs/quickstart) and [configuration](https://www.greptile.com/docs/code-review/greptile-json-reference).
- [CodeRabbit setup](https://docs.coderabbit.ai/getting-started/quickstart) and [configuration](https://docs.coderabbit.ai/reference/configuration).
- [Cursor Bugbot](https://cursor.com/docs/bugbot).
- [Macroscope setup](https://docs.macroscope.com/setup-instructions) and [instructions](https://docs.macroscope.com/custom-instructions).
- [Blacksmith setup](https://docs.blacksmith.sh/introduction/quickstart).

Blacksmith supplies CI runners and supports organizations under its documented setup.
It is not an AI code reviewer.
