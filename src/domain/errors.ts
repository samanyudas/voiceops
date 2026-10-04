import { Schema } from "effect";
const fields = { code: Schema.String, message: Schema.String };
export class InvalidInput extends Schema.TaggedError<InvalidInput>()("InvalidInput", fields, { httpApiStatus: 400 }) {}
export class MissingRecord extends Schema.TaggedError<MissingRecord>()("MissingRecord", fields, { httpApiStatus: 404 }) {}
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", { ...fields, candidates: Schema.Array(Schema.String) }, { httpApiStatus: 409 }) {}
export class ExpiredDraft extends Schema.TaggedError<ExpiredDraft>()("ExpiredDraft", fields, { httpApiStatus: 410 }) {}
export class StorageFailure extends Schema.TaggedError<StorageFailure>()("StorageFailure", fields, { httpApiStatus: 503 }) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", fields, { httpApiStatus: 401 }) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", fields, { httpApiStatus: 403 }) {}
export type Failure = InvalidInput | MissingRecord | Conflict | ExpiredDraft | StorageFailure;
export const conflict = (code: string, message: string, candidates: readonly string[] = []) => new Conflict({ code, message, candidates });
