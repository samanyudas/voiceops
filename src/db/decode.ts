import { Effect, Schema } from "effect";
import { StorageFailure } from "../domain/errors.js";
export const decode = <A>(schema: Schema.Codec<A, unknown>, value: unknown) => Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(() => new StorageFailure({ code: "InvalidStoredData", message: "Stored data failed validation. The operation outcome is unknown. Retry with the same operation key." })));
