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
| 503 | Storage failure with an unknown operation outcome |

A 503 does not prove rollback.
Retry a mutation with the same logical key after a lost response.
The server retries an entire transaction at most twice for retryable SQL failures.
Database constraints prevent multiple active jobs for one technician or multiple active technicians for one job.
Reports and events reject ordinary updates and deletes.
