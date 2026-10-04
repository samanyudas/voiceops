import { Schema } from "effect";

const identifier = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{1,80}$/));
export const AssetId = identifier.pipe(Schema.brand("AssetId"));
export const DraftId = identifier.pipe(Schema.brand("DraftId"));
export const WorkOrderId = identifier.pipe(Schema.brand("WorkOrderId"));
export const TechnicianId = identifier.pipe(Schema.brand("TechnicianId"));
export const Priority = Schema.Literals(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const Skill = Schema.Literals(["mechanical", "rotating-equipment", "electrical", "instrumentation"]);
export const Category = Schema.Literals(["abnormal-vibration", "temperature-issue", "mechanical-leak", "electrical-fault", "instrumentation-fault", "performance-degradation", "unclassified"]);
export const Lifecycle = Schema.Literals(["NEW", "VALIDATED", "PRIORITIZED", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
export const Action = Schema.Literals(["acknowledge", "start", "resolve", "close"]);
export const Facts = Schema.Struct({
  equipment: Schema.Literals(["operating", "unavailable", "unknown"]),
  leak: Schema.Literals(["none", "minor", "significant", "unknown"]),
  fireOrSmoke: Schema.Literals(["yes", "no", "unknown"]),
  personnelHazard: Schema.Literals(["yes", "no", "unknown"]),
  vibration: Schema.Literals(["normal", "abnormal", "severe", "unknown"]),
  temperature: Schema.Literals(["normal", "abnormal", "severe", "unknown"])
});
const observation = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000), Schema.isPattern(/\S/));
export const Report = Schema.Struct({ assetId: AssetId, category: Category, observations: observation, facts: Facts });
export const RequiredFact = Schema.Literals(["equipment", "leak", "fireOrSmoke", "personnelHazard", "vibration", "temperature", "category"]);
export const Assessment = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("eligible"), priority: Priority, requiredSkill: Skill, reasons: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("manual-review"), knownPriority: Schema.NullOr(Priority), missing: Schema.Array(RequiredFact), reasons: Schema.Array(Schema.String) })
]);
export const Candidate = Schema.Struct({ id: WorkOrderId, priority: Schema.NullOr(Priority), lifecycle: Lifecycle, lastReportAt: Schema.String });
export const Draft = Schema.Struct({ id: DraftId, report: Report, assessment: Assessment, expiresAt: Schema.String, duplicateCandidates: Schema.Array(Candidate) });
export const Prepared = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("ready"), draft: Draft }),
  Schema.Struct({ kind: Schema.Literal("manual-review"), draft: Draft }),
  Schema.Struct({ kind: Schema.Literal("duplicate-decision-required"), draft: Draft })
]);
export const PrepareInput = Schema.Struct({ asset: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)), category: Category, observations: observation, facts: Facts });
export const Decision = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("no-duplicate-expected") }),
  Schema.Struct({ kind: Schema.Literal("new-occurrence") }),
  Schema.Struct({ kind: Schema.Literal("same-issue"), workOrderId: WorkOrderId })
]);
export const ConfirmInput = Schema.Struct({ draftId: DraftId, decision: Decision });
export const TechnicianAction = Schema.Struct({ requestId: identifier, workOrderId: WorkOrderId, action: Action, technicianId: TechnicianId });
export const Allocation = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("held"), reasons: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("queued"), escalationRequired: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("assigned"), technicianId: TechnicianId }),
  Schema.Struct({ kind: Schema.Literal("completed") })
]);
export const WorkOrderView = Schema.Struct({ id: WorkOrderId, reportCount: Schema.Int, lifecycle: Lifecycle, priority: Schema.NullOr(Priority), allocation: Allocation });
export const AssignmentView = Schema.Struct({ workOrderId: WorkOrderId, technicianId: TechnicianId, allocatedAt: Schema.String });
export const ConfirmationResult = Schema.Struct({ operation: Schema.Literals(["created", "report-added"]), workOrder: WorkOrderView, assignments: Schema.Array(AssignmentView) });
export const ActionResult = Schema.Struct({ workOrder: WorkOrderView, assignments: Schema.Array(AssignmentView) });
export const Asset = Schema.Struct({ id: AssetId, name: Schema.String, type: Schema.String });
export const AssetContext = Schema.Struct({ asset: Asset, history: Schema.Array(Schema.Struct({ at: Schema.String, note: Schema.String })), openWorkOrders: Schema.Array(Candidate) });
export const StoredWorkOrder = Schema.Struct({ id: WorkOrderId, assetId: AssetId, category: Category, assessment: Assessment, lifecycle: Lifecycle, reportCount: Schema.Int });
export const StoredDraft = Schema.Struct({ id: DraftId, report: Report, assessment: Assessment, expiresAt: Schema.String, expired: Schema.Boolean, decisionKey: Schema.NullOr(Schema.String), result: Schema.NullOr(ConfirmationResult) });
export const ActionReceipt = Schema.Struct({ fingerprint: Schema.String, result: ActionResult });
export const State = Schema.Struct({
  workOrders: Schema.Array(WorkOrderView),
  assignments: Schema.Array(Schema.Struct({ workOrderId: WorkOrderId, technicianId: TechnicianId, allocatedAt: Schema.String, releasedAt: Schema.NullOr(Schema.String) })),
  reports: Schema.Array(Schema.Struct({ workOrderId: WorkOrderId, report: Report, at: Schema.String })),
  events: Schema.Array(Schema.Struct({ workOrderId: WorkOrderId, action: Schema.String, at: Schema.String, reason: Schema.String })),
  queue: Schema.Array(WorkOrderId),
  technicians: Schema.Array(Schema.Struct({ id: TechnicianId, skills: Schema.Array(Skill), available: Schema.Boolean }))
});
export type Report = typeof Report.Type;
export type Assessment = typeof Assessment.Type;
export type Priority = typeof Priority.Type;
export type Skill = typeof Skill.Type;
export type Category = typeof Category.Type;
export type Lifecycle = typeof Lifecycle.Type;
export type Action = typeof Action.Type;
export type PrepareInput = typeof PrepareInput.Type;
export type ConfirmInput = typeof ConfirmInput.Type;
export type TechnicianAction = typeof TechnicianAction.Type;
export type WorkOrderView = typeof WorkOrderView.Type;
export type AssignmentView = typeof AssignmentView.Type;
export type ConfirmationResult = typeof ConfirmationResult.Type;
export type ActionResult = typeof ActionResult.Type;
export type Prepared = typeof Prepared.Type;
export type AssetContext = typeof AssetContext.Type;
export type RequiredFact = typeof RequiredFact.Type;
export type WorkOrderId = typeof WorkOrderId.Type;
export type State = typeof State.Type;
