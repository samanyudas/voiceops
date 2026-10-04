import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";
import { ActionReceipt, ActionResult, AssignmentView, ConfirmationResult, StoredDraft, WorkOrderId, type ConfirmInput, type TechnicianAction } from "../domain/models.js";
import { conflict, ExpiredDraft, MissingRecord } from "../domain/errors.js";
import { isDuplicate, mergeAssessment, priorityRank, transition } from "../policy/maintenance.js";
import { decode } from "../db/decode.js";
import { Reads, storageFailure } from "../repositories/reads.js";

export const dispatcherLock = (sql: PgClient.PgClient) => sql`SELECT pg_advisory_xact_lock(71190324)`;
export function makeDispatch(sql: PgClient.PgClient, reads: Reads['Service']) {
  const event = (id: string, action: string, reason: string) => sql`INSERT INTO events(work_order_id,action,reason) VALUES (${id},${action},${reason})`;
  const drain = Effect.gen(function*() {
    const assigned: typeof AssignmentView.Type[] = [];
    const queued = yield* sql<{ id: string; required_skill: string }>`SELECT id,required_skill FROM work_orders WHERE dispatch_status='QUEUED' ORDER BY priority_rank,created_at,id FOR UPDATE`;
    for (const order of queued) {
      const technicians = yield* sql<{ id: string }>`SELECT t.id FROM technicians t WHERE EXISTS(SELECT 1 FROM technician_skills s WHERE s.technician_id=t.id AND s.skill=${order.required_skill}) AND NOT EXISTS(SELECT 1 FROM assignments a WHERE a.technician_id=t.id AND a.released_at IS NULL) ORDER BY (SELECT max(allocated_at) FROM assignments a WHERE a.technician_id=t.id) ASC NULLS FIRST,t.id LIMIT 1 FOR UPDATE OF t`;
      const technician = technicians[0];
      if (!technician) continue;
      const rows = yield* sql<{ value: unknown }>`INSERT INTO assignments(work_order_id,technician_id) VALUES (${order.id},${technician.id}) RETURNING json_build_object('workOrderId',work_order_id,'technicianId',technician_id,'allocatedAt',allocated_at::text) AS value`;
      const assignment = yield* decode(Schema.Array(AssignmentView), rows.map(r => r.value));
      assigned.push(...assignment);
      yield* sql`UPDATE work_orders SET lifecycle='ASSIGNED',dispatch_status='ASSIGNED',escalation_required=false WHERE id=${order.id}`;
      yield* event(order.id, 'ASSIGNED', 'Least-recently-assigned free technician with the required skill. Capacity escalation ends, not the underlying hazard.');
    }
    const critical = yield* sql<{ id: string }>`UPDATE work_orders SET escalation_required=true WHERE dispatch_status='QUEUED' AND priority='CRITICAL' AND NOT escalation_required RETURNING id`;
    for (const order of critical) yield* event(order.id, 'ESCALATION_REQUIRED', 'Critical work awaits compatible technician capacity.');
    return assigned;
  });
  const commitDraft = (input: ConfirmInput) => sql.withTransaction(Effect.gen(function*() {
    yield* dispatcherLock(sql);
    const rows = yield* sql<{ value: unknown }>`SELECT json_build_object('id',id,'report',report,'assessment',assessment,'expiresAt',expires_at::text,'expired',expires_at <= clock_timestamp(),'decisionKey',decision_key,'result',result) AS value FROM drafts WHERE id=${input.draftId} FOR UPDATE`;
    const row = rows[0];
    if (!row) return yield* new MissingRecord({ code: 'MissingDraft', message: 'This draft does not exist.' });
    const draft = yield* decode(StoredDraft, row.value);
    const decisionKey = JSON.stringify(input.decision);
    if (draft.result !== null) {
      if (draft.decisionKey !== decisionKey) return yield* conflict('ConflictingReplay', 'This draft already committed another decision.');
      return draft.result;
    }
    if (draft.expired) return yield* new ExpiredDraft({ code: 'ExpiredDraft', message: 'This draft expired. Prepare and confirm a new draft.' });
    yield* reads.asset(draft.report.assetId);
    const candidates = yield* reads.candidates(draft.report.assetId, draft.report.category);
    if (input.decision.kind === 'no-duplicate-expected' && candidates.length > 0) return yield* conflict('DuplicateDecisionRequired', 'Select the same issue or explicitly confirm a new occurrence.', candidates.map(c => c.id));
    let id: typeof WorkOrderId.Type;
    let operation: typeof ConfirmationResult.Type['operation'];
    if (input.decision.kind === 'same-issue') {
      id = input.decision.workOrderId;
      const candidate = candidates.find(c => c.id === id);
      if (!candidate) return yield* conflict('StaleDuplicate', 'The selected work order is no longer a current matching duplicate.', candidates.map(c => c.id));
      yield* sql`SELECT id FROM work_orders WHERE id=${id} FOR UPDATE`;
      const existing = yield* reads.workOrder(id);
      if (!isDuplicate(draft.report, existing)) return yield* conflict('StaleDuplicate', 'The selected work order no longer matches.');
      const assessment = mergeAssessment(existing.assessment, draft.assessment);
      const priority = assessment.kind === 'eligible' ? assessment.priority : assessment.knownPriority;
      const view = yield* reads.view(id);
      const holdUnassignedForManualReview = assessment.kind === 'manual-review' && view.allocation.kind !== 'assigned';
      yield* sql`UPDATE work_orders SET assessment=${sql.json(assessment)},priority=${priority},priority_rank=${priority === null ? null : priorityRank[priority]},report_count=report_count+1,last_report_at=clock_timestamp(),dispatch_status=CASE WHEN ${holdUnassignedForManualReview} THEN 'HELD' ELSE dispatch_status END,escalation_required=CASE WHEN ${holdUnassignedForManualReview} THEN false ELSE escalation_required END WHERE id=${id}`;
      yield* event(id, 'REPORT_ADDED', 'Operator selected the same issue. Urgency cannot decrease and a manual-review hold cannot clear automatically.');
      operation = 'report-added';
    } else {
      id = Schema.decodeUnknownSync(WorkOrderId)(randomUUID());
      const assessment = draft.assessment;
      const priority = assessment.kind === 'eligible' ? assessment.priority : assessment.knownPriority;
      const eligible = assessment.kind === 'eligible';
      yield* sql`INSERT INTO work_orders(id,asset_id,category,assessment,priority,priority_rank,required_skill,lifecycle,dispatch_status,report_count) VALUES (${id},${draft.report.assetId},${draft.report.category},${sql.json(assessment)},${priority},${priority === null ? null : priorityRank[priority]},${eligible ? assessment.requiredSkill : null},${eligible ? 'PRIORITIZED' : 'VALIDATED'},${eligible ? 'QUEUED' : 'HELD'},1)`;
      for (const action of eligible ? ['NEW','VALIDATED','PRIORITIZED','QUEUED'] : ['NEW','VALIDATED','MANUAL_REVIEW']) yield* event(id, action, assessment.reasons.join(' '));
      operation = 'created';
    }
    yield* sql`INSERT INTO reports(work_order_id,report) VALUES (${id},${sql.json(draft.report)})`;
    const assignments = yield* drain;
    const result: ConfirmationResult = { operation, workOrder: yield* reads.view(id), assignments };
    yield* sql`UPDATE drafts SET decision_key=${decisionKey},result=${sql.json(result)} WHERE id=${draft.id}`;
    return result;
  })).pipe(Effect.retry({ times: 2, while: e => e._tag === 'SqlError' && e.isRetryable }), Effect.catchTag('SqlError', () => Effect.fail(storageFailure())));
  const resolve = (input: TechnicianAction) => sql.withTransaction(Effect.gen(function*() {
    yield* dispatcherLock(sql);
    const fingerprint = JSON.stringify(input);
    const receipts = yield* sql<{ value: unknown }>`SELECT json_build_object('fingerprint',fingerprint,'result',result) AS value FROM action_receipts WHERE request_id=${input.requestId}`;
    const receiptRow = receipts[0];
    if (receiptRow) {
      const receipt = yield* decode(ActionReceipt, receiptRow.value);
      if (receipt.fingerprint !== fingerprint) return yield* conflict('ConflictingReplay', 'This action key already committed different arguments.');
      return receipt.result;
    }
    yield* sql`SELECT id FROM work_orders WHERE id=${input.workOrderId} FOR UPDATE`;
    const order = yield* reads.workOrder(input.workOrderId);
    yield* sql`SELECT id FROM technicians WHERE id=${input.technicianId} FOR UPDATE`;
    const assignments = yield* sql<{ technician_id: string }>`SELECT technician_id FROM assignments WHERE work_order_id=${input.workOrderId} ORDER BY id DESC LIMIT 1 FOR UPDATE`;
    if (assignments[0]?.technician_id !== input.technicianId) return yield* conflict('AssignmentMismatch', 'Only the assigned technician can act on this work order.');
    const result = transition(order.lifecycle, input.action);
    if (result.kind === 'invalid' || input.action !== 'resolve') return yield* conflict('InvalidTransition', 'The requested action is invalid for the current lifecycle.');
    if (result.next !== order.lifecycle) {
      yield* sql`UPDATE work_orders SET lifecycle=${result.next},dispatch_status='COMPLETED' WHERE id=${order.id}`;
      yield* event(order.id, result.next, 'Synthetic technician action.');
    }
    {
      const released = yield* sql`UPDATE assignments SET released_at=clock_timestamp() WHERE work_order_id=${order.id} AND technician_id=${input.technicianId} AND released_at IS NULL RETURNING id`;
      if (released.length !== 1) return yield* conflict('AssignmentMismatch', 'The work order has no matching active assignment.');
      yield* event(order.id, 'CAPACITY_RELEASED', 'Resolution releases capacity before queue assignment in this transaction.');
    }
    const allocated = yield* drain;
    const response: ActionResult = { workOrder: yield* reads.view(order.id), assignments: allocated };
    yield* sql`INSERT INTO action_receipts(request_id,fingerprint,result) VALUES (${input.requestId},${fingerprint},${sql.json(response)})`;
    return response;
  })).pipe(Effect.retry({ times: 2, while: e => e._tag === 'SqlError' && e.isRetryable }), Effect.catchTag('SqlError', () => Effect.fail(storageFailure())));
  return { commitDraft, resolve };
}
export class DispatchService extends Context.Service<DispatchService, ReturnType<typeof makeDispatch>>()('voiceops/DispatchService') {
  static readonly layer = Layer.effect(DispatchService, Effect.gen(function*() { return makeDispatch(yield* PgClient.PgClient, yield* Reads); }));
}
