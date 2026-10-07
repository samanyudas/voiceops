# Backend API reference

`src/api/definition.ts` defines the Effect HttpApi schemas and generated OpenAPI contract.
`GET /openapi.json` returns the contract without operational data.
The operator credential uses `x-voiceops-tool-key`.
The technician credential uses `x-voiceops-tech-key`.
Missing credentials return 401 and a valid credential from the wrong class returns 403.

| Method and path | Credential | Result |
| --- | --- | --- |
| `GET /assets/{assetId}` | Operator | Asset registry, history, and unresolved work orders |
| `POST /intake/prepare` | Operator | Expiring draft and deterministic assessment |
| `POST /intake/confirm` | Operator | Original created or report-added receipt |
| `POST /technician/actions` | Technician | Lifecycle receipt and new assignments |
| `GET /work-orders/{workOrderId}` | Technician | Current work-order view |
| `GET /state` | Technician | Consistent snapshot of orders, queue, technicians, assignments, reports, and events |

Preparation takes `asset`, `category`, `observations`, and all six `facts` fields.
The fields retain explicit unknown values.
Preparation never consumes technician capacity.

```json
{
  "asset": "pump p 101",
  "category": "mechanical-leak",
  "observations": "A small seal leak is visible.",
  "facts": {
    "equipment": "operating",
    "leak": "minor",
    "fireOrSmoke": "no",
    "personnelHazard": "no",
    "vibration": "normal",
    "temperature": "normal"
  }
}
```

Preparation returns `{kind, draft}`.
The kind is `ready`, `manual-review`, or `duplicate-decision-required`.
The draft contains `id`, `report`, `assessment`, `expiresAt`, and `duplicateCandidates`.
Drafts expire ten minutes after database creation.
Expiry uses database wall time after any dispatcher lock wait.

Confirmation takes `draftId` and a decision.
`no-duplicate-expected` rejects a duplicate that appeared after preparation.
`new-occurrence` creates separate work after the operator explicitly chooses that branch.
`same-issue` requires a currently matching unresolved `workOrderId`.

```json
{"draftId":"DRAFT_ID","decision":{"kind":"same-issue","workOrderId":"WORK_ORDER_ID"}}
```

Confirmation returns `operation`, `workOrder`, and `assignments`.
The work order contains `id`, `reportCount`, `lifecycle`, `priority`, and `allocation`.
Allocation is assigned with `technicianId`, queued with `escalationRequired`, or held with reasons.
Resolved and closed read views use `allocation.kind = "completed"`.
The priority can be null when facts cannot establish urgency.

Technician actions require `requestId`, `workOrderId`, `technicianId`, and `action`.
Actions are `acknowledge`, `start`, `resolve`, and `close`.
The assigned technician controls those actions in this simulation.
The technician credential is a shared PoC capability, not a personal identity system.

A draft identifier or technician request identifier is the mutation idempotency key.
Matching retries return the exact persisted receipt before current lifecycle validation.
Different arguments with the same key return 409.
A receipt may describe an earlier queued or assigned state.
Current views remain separate from receipts.

| Status | Meaning |
| --- | --- |
| 400 | Invalid input or schema |
| 404 | Unknown asset, missing draft, or missing work order |
| 409 | Duplicate decision, stale candidate, conflicting replay, transition, or technician mismatch |
| 410 | Expired draft |
| 429 | The authenticated role has exhausted its request budget |
| 503 | Storage failure with an unknown operation outcome |

A 503 does not prove rollback.
Retry a mutation with the same logical key after a lost response.
The server retries an entire transaction at most twice for retryable SQL failures.
Database constraints prevent multiple active jobs for one technician or multiple active technicians for one job.
Reports and events reject ordinary updates and deletes.

## Request rate limits

Each backend process owns separate operator and technician budgets.
Each role permits 120 operational requests and 30 writes per 60-second fixed window by default.
All six operational routes consume the all-request budget.
GET and HEAD requests consume only the all-request budget.
Every other admitted method also consumes the write budget.
Effect routes HEAD requests through the existing GET handlers.
These defaults are initial protection settings, not measured backend capacity.
The shared capability credentials make each budget shared by all callers with that role.

Authentication runs before admission, and admission runs before payload decoding or service work.
Invalid credentials and wrong-role credentials retain their 401 and 403 responses without consuming either budget.
An admitted request consumes its budget even if decoding or the operation fails.
A rejected request consumes neither budget and performs no mutation.
The public `GET /openapi.json` route remains outside these budgets.

Operational responses after admission include `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`.
The headers describe the applicable budget with the fewest remaining requests.
`RateLimit-Reset` is the rounded-up number of seconds until that budget resets, with a minimum of one.
A 429 response also includes `Retry-After` with the same number of seconds.
If both budgets reject a write, the response describes the exhausted budget that resets last.
The error contains `code: "RateLimited"` and `message: "Request rate limit exceeded."`.
Effect also includes the error discriminator `_tag: "RateLimited"`.

| Environment field | Default | Accepted decimal integers |
| --- | --- | --- |
| `RATE_LIMIT_WINDOW_SECONDS` | 60 | 1 through 3600 |
| `RATE_LIMIT_ALL_PER_WINDOW` | 120 | 1 through 100000 |
| `RATE_LIMIT_WRITES_PER_WINDOW` | 30 | 1 through 100000 |

The server rejects invalid settings before it starts database access or listens.
The write budget cannot exceed the all-request budget.

The limiter has exactly four counters and uses a monotonic clock.
The counter keys are validated roles, with no caller-controlled identity or IP address.
Admission checks and increments run synchronously, so only one concurrent request can consume a final slot within one process.
Fixed windows permit a burst across a window boundary.
Restarting a process resets its budgets, and multiple processes each have their own budgets.
A deployment that needs a shared limit across replicas requires separate gateway or centralized admission enforcement.
These budgets do not limit unauthenticated traffic or the public OpenAPI route.
