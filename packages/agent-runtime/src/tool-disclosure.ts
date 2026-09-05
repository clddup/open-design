import type { AgentToolCallRecord } from "./completion-guard.js";
import type { AgentToolDefinition } from "./runtime-ports.js";

export type ModelToolDisclosurePhase =
  "bootstrap" | "host-inspected" | "inspected" | "continuation" | "expanded";

/** Only the Provider view changes; execution metadata and validators are retained. */
export function disclosedToolDefinitions(
  definitions: readonly AgentToolDefinition[],
  phase: ModelToolDisclosurePhase,
): AgentToolDefinition[] {
  if (phase === "expanded") return [...definitions];
  return definitions
    .filter((definition) => {
      const disclosure = definition.modelDisclosure;
      if (disclosure === undefined || disclosure.bootstrap === "available") {
        return true;
      }
      if (phase === "continuation") {
        return disclosure.continuation === "available";
      }
      return (
        (phase === "host-inspected" || phase === "inspected") &&
        disclosure.afterInspection === "available"
      );
    })
    .map((definition) => projectDisclosure(definition, phase));
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

/** Records contain only successfully executed calls, not requests or failures. */
export function resolveModelToolDisclosurePhase(
  definitions: readonly AgentToolDefinition[],
  records: readonly AgentToolCallRecord[],
  options: { initialInspection?: boolean } = {},
): ModelToolDisclosurePhase {
  const roles = new Map(
    definitions.map((definition) => [
      definition.name,
      definition.modelDisclosure?.role,
    ]),
  );
  let modelInspected = false;
  let materialWritten = false;
  for (const record of records) {
    const role = roles.get(record.toolName);
    if (role === "capability-discovery") return "expanded";
    if (role === "material-write" && record.revisionAdvanced === true) {
      materialWritten = true;
    }
    if (role === "inspection") modelInspected = true;
  }
  if (materialWritten) return "continuation";
  if (modelInspected) return "inspected";
  return options.initialInspection ? "host-inspected" : "bootstrap";
}
