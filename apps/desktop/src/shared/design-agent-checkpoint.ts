import {
  normalizeDesignApplyToolInput,
  type DesignApplyToolInput,
} from "./design-apply-input";
import { DESIGN_APPLY_TOOL_INPUT_SCHEMA } from "./design-agent-operation-schemas";
import { exactKeys, isRecord } from "./design-agent-validation";

export type DesignCheckpointToolInput =
  | {
      version: 1;
      action: "apply-and-capture";
      apply: DesignApplyToolInput;
    }
  | {
      version: 1;
      action: "refine-and-capture";
      refinement: DesignApplyToolInput;
    };

export const DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA = {
  type: "object",
  description:
    "A host-conditional design checkpoint. apply-and-capture commits one material transaction and captures only its successful revision. refine-and-capture consumes the independent critic findings returned by the previous capture, commits one refinement, then captures only the successful refined revision.",
  properties: {
    version: { const: 1 },
    action: {
      enum: ["apply-and-capture", "refine-and-capture"],
    },
    apply: DESIGN_APPLY_TOOL_INPUT_SCHEMA,
    refinement: DESIGN_APPLY_TOOL_INPUT_SCHEMA,
  },
  oneOf: [
    {
      properties: {
        version: { const: 1 },
        action: { const: "apply-and-capture" },
        apply: DESIGN_APPLY_TOOL_INPUT_SCHEMA,
      },
      required: ["version", "action", "apply"],
      additionalProperties: false,
    },
    {
      properties: {
        version: { const: 1 },
        action: { const: "refine-and-capture" },
        refinement: DESIGN_APPLY_TOOL_INPUT_SCHEMA,
      },
      required: ["version", "action", "refinement"],
      additionalProperties: false,
    },
  ],
  additionalProperties: false,
} as const;

export function isDesignCheckpointToolInput(
  input: unknown,
): input is DesignCheckpointToolInput {
  return normalizeDesignCheckpointToolInput(input) !== undefined;
}

export function normalizeDesignCheckpointToolInput(
  input: unknown,
): DesignCheckpointToolInput | undefined {
  if (
    !isRecord(input) ||
    input.version !== 1 ||
    (input.action !== "apply-and-capture" &&
      input.action !== "refine-and-capture")
  ) {
    return undefined;
  }
  if (input.action === "apply-and-capture") {
    const apply = normalizeDesignApplyToolInput(input.apply);
    return apply && exactKeys(input, ["version", "action", "apply"])
      ? { version: 1, action: "apply-and-capture", apply }
      : undefined;
  }
  const refinement = normalizeDesignApplyToolInput(input.refinement);
  return refinement && exactKeys(input, ["version", "action", "refinement"])
    ? {
        version: 1,
        action: "refine-and-capture",
        refinement,
      }
    : undefined;
}
