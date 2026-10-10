import { Effect, Layer, Schema } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { serverLayer } from "../src/api/server.js";
import { defaultRateLimits, type RateLimitConfig } from "../src/api/rate-limit.js";

function decodeRateLimits(): RateLimitConfig {
  const integer = (name: string, fallback: number, maximum: number) => {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return Schema.decodeUnknownSync(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum })))(
      Schema.decodeUnknownSync(Schema.String.check(Schema.isPattern(/^[0-9]+$/)))(value)
    );
  };
  const windowMs = integer("RATE_LIMIT_WINDOW_SECONDS", defaultRateLimits.windowMs / 1000, 3600) * 1000;
  const allPerWindow = integer("RATE_LIMIT_ALL_PER_WINDOW", defaultRateLimits.allPerWindow, 100_000);
  const writesPerWindow = integer("RATE_LIMIT_WRITES_PER_WINDOW", defaultRateLimits.writesPerWindow, 100_000);
  if (writesPerWindow > allPerWindow) throw new Error("Write limit must not exceed the all-request limit.");
  return { windowMs, allPerWindow, writesPerWindow };
}
const config = Schema.Struct({ DATABASE_URL: Schema.NonEmptyString, TOOL_API_KEY: Schema.String.check(Schema.isMinLength(16)), TECHNICIAN_API_KEY: Schema.String.check(Schema.isMinLength(16)) });
const run = Effect.gen(function*() {
  const values = yield* Schema.decodeUnknownEffect(config)(process.env);
  if (values.TOOL_API_KEY === values.TECHNICIAN_API_KEY) return yield* Effect.fail(new Error('Operator and technician credentials must differ.'));
  const port = yield* Schema.decodeUnknownEffect(Schema.Int.check(Schema.isBetween({minimum:1,maximum:65535})))(Number(process.env.PORT ?? '3000'));
  const rateLimits = yield* Effect.try(decodeRateLimits);
  return yield* Layer.launch(serverLayer({ databaseUrl: values.DATABASE_URL, toolKey: values.TOOL_API_KEY, technicianKey: values.TECHNICIAN_API_KEY, port, host: process.env.HOST ?? '127.0.0.1', rateLimits }));
});
NodeRuntime.runMain(run.pipe(Effect.mapError(() => new Error('Backend startup failed. Check required environment fields, distinct credentials, database access, migrations, the listen port, and rate limit settings.'))));
