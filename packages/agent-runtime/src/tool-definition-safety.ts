import type { AgentToolDefinition } from "./index.js";

export function selectSafeDefinitions(
  definitions: readonly AgentToolDefinition[],
): AgentToolDefinition[] {
  const safe: AgentToolDefinition[] = [];
  const names = new Set<string>();
  for (const definition of definitions) {
    if (!isSafeDefinition(definition) || names.has(definition.name)) continue;
    names.add(definition.name);
    safe.push(definition);
  }
  return safe;
}

function isSafeDefinition(definition: AgentToolDefinition): boolean {
  const prompt = definition.approvalPrompt;
  return (
    definition.name.length > 0 &&
    definition.name.startsWith("opendesign_") &&
    definition.description.length > 0 &&
    definition.inputSchema.type === "object" &&
    definition.inputSchema.additionalProperties === false &&
    typeof definition.validateInput === "function" &&
    (definition.explainInvalidInput === undefined ||
      typeof definition.explainInvalidInput === "function") &&
    (definition.approvalScope === undefined ||
      definition.approvalScope === "call" ||
      definition.approvalScope === "run") &&
    (definition.approvalScope !== "run" ||
      definition.approval === "required") &&
    (prompt === undefined ||
      (typeof prompt.title === "string" &&
        typeof prompt.summary === "string" &&
        prompt.title.length > 0 &&
        prompt.title.length <= 2_000 &&
        prompt.summary.length <= 20_000))
  );
}
