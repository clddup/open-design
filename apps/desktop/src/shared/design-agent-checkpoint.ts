import {
  normalizeDesignApplyToolInput,
  type DesignApplyToolInput,
} from "./design-apply-input";
import { DESIGN_APPLY_TOOL_INPUT_SCHEMA } from "./design-agent-operation-schemas";
import {
  DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA,
  isDesignVisualReviewToolInput,
  type DesignVisualReviewToolInput,
} from "./design-agent-plan-review";
import { exactKeys, isRecord } from "./design-agent-validation";

export type DesignCheckpointToolInput =
  | {
      version: 1;
      action: "apply-and-capture";
      apply: DesignApplyToolInput;
    }
  | {
      version: 1;
      action: "review-refine-and-capture";
      review: DesignVisualReviewToolInput;
      refinement: DesignApplyToolInput;
    };

export const DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA = {
  type: "object",
  description:
    "A host-conditional design checkpoint. apply-and-capture commits one material transaction and captures only its successful revision. review-refine-and-capture first accepts the structured review, then commits its refinement, then captures only the successful refined revision.",
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
        action: { const: "review-refine-and-capture" },
        review: DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA,
        refinement: DESIGN_APPLY_TOOL_INPUT_SCHEMA,
      },
      required: ["version", "action", "review", "refinement"],
      additionalProperties: false,
    },
  ],
  additionalProperties: false,
} as const;

export function isDesignCheckpointToolInput(
  input: unknown,
): input is DesignCheckpointToolInput {
  if (
    !isRecord(input) ||
    input.version !== 1 ||
    (input.action !== "apply-and-capture" &&
      input.action !== "review-refine-and-capture")
  ) {
    return false;
  }
  if (input.action === "apply-and-capture") {
    return (
      normalizeDesignApplyToolInput(input.apply) !== undefined &&
      exactKeys(input, ["version", "action", "apply"])
    );
  }
  return (
    isDesignVisualReviewToolInput(input.review) &&
    normalizeDesignApplyToolInput(input.refinement) !== undefined &&
    exactKeys(input, ["version", "action", "review", "refinement"])
  );
}
