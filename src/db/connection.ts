import { PgClient } from "@effect/sql-pg";
import { Layer, Redacted } from "effect";
import { migrations } from "./migrations.js";
export const databaseLayer = (url: string) => migrations.pipe(Layer.provideMerge(PgClient.layer({ url: Redacted.make(url), maxConnections: 10, applicationName: "voiceops-poc" })));
