import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERNAL_DESIGN_COMPONENT_TOOL_NAME as DESIGN_COMPONENT_TOOL_NAME,
  type DesignComponentToolInput,
} from "@/shared/design-agent-tools.js";
import { handleCanonicalDesignComponentTool } from "./design-component-tool-handler.js";

const context: TrustedToolContext = {
  runId: "run_component",
  sessionId: "conversation_component",
  documentId: "document_component",
  revision: 8,
  scope: { kind: "page", pageId: "page_ui", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_ui" },
};

function setup(call: ToolCallRequest) {
  const result: TrustedToolResult = {
    observedRevision: 9,
    designRevision: {
      previousRevision: 8,
      revision: 9,
      transactionId: "component_change",
    },
    content: { ok: true },
  };
  const delivered = {
    ...result,
    content: { ok: true, delivery: { targets: [] } },
  };
  const targetIds = ["target_ui"];
  const coordinator = {
    assertComponentToolAccess: vi.fn(),
    assertDocumentInspected: vi.fn(),
    assertVisualReviewBeforeWrite: vi.fn(),
    resolveMaterialTargetIdsIfPlanned: vi.fn(() => targetIds),
    recordMaterialDesignWriteCompleted: vi.fn(),
  };
  const execute = vi.fn().mockResolvedValue(result);
  const withDelivery = vi.fn(() => delivered);
  return {
    coordinator,
    delivered,
    execute,
    input: {
      call,
      context,
      coordinator: coordinator as never,
      execute,
      withDelivery,
    },
    result,
    targetIds,
    withDelivery,
  };
}

describe("Design Component Main tool handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes non-material Component metadata without visual-review delivery", async () => {
    const call: ToolCallRequest = {
      toolCallId: "create_component",
      toolName: DESIGN_COMPONENT_TOOL_NAME,
      input: {
        action: "create-component",
        label: "Promote Button Main",
        pageId: "page_ui",
        rootNodeId: "button_main",
        componentId: "component_button",
        name: "Button",
      },
    };
    const state = setup(call);

    await expect(
      handleCanonicalDesignComponentTool(
        state.input,
        call.input as DesignComponentToolInput,
      ),
    ).resolves.toBe(state.result);
    expect(state.coordinator.assertComponentToolAccess).toHaveBeenCalledWith(
      context,
      call.input,
    );
    expect(state.coordinator.assertDocumentInspected).toHaveBeenCalledWith(
      context,
    );
    expect(
      state.coordinator.assertVisualReviewBeforeWrite,
    ).not.toHaveBeenCalled();
    expect(
      state.coordinator.resolveMaterialTargetIdsIfPlanned,
    ).not.toHaveBeenCalled();
    expect(state.withDelivery).not.toHaveBeenCalled();
  });

  it("records a material Instance creation and attaches delivery", async () => {
    const call: ToolCallRequest = {
      toolCallId: "create_instance",
      toolName: DESIGN_COMPONENT_TOOL_NAME,
      input: {
        action: "create-instance",
        label: "Place Button Instance",
        pageId: "page_ui",
        componentId: "component_button",
        instanceId: "button_instance",
        parentId: "screen_frame",
        index: 2,
        x: 48,
        y: 320,
        name: "Primary action",
      },
    };
    const state = setup(call);

    await expect(
      handleCanonicalDesignComponentTool(
        state.input,
        call.input as DesignComponentToolInput,
      ),
    ).resolves.toBe(state.delivered);
    expect(
      state.coordinator.assertVisualReviewBeforeWrite,
    ).toHaveBeenCalledWith(context);
    expect(
      state.coordinator.resolveMaterialTargetIdsIfPlanned,
    ).toHaveBeenCalledWith(context, [], "screen_frame");
    expect(
      state.coordinator.recordMaterialDesignWriteCompleted,
    ).toHaveBeenCalledWith(context.runId, state.targetIds, 9, [
      "button_instance",
    ]);
    expect(state.withDelivery).toHaveBeenCalledWith(
      state.result,
      context.runId,
    );
  });

  it("treats a name-only Instance override as non-material", async () => {
    const call: ToolCallRequest = {
      toolCallId: "rename_instance",
      toolName: DESIGN_COMPONENT_TOOL_NAME,
      input: {
        action: "set-override",
        label: "Rename Button Instance",
        pageId: "page_ui",
        instanceId: "button_instance",
        sourcePath: ["button_main"],
        patch: { name: "Primary action" },
      },
    };
    const state = setup(call);

    await handleCanonicalDesignComponentTool(
      state.input,
      call.input as DesignComponentToolInput,
    );

    expect(
      state.coordinator.assertVisualReviewBeforeWrite,
    ).not.toHaveBeenCalled();
    expect(
      state.coordinator.recordMaterialDesignWriteCompleted,
    ).not.toHaveBeenCalled();
    expect(state.withDelivery).not.toHaveBeenCalled();
  });
});
