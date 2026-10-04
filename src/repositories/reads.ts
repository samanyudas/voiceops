import { Context, Effect, Layer, Schema } from "effect";
import { PgClient } from "@effect/sql-pg";
import { Asset, AssetContext, Candidate, State, StoredWorkOrder, WorkOrderView } from "../domain/models.js";
import { MissingRecord, StorageFailure } from "../domain/errors.js";
import { decode } from "../db/decode.js";

export function makeReads(sql: PgClient.PgClient) {
  const candidates = (assetId: string, category?: string) => Effect.gen(function*() {
    const rows = yield* sql<{ value: unknown }>`SELECT json_build_object('id',id,'priority',priority,'lifecycle',lifecycle,'lastReportAt',last_report_at::text) AS value FROM work_orders WHERE asset_id=${assetId} AND (${category ?? null}::text IS NULL OR category=${category ?? null}) AND lifecycle NOT IN ('RESOLVED','CLOSED') ORDER BY created_at,id`;
    return yield* decode(Schema.Array(Candidate), rows.map(r => r.value));
  });
  const asset = (id: string) => Effect.gen(function*() {
    const rows = yield* sql<{ value: unknown }>`SELECT json_build_object('id',id,'name',name,'type',type) AS value FROM assets WHERE id=${id}`;
    const row = rows[0];
    if (!row) return yield* new MissingRecord({ code: "UnknownAsset", message: "The synthetic asset registry does not contain this asset." });
    return yield* decode(Asset, row.value);
  });
  const workOrder = (id: string) => Effect.gen(function*() {
    const rows = yield* sql<{ value: unknown }>`SELECT json_build_object('id',id,'assetId',asset_id,'category',category,'assessment',assessment,'lifecycle',lifecycle,'reportCount',report_count) AS value FROM work_orders WHERE id=${id}`;
    const row = rows[0];
    if (!row) return yield* new MissingRecord({ code: "MissingWorkOrder", message: "This work order does not exist." });
    return yield* decode(StoredWorkOrder, row.value);
  });
  const view = (id: string) => Effect.gen(function*() {
    const rows = yield* sql<{ value: unknown }>`SELECT json_build_object('id',w.id,'reportCount',w.report_count,'lifecycle',w.lifecycle,'priority',w.priority,'allocation', CASE w.dispatch_status WHEN 'HELD' THEN json_build_object('kind','held','reasons',w.assessment->'reasons') WHEN 'QUEUED' THEN json_build_object('kind','queued','escalationRequired',w.escalation_required) WHEN 'COMPLETED' THEN json_build_object('kind','completed') ELSE json_build_object('kind','assigned','technicianId',a.technician_id) END) AS value FROM work_orders w LEFT JOIN assignments a ON a.work_order_id=w.id AND a.released_at IS NULL WHERE w.id=${id}`;
    const row = rows[0];
    if (!row) return yield* new MissingRecord({ code: "MissingWorkOrder", message: "This work order does not exist." });
    return yield* decode(WorkOrderView, row.value);
  });
  const context = (id: string) => Effect.gen(function*() {
    const registry = yield* asset(id);
    const rows = yield* sql<{ value: unknown }>`SELECT json_build_object('at',at::text,'note',note) AS value FROM maintenance_history WHERE asset_id=${id} ORDER BY at DESC`;
    const result = { asset: registry, history: rows.map(r => r.value), openWorkOrders: yield* candidates(id) };
    return yield* decode(AssetContext, result);
  });
  const state = sql.withTransaction(Effect.gen(function*() {
    yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const ids = yield* sql<{ id: string }>`SELECT id FROM work_orders ORDER BY created_at,id`;
    const workOrders = yield* Effect.forEach(ids, r => view(r.id));
    const assignments = yield* sql<{ value: unknown }>`SELECT json_build_object('workOrderId',work_order_id,'technicianId',technician_id,'allocatedAt',allocated_at::text,'releasedAt',released_at::text) AS value FROM assignments ORDER BY id`;
    const reports = yield* sql<{ value: unknown }>`SELECT json_build_object('workOrderId',work_order_id,'report',report,'at',at::text) AS value FROM reports ORDER BY id`;
    const events = yield* sql<{ value: unknown }>`SELECT json_build_object('workOrderId',work_order_id,'action',action,'at',at::text,'reason',reason) AS value FROM events ORDER BY id`;
    const queue = yield* sql<{ id: string }>`SELECT id FROM work_orders WHERE dispatch_status='QUEUED' ORDER BY priority_rank,created_at,id`;
    const technicians = yield* sql<{ value: unknown }>`SELECT json_build_object('id',t.id,'skills',COALESCE((SELECT json_agg(skill ORDER BY skill) FROM technician_skills WHERE technician_id=t.id),'[]'::json),'available',NOT EXISTS(SELECT 1 FROM assignments WHERE technician_id=t.id AND released_at IS NULL)) AS value FROM technicians t ORDER BY t.id`;
    return yield* decode(State, { workOrders, assignments: assignments.map(r => r.value), reports: reports.map(r => r.value), events: events.map(r => r.value), queue: queue.map(r => r.id), technicians: technicians.map(r => r.value) });
  }));
  return { asset, candidates, workOrder, view, context, state };
}
export class Reads extends Context.Service<Reads, ReturnType<typeof makeReads>>()('voiceops/Reads') {
  static readonly layer = Layer.effect(Reads, Effect.map(PgClient.PgClient, makeReads));
}
export const storageFailure = () => new StorageFailure({ code: "StorageUnavailable", message: "The database operation outcome is unknown. Retry with the same draft or action key." });
