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
  it("continues to executable planning without inferring Page creation", () => {
    const scope: DesignDeliveryScope = {
      version: 1,
      deliverable: "ui",
      objective: "Design the complete 24-screen product suite",
      targets: Array.from({ length: 24 }, (_, index) => ({
        targetId: `screen-${index + 1}`,
        label: `Screen ${index + 1}`,
        objective: `Design complete product screen ${index + 1}`,
        requiredContent: [`Screen ${index + 1} content`],
      })),
      exclusions: [],
      assumptions: [],
    };
    const coordinator = {
      recordDeliveryScopeReviewed: vi.fn(() => scope),
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
        status: "confirmed",
        nextAction: "define-executable-plan",
      },
    });
  });
});
