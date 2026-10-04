import { Effect } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { databaseLayer } from "../src/db/connection.js";
import { seedDemo } from "../src/db/seed.js";
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required.');
NodeRuntime.runMain(seedDemo.pipe(Effect.provide(databaseLayer(url)),Effect.provide(NodeServices.layer)));
