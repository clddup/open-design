import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESIGN_PAGE_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import {
  designPageToolPreauthorization,
  handleDesignPageTool,
} from "./design-page-tool-handler.js";

const context: TrustedToolContext = {
  runId: "run_page",
  sessionId: "conversation_page",
  documentId: "document_page",
  revision: 4,
  scope: { kind: "page", pageId: "page_main", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_main" },
};

function setup(call: ToolCallRequest, result?: TrustedToolResult) {
  const coordinator = {
    assertPageToolAccess: vi.fn(),
    assertPageLifecycleInspected: vi.fn(),
    recordPageToolCompleted: vi.fn(),
    supersedeDesignDeliveryForClearedPage: vi.fn(),
    hasPageStructureAccess: vi.fn(() => true),
    assertDeliveryScopeReviewed: vi.fn(),
    hasPageStructureAuthorization: vi.fn(() => true),
  };
  const execute = vi.fn().mockResolvedValue(
    result ?? {
      observedRevision: 5,
      designRevision: {
        previousRevision: 4,
        revision: 5,
        transactionId: "page_change",
      },
      content: { ok: true },
    },
  );
  return {
    coordinator,
    execute,
    input: {
      call,
      context,
      coordinator: coordinator as never,
      execute,
    },
  };
}

describe("Design Page Main tool handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for another tool family without touching Page state", async () => {
    const state = setup({
      toolCallId: "inspect",
      toolName: "opendesign_inspect_document",
      input: {},
    });

    await expect(handleDesignPageTool(state.input)).resolves.toBeNull();
    expect(state.coordinator.assertPageToolAccess).not.toHaveBeenCalled();
    expect(state.execute).not.toHaveBeenCalled();
  });

  it("rejects malformed Page input before access or inspection checks", async () => {
    const state = setup({
      toolCallId: "delete_invalid",
      toolName: DESIGN_PAGE_TOOL_NAME,
      input: { action: "delete", label: "Delete Page" },
    });

    await expect(handleDesignPageTool(state.input)).rejects.toThrow(
      /Page.*\/pageId/,
    );
    expect(state.coordinator.assertPageToolAccess).not.toHaveBeenCalled();
    expect(
      state.coordinator.assertPageLifecycleInspected,
    ).not.toHaveBeenCalled();
    expect(state.execute).not.toHaveBeenCalled();
  });

  it("returns only approved Run-scoped Page structure capability", async () => {
    const call: ToolCallRequest = {
      toolCallId: "page_structure_access",
      toolName: PAGE_STRUCTURE_ACCESS_TOOL_NAME,
      input: {
        actions: ["create-page", "cross-page-edit"],
        reason: "Create and design the requested Research Page",
      },
    };
    const state = setup(call);

    await expect(handleDesignPageTool(state.input)).resolves.toEqual({
      content: {
        ok: true,
        capability: "page-structure",
        scope: "current-design-file",
        expires: "run-end",
        actions: ["create-page", "cross-page-edit"],
      },
    });
    expect(state.coordinator.hasPageStructureAccess).toHaveBeenCalledWith(
      context.runId,
    );
    expect(state.coordinator.assertDeliveryScopeReviewed).toHaveBeenCalledWith(
      context,
    );
    expect(state.execute).not.toHaveBeenCalled();
  });

  it("keeps Page structure approval identity in the Page owner", () => {
    const call: ToolCallRequest = {
      toolCallId: "page_structure_access",
      toolName: PAGE_STRUCTURE_ACCESS_TOOL_NAME,
      input: {
        actions: ["create-page"],
        reason: "Create the requested Page",
      },
    };
    const state = setup(call);

    expect(
      designPageToolPreauthorization(call, context, state.coordinator as never),
    ).toBe(true);
    expect(
      state.coordinator.hasPageStructureAuthorization,
    ).toHaveBeenCalledWith(context.runId, call.toolCallId, ["create-page"]);
    expect(
      designPageToolPreauthorization(
        { ...call, input: { actions: [], reason: "Missing actions" } },
        context,
        state.coordinator as never,
      ),
    ).toBe(true);
    expect(
      designPageToolPreauthorization(
        {
          toolCallId: "inspect",
          toolName: "opendesign_inspect_document",
          input: {},
        },
        context,
        state.coordinator as never,
      ),
    ).toBeNull();
  });

  it("executes an authorized Page rename and records its revision", async () => {
    const call: ToolCallRequest = {
      toolCallId: "rename_page",
      toolName: DESIGN_PAGE_TOOL_NAME,
      input: {
        action: "rename",
        label: "Rename Main Page",
        pageId: "page_main",
        name: "Main",
      },
    };
    const state = setup(call);
    const result = await handleDesignPageTool(state.input);

    expect(state.coordinator.assertPageToolAccess).toHaveBeenCalledWith(
      context,
      call.input,
    );
    expect(state.coordinator.assertPageLifecycleInspected).toHaveBeenCalledWith(
      context,
    );
    expect(state.execute).toHaveBeenCalledWith(call);
    expect(state.coordinator.recordPageToolCompleted).toHaveBeenCalledWith(
      context.runId,
      "rename",
    );
    expect(result).toMatchObject({ designRevision: { revision: 5 } });
  });

  it("supersedes cleared Page delivery even when clear is a zero-revision result", async () => {
    const call: ToolCallRequest = {
      toolCallId: "clear_page",
      toolName: DESIGN_PAGE_TOOL_NAME,
      input: {
        action: "clear",
        label: "Clear Main Page",
        pageId: "page_main",
      },
    };
    const result: TrustedToolResult = {
      observedRevision: 4,
      content: { ok: true, changed: false },
    };
    const state = setup(call, result);

    await expect(handleDesignPageTool(state.input)).resolves.toEqual({
      ...result,
      content: {
        ok: true,
        changed: false,
        deliveryDisposition: "superseded",
      },
    });
    expect(state.coordinator.recordPageToolCompleted).toHaveBeenCalledWith(
      context.runId,
      "clear",
    );
    expect(
      state.coordinator.supersedeDesignDeliveryForClearedPage,
    ).toHaveBeenCalledWith(context, "page_main");
  });

  it("rejects an unstructured Page clear result", async () => {
    const state = setup(
      {
        toolCallId: "clear_page_invalid_result",
        toolName: DESIGN_PAGE_TOOL_NAME,
        input: {
          action: "clear",
          label: "Clear Main Page",
          pageId: "page_main",
        },
      },
      { observedRevision: 5, content: "cleared" },
    );

    await expect(handleDesignPageTool(state.input)).rejects.toThrow(
      "Page clear result must be structured",
    );
  });
});
