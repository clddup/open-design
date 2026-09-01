import type { ToolCallRequest } from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import { handleDesignPlanUpdateTool } from "./design-plan-update-tool-handler.js";

const context = {
  runId: "run_plan",
  sessionId: "conversation_1",
  documentId: "document_1",
  revision: 3,
  scope: { kind: "page" as const, pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page" as const, pageId: "page_1" },
};

function call(input: unknown): ToolCallRequest {
  return {
    toolCallId: "update_plan_1",
    toolName: "opendesign_update_plan",
    input,
  };
}

describe("handleDesignPlanUpdateTool", () => {
  it("returns the Main-owned execution ledger after completing the active step", () => {
    const delivery = {
      version: 4 as const,
      targets: [],
      activeTargetId: "target_home",
      planExecution: { planRevision: 2, targets: [] },
    };
    const deliveryStage = { plannedTargets: 1 };
    const coordinator = {
      updateDesignPlan: vi.fn().mockReturnValue(delivery),
      getDeliveryStageContext: vi.fn().mockReturnValue(deliveryStage),
    };

    expect(
      handleDesignPlanUpdateTool(
        coordinator as never,
        call({
          planRevision: 2,
          targetId: "target_home",
          completeStepId: "build_content",
        }),
        context,
      ),
    ).toEqual({
      content: {
        ok: true,
        planRevision: 2,
        planExecution: delivery.planExecution,
        delivery,
        deliveryStage,
      },
    });
    expect(coordinator.updateDesignPlan).toHaveBeenCalledWith(context, {
      planRevision: 2,
      targetId: "target_home",
      completeStepId: "build_content",
    });
  });

  it("rejects malformed progress input with its exact field path", () => {
    const coordinator = {
      updateDesignPlan: vi.fn(),
      getDeliveryStageContext: vi.fn(),
    };

    expect(() =>
      handleDesignPlanUpdateTool(
        coordinator as never,
        call({ planRevision: 2, targetId: "target_home" }),
        context,
      ),
    ).toThrow(/design_plan_update\.schema_invalid at \/completeStepId/);
    expect(coordinator.updateDesignPlan).not.toHaveBeenCalled();
  });
});
