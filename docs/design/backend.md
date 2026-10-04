# Backend design: one transaction-scoped dispatcher lock

## Usage (caller's view)

The API parses external input into domain values before it invokes a service.
The operator uses preparation and confirmation.
The technician uses a separate credential and action route.
No caller coordinates repository writes or controls transaction order.

```ts
const prepared = yield* intake.prepare({
  asset: "pump p 101",
  category: "mechanical-leak",
  observations: "Small seal leak while the pump operates.",
  facts: {
    equipment: "operating",
    leak: "minor",
    fireOrSmoke: "no",
    personnelHazard: "no",
    vibration: "normal",
    temperature: "normal",
  },
});
// Returns an expiring draft with derived urgency and duplicate candidates.
// Preparation never consumes technician capacity.

const confirmed = yield* intake.confirm({
  draftId: prepared.draft.id,
  decision: { kind: "new-occurrence" },
});
// Returns one persisted work order with its current assigned, queued, or held outcome.
// The agent requests this operation only after verbal confirmation.
// Repeating this request returns its persisted result without another mutation.
```

```ts
const updated = yield* intake.confirm({
  draftId,
  decision: { kind: "same-issue", workOrderId: existingId },
});
// Adds one report, increments reportCount, and preserves or increases priority.
// It retains an existing active assignment.
```

```ts
// Technician route, inaccessible with the agent tool credential.
const resolved = yield* technicianActions.act({
  requestId: "demo-resolve-001",
  workOrderId,
  action: "resolve",
  technicianId,
});
// Commits resolution, capacity release, queued assignment, and events together.
// Includes the newly assigned work orders so the CLI can show actual results.
```

## Problem

The accepted spec requires durable drafts, duplicate decisions, deterministic allocation, and atomic capacity release.
Concurrent intake must not bypass higher-priority compatible queued work or allocate a technician twice.
The application is greenfield, but its accepted boundaries already assign policy to pure functions and assignment writes to DispatchService.
This candidate serializes allocation-changing transactions at one Postgres lock before it takes row locks.
It preserves strict ordering across those transactions and keeps the public service surface small.

## Shape

The following sketch defines domain shapes and service contracts.
It does not assert a verified Effect v4 import or constructor API.
Implementation must first verify the accepted package versions and APIs against official documentation.

```ts
type AssetId = string; // Parsed and normalized once at the service boundary.
type DraftId = string; // Parsed identifier, not caller-generated database state.
type WorkOrderId = string;
type TechnicianId = string;
type Timestamp = string; // Validated timestamp at boundaries, database time internally.

type KnownBoolean = "yes" | "no" | "unknown";
type EquipmentStatus = "operating" | "unavailable" | "unknown";
type LeakSignificance = "none" | "minor" | "significant" | "unknown";
type Severity = "normal" | "abnormal" | "severe" | "unknown";
type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type Skill = "mechanical" | "rotating-equipment" | "electrical" | "instrumentation";
type FaultCategory =
  | "abnormal-vibration"
  | "temperature-issue"
  | "mechanical-leak"
  | "electrical-fault"
  | "instrumentation-fault"
  | "performance-degradation";
type ReportCategory = FaultCategory | "unclassified";

interface Facts {
  readonly equipment: EquipmentStatus;
  readonly leak: LeakSignificance;
  readonly fireOrSmoke: KnownBoolean;
  readonly personnelHazard: KnownBoolean;
  readonly vibration: Severity;
  readonly temperature: Severity;
}
interface Report {
  readonly assetId: AssetId;
  readonly category: ReportCategory;
  readonly observations: string;
  readonly facts: Facts;
}
type RequiredFact = keyof Facts | "category";
type Assessment =
  | {
      readonly kind: "eligible";
      readonly priority: Priority;
      readonly requiredSkill: Skill;
      readonly reasons: readonly string[];
    }
  | {
      readonly kind: "manual-review";
      readonly knownPriority: Priority | null;
      readonly missing: readonly RequiredFact[];
      readonly reasons: readonly string[];
    };

interface DuplicateCandidate {
  readonly id: WorkOrderId;
  readonly priority: Priority | null;
  readonly lifecycle: Lifecycle;
  readonly lastReportAt: Timestamp;
}
interface Draft {
  readonly id: DraftId;
  readonly report: Report;
  readonly assessment: Assessment;
  readonly expiresAt: Timestamp;
  readonly duplicateCandidates: readonly DuplicateCandidate[];
}
type Prepared =
  | { readonly kind: "ready"; readonly draft: Draft }
  | { readonly kind: "manual-review"; readonly draft: Draft }
  | { readonly kind: "duplicate-decision-required"; readonly draft: Draft };
type DuplicateDecision =
  | { readonly kind: "no-duplicate-expected" }
  | { readonly kind: "new-occurrence" }
  | { readonly kind: "same-issue"; readonly workOrderId: WorkOrderId };
interface PrepareInput {
  readonly asset: string;
  readonly category: ReportCategory;
  readonly observations: string;
  readonly facts: Facts;
}
interface ConfirmInput {
  readonly draftId: DraftId;
  readonly decision: DuplicateDecision;
}
type LifecycleAction = "acknowledge" | "start" | "resolve" | "close";
interface TechnicianAction {
  readonly requestId: string;
  readonly workOrderId: WorkOrderId;
  readonly action: LifecycleAction;
  readonly technicianId: TechnicianId;
}
interface ResolveInput {
  readonly requestId: string;
  readonly workOrderId: WorkOrderId;
  readonly technicianId: TechnicianId;
}
type ConfirmFailure =
  | InvalidInput | MissingDraft | ExpiredDraft
  | DuplicateDecisionRequired | StaleDuplicate | ConflictingReplay;
type ActionFailure =
  | InvalidInput | MissingWorkOrder | InvalidTransition
  | AssignmentMismatch | ConflictingReplay;
// Each named failure is a tagged domain record with context for HTTP mapping.

type Lifecycle =
  | "NEW" | "VALIDATED" | "PRIORITIZED" | "ASSIGNED"
  | "ACKNOWLEDGED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
type Allocation =
  | { readonly kind: "held"; readonly reasons: readonly string[] }
  | { readonly kind: "queued"; readonly escalationRequired: boolean }
  | { readonly kind: "assigned"; readonly technicianId: TechnicianId }
  | { readonly kind: "completed" };
interface WorkOrderView {
  readonly id: WorkOrderId;
  readonly reportCount: number;
  readonly lifecycle: Lifecycle;
  readonly priority: Priority | null;
  readonly allocation: Allocation;
}
interface ConfirmationResult {
  readonly operation: "created" | "report-added";
  readonly workOrder: WorkOrderView;
  readonly assignments: readonly AssignmentView[];
}
interface AssignmentView {
  readonly workOrderId: WorkOrderId;
  readonly technicianId: TechnicianId;
  readonly allocatedAt: Timestamp;
}
interface ActionResult {
  readonly workOrder: WorkOrderView;
  readonly assignments: readonly AssignmentView[];
}

interface IntakeService {
  context(asset: string): Effect<AssetContext, UnknownAsset | InvalidInput>;
  prepare(input: PrepareInput): Effect<Prepared, UnknownAsset | InvalidInput | StorageFailure>;
  confirm(input: ConfirmInput): Effect<ConfirmationResult, ConfirmFailure | StorageFailure>;
}
interface DispatchService {
  commitDraft(input: ConfirmInput): Effect<ConfirmationResult, ConfirmFailure | StorageFailure>;
  resolve(input: ResolveInput): Effect<ActionResult, ActionFailure | StorageFailure>;
}
interface TechnicianActionService {
  act(input: TechnicianAction): Effect<ActionResult, ActionFailure | StorageFailure>;
}

function assess(report: Report): Assessment { throw new Error("not implemented"); }
function requiredSkill(category: FaultCategory): Skill { throw new Error("not implemented"); }
function raisePriority(existing: Priority, incoming: Priority): Priority {
  throw new Error("not implemented");
}
function transition(current: Lifecycle, action: LifecycleAction): TransitionResult {
  throw new Error("not implemented");
}
function isDuplicate(report: Report, candidate: DuplicateFacts): boolean {
  throw new Error("not implemented");
}
```

The allocation union prevents an assigned response without a technician identifier.
The assessment union distinguishes known urgency from dispatch eligibility.
Unknown safety facts remain explicit strings throughout observation storage and response serialization.
Schema parsers enforce limits, identifiers, categories, and timestamps at HTTP and database boundaries.
No assertion, `any`, or non-null escape is necessary to create these values.
The schema and database decoder return domain values rather than exposing transport objects.

### Module ownership

| Module | Ownership and interface |
| --- | --- |
| `domain` | Values, outcome unions, tagged failures, lifecycle, and immutable read views |
| `policy` | Assessment, category-to-skill mapping, duplicate predicate, urgency merge, and transition decision |
| `services/intake` | Asset normalization, context assembly, draft preparation, and operator decision semantics |
| `services/dispatch` | Confirmation mutation, dispatch lock, assignment writes, release transaction, and associated events |
| `services/technician-actions` | Acknowledge, start, and close mutations, with resolution delegated to the transaction owner |
| `repositories` | Asset, history, draft, work-order, assignment, technician, queue, and event reads |
| `db` | PgClient layer, PgMigrator migrations, storage decoders, and seeded references |
| `api` | Effect HttpApi definitions, schema validation, credential separation, HTTP errors, and CLI adapter |

Dispatch owns the full transaction rather than exposing methods such as lock, assign, or release to callers.
Intake performs useful preparation work before it delegates confirmation to that owner.
Technician actions retain their own transition behavior and delegate only resolution because it changes allocation.
The normal call chain is API, service, and database boundary.
Read repositories do not separate assignment writes from their audit events.

### Persistence and access patterns

- Store seed assets, seed history, technician skill rows, work orders, immutable reports, drafts, assignments, and append-only events.
- Keep report facts immutable so the original observations remain inspectable after duplicate updates.
- Store the current derived priority and eligibility on the work order as the queue projection.
- Store the confirmation decision fingerprint and complete result on the draft within its mutation transaction.
- Store a unique technician action request identifier, argument fingerprint, and result in the same transaction as each action.
- Use `assignments WHERE released_at IS NULL` as the capacity source of truth.
- Derive technician availability from active assignments instead of storing a second availability flag.
- Use partial unique indexes on active assignments for technician and work order independently.
- Index open work orders by asset and category for duplicate lookup.
- Index eligible queued work by priority rank, creation timestamp, and stable identifier.
- Match technicians through their skill rows and order by latest historical allocation, then technician identifier.
- Rank a technician with no historical allocation before one who already received work.

One work order has one required skill.
A technician has a set of skills.
An assignment records allocated and released timestamps.
The queue projection and lifecycle update in the same transaction as their events.
Events do not become a separate source of current state.

### Transaction protocol

All mutations that can change allocation acquire the same transaction-scoped Postgres advisory lock first.
Use one named, fixed dispatcher key for this PoC.
The lock is global to this synthetic facility, not local to a process.
Postgres releases it automatically at transaction end, including rollback and connection loss.

The consistent order is dispatcher lock, draft row when present, affected work-order rows, technician rows, then assignment rows.
Order multiple rows of the same type by stable identifier.
Ordinary lifecycle mutations also take the dispatcher lock in this small PoC, so they cannot invert this order.
Use READ COMMITTED and issue all mutable-state reads after lock acquisition.
Revalidate expiry with current database time after any lock wait.
Do not use `SKIP LOCKED` for queue allocation because this candidate promises strict eligible queue order.

Confirmation pseudocode:

```text
BEGIN
Acquire transaction-scoped dispatcher advisory lock.
Lock draft row FOR UPDATE.
If confirmed, check the decision fingerprint and return the stored result.
Reject an expired or unavailable draft.
Recheck asset validity, assessment, and current unresolved duplicates.
Require an explicit duplicate decision when new candidates appeared.
For same-issue, lock the selected current work order and recheck its duplicate predicate.
Append one report and event, then preserve or raise priority.
For new-occurrence, insert a work order and its initial lifecycle events.
Mark eligible new work PRIORITIZED and QUEUED before allocation.
Keep incomplete or unclassified confirmed work held and ineligible.
Drain the durable queue against free compatible technicians.
Persist the draft decision and complete confirmation result.
COMMIT
```

Queue draining scans eligible queued work in priority, timestamp, and identifier order.
For each work order, select its least-recently-assigned free compatible technician.
If none exists, keep the work queued and continue to the next work order.
A lower-priority job can proceed only when no free technician can serve the preceding compatible job.
Lock the selected work order and technician rows before the assignment write.
Insert the active assignment, set ASSIGNED, and append its assignment event.
Clear a current capacity escalation flag but retain earlier escalation events.
After draining, mark critical unassigned work escalated and add its event only when the flag changes.
Do not preempt active work.

Resolution pseudocode:

```text
BEGIN
Acquire the same dispatcher advisory lock.
Lock the current work order, technician, and active assignment in the common order.
Verify the action and technician match the active assignment.
Check a matching persisted command receipt before validating the current lifecycle or active assignment.
Otherwise require IN_PROGRESS before resolution.
Set RESOLVED, release the assignment, and append resolution and release events.
Drain the queue with the newly available capacity in the same transaction.
Store or derive the operation result from these committed events.
COMMIT
```

Repeated resolution must not repeat release events or allocate another job for that technician.
Reuse the action request identifier after a timeout so the stored receipt identifies the original outcome.
Reject the same identifier with different arguments.
Acknowledgement and start accept their existing target state as an idempotent replay.
A request behind the current lifecycle fails unless it has an existing matching action receipt.
Close operates only after resolution and never releases capacity again.
An invalid action rolls back without partial state changes.

The unique indexes are a second defense if a future writer omits the advisory protocol.
Constraint violations become tagged conflicts or storage failures, rather than partial success.
The advisory lock protects order, while row locks and constraints protect record consistency and capacity.

### API and error outcomes

| Boundary | Outcomes |
| --- | --- |
| Asset context | `200` registry and history, `404` unknown asset, `400` invalid identifier |
| Prepare | `200` ready draft, duplicate decision, or manual-review draft |
| Confirm | `200` persisted created or report-added result, including assigned, queued, or held status |
| Confirm duplicate recheck | `409` duplicate decision required or stale selected candidate, with current candidates |
| Confirm expiry | `410` expired draft |
| Missing draft or work order | `404` tagged missing record |
| Conflicting replay | `409` same draft already confirmed with a different decision |
| Invalid lifecycle action | `409` invalid transition or assignment mismatch |
| Credentials | `401` missing or invalid credential, `403` wrong credential class |
| Storage failure | `503` outcome unknown, retry with the same draft or action key |

Voice tools expose only context, prepare, and confirm.
Duplicate confirmation is a branch of confirm, not a third allocation primitive.
Technician HTTP operations and CLI commands use a separate capability.
The agent cannot invoke acknowledge, start, resolve, or close with its credential.

### Idempotency, duplicates, and unknown values

Draft identifiers are confirmation idempotency keys.
The result and confirmation decision commit with the work mutation.
The stored result is the original mutation receipt, not a promise that its queued or assigned state still applies later.
The CLI obtains the current work-order view separately before it reports a later lifecycle action.
If the process loses its response after commit, a retry returns the stored result.
If it fails before commit, no result or mutation survives.
Repeated preparation can create multiple drafts, but confirmation rechecks duplicates before it creates work.

Default confirmation cannot implicitly declare a new occurrence when the duplicate set changes.
The no-duplicate-expected decision rejects any duplicate now present.
The operator must explicitly choose a new occurrence or a same-issue candidate.
An explicit new occurrence creates separate work even when duplicates exist.
A same-issue candidate must remain unresolved and match asset and category at confirmation time.
There is no duplicate age cutoff.
Held work remains held because the PoC has no manual-review completion workflow.
Adding reports to held work can raise known urgency without automatically granting dispatch eligibility.

Missing facts produce manual-review eligibility rather than negative facts or a guessed priority.
A reported hazard can establish CRITICAL urgency while other missing facts still hold dispatch.
Unknown assets never produce a draft for automatic dispatch.
An unclassified category cannot produce a required skill.
Existing urgency never falls during duplicate enrichment.
The history records the complete new observation, including explicit uncertainty.

Verbal confirmation remains model-mediated.
The backend can enforce draft expiry and operation idempotency, but it cannot independently prove human consent.

## Synthesis decision

Candidate A is the base.
The parent and independent judge chose it over Candidate B, whose component lock planning and serializable retries add more coordination.
The judge scored A 9/10 and B 8/10 against queue correctness, transaction invariants, module depth, maintainability, and testability.
The runners and judge used the inherited model, so this is not evidence of model diversity.
The user authorized implementation by asking to continue on 2026-10-03.

The synthesis adds these corrections:

- Check a technician command receipt before validating a released assignment or advanced lifecycle.
- Persist the argument fingerprint and exact result atomically for each command.
- Retry an entire transaction only for retryable SQL failures, with a bounded retry policy and stable logical identifiers.
- Treat connection loss after commit as an unknown outcome, not proof of rollback.
- Check draft expiry with current database time after the dispatcher lock wait.
- Keep held work ineligible when a duplicate report lacks facts, while preserving or raising known urgency.

A valid repeated command returns its stored receipt before the current-state checks.
A failed transaction can roll back, while a lost response after commit requires a retry with the same identifier.
Tests must distinguish those cases.
The public API exposes tagged failures and never claims that a storage failure proves no mutation occurred.

## Tradeoffs accepted

- We accept one serialized dispatcher per facility in exchange for strict, inspectable queue order.
- We accept reduced allocation throughput in exchange for one lock protocol across intake and resolution.
- We accept global allocation transactions across unrelated skills in exchange for fewer deadlock and fairness cases in this PoC.
- We accept a stored queue projection in exchange for indexed allocation queries and atomic state explanations.
- We accept model-mediated confirmation in exchange for the hosted voice interface specified by the user.

## Alternatives considered

A per-technician `SKIP LOCKED` dispatcher permits unrelated allocations concurrently but can bypass a blocked higher-priority job.
That shape hides capacity locking but exposes weaker ordering semantics to callers and tests.
It loses here because the user explicitly selected deterministic priority ordering.

A per-skill dispatcher lock allows mechanical and electrical allocation concurrently.
Multi-skilled technicians then require several lock keys and a cross-skill order.
It hides less concurrency complexity than this single transaction owner while adding coordination rules.

A queue worker separates confirmation from dispatch and hides allocation behind an asynchronous consumer.
It adds an outbox or polling contract and cannot satisfy immediate resolution-triggered assignment without another coordination mechanism.
The accepted scope excludes workers and polling infrastructure.

## Implementation reconciliation

No application implementation exists in this candidate.
No API import, package compatibility, locking test, or transaction outcome is verified by this document.
Any accepted deviation must update this design before the next implementation unit receives its contract.

## Open questions and risks

Can an official Effect v4 package set provide the accepted HTTP, SQL, Schema, and migration APIs under the pinned toolchain?
The implementation must answer this with source and executable package evidence before application work.

Does queue draining across all free technicians keep transaction duration acceptable for the three-technician synthetic world?
Real Postgres HTTP tests must prove the answer before any larger-scale claim.

Can the independent review find any allocation-changing write that bypasses the dispatcher lock?
The public HTTP concurrency tests and constraint tests must cover the resulting protocol.

## Next implementation step

Verify and pin the Effect package set, then create migrations and HTTP tests for confirmation, queue order, and atomic resolution.

## Implementation reconciliation

Resolved and closed read views use `allocation.kind = "completed"`.
This outcome records released capacity without a false queued, held, or active assignment claim.
Intake confirmation retains assigned, queued, and held outcomes.
A confirmation result is the original operation receipt rather than the current work-order state.
