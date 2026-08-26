import type {
  AgentToolCallRecord,
  AgentToolDefinition,
  ModelToolSurface,
} from "./index.js";

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
  const surface =
    phase === "expanded" || phase === "continuation"
      ? "general"
      : (options.surface ?? "general");
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
    return visibleDefinitions.filter(
      (definition) => definition.modelDisclosure?.role !== "plan",
    );
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
    return [
      {
        ...definition,
        description: disclosure.bootstrapDescription ?? definition.description,
        inputSchema: disclosure.bootstrapInputSchema ?? definition.inputSchema,
      },
    ];
  });
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
 * General Runs expand after a material revision. A Plan
 * that explicitly targets an existing artboard expands the edit surface
 * because its first valid mutation may require hierarchy/layout/component
 * tooling.
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
    if (role === "material-write" && record.revision !== undefined) {
      const disclosure = definitions.find(
        (definition) => definition.name === record.toolName,
      )?.modelDisclosure;
      if (
        options.surface === "new-design" &&
        disclosure?.surfaces?.includes("new-design")
      ) {
        return "continuation";
      }
      return "expanded";
    }
    if (role === "plan" && planTargetsExistingArtboard(record.input)) {
      return "expanded";
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

function planTargetsExistingArtboard(input: unknown): boolean {
  if (!isRecord(input)) return false;
  if (isExistingArtboard(input.artboard)) return true;
  return (
    Array.isArray(input.targets) &&
    input.targets.some(
      (target) => isRecord(target) && isExistingArtboard(target.artboard),
    )
  );
}

function isExistingArtboard(value: unknown): boolean {
  return isRecord(value) && value.mode === "existing";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeModelDisclosure(
  disclosure: AgentToolDefinition["modelDisclosure"],
): boolean {
  if (disclosure === undefined) return true;
  if (
    disclosure === null ||
    typeof disclosure !== "object" ||
    Array.isArray(disclosure) ||
    !Object.keys(disclosure).every((key) =>
      [
        "bootstrap",
        "beforePlan",
        "afterInspection",
        "role",
        "surfaces",
        "bootstrapDescription",
        "bootstrapInputSchema",
        "whenDeliveryScopeReview",
      ].includes(key),
    )
  ) {
    return false;
  }
  if (
    disclosure.surfaces !== undefined &&
    (!Array.isArray(disclosure.surfaces) ||
      disclosure.surfaces.length < 1 ||
      disclosure.surfaces.length > 2 ||
      new Set(disclosure.surfaces).size !== disclosure.surfaces.length ||
      !disclosure.surfaces.every(
        (surface) => surface === "general" || surface === "new-design",
      ))
  ) {
    return false;
  }
  if (
    disclosure.whenDeliveryScopeReview !== undefined &&
    disclosure.whenDeliveryScopeReview !== "required"
  ) {
    return false;
  }
  if (
    disclosure.beforePlan !== undefined &&
    disclosure.beforePlan !== "available" &&
    disclosure.beforePlan !== "deferred"
  ) {
    return false;
  }
  if (
    disclosure.afterInspection !== undefined &&
    disclosure.afterInspection !== "available"
  ) {
    return false;
  }
  if (
    disclosure.bootstrap !== "available" &&
    disclosure.bootstrap !== "deferred"
  ) {
    return false;
  }
  if (
    disclosure.role !== undefined &&
    disclosure.role !== "inspection" &&
    disclosure.role !== "plan" &&
    disclosure.role !== "material-write"
  ) {
    return false;
  }
  if (
    disclosure.bootstrapDescription !== undefined &&
    (typeof disclosure.bootstrapDescription !== "string" ||
      disclosure.bootstrapDescription.length === 0 ||
      disclosure.bootstrapDescription.length > 20_000)
  ) {
    return false;
  }
  const schema = disclosure.bootstrapInputSchema;
  return (
    schema === undefined ||
    (schema !== null &&
      typeof schema === "object" &&
      !Array.isArray(schema) &&
      schema.type === "object" &&
      schema.additionalProperties === false)
  );
}
