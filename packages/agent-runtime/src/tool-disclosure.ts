import type { AgentToolCallRecord } from "./completion-guard.js";
import type { ModelToolSurface } from "./run-request.js";
import type { AgentToolDefinition } from "./runtime-ports.js";

export type ModelToolDisclosurePhase =
  "bootstrap" | "host-inspected" | "inspected" | "continuation" | "expanded";

/**
 * Returns the exact model-facing definition view for one disclosure phase.
 * The returned definitions retain the original executor metadata and runtime
 * validator; only Provider-visible description/schema may be narrowed.
 */
export function disclosedToolDefinitions(
  definitions: readonly AgentToolDefinition[],
  phase: ModelToolDisclosurePhase,
  options: {
    surface?: ModelToolSurface;
    deliveryScopeReview?: "direct" | "required";
  } = {},
): AgentToolDefinition[] {
  // Keep a new-design Run on its compact surface after the first material
  // revision. Treating continuation as general silently exposed the full
  // professional catalog and made tool selection noisy at the point where
  // the model should continue the current visual stage.
  const surface =
    phase === "expanded" ? "general" : (options.surface ?? "general");
  const visibleDefinitions = definitions.filter((definition) => {
    if (
      definition.modelDisclosure?.whenDeliveryScopeReview === "required" &&
      options.deliveryScopeReview !== "required"
    ) {
      return false;
    }
    const surfaces = definition.modelDisclosure?.surfaces ?? ["general"];
    return surfaces.includes(surface);
  });
  if (phase === "expanded") return visibleDefinitions;
  if (phase === "continuation") {
    return visibleDefinitions
      .filter((definition) => {
        const disclosure = definition.modelDisclosure;
        return (
          disclosure === undefined ||
          (disclosure.role !== "plan" &&
            (disclosure.bootstrap === "available" ||
              disclosure.continuation === "available"))
        );
      })
      .map((definition) => projectDisclosure(definition, phase));
  }
  return visibleDefinitions.flatMap((definition) => {
    const disclosure = definition.modelDisclosure;
    if (disclosure === undefined) return [definition];
    if (
      phase === "host-inspected" &&
      (disclosure.bootstrap !== "available" ||
        disclosure.beforePlan === "deferred")
    ) {
      return [];
    }
    if (
      disclosure.bootstrap === "deferred" &&
      !(phase === "inspected" && disclosure.afterInspection === "available")
    ) {
      return [];
    }
    return [projectDisclosure(definition, phase)];
  });
}

function projectDisclosure(
  definition: AgentToolDefinition,
  phase: ModelToolDisclosurePhase,
): AgentToolDefinition {
  const disclosure = definition.modelDisclosure;
  if (disclosure === undefined) return definition;
  return {
    ...definition,
    description:
      phase === "continuation"
        ? (disclosure.continuationDescription ??
          disclosure.bootstrapDescription ??
          definition.description)
        : (disclosure.bootstrapDescription ?? definition.description),
    inputSchema:
      phase === "continuation"
        ? (disclosure.continuationInputSchema ??
          disclosure.bootstrapInputSchema ??
          definition.inputSchema)
        : (disclosure.bootstrapInputSchema ?? definition.inputSchema),
  };
}

export function deliveryScopeReviewToolDefinitions(
  definitions: readonly AgentToolDefinition[],
  phase: "bootstrap" | "host-inspected",
  options: { surface?: ModelToolSurface } = {},
): AgentToolDefinition[] {
  return disclosedToolDefinitions(definitions, phase, {
    ...options,
    deliveryScopeReview: "required",
  }).filter(
    (definition) =>
      definition.modelDisclosure?.whenDeliveryScopeReview === "required" ||
      definition.modelDisclosure?.role === "inspection",
  );
}

/**
 * New-design Runs stay on the compact surface through inspection and the
 * current stage's first material commit, then enter a continuation surface
 * that keeps that stage authoritative while allowing the next compact stage.
 * Both new-design and general Runs stay on a compact continuation surface
 * after material writes. Advanced tools expand only after the model explicitly
 * inspects the capability manifest, avoiding a full catalog dump during
 * ordinary compose/edit/capture loops.
 */
export function resolveModelToolDisclosurePhase(
  definitions: readonly AgentToolDefinition[],
  records: readonly AgentToolCallRecord[],
  options: {
    initialInspection?: boolean;
    surface?: ModelToolSurface;
  } = {},
): ModelToolDisclosurePhase {
  const roles = new Map(
    definitions.flatMap((definition) => {
      const role = definition.modelDisclosure?.role;
      return role === undefined ? [] : [[definition.name, role] as const];
    }),
  );
  if (roles.size === 0) return "expanded";

  let inspected = options.initialInspection ?? false;
  let modelInspected = false;
  let planned = false;
  for (const record of records) {
    const role = roles.get(record.toolName);
    if (role === "capability-discovery" && record.status === "completed") {
      return "expanded";
    }
    if (role === "material-write" && record.revisionAdvanced === true) {
      return "continuation";
    }
    if (role === "plan") planned = true;
    if (role === "inspection") {
      inspected = true;
      modelInspected = true;
    }
  }
  if (options.initialInspection && !planned && !modelInspected) {
    return "host-inspected";
  }
  return inspected ? "inspected" : "bootstrap";
}
