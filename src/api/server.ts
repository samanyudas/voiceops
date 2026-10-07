import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpEffect, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { NodeHttpServer } from "@effect/platform-node";
import { Api, OperatorAuth, TechnicianAuth } from "./definition.js";
import { Forbidden, Unauthorized, RateLimited } from "../domain/errors.js";
import { IntakeService } from "../services/intake.js";
import { TechnicianActionService } from "../services/technician-actions.js";
import { servicesLayer } from "../services/runtime.js";
import { defaultRateLimits, makeRateLimiter, type CapabilityRole, type RateLimitConfig } from "./rate-limit.js";

function matches(value: string | undefined, expected: string): boolean {
  if (value === undefined) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a,b);
}
export function serverLayer(options: { readonly databaseUrl: string; readonly toolKey: string; readonly technicianKey: string; readonly port: number; readonly host?: string; readonly rateLimits?: RateLimitConfig }) {
  const limiter = makeRateLimiter(options.rateLimits ?? defaultRateLimits);
  const authorize = (role: CapabilityRole) => Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const expected = role === 'operator' ? options.toolKey : options.technicianKey;
    const own = request.headers[role === 'operator' ? 'x-voiceops-tool-key' : 'x-voiceops-tech-key'];
    const other = request.headers[role === 'operator' ? 'x-voiceops-tech-key' : 'x-voiceops-tool-key'];
    const otherExpected = role === 'operator' ? options.technicianKey : options.toolKey;
    if (matches(own, expected)) return;
    if (matches(other,otherExpected) || matches(own,otherExpected)) return yield* new Forbidden({ code: 'WrongCapability', message: 'This credential cannot perform this class of operations.' });
    return yield* new Unauthorized({ code: 'InvalidCredential', message: 'A valid capability credential is required.' });
  });
  const admit = (role: CapabilityRole) => authorize(role).pipe(Effect.andThen(Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const decision = limiter.admit(role, request.method);
    const { limit, remaining, resetAfterSeconds } = decision.snapshot;
    yield* HttpEffect.appendPreResponseHandler((_request, response) => Effect.succeed(HttpServerResponse.setHeaders(response, {
      'RateLimit-Limit': String(limit),
      'RateLimit-Remaining': String(remaining),
      'RateLimit-Reset': String(resetAfterSeconds),
      ...(decision.kind === 'limited' ? { 'Retry-After': String(resetAfterSeconds) } : {})
    })));
    if (decision.kind === 'limited') return yield* new RateLimited({ code: 'RateLimited', message: 'Request rate limit exceeded.' });
  })));
  const auth = Layer.mergeAll(
    Layer.succeed(OperatorAuth, OperatorAuth.of(next => admit('operator').pipe(Effect.andThen(next)))),
    Layer.succeed(TechnicianAuth, TechnicianAuth.of(next => admit('technician').pipe(Effect.andThen(next))))
  );
  const operator = HttpApiBuilder.group(Api,'operator', Effect.fn(function*(handlers) {
    const intake = yield* IntakeService;
    return handlers.handleAll({ context: ({params}) => intake.context(params.assetId), prepare: ({payload}) => intake.prepare(payload), confirm: ({payload}) => intake.confirm(payload) });
  }));
  const technician = HttpApiBuilder.group(Api,'technician', Effect.fn(function*(handlers) {
    const actions = yield* TechnicianActionService;
    return handlers.handleAll({ act: ({payload}) => actions.act(payload), view: ({params}) => actions.view(params.workOrderId), state: () => actions.state });
  }));
  const routes = HttpApiBuilder.layer(Api,{ openapiPath: '/openapi.json' }).pipe(Layer.provide([operator,technician]),Layer.provide(auth),Layer.provide(servicesLayer(options.databaseUrl)));
  return HttpRouter.serve(routes).pipe(Layer.provide(NodeHttpServer.layer(createServer,{ port: options.port, host: options.host ?? '127.0.0.1' })));
}
