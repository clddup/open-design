import { describe, expect, it } from "vitest";
import type { DesignApplyToolInput } from "@/shared/design-agent-tools.js";
import {
  assertApplyPlanSteps,
  bindApplyToActivePlanSteps,
} from "./design-plan-apply-execution.js";
import type { DesignWorkflowState } from "./design-plan-registration.js";

type PlanExecutionState = Pick<
  DesignWorkflowState,
  "planExecution" | "targetsById"
>;

function executionState(): PlanExecutionState {
  return {
    planExecution: {
      planRevision: 1,
      targets: [
        {
          targetId: "target_a",
          steps: [
            {
              stepId: "structure",
              label: "Build structure",
              kind: "implementation",
              status: "in_progress",
            },
            {
              stepId: "content",
              label: "Build content",
              kind: "implementation",
              status: "pending",
            },
            {
              stepId: "target_a.review-refine",
              label: "Review and refine",
              kind: "review-refine",
              status: "pending",
            },
          ],
        },
        {
          targetId: "target_b",
          steps: [
            {
              stepId: "details",
              label: "Build details",
              kind: "implementation",
              status: "pending",
            },
            {
              stepId: "target_b.review-refine",
              label: "Review and refine",
              kind: "review-refine",
              status: "pending",
            },
          ],
        },
      ],
    },
    targetsById: new Map(),
  };
}

function applyInput(stepIds: readonly string[]): DesignApplyToolInput {
  return {
    label: "Apply design",
    commands: [],
    steps: stepIds.map((stepId, index) => ({
      stepId,
      label: `Model step ${index + 1}`,
      commandIds: [`command_${index + 1}`],
    })),
  };
}

describe("design Plan Apply execution", () => {
  it("consolidates invented model steps into the current authoritative implementation step", () => {
    const state = executionState();
    const input = applyInput(["invented_structure", "invented_content"]);
    input.commands = [
      { commandId: "command_1", type: "delete_element", nodeId: "node_1" },
      { commandId: "command_2", type: "delete_element", nodeId: "node_2" },
    ];
    const bound = bindApplyToActivePlanSteps(state, ["target_a"], input);

    expect(bound.steps).toEqual([
      {
        stepId: "structure",
        label: "Build structure",
        commandIds: ["command_1", "command_2"],
      },
    ]);
    expect(() =>
      assertApplyPlanSteps(state, ["target_a"], bound.steps),
    ).not.toThrow();
  });

  it("keeps explicitly correct consecutive implementation steps", () => {
    const state = executionState();
    const bound = bindApplyToActivePlanSteps(
      state,
      ["target_a"],
      applyInput(["structure", "content"]),
    );

    expect(bound.steps).toEqual([
      {
        stepId: "structure",
        label: "Build structure",
        commandIds: ["command_1"],
      },
      {
        stepId: "content",
        label: "Build content",
        commandIds: ["command_2"],
      },
    ]);
    expect(() =>
      assertApplyPlanSteps(state, ["target_a"], bound.steps),
    ).not.toThrow();
  });

  it("consolidates rather than advancing across a review boundary", () => {
    const state = executionState();
    const input = applyInput(["structure", "content", "review"]);
    input.commands = [
      { commandId: "command_1", type: "delete_element", nodeId: "node_1" },
      { commandId: "command_2", type: "delete_element", nodeId: "node_2" },
      { commandId: "command_3", type: "delete_element", nodeId: "node_3" },
    ];
    const bound = bindApplyToActivePlanSteps(state, ["target_a"], input);

    expect(bound.steps).toEqual([
      {
        stepId: "structure",
        label: "Build structure",
        commandIds: ["command_1", "command_2", "command_3"],
      },
    ]);
    expect(() =>
      assertApplyPlanSteps(state, ["target_a"], bound.steps),
    ).not.toThrow();
  });

  it("does not bind an implementation step to an unauthorized target", () => {
    const state = executionState();
    const bound = bindApplyToActivePlanSteps(
      state,
      ["target_b"],
      applyInput(["invented_structure"]),
    );

    expect(bound.steps?.[0]?.stepId).toBe("invented_structure");
    expect(() =>
      assertApplyPlanSteps(state, ["target_b"], bound.steps),
    ).toThrow("design_workflow.plan_step_order_invalid");
  });
});
