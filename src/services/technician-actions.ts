import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer } from "effect";
import { ActionReceipt, type ActionResult, type TechnicianAction, type State, type WorkOrderView } from "../domain/models.js";
import { conflict, type MissingRecord, type StorageFailure } from "../domain/errors.js";
import { transition } from "../policy/maintenance.js";
import { decode } from "../db/decode.js";
import { DispatchService, dispatcherLock } from "./dispatch.js";
import { Reads, storageFailure } from "../repositories/reads.js";
export class TechnicianActionService extends Context.Service<TechnicianActionService, {
  act: DispatchService['Service']['resolve'];
  view: (id: string) => Effect.Effect<WorkOrderView, MissingRecord | StorageFailure>;
  state: Effect.Effect<State, StorageFailure | MissingRecord>;
}>()('voiceops/TechnicianActionService') {
  static readonly layer = Layer.effect(TechnicianActionService, Effect.gen(function*() {
    const dispatch = yield* DispatchService;
    const reads = yield* Reads;
    const sql = yield* PgClient.PgClient;
    const ordinaryAction = (input: TechnicianAction) => sql.withTransaction(Effect.gen(function*() {
      yield* dispatcherLock(sql);
      const fingerprint = JSON.stringify(input);
      const receipts = yield* sql<{ value: unknown }>`SELECT json_build_object('fingerprint',fingerprint,'result',result) AS value FROM action_receipts WHERE request_id=${input.requestId}`;
      const row = receipts[0];
      if (row) {
        const receipt = yield* decode(ActionReceipt,row.value);
        if (receipt.fingerprint !== fingerprint) return yield* conflict('ConflictingReplay','This action key already committed different arguments.');
        return receipt.result;
      }
      yield* sql`SELECT id FROM work_orders WHERE id=${input.workOrderId} FOR UPDATE`;
      const order = yield* reads.workOrder(input.workOrderId);
      yield* sql`SELECT id FROM technicians WHERE id=${input.technicianId} FOR UPDATE`;
      const assignments = yield* sql<{ technician_id: string }>`SELECT technician_id FROM assignments WHERE work_order_id=${order.id} ORDER BY id DESC LIMIT 1 FOR UPDATE`;
      if (assignments[0]?.technician_id !== input.technicianId) return yield* conflict('AssignmentMismatch','Only the assigned technician can act on this work order.');
      const next = transition(order.lifecycle,input.action);
      if (next.kind === 'invalid' || input.action === 'resolve') return yield* conflict('InvalidTransition','The requested action is invalid for the current lifecycle.');
      if (next.next !== order.lifecycle) {
        yield* sql`UPDATE work_orders SET lifecycle=${next.next} WHERE id=${order.id}`;
        yield* sql`INSERT INTO events(work_order_id,action,reason) VALUES (${order.id},${next.next},'Synthetic technician action. Capacity changes only on resolution.')`;
      }
      const result: ActionResult = { workOrder: yield* reads.view(order.id), assignments: [] };
      yield* sql`INSERT INTO action_receipts(request_id,fingerprint,result) VALUES (${input.requestId},${fingerprint},${sql.json(result)})`;
      return result;
    })).pipe(Effect.retry({times:2,while:e=>e._tag==='SqlError' && e.isRetryable}),Effect.catchTag('SqlError',()=>Effect.fail(storageFailure())));
    return {
      act: (input) => input.action === 'resolve' ? dispatch.resolve(input) : ordinaryAction(input),
      view: (id) => reads.view(id).pipe(Effect.catchTag('SqlError', () => Effect.fail(storageFailure()))),
      state: reads.state.pipe(Effect.catchTag('SqlError', () => Effect.fail(storageFailure())))
    };
  }));
}
