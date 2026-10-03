import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";
import { Schema } from "effect";
import { ActionResult, AssetContext, ConfirmInput, ConfirmationResult, PrepareInput, Prepared, State, TechnicianAction, WorkOrderId, WorkOrderView } from "../domain/models.js";
import { Conflict, ExpiredDraft, Forbidden, InvalidInput, MissingRecord, StorageFailure, Unauthorized } from "../domain/errors.js";

export class OperatorAuth extends HttpApiMiddleware.Service<OperatorAuth>()('voiceops/OperatorAuth', { error: [Unauthorized, Forbidden] }) {}
export class TechnicianAuth extends HttpApiMiddleware.Service<TechnicianAuth>()('voiceops/TechnicianAuth', { error: [Unauthorized, Forbidden] }) {}
const errors = [InvalidInput, MissingRecord, Conflict, ExpiredDraft, StorageFailure];
export const Api = HttpApi.make('voiceops')
  .add(HttpApiGroup.make('operator')
    .add(HttpApiEndpoint.get('context','/assets/:assetId',{ params: { assetId: Schema.String }, success: AssetContext, error: errors }),
      HttpApiEndpoint.post('prepare','/intake/prepare',{ payload: PrepareInput, success: Prepared, error: errors }),
      HttpApiEndpoint.post('confirm','/intake/confirm',{ payload: ConfirmInput, success: ConfirmationResult, error: errors }))
    .middleware(OperatorAuth))
  .add(HttpApiGroup.make('technician')
    .add(HttpApiEndpoint.post('act','/technician/actions',{ payload: TechnicianAction, success: ActionResult, error: errors }),
      HttpApiEndpoint.get('view','/work-orders/:workOrderId',{ params: { workOrderId: WorkOrderId }, success: WorkOrderView, error: errors }),
      HttpApiEndpoint.get('state','/state',{ success: State, error: errors }))
    .middleware(TechnicianAuth));
