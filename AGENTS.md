# VoiceOps agent map

VoiceOps uses TypeScript, Effect, and Postgres in its accepted design.
The backend implements durable intake, dispatch, and technician workflow actions.
Live ElevenLabs conversations still require separate credentials and verification.
Read [PROGRESS.md](PROGRESS.md) before selecting work.

## Commands

Use Node 24.21.0 and npm 12.2.0.

```sh
npm ci --ignore-scripts
npm run verify
npm run eval
TEST_DATABASE_URL=postgres://voiceops:synthetic-test-password@127.0.0.1:5432/voiceops_test npm run test:integration
npm run package:source
npm run check:package
```

Run the actual affected behavior before declaring a feature complete.
Maintenance checks do not prove voice, database, or technician behavior.

## Work boundaries

- Keep priority, skill, duplicate, and transition decisions pure.
- Keep assignment writes and audit events inside their transaction owner.
- Preserve unknown observations and use synthetic data only.
- Read the implementation and other callers before editing.
- Use one branch or worktree per independent task.
- Record evidence and remaining work in PROGRESS.md before handoff.
- Preserve generated files, including the changelog, through their generator.

Read [architecture](docs/ARCHITECTURE.md) before changing module boundaries.
Read [agent contributions](docs/AI-CONTRIBUTIONS.md) before implementation or review.
Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## Definition of done

Acceptance criteria match observed behavior.
The applicable tests and `npm run verify` pass.
The diff, risk class, and verification gaps are reviewable.
Release and external-service claims have direct evidence.

## Agent skills

### Issue tracker

Track issues and specs in GitHub Issues.
Before an issue operation, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels.
Before a triage operation, read `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context glossary and ADR layout.
Before domain exploration or design, read `docs/agents/domain.md`.
