import { randomUUID } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";
import { DraftId, type Prepared, type PrepareInput } from "../domain/models.js";
import { InvalidInput } from "../domain/errors.js";
import { assess } from "../policy/maintenance.js";
import { Reads, storageFailure } from "../repositories/reads.js";
import { DispatchService } from "./dispatch.js";

export function normalizeAsset(input: string) {
  const normalized = input.trim().toUpperCase().replace(/^(PUMP|COMPRESSOR|SEPARATOR)\s+/, '').replace(/[\s-]/g, '');
  const match = /^([PCV])(\d{3})$/.exec(normalized);
  if (!match?.[1] || !match[2]) return Effect.fail(new InvalidInput({ code: 'InvalidAssetId', message: 'Use a synthetic asset identifier such as P-101.' }));
  return Effect.succeed(`${match[1]}-${match[2]}`);
}
export class IntakeService extends Context.Service<IntakeService, {
  context: (asset: string) => Effect.Effect<import('../domain/models.js').AssetContext, InvalidInput | import('../domain/errors.js').MissingRecord | import('../domain/errors.js').StorageFailure>;
  prepare: (input: PrepareInput) => Effect.Effect<Prepared, InvalidInput | import('../domain/errors.js').MissingRecord | import('../domain/errors.js').StorageFailure>;
  confirm: DispatchService['Service']['commitDraft'];
}>()('voiceops/IntakeService') {
  static readonly layer = Layer.effect(IntakeService, Effect.gen(function*() {
    const sql = yield* PgClient.PgClient;
    const reads = yield* Reads;
    const dispatch = yield* DispatchService;
    const context = (asset: string) => Effect.gen(function*() { return yield* reads.context(yield* normalizeAsset(asset)); }).pipe(Effect.catchTag('SqlError', () => Effect.fail(storageFailure())));
    const prepare = (input: PrepareInput) => Effect.gen(function*() {
      const asset = yield* reads.asset(yield* normalizeAsset(input.asset));
      const report = { assetId: asset.id, category: input.category, observations: input.observations.trim(), facts: input.facts };
      const assessment = assess(report);
      const candidates = yield* reads.candidates(asset.id, input.category);
      const id = Schema.decodeUnknownSync(DraftId)(randomUUID());
      const rows = yield* sql<{ expires_at: string }>`INSERT INTO drafts(id,report,assessment,expires_at) VALUES (${id},${sql.json(report)},${sql.json(assessment)},clock_timestamp()+interval '10 minutes') RETURNING expires_at::text`;
      const row = rows[0];
      if (!row) return yield* storageFailure();
      const draft = { id, report, assessment, expiresAt: row.expires_at, duplicateCandidates: candidates };
      const response: Prepared = assessment.kind === 'manual-review' ? { kind: 'manual-review', draft } : candidates.length ? { kind: 'duplicate-decision-required', draft } : { kind: 'ready', draft };
      return response;
    }).pipe(Effect.catchTag('SqlError', () => Effect.fail(storageFailure())));
    return { context, prepare, confirm: dispatch.commitDraft };
  }));
}
