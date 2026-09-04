import type {
  ToolCallRequest,
  TrustedToolContext,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  type DesignDeliveryScope,
} from "@/shared/design-agent-tools.js";
import { handleDeliveryScopeTool } from "./delivery-scope-tool-handler.js";

const context: TrustedToolContext = {
  runId: "run_scope",
  sessionId: "conversation_scope",
  documentId: "document_scope",
  revision: 0,
  scope: { kind: "page", pageId: "page_current", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_current" },
};

describe("handleDeliveryScopeTool", () => {
  it("records every target without writing empty Frames to the document", () => {
    const scope: DesignDeliveryScope = {
      version: 1,
      deliverable: "ui",
      objective: "Design the complete 24-screen product suite",
      targets: Array.from({ length: 24 }, (_, index) => ({
        targetId: `screen-${index + 1}`,
        label: `Screen ${index + 1}`,
        objective: `Design complete product screen ${index + 1}`,
        artboard: { width: 1440, height: 900 },
        requiredContent: [`Screen ${index + 1} content`],
      })),
      exclusions: [],
      assumptions: [],
    };
    const reservation = {
      artboards: scope.targets.map((target, index) => ({
        targetId: target.targetId,
        label: target.label,
        pageId: "page_current",
        frameId: `run_scope_scope_${index + 1}`,
        x: index * 1600,
        y: 0,
        width: target.artboard.width,
        height: target.artboard.height,
      })),
    };
    const coordinator = {
      createDeliveryScopeReservation: vi.fn(() => reservation),
      recordDeliveryScopeCompleted: vi.fn(() => ({
        scope,
        artboards: reservation.artboards,
      })),
      getDeliveryLedger: vi.fn(() => ({ targets: reservation.artboards })),
      getDeliveryStageContext: vi.fn(() => ({
        totalTargets: 24,
        plannedTargets: 0,
        verifiedTargets: 0,
      })),
    };
    const call: ToolCallRequest = {
      toolCallId: "scope_call",
      toolName: DESIGN_DELIVERY_SCOPE_TOOL_NAME,
      input: scope,
    };

    expect(
      handleDeliveryScopeTool(coordinator as never, call, context),
    ).toMatchObject({
      content: {
        ok: true,
        status: "recorded",
        nextAction: "generate-first-target",
      },
    });
    expect(coordinator.createDeliveryScopeReservation).toHaveBeenCalledOnce();
    expect(coordinator.recordDeliveryScopeCompleted).toHaveBeenCalledWith(
      context,
      scope,
      reservation,
    );
  });
});
