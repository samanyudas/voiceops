import { Effect, Layer, Schema } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { serverLayer } from "../src/api/server.js";
const config = Schema.Struct({ DATABASE_URL: Schema.NonEmptyString, TOOL_API_KEY: Schema.String.check(Schema.isMinLength(16)), TECHNICIAN_API_KEY: Schema.String.check(Schema.isMinLength(16)) });
const run = Effect.gen(function*() {
  const values = yield* Schema.decodeUnknownEffect(config)(process.env);
  if (values.TOOL_API_KEY === values.TECHNICIAN_API_KEY) return yield* Effect.fail(new Error('Operator and technician credentials must differ.'));
  const port = yield* Schema.decodeUnknownEffect(Schema.Int.check(Schema.isBetween({minimum:1,maximum:65535})))(Number(process.env.PORT ?? '3000'));
  return yield* Layer.launch(serverLayer({ databaseUrl: values.DATABASE_URL, toolKey: values.TOOL_API_KEY, technicianKey: values.TECHNICIAN_API_KEY, port, host: process.env.HOST ?? '127.0.0.1' }));
});
NodeRuntime.runMain(run.pipe(Effect.mapError(() => new Error('Backend startup failed. Check required environment fields, distinct credentials, database access, migrations, and the listen port.'))));
