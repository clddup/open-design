import { isTrustedToolFailure } from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import {
  classifyDesignWorkflowFailure,
  designWorkflowClassificationFromFailureCode,
  designWorkflowError,
} from "./design-workflow-failure-classification";

describe("design workflow failure contract", () => {
  it.each([
    ["inspection_required", "inspection", "applying-draft"],
    ["material_write_required", "material-write", "applying-draft"],
    ["capture_required", "capture", "capturing-canvas"],
    [
      "component_strategy_incomplete",
      "component-repair",
      "repairing-components",
    ],
    ["plan_amendment_invalid", "plan-repair", "repairing-plan"],
    ["layout_quality_failed", "layout-repair", "repairing-layout"],
    ["revision_conflict", "inspection", "canvas-changed"],
    ["scope_conflict", "inspection", "scope-conflict"],
  ] as const)("classifies %s by stable code", (code, phase, presentation) => {
    expect(classifyDesignWorkflowFailure(code)).toMatchObject({
      code,
      phase,
      presentation,
    });
  });

  it("creates one canonical trusted failure without parsing its message", () => {
    const error = designWorkflowError(
      "target_stale",
      "The selected node was removed",
      { commandId: "replace-card" },
    );

    expect(isTrustedToolFailure(error.cause)).toBe(true);
    expect(error.cause).toMatchObject({
      code: "design_target_stale",
      recoverable: true,
      details: {
        kind: "design-workflow",
        workflowCode: "target_stale",
        phase: "inspection",
        requiresInspection: true,
        issues: [
          {
            code: "design_workflow.target_stale",
            commandId: "replace-card",
            path: "/targetSet",
            message: "The selected node was removed",
          },
        ],
      },
    });
  });

  it("looks up presentation from the stable failure code only", () => {
    expect(
      designWorkflowClassificationFromFailureCode("design_capture_required"),
    ).toMatchObject({
      code: "capture_required",
      presentation: "capturing-canvas",
    });
    expect(
      designWorkflowClassificationFromFailureCode(
        "design_workflow.capture_required: misleading message",
      ),
    ).toBeUndefined();
    expect(
      designWorkflowClassificationFromFailureCode("provider_error"),
    ).toBeUndefined();
  });
});
