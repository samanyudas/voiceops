# Prepare a release

## Verify the revision

Select a version and an exact commit from main.
Confirm the relevant PR checks and review decisions.
Run the complete verification command on that revision.
Confirm actual application behavior separately when application code exists.

The current artifact is a source archive.
It is not a DMG, deployed backend, or verified voice agent.

## Publish deliberately

Create an immutable tag for the approved commit.
Use the Release workflow with that tag and an explicit publication choice.
The workflow verifies the checkout, packages source, and checks the extracted archive.
The default mode creates a draft release.
Choose stable publication only after the release decision.
Use GitHub-generated release notes rather than manually editing a changelog.

Never move a published tag or replace an existing release's assets.
Do not publish a stable release just to test reporter automation.

## Follow the result

Confirm the release has a downloadable asset.
The issue workflow compares each recorded fix commit with the released tag.
Only an included fix can trigger a reporter confirmation request.
Scheduled reconciliation handles releases created with the built-in workflow token.
Read the [issue lifecycle policy](issue-lifecycle.md) for the follow-up rules.
