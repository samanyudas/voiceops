# VoiceOps

VoiceOps is a synthetic voice-to-work-order proof of concept.
This repository currently contains its accepted design and maintenance foundation.
The voice agent, database workflow, and technician CLI are not implemented yet.

## Start here

Use Node 24.21.0 and npm 12.2.0.
The lockfile pins development dependencies.

```sh
npm ci --ignore-scripts
npm run verify
```

The verification command runs lint, type checks, compilation, tests, a built-tool selftest, and repository policy checks.
These checks verify the maintenance tools.
They do not establish that the planned voice workflow works.

## Repository layout

| Location | Purpose |
| --- | --- |
| `src/` | Planned TypeScript application modules, with documented dependency boundaries |
| `tests/` | Executable maintenance and architecture tests |
| `tools/` | Repository checks, source packaging, and issue lifecycle automation |
| `docs/` | Specs, ADRs, agent guidance, maintenance policy, and verification evidence |
| `.github/` | Issue forms, PR template, CI, and release workflows |

Use the [accepted spec](docs/specs/voiceops.md) and [issue 1](https://github.com/samanyudas/voiceops/issues/1) for product requirements.
Use [PROGRESS.md](PROGRESS.md) for the current state.
Use [CONTRIBUTING.md](CONTRIBUTING.md) for verification and PR requirements.

## Source packaging

Commit the intended source before packaging.

```sh
npm run package:source
npm run check:package
```

The source archive contains the exact committed revision.
The package check extracts it, installs dependencies, and runs verification in a temporary directory.
VoiceOps has no desktop application or DMG artifact.

## Support and security

Read [SUPPORT.md](SUPPORT.md) for issue reporting.
Read [SECURITY.md](SECURITY.md) for private vulnerability reports.
All equipment, technician records, and examples must remain synthetic.
