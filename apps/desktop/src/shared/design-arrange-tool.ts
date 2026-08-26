import type { AutoLayout, LayoutLimits } from "@opendesign/design-contracts";
import { DESIGN_ARRANGE_TOOL_INPUT_SCHEMA } from "./design-arrange-tool-schema";
import type { DesignArrangeToolInput } from "./design-arrange-tool-types";
import { defineContract, type ValidationIssue } from "./contract-validation";

export {
  DESIGN_ARRANGE_ACTIONS,
  DESIGN_ARRANGE_TOOL_INPUT_SCHEMA,
} from "./design-arrange-tool-schema";
export type { DesignArrangeToolInput } from "./design-arrange-tool-types";

export const DesignArrangeContract = defineContract<DesignArrangeToolInput>({
  schema: DESIGN_ARRANGE_TOOL_INPUT_SCHEMA,
  code: "design_arrange.schema_invalid",
  subject: "Arrange",
  maximum: 32,
  refine: refineDesignArrange,
});

function refineDesignArrange(input: DesignArrangeToolInput): ValidationIssue[] {
  if (input.action === "set-auto-layout") {
    return refineAutoLayout(input.autoLayout);
  }
  if (input.action === "set-layout-limits" && input.limits !== null) {
    return refineLayoutLimits(input.limits);
  }
  if (input.action === "set-layout-guides") {
    const issues: ValidationIssue[] = [];
    const seenIds = new Set<string>();
    input.layoutGuides.forEach((guide, index) => {
      if (seenIds.has(guide.id)) {
        issues.push({
          code: "design_arrange.layout_guide_id_duplicated",
          path: `/layoutGuides/${index}/id`,
          message: "Each Layout Guide ID must be unique within the Frame",
          actual: guide.id,
          recovery:
            "Keep one guide per stable ID or assign a distinct ID to the duplicated guide.",
        });
      }
      seenIds.add(guide.id);
    });
    return issues;
  }
  return [];
}

function refineAutoLayout(autoLayout: AutoLayout): ValidationIssue[] {
  if (
    autoLayout.mode !== "grid" ||
    autoLayout.autoTracks === undefined ||
    autoLayout.itemsPositioning === "row-auto-flow"
  ) {
    return [];
  }
  return [
    {
      code: "design_arrange.grid_auto_tracks_requires_auto_flow",
      path: "/autoLayout/autoTracks",
      message: "Grid autoTracks requires row-auto-flow item positioning",
      expected: "row-auto-flow",
      actual: autoLayout.itemsPositioning,
      recovery:
        "Set itemsPositioning to row-auto-flow or remove autoTracks for a manual Grid.",
    },
  ];
}

function refineLayoutLimits(limits: LayoutLimits): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (
    limits.minWidth !== undefined &&
    limits.maxWidth !== undefined &&
    limits.minWidth > limits.maxWidth
  ) {
    issues.push({
      code: "design_arrange.layout_limits_inverted",
      path: "/limits/maxWidth",
      message: "maxWidth must be greater than or equal to minWidth",
      expected: { minimum: limits.minWidth },
      actual: limits.maxWidth,
      recovery: "Increase maxWidth or lower minWidth before retrying.",
    });
  }
  if (
    limits.minHeight !== undefined &&
    limits.maxHeight !== undefined &&
    limits.minHeight > limits.maxHeight
  ) {
    issues.push({
      code: "design_arrange.layout_limits_inverted",
      path: "/limits/maxHeight",
      message: "maxHeight must be greater than or equal to minHeight",
      expected: { minimum: limits.minHeight },
      actual: limits.maxHeight,
      recovery: "Increase maxHeight or lower minHeight before retrying.",
    });
  }
  return issues;
}
