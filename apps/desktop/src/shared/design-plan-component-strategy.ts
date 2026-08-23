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

const ID_PATTERN = "^[^\\u0000-\\u001F\\u007F]+$";
const NON_WHITESPACE_PATTERN = "\\S";

const OCCURRENCE_SCHEMA = {
  type: "object",
  properties: {
    targetId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: ID_PATTERN,
    },
    nodeId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      pattern: ID_PATTERN,
    },
  },
  required: ["targetId", "nodeId"],
  additionalProperties: false,
} as const;

export const DESIGN_PLAN_COMPONENT_STRATEGY_SCHEMA = {
  type: "object",
  description:
    "Explicit component judgment. Use reuse-component for a compatible componentId from inspection.document.componentCatalog, component when this delivery creates/owns the Main, and ordinary when linked reuse is not justified.",
  properties: {
    summary: {
      type: "string",
      minLength: 12,
      maxLength: 1_000,
      pattern: NON_WHITESPACE_PATTERN,
    },
    candidates: {
      type: "array",
      maxItems: 24,
      items: {
        anyOf: [
          {
            type: "object",
            properties: {
              decisionId: {
                type: "string",
                minLength: 1,
                maxLength: 128,
                pattern: ID_PATTERN,
              },
              label: {
                type: "string",
                minLength: 1,
                maxLength: 256,
                pattern: NON_WHITESPACE_PATTERN,
              },
              decision: { const: "reuse-component" },
              rationale: {
                type: "string",
                minLength: 12,
                maxLength: 500,
                pattern: NON_WHITESPACE_PATTERN,
              },
              componentId: {
                type: "string",
                minLength: 1,
                maxLength: 256,
                pattern: ID_PATTERN,
              },
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
              decisionId: {
                type: "string",
                minLength: 1,
                maxLength: 128,
                pattern: ID_PATTERN,
              },
              label: {
                type: "string",
                minLength: 1,
                maxLength: 256,
                pattern: NON_WHITESPACE_PATTERN,
              },
              decision: { const: "component" },
              rationale: {
                type: "string",
                minLength: 12,
                maxLength: 500,
                pattern: NON_WHITESPACE_PATTERN,
              },
              componentId: {
                type: "string",
                minLength: 1,
                maxLength: 256,
                pattern: ID_PATTERN,
              },
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
              decisionId: {
                type: "string",
                minLength: 1,
                maxLength: 128,
                pattern: ID_PATTERN,
              },
              label: {
                type: "string",
                minLength: 1,
                maxLength: 256,
                pattern: NON_WHITESPACE_PATTERN,
              },
              decision: { const: "ordinary" },
              rationale: {
                type: "string",
                minLength: 12,
                maxLength: 500,
                pattern: NON_WHITESPACE_PATTERN,
              },
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
