import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import { handleDesignImportExportTool } from "./design-import-export-tool-handler.js";

const context: TrustedToolContext = {
  runId: "run_import_export",
  sessionId: "conversation_import_export",
  documentId: "document_brand",
  revision: 7,
  scope: { kind: "page", pageId: "page_brand", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_brand" },
};

const svgExportInput = {
  pageId: "page_brand",
  rootNodeIds: ["logo_symbol", "logo_wordmark"],
  suggestedName: "OpenDesign Brand.svg",
  includeLayerIds: true,
  padding: 24,
};

const rasterExportInput = {
  pageId: "page_brand",
  rootNodeId: "logo_symbol",
  suggestedName: "OpenDesign Symbol.png",
  format: "png",
  size: { mode: "scale", value: 3 },
  background: { mode: "transparent" },
  resampling: "smooth",
};

const svgImportInput = {
  attachmentId: `svg_${"a".repeat(64)}`,
  pageId: "page_brand",
  parentId: "frame_brand",
  index: 2,
  x: 48,
  y: 72,
};

function setup(call: ToolCallRequest) {
  const exportResult: TrustedToolResult = {
    observedRevision: 7,
    content: { ok: true, saved: true },
  };
  const importResult: TrustedToolResult = {
    observedRevision: 8,
    designRevision: {
      previousRevision: 7,
      revision: 8,
      transactionId: "import_svg",
    },
    content: {
      ok: true,
      importedNodeIds: ["svg_root", "", 3, "svg_path"],
    },
  };
  const svgExportHost = { execute: vi.fn().mockResolvedValue(exportResult) };
  const rasterExportHost = { execute: vi.fn().mockResolvedValue(exportResult) };
  const svgImportHost = { execute: vi.fn().mockResolvedValue(importResult) };
  const targetIds = ["target_brand"];
  const coordinator = {
    assertDocumentInspected: vi.fn(),
    assertVisualReviewBeforeWrite: vi.fn(),
    resolveMaterialTargetIds: vi.fn(() => targetIds),
    recordMaterialDesignWriteCompleted: vi.fn(),
  };
  const deliveredResult = {
    ...importResult,
    content: {
      ok: true,
      importedNodeIds: ["svg_root", "", 3, "svg_path"],
      delivery: { targets: [] },
    },
  };
  const withDelivery = vi.fn(() => deliveredResult);
  const getSvgExportHost = vi.fn(() => svgExportHost as never);
  const getRasterExportHost = vi.fn(() => rasterExportHost as never);
  const getSvgImportHost = vi.fn(() => svgImportHost as never);

  return {
    input: {
      call,
      context,
      executionContext: context,
      signal: new AbortController().signal,
      coordinator: coordinator as never,
      getSvgExportHost,
      getRasterExportHost,
      getSvgImportHost,
      withDelivery,
    },
    coordinator,
    deliveredResult,
    exportResult,
    getRasterExportHost,
    getSvgExportHost,
    getSvgImportHost,
    importResult,
    rasterExportHost,
    svgExportHost,
    svgImportHost,
    targetIds,
    withDelivery,
  };
}

describe("Design import/export Main tool handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for another tool family without resolving services", async () => {
    const state = setup({
      toolCallId: "inspect",
      toolName: "opendesign_inspect_document",
      input: {},
    });

    await expect(handleDesignImportExportTool(state.input)).resolves.toBeNull();

    expect(state.coordinator.assertDocumentInspected).not.toHaveBeenCalled();
    expect(state.getSvgExportHost).not.toHaveBeenCalled();
    expect(state.getRasterExportHost).not.toHaveBeenCalled();
    expect(state.getSvgImportHost).not.toHaveBeenCalled();
  });

  it("rejects malformed SVG export before inspection or native save", async () => {
    const state = setup({
      toolCallId: "export_svg_invalid",
      toolName: EXPORT_SVG_TOOL_NAME,
      input: { ...svgExportInput, suggestedName: "../brand.svg" },
    });

    await expect(handleDesignImportExportTool(state.input)).rejects.toThrow(
      /SVG export.*\/suggestedName/,
    );

    expect(state.coordinator.assertDocumentInspected).not.toHaveBeenCalled();
    expect(state.getSvgExportHost).not.toHaveBeenCalled();
  });

  it("exports inspected SVG through the Main save host", async () => {
    const call: ToolCallRequest = {
      toolCallId: "export_svg",
      toolName: EXPORT_SVG_TOOL_NAME,
      input: svgExportInput,
    };
    const state = setup(call);

    await expect(handleDesignImportExportTool(state.input)).resolves.toBe(
      state.exportResult,
    );

    expect(state.coordinator.assertDocumentInspected).toHaveBeenCalledWith(
      context,
    );
    expect(state.svgExportHost.execute).toHaveBeenCalledWith(
      call,
      context,
      state.input.signal,
    );
    expect(state.getRasterExportHost).not.toHaveBeenCalled();
    expect(state.getSvgImportHost).not.toHaveBeenCalled();
  });

  it("exports inspected raster through the Main save host", async () => {
    const call: ToolCallRequest = {
      toolCallId: "export_raster",
      toolName: EXPORT_RASTER_TOOL_NAME,
      input: rasterExportInput,
    };
    const state = setup(call);

    await expect(handleDesignImportExportTool(state.input)).resolves.toBe(
      state.exportResult,
    );

    expect(state.coordinator.assertDocumentInspected).toHaveBeenCalledWith(
      context,
    );
    expect(state.rasterExportHost.execute).toHaveBeenCalledWith(
      call,
      context,
      state.input.signal,
    );
    expect(state.getSvgExportHost).not.toHaveBeenCalled();
    expect(state.getSvgImportHost).not.toHaveBeenCalled();
  });

  it("records imported SVG material only after a real revision", async () => {
    const call: ToolCallRequest = {
      toolCallId: "import_svg",
      toolName: IMPORT_SVG_TOOL_NAME,
      input: svgImportInput,
    };
    const state = setup(call);

    await expect(handleDesignImportExportTool(state.input)).resolves.toBe(
      state.deliveredResult,
    );

    expect(state.coordinator.assertDocumentInspected).toHaveBeenCalledWith(
      context,
    );
    expect(
      state.coordinator.assertVisualReviewBeforeWrite,
    ).toHaveBeenCalledWith(context);
    expect(state.coordinator.resolveMaterialTargetIds).toHaveBeenCalledWith(
      context,
      [],
      "frame_brand",
    );
    expect(state.svgImportHost.execute).toHaveBeenCalledWith(
      call,
      context,
      state.input.signal,
    );
    expect(
      state.coordinator.recordMaterialDesignWriteCompleted,
    ).toHaveBeenCalledWith(context.runId, state.targetIds, 8, [
      "svg_root",
      "svg_path",
    ]);
    expect(state.withDelivery).toHaveBeenCalledWith(state.importResult);
    expect(
      state.svgImportHost.execute.mock.invocationCallOrder[0],
    ).toBeLessThan(
      state.coordinator.recordMaterialDesignWriteCompleted.mock
        .invocationCallOrder[0] ?? 0,
    );
  });
});
