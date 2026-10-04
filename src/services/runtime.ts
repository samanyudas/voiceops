import { Layer } from "effect";
import { NodeServices } from "@effect/platform-node";
import { databaseLayer } from "../db/connection.js";
import { Reads } from "../repositories/reads.js";
import { DispatchService } from "./dispatch.js";
import { IntakeService } from "./intake.js";
import { TechnicianActionService } from "./technician-actions.js";
export const servicesLayer = (url: string) => {
  const database = databaseLayer(url).pipe(Layer.provide(NodeServices.layer));
  const reads = Reads.layer.pipe(Layer.provideMerge(database));
  const dispatch = DispatchService.layer.pipe(Layer.provideMerge(reads));
  return Layer.mergeAll(IntakeService.layer, TechnicianActionService.layer).pipe(Layer.provide(dispatch));
};
