# Verify the implemented VoiceOps flows

VoiceOps uses `e2e@0.17.0`, the tester-army runner, for real HTTP and CLI acceptance tests.
The target uses the runner's `api` platform without a browser engine or model provider.
Every assertion runs against the local backend, CLI output, or a generated offline configuration file.

## Run the acceptance tests

Use Node 24.21.0, npm 12.2.0, and Docker.
Create an isolated synthetic Postgres database before running either database suite.
Both suites reset their database and accept only `postgres:` or `postgresql:` URLs with a `localhost` or `127.0.0.1` host.
The database name must contain only letters, digits, and underscores, and end in `_test`.
The URL must have no query parameters or fragment because the Postgres driver can override the connection target through query parameters.
The E2E wrapper validates the URL before it starts the runner, including when the runner is unavailable.
Malformed URLs return a fixed configuration error without printing the supplied credentials.
These restrictions apply to test commands only.
Do not run both suites concurrently against the same database.

```sh
npm ci --ignore-scripts
docker run --name voiceops-e2e-postgres \
  -e POSTGRES_USER=voiceops \
  -e POSTGRES_PASSWORD=synthetic-test-password \
  -e POSTGRES_DB=voiceops_e2e_test \
  -p 127.0.0.1:55432:5432 \
  -d postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
docker exec voiceops-e2e-postgres pg_isready -U voiceops -d voiceops_e2e_test
npm run verify
TEST_DATABASE_URL=postgres://voiceops:synthetic-test-password@127.0.0.1:55432/voiceops_e2e_test npm run test:acceptance
```

If Postgres is still starting, repeat `pg_isready` until it reports that the server accepts connections.
If the named container already exists, run `docker start voiceops-e2e-postgres` instead of `docker run`.
An existing container retains its original synthetic credentials, which may differ from the example password.
Set `TEST_DATABASE_URL` to those credentials before running the tests.
`test:acceptance` runs the existing integration tests and the tester-army suite sequentially.
To run only the tester-army suite, use `npm run test:e2e` with the same test URL.
The command builds the actual backend and disables runner telemetry before starting the runner.
The suite uses one worker, zero retries, a 30-second test timeout, and a 10-second cleanup timeout.
The helper selects an available localhost port and starts the compiled server with separate synthetic operator and technician credentials.
The helper bounds startup, HTTP requests, SQL statements, CLI subprocesses, and server termination.
Each backend case resets synthetic data through SQL and the actual seed CLI.
Offline voice cases use temporary directories under `artifacts/e2e/` and remove them after each test.

The runner writes these review artifacts.

| File | Contents |
| --- | --- |
| `artifacts/e2e/report.json` | Test outcomes, run errors, and runner metadata |
| `artifacts/e2e/junit.xml` | Machine-readable test results |
| `artifacts/e2e/summary.md` | Human-readable test summary |
| `artifacts/e2e/failures/` | Failure pages when a test fails |

The existing `postgres-integration` CI job runs integration and E2E sequentially against its isolated Postgres service.
The job uploads E2E reports after success or failure, before cleanup.
The package CI job retains its dependencies on `verify` and `postgres-integration`.
The existing required check therefore includes E2E failures without adding a separate check that branch protection does not require.
Local workflow checks do not prove that GitHub executed this revised job.

## Implemented-flow coverage

The tester-army suite has 29 backend cases and nine offline ElevenLabs and cleanup CLI cases.
The existing integration suite retains 32 cases, including controlled database faults and transaction timing.
Each row identifies the tests that check the required behavior.

| Implemented flow | Tester-army evidence | Additional existing evidence |
| --- | --- | --- |
| Public routes and contract | OpenAPI lists all six operational routes, valid response and request schemas, no operational data | Compiled voice-to-backend schema tests |
| Asset lookup | Identifier normalization, history, asset-specific open work, resolved work exclusion, 400 and 404 errors | Integration context normalization |
| Credential classes | All six routes deny absent, wrong, and cross-class credentials with unchanged state | Redirect and secret-redaction boundary tests |
| Intake validation | Missing fields, invalid facts and categories, empty and oversized observations, unknown assets | Integration HTTP schema rejection |
| Preparation | Normalized persisted observations, ten-minute expiry, no assignment before confirmation | Expiry checked after waiting for dispatcher lock |
| Confirmation | New occurrence, explicit no-duplicate decision, same-issue report, concurrent duplicate recheck, stale and mismatched candidates | Integration duplicate transaction checks |
| Expiry and retry | Expired draft returns 410 without operational mutation, confirmed expired draft replays its original receipt | Database wall-clock expiry after lock wait |
| Manual review | Each unknown observation, unclassified work, permanent hold through later complete reports, held queued work | Integration hold persistence |
| Priority | Every documented urgency condition, maximum duplicate urgency, queue reprioritization | Pure policy tests and stored priority constraints |
| Skill and capacity | All six classified categories, compatible technicians, least-recent assignment, incompatible queued work | Independent unique capacity constraints |
| Queue and escalation | CRITICAL, HIGH, MEDIUM, then LOW dispatch, FIFO among equal priorities, one escalation event | Stable identifier ordering when timestamps tie |
| Technician lifecycle | Actual CLI `acknowledge`, `start`, `resolve`, `close`, `view`, and `state`, completed allocation | CLI queue reassignment regression |
| Technician errors | Invalid arguments, missing key, exact 401, 404, and 409 CLI responses, illegal transitions, technician mismatch | Credential and redirect boundary tests |
| Durable receipts | Exact confirmation and action replay, conflicting keys, no double release after closure | Lost HTTP response after commit |
| Concurrent work | Same-draft confirms, same-key resolutions, intake versus release, no double booking | SQLSTATE 40001 retries the complete transaction |
| Restart | Pending drafts, current state, confirmation and action receipts survive a server restart | Integration persistence checks |
| Seed | Actual seed CLI is idempotent and preserves jobs after dispatch | Integration demo seed |
| Offline voice configuration | Actual `prepare` CLI, three tool routes, secret locators, private output, repeatable output, no cloud state | Official request and backend schema validation |
| Five voice scenarios | Generated complete intake, missing asset, unknown asset, emergency, and ambiguous-facts mocks match domain schemas and policy | All 13 mocks checked against compiled backend responses |
| Cloud command boundaries | Actual CLI denies provision, adopt, and run-tests without opt-in or credentials | Injected API tests for uncertain provisioning, verified adoption, invocation resume, private state writes |
| Cleanup and cloud checkpoints | Actual `npm run clean` in an isolated fixture preserves pending resource IDs, invocation state, lock contents, and private permissions | Generated build, coverage, E2E, and package outputs disappear |
| Test database isolation | Both real test entry points reject host, database, port, and startup query parameters, fragments, unsafe database paths, wrong protocols, and missing configuration before connecting | `tests/test-database-target.test.mjs` uses loopback sentinels and isolated runner reports |
| Transaction failure and audit immutability | Covered by the existing integration suite in `test:acceptance` | Injected assignment failure rolls back resolution, capacity, receipts, and events, append-only triggers reject edits |

The HTTP state checks cover work orders, assignments, reports, events, queue, and technician availability.
SQL modifies draft expiry only to arrange the expiry case.
Database fault injection remains in the focused integration suite.

## Verification limits

VoiceOps has a backend and technician CLI, with no browser UI to exercise.
The offline voice checks validate configuration and mocks rather than agent conversation behavior.
They do not run hosted simulations, a human microphone, speech recognition, or audio quality checks.
The suite makes no model calls and requires no ElevenLabs API key.
Live voice verification requires separately authorized credentials, remote resources, a running backend, and a public HTTPS tunnel.
Historical recordings do not prove that the current configuration has passed a new live conversation.
Source packaging archives committed `HEAD`, so an archive check cannot validate uncommitted E2E changes.
See [PROGRESS.md](../PROGRESS.md) and [the E2E decision record](evidence/e2e-decisions.tsv) for this branch's evidence and remaining work.
