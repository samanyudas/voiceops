# Run the synthetic maintenance backend

The backend turns confirmed maintenance observations into held, queued, or assigned work orders.
It never diagnoses equipment or contacts a real technician.

## Start the local demonstration

Use Node 24.21.0 and npm 12.2.0.
Verify the actual `node --version` before you rely on a wrapper.
A wrapper can fall back to another Node version when install scripts prevent its executable download.

Create an ignored `.env` file with distinct credentials.
Use synthetic local data only.

```dotenv
POSTGRES_PASSWORD=replace-with-a-local-password
DATABASE_URL=postgres://voiceops:replace-with-a-local-password@127.0.0.1:5432/voiceops
TOOL_API_KEY=replace-with-a-random-operator-secret
TECHNICIAN_API_KEY=replace-with-a-different-random-technician-secret
PORT=3000
```

Start Postgres and the backend.
The API applies pending migrations before it accepts requests.
The seed command adds references and two synthetic jobs with occupied capacity.
A repeated seed preserves existing jobs and never resets operational state.

```sh
docker compose up -d --wait
npm ci --ignore-scripts
npm run build
npm run seed
npm start
```

Tech-01 starts with C-201 work in progress.
Tech-03 starts with P-101 work in progress.
Tech-02 remains free for an electrical report.
A new mechanical report queues until a compatible technician resolves current work.

## Inspect and complete work

The CLI uses `TECHNICIAN_API_KEY` and `VOICEOPS_URL`.
It defaults to `http://127.0.0.1:3000`.
Pass a unique request identifier for each logical action.
Reuse that identifier after a timeout.

```sh
npm run technician -- state
npm run technician -- view demo-busy-mechanical
npm run technician -- resolve demo-busy-mechanical Tech-03 demo-resolve-001
npm run technician -- acknowledge WORK_ORDER_ID TECHNICIAN_ID ack-001
npm run technician -- start WORK_ORDER_ID TECHNICIAN_ID start-001
npm run technician -- resolve WORK_ORDER_ID TECHNICIAN_ID resolve-001
npm run technician -- close WORK_ORDER_ID TECHNICIAN_ID close-001
```

The resolution result includes the new queue assignments from the same transaction.
A receipt records the original mutation result.
Use `view` or `state` to inspect the current state after later actions.

## Test the public API

Use a dedicated local database whose name ends in `_test`.
The tests reset that database's synthetic records.
They reject a missing test URL and do not report a skipped success.

```sh
npm run verify
TEST_DATABASE_URL=postgres://voiceops:synthetic-test-password@127.0.0.1:5432/voiceops_test npm run test:integration
```

The integration suite starts the real API process and uses real Postgres.
It tests rollback with a database trigger that rejects assignment.
It tests an unknown commit outcome through a proxy that drops a response after commit.
It tests a whole-transaction retry with PostgreSQL SQLSTATE `40001`.
The tests remove their temporary triggers and proxy after each case.

## Limits

The PoC serializes allocation-changing transactions through one facility advisory lock.
This choice preserves strict eligible queue order and limits throughput to that lock's transaction rate.
No measured throughput or multi-facility scaling claim exists.
Unknown observations require manual review, even when a known hazard establishes critical urgency.
A later report never clears a previous manual-review hold automatically.
There is no supervisor action to remove that hold.
The backend cannot independently prove verbal consent.
Live voice tests and a voice recording require a configured ElevenLabs agent and API key.

See the [API contract](backend-api.md) and [transaction design](design/backend.md).
