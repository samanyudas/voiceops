import type { Action, Assessment, Category, Lifecycle, Priority, Report, RequiredFact, Skill } from "../domain/models.js";

export const priorityRank: Readonly<Record<Priority, number>> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const skillByCategory: Readonly<Record<Exclude<Category, "unclassified">, Skill>> = {
  "abnormal-vibration": "rotating-equipment", "temperature-issue": "mechanical", "mechanical-leak": "mechanical",
  "electrical-fault": "electrical", "instrumentation-fault": "instrumentation", "performance-degradation": "mechanical"
};
export function raisePriority(existing: Priority | null, incoming: Priority | null): Priority | null {
  if (existing === null) return incoming;
  if (incoming === null) return existing;
  return priorityRank[existing] <= priorityRank[incoming] ? existing : incoming;
}
export function assess(report: Report): Assessment {
  const facts = report.facts;
  const missing: RequiredFact[] = [];
  for (const key of ["equipment", "leak", "fireOrSmoke", "personnelHazard", "vibration", "temperature"] satisfies RequiredFact[]) {
    if (facts[key] === "unknown") missing.push(key);
  }
  if (report.category === "unclassified") missing.push("category");
  let priority: Priority | null = missing.length === 0 ? "LOW" : null;
  const reasons: string[] = [];
  if (facts.personnelHazard === "yes" || facts.fireOrSmoke === "yes" || facts.leak === "significant") {
    priority = "CRITICAL";
    reasons.push("Reported personnel hazard, fire or smoke, or significant leak.");
  } else if (facts.equipment === "unavailable" || facts.vibration === "severe" || facts.temperature === "severe") {
    priority = "HIGH";
    reasons.push("Reported unavailable equipment or severe vibration or temperature.");
  } else if (facts.vibration === "abnormal" || facts.temperature === "abnormal" || (report.category === "performance-degradation" && facts.equipment === "operating")) {
    priority = "MEDIUM";
    reasons.push("Reported abnormal vibration or temperature, or degraded performance while operating.");
  }
  if (missing.length > 0 || report.category === "unclassified" || priority === null) {
    return { kind: "manual-review", knownPriority: priority, missing, reasons: [...reasons, "Required facts remain unknown or the category is unclassified."] };
  }
  return { kind: "eligible", priority, requiredSkill: skillByCategory[report.category], reasons: reasons.length ? reasons : ["Reported equipment operates without an explicit urgent condition."] };
}
export function mergeAssessment(existing: Assessment, incoming: Assessment): Assessment {
  const priority = raisePriority(existing.kind === "eligible" ? existing.priority : existing.knownPriority, incoming.kind === "eligible" ? incoming.priority : incoming.knownPriority);
  if (existing.kind === "manual-review" || incoming.kind === "manual-review") {
    return { kind: "manual-review", knownPriority: priority, missing: [...new Set([...(existing.kind === "manual-review" ? existing.missing : []), ...(incoming.kind === "manual-review" ? incoming.missing : [])])], reasons: [...existing.reasons, ...incoming.reasons, "Manual review requires a maintainer and does not clear automatically."] };
  }
  return { ...existing, priority: priority ?? existing.priority, reasons: [...existing.reasons, ...incoming.reasons] };
}
export function isDuplicate(report: Pick<Report, "assetId" | "category">, candidate: { readonly assetId: Report["assetId"]; readonly category: Category; readonly lifecycle: Lifecycle }): boolean {
  return report.assetId === candidate.assetId && report.category === candidate.category && candidate.lifecycle !== "RESOLVED" && candidate.lifecycle !== "CLOSED";
}
const transitions: Readonly<Record<Action, { readonly from: Lifecycle; readonly to: Lifecycle }>> = {
  acknowledge: { from: "ASSIGNED", to: "ACKNOWLEDGED" }, start: { from: "ACKNOWLEDGED", to: "IN_PROGRESS" }, resolve: { from: "IN_PROGRESS", to: "RESOLVED" }, close: { from: "RESOLVED", to: "CLOSED" }
};
export function transition(current: Lifecycle, action: Action): { readonly kind: "allowed"; readonly next: Lifecycle } | { readonly kind: "invalid" } {
  const rule = transitions[action];
  if (current === rule.from || ((action === "acknowledge" || action === "start") && current === rule.to)) return { kind: "allowed", next: rule.to };
  return { kind: "invalid" };
}
