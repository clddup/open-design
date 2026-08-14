import type { AgentToolCallRecord, AgentToolDefinition } from "./index.js";

export type ModelToolDisclosurePhase = "bootstrap" | "inspected" | "expanded";

/**
 * Returns the exact model-facing definition view for one disclosure phase.
 * The returned definitions retain the original executor metadata and runtime
 * validator; only Provider-visible description/schema may be narrowed.
 */
export function disclosedToolDefinitions(
  definitions: readonly AgentToolDefinition[],
  phase: ModelToolDisclosurePhase,
): AgentToolDefinition[] {
  if (phase === "expanded") return [...definitions];
  return definitions.flatMap((definition) => {
    const disclosure = definition.modelDisclosure;
    if (disclosure === undefined) return [definition];
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

/**
 * New-design Runs stay on the compact surface through inspection and create
 * Plan allocation, then expand after the first material revision. A Plan that
 * explicitly targets an existing artboard expands the edit surface because
 * its first valid mutation may require hierarchy/layout/component tooling.
 */
export function resolveModelToolDisclosurePhase(
  definitions: readonly AgentToolDefinition[],
  records: readonly AgentToolCallRecord[],
): ModelToolDisclosurePhase {
  const roles = new Map(
    definitions.flatMap((definition) => {
      const role = definition.modelDisclosure?.role;
      return role === undefined ? [] : [[definition.name, role] as const];
    }),
  );
  if (roles.size === 0) return "expanded";

  let inspected = false;
  for (const record of records) {
    const role = roles.get(record.toolName);
    if (role === "material-write" && record.revision !== undefined) {
      return "expanded";
    }
    if (role === "plan" && planTargetsExistingArtboard(record.input)) {
      return "expanded";
    }
    if (role === "inspection") inspected = true;
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
        "afterInspection",
        "role",
        "bootstrapDescription",
        "bootstrapInputSchema",
      ].includes(key),
    )
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
