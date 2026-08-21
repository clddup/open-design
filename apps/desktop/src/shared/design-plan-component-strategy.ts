export type DesignPlanSemanticOccurrence = {
  targetId: string;
  nodeId: string;
};

export type DesignPlanComponentCandidate =
  | {
      decisionId: string;
      label: string;
      decision: "component";
      rationale: string;
      componentId: string;
      main: DesignPlanSemanticOccurrence & { mode: "create" | "existing" };
      instances: DesignPlanSemanticOccurrence[];
    }
  | {
      decisionId: string;
      label: string;
      decision: "reuse-component";
      rationale: string;
      componentId: string;
      instances: DesignPlanSemanticOccurrence[];
    }
  | {
      decisionId: string;
      label: string;
      decision: "ordinary";
      rationale: string;
      occurrences: DesignPlanSemanticOccurrence[];
    };

export type DesignPlanComponentStrategy = {
  summary: string;
  candidates: DesignPlanComponentCandidate[];
};

const OCCURRENCE_SCHEMA = {
  type: "object",
  properties: {
    targetId: { type: "string", minLength: 1, maxLength: 128 },
    nodeId: { type: "string", minLength: 1, maxLength: 256 },
  },
  required: ["targetId", "nodeId"],
  additionalProperties: false,
} as const;

export const DESIGN_PLAN_COMPONENT_STRATEGY_SCHEMA = {
  type: "object",
  description:
    "Explicit component judgment. Use reuse-component for a compatible componentId from inspection.document.componentCatalog, component when this delivery creates/owns the Main, and ordinary when linked reuse is not justified.",
  properties: {
    summary: { type: "string", minLength: 12, maxLength: 1_000 },
    candidates: {
      type: "array",
      maxItems: 24,
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              decisionId: { type: "string", minLength: 1, maxLength: 128 },
              label: { type: "string", minLength: 1, maxLength: 256 },
              decision: { const: "reuse-component" },
              rationale: { type: "string", minLength: 12, maxLength: 500 },
              componentId: { type: "string", minLength: 1, maxLength: 256 },
              instances: {
                type: "array",
                minItems: 1,
                maxItems: 32,
                items: OCCURRENCE_SCHEMA,
              },
            },
            required: [
              "decisionId",
              "label",
              "decision",
              "rationale",
              "componentId",
              "instances",
            ],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              decisionId: { type: "string", minLength: 1, maxLength: 128 },
              label: { type: "string", minLength: 1, maxLength: 256 },
              decision: { const: "component" },
              rationale: { type: "string", minLength: 12, maxLength: 500 },
              componentId: { type: "string", minLength: 1, maxLength: 256 },
              main: {
                ...OCCURRENCE_SCHEMA,
                properties: {
                  ...OCCURRENCE_SCHEMA.properties,
                  mode: { enum: ["create", "existing"] },
                },
                required: ["mode", "targetId", "nodeId"],
              },
              instances: {
                type: "array",
                maxItems: 32,
                items: OCCURRENCE_SCHEMA,
              },
            },
            required: [
              "decisionId",
              "label",
              "decision",
              "rationale",
              "componentId",
              "main",
              "instances",
            ],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              decisionId: { type: "string", minLength: 1, maxLength: 128 },
              label: { type: "string", minLength: 1, maxLength: 256 },
              decision: { const: "ordinary" },
              rationale: { type: "string", minLength: 12, maxLength: 500 },
              occurrences: {
                type: "array",
                minItems: 1,
                maxItems: 32,
                items: OCCURRENCE_SCHEMA,
              },
            },
            required: [
              "decisionId",
              "label",
              "decision",
              "rationale",
              "occurrences",
            ],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["summary", "candidates"],
  additionalProperties: false,
} as const;

export function isDesignPlanComponentStrategy(
  value: unknown,
  targetIds: readonly string[],
): value is DesignPlanComponentStrategy {
  if (!isRecord(value) || !text(value.summary, 12, 1_000)) return false;
  if (!Array.isArray(value.candidates) || value.candidates.length > 24) {
    return false;
  }
  const targetOrder = new Map(
    targetIds.map((targetId, index) => [targetId, index]),
  );
  const decisionIds = new Set<string>();
  const componentIds = new Set<string>();
  const occurrenceNodeIds = new Set<string>();
  for (const candidate of value.candidates) {
    if (!isCandidate(candidate, targetOrder)) return false;
    if (decisionIds.has(candidate.decisionId)) return false;
    decisionIds.add(candidate.decisionId);
    if (candidate.decision !== "ordinary") {
      if (componentIds.has(candidate.componentId)) return false;
      componentIds.add(candidate.componentId);
    }
    for (const occurrence of candidateOccurrences(candidate)) {
      if (occurrenceNodeIds.has(occurrence.nodeId)) return false;
      occurrenceNodeIds.add(occurrence.nodeId);
    }
  }
  return exactKeys(value, ["summary", "candidates"]);
}

export function componentStrategyOccurrencesForTarget(
  strategy: DesignPlanComponentStrategy,
  targetId: string,
): Array<
  | {
      decisionId: string;
      decision: "component-main";
      nodeId: string;
      componentId: string;
    }
  | {
      decisionId: string;
      decision: "component-instance";
      nodeId: string;
      componentId: string;
    }
  | { decisionId: string; decision: "ordinary"; nodeId: string }
> {
  const result: ReturnType<typeof componentStrategyOccurrencesForTarget> = [];
  for (const candidate of strategy.candidates) {
    if (candidate.decision === "ordinary") {
      result.push(
        ...candidate.occurrences
          .filter((occurrence) => occurrence.targetId === targetId)
          .map((occurrence) => ({
            decisionId: candidate.decisionId,
            decision: "ordinary" as const,
            nodeId: occurrence.nodeId,
          })),
      );
      continue;
    }
    if (candidate.decision === "reuse-component") {
      result.push(
        ...candidate.instances
          .filter((instance) => instance.targetId === targetId)
          .map((instance) => ({
            decisionId: candidate.decisionId,
            decision: "component-instance" as const,
            nodeId: instance.nodeId,
            componentId: candidate.componentId,
          })),
      );
      continue;
    }
    if (candidate.main.targetId === targetId) {
      result.push({
        decisionId: candidate.decisionId,
        decision: "component-main",
        nodeId: candidate.main.nodeId,
        componentId: candidate.componentId,
      });
    }
    result.push(
      ...candidate.instances
        .filter((instance) => instance.targetId === targetId)
        .map((instance) => ({
          decisionId: candidate.decisionId,
          decision: "component-instance" as const,
          nodeId: instance.nodeId,
          componentId: candidate.componentId,
        })),
    );
  }
  return result;
}

function isCandidate(
  value: unknown,
  targetOrder: ReadonlyMap<string, number>,
): value is DesignPlanComponentCandidate {
  if (
    !isRecord(value) ||
    !safeId(value.decisionId, 128) ||
    !text(value.label, 1, 256) ||
    !text(value.rationale, 12, 500)
  ) {
    return false;
  }
  if (value.decision === "ordinary") {
    return (
      Array.isArray(value.occurrences) &&
      value.occurrences.length >= 1 &&
      value.occurrences.length <= 32 &&
      value.occurrences.every((item) => isOccurrence(item, targetOrder)) &&
      exactKeys(value, [
        "decisionId",
        "label",
        "decision",
        "rationale",
        "occurrences",
      ])
    );
  }
  if (value.decision === "reuse-component") {
    return (
      safeId(value.componentId, 256) &&
      Array.isArray(value.instances) &&
      value.instances.length >= 1 &&
      value.instances.length <= 32 &&
      value.instances.every((item) => isOccurrence(item, targetOrder)) &&
      exactKeys(value, [
        "decisionId",
        "label",
        "decision",
        "rationale",
        "componentId",
        "instances",
      ])
    );
  }
  if (
    value.decision !== "component" ||
    !safeId(value.componentId, 256) ||
    !isMainOccurrence(value.main, targetOrder) ||
    !Array.isArray(value.instances) ||
    value.instances.length > 32 ||
    !value.instances.every((item) => isOccurrence(item, targetOrder)) ||
    !exactKeys(value, [
      "decisionId",
      "label",
      "decision",
      "rationale",
      "componentId",
      "main",
      "instances",
    ])
  ) {
    return false;
  }
  const mainIndex = targetOrder.get(value.main.targetId);
  return value.instances.every(
    (instance) =>
      (targetOrder.get(instance.targetId) ?? -1) >= (mainIndex ?? 0),
  );
}

function isOccurrence(
  value: unknown,
  targetOrder: ReadonlyMap<string, number>,
): value is DesignPlanSemanticOccurrence {
  return (
    isOccurrenceFields(value, targetOrder) &&
    exactKeys(value, ["targetId", "nodeId"])
  );
}

function isMainOccurrence(
  value: unknown,
  targetOrder: ReadonlyMap<string, number>,
): value is DesignPlanSemanticOccurrence & { mode: "create" | "existing" } {
  return (
    isOccurrenceFields(value, targetOrder) &&
    (value.mode === "create" || value.mode === "existing") &&
    exactKeys(value, ["mode", "targetId", "nodeId"])
  );
}

function isOccurrenceFields(
  value: unknown,
  targetOrder: ReadonlyMap<string, number>,
): value is Record<string, unknown> & DesignPlanSemanticOccurrence {
  return (
    isRecord(value) &&
    safeId(value.targetId, 128) &&
    targetOrder.has(value.targetId) &&
    safeId(value.nodeId, 256)
  );
}

function candidateOccurrences(
  candidate: DesignPlanComponentCandidate,
): DesignPlanSemanticOccurrence[] {
  if (candidate.decision === "ordinary") return candidate.occurrences;
  if (candidate.decision === "reuse-component") return candidate.instances;
  return [candidate.main, ...candidate.instances];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(
  value: unknown,
  minLength: number,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minLength &&
    value.length <= maxLength
  );
}

function safeId(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  );
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
