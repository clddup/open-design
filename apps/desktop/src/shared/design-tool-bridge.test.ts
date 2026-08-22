import { describe, expect, it } from "vitest";
import {
  isDesignToolBridgeProgress,
  isTrustedToolFailure,
} from "@opendesign/agent-contracts";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
} from "./design-agent-tools";
import {
  isRendererDesignToolProgress,
  isRendererDesignToolRequest,
  isRendererDesignToolResponse,
} from "./design-tool-bridge";

const context = {
  runId: "run_1",
  sessionId: "conversation_1",
  documentId: "document_1",
  revision: 4,
  scope: {
    kind: "selection" as const,
    pageId: "page_1",
    selectedNodeIds: ["unrelated_selection"],
    primaryNodeId: "unrelated_selection",
  },
  mutationTarget: { kind: "page" as const, pageId: "page_1" },
};

describe("Renderer design tool bridge", () => {
  it("accepts only bounded correlated semantic-step progress", () => {
    expect(
      isRendererDesignToolProgress({
        requestId: "renderer_apply_1",
        phase: "applying",
        progress: 0.5,
        message: "设计步骤：导航 · r1",
      }),
    ).toBe(true);
    expect(
      isDesignToolBridgeProgress({
        type: "design-tool.progress",
        requestId: "tool_1",
        message: "设计步骤：导航 · r1",
        progress: 0.5,
      }),
    ).toBe(true);
    expect(
      isDesignToolBridgeProgress({
        type: "design-tool.progress",
        requestId: "tool_1",
        message: "x".repeat(2_001),
        progress: 0.5,
      }),
    ).toBe(false);
  });

  it("accepts bounded raster preparation bytes only for the typed export tool", () => {
    const request = {
      requestId: "renderer_raster_export",
      call: {
        toolCallId: "export_raster_1",
        toolName: EXPORT_RASTER_TOOL_NAME,
        input: {
          pageId: "page_1",
          rootNodeId: "frame_1",
          suggestedName: "Poster",
          format: "png",
          size: { mode: "scale", value: 2 },
          background: { mode: "transparent" },
          resampling: "smooth",
        },
      },
      context,
    };
    expect(isRendererDesignToolRequest(request)).toBe(true);
    expect(
      isRendererDesignToolResponse({
        requestId: request.requestId,
        ok: true,
        result: {
          observedRevision: 4,
          content: {
            kind: "raster-export-preparation",
            version: 1,
            suggestedName: "Poster",
            format: "png",
            mimeType: "image/png",
            bytes: new Uint8Array([1, 2, 3]),
            width: 1600,
            height: 1200,
            revision: 4,
            rootNodeId: "frame_1",
          },
        },
      }),
    ).toBe(true);
    expect(
      isRendererDesignToolRequest({
        ...request,
        call: {
          ...request.call,
          input: { ...request.call.input, filePath: "/tmp/poster.png" },
        },
      }),
    ).toBe(false);
  });

  it("requires a Main-selected Page or Frame target for canvas capture", () => {
    const request = {
      requestId: "renderer_capture_1",
      call: {
        toolCallId: "capture_1",
        toolName: DESIGN_CAPTURE_TOOL_NAME,
        input: {},
      },
      context,
      captureTarget: {
        kind: "frame" as const,
        pageId: "page_1",
        nodeId: "frame_1",
        qualityProfile: { kind: "graphic" as const },
      },
    };

    expect(isRendererDesignToolRequest(request)).toBe(true);
    expect(
      isRendererDesignToolRequest({ ...request, captureTarget: undefined }),
    ).toBe(false);
    expect(
      isRendererDesignToolRequest({
        ...request,
        captureTarget: { ...request.captureTarget, filePath: "C:\\draft" },
      }),
    ).toBe(false);
    expect(
      isRendererDesignToolRequest({
        ...request,
        captureTarget: {
          ...request.captureTarget,
          qualityProfile: {
            kind: "ui",
            platform: "ios",
            interactionMode: "touch",
            safeAreaInsets: { top: 10_001, right: 0, bottom: 0, left: 0 },
            safeAreaNodeIds: [],
            interactiveNodeIds: [],
          },
        },
      }),
    ).toBe(false);
    expect(
      isRendererDesignToolRequest({
        ...request,
        call: {
          toolCallId: "inspect_1",
          toolName: "opendesign_inspect_document",
          input: {},
        },
      }),
    ).toBe(false);
    const rebasedResult = {
      requestId: request.requestId,
      ok: true as const,
      result: {
        content: { ok: true },
        designRevision: {
          previousRevision: 6,
          rebasedFromRevision: 4,
          revision: 7,
          transactionId: "transaction_rebased",
        },
      },
    };
    expect(isRendererDesignToolResponse(rebasedResult)).toBe(true);
    expect(
      isRendererDesignToolResponse({
        ...rebasedResult,
        performance: {
          canvasWaitCount: 3,
          canvasWaitMs: 348,
          configuredStageDelayMs: 300,
        },
      }),
    ).toBe(true);
    expect(
      isRendererDesignToolResponse({
        ...rebasedResult,
        performance: {
          canvasWaitCount: 3,
          canvasWaitMs: -1,
          configuredStageDelayMs: 300,
        },
      }),
    ).toBe(false);
    expect(
      isRendererDesignToolResponse({ ...rebasedResult, filePath: "/tmp/x" }),
    ).toBe(false);
    expect(
      isRendererDesignToolResponse({
        ...rebasedResult,
        result: {
          ...rebasedResult.result,
          designRevision: {
            ...rebasedResult.result.designRevision,
            rebasedFromRevision: 6,
          },
        },
      }),
    ).toBe(false);
  });

  it("accepts a bounded internal Image update with an explicit node target", () => {
    const request = {
      requestId: "renderer_request_1",
      call: {
        toolCallId: "update_image_1",
        toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
        input: {
          action: "replace-source",
          label: "Replace the hero source",
          pageId: "page_1",
          nodeId: "hero_image",
          asset: {
            id: `asset_${"a".repeat(64)}`,
            kind: "image",
            name: "Hero.webp",
            mimeType: "image/webp",
            source: { type: "data", value: "aW1hZ2U=" },
            size: { width: 1600, height: 900 },
            extensions: {},
          },
        },
      },
      context,
    };

    expect(isRendererDesignToolRequest(request)).toBe(true);
    expect(
      isRendererDesignToolRequest({
        ...request,
        call: {
          ...request.call,
          input: {
            ...request.call.input,
            nodeId: undefined,
            selectionNodeId: "unrelated_selection",
          },
        },
      }),
    ).toBe(false);
    expect(
      isRendererDesignToolRequest({
        ...request,
        call: {
          ...request.call,
          input: {
            ...request.call.input,
            asset: {
              ...request.call.input.asset,
              source: { type: "external", value: "C:\\Users\\me\\hero.webp" },
            },
          },
        },
      }),
    ).toBe(false);
  });

  it("accepts a bounded prepared image-edit source without applying the generic JSON limit", () => {
    const assetId = `asset_${"a".repeat(64)}`;
    expect(
      isRendererDesignToolResponse({
        requestId: "prepared_image_edit_1",
        ok: true,
        result: {
          observedRevision: 4,
          content: {
            kind: "prepared-image-edit-source",
            pageId: "page_1",
            nodeId: "hero_image",
            expectedAssetId: assetId,
            placement: { mode: "fit" },
            targetSize: { width: 800, height: 450 },
            asset: {
              id: assetId,
              kind: "image",
              name: "Hero.png",
              mimeType: "image/png",
              source: { type: "data", value: "A".repeat(4_000_004) },
              size: { width: 1600, height: 900 },
              extensions: {},
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("accepts SVG source only on the bounded Main-to-Renderer import call", () => {
    const request = {
      requestId: "renderer_svg_import",
      call: {
        toolCallId: "import_svg_1",
        toolName: INTERNAL_IMPORT_SVG_TOOL_NAME,
        input: {
          attachmentId: `svg_${"b".repeat(64)}`,
          pageId: "page_1",
          parentId: null,
          index: 1,
          x: 120,
          y: 80,
          name: "Brand.svg",
          svg: '<svg viewBox="0 0 20 20" />',
          idPrefix: "agent_svg_deadbeef",
        },
      },
      context,
    };

    expect(isRendererDesignToolRequest(request)).toBe(true);
    expect(
      isRendererDesignToolRequest({
        ...request,
        call: {
          ...request.call,
          input: {
            ...request.call.input,
            filePath: "C:\\Users\\designer\\Brand.svg",
          },
        },
      }),
    ).toBe(false);
  });

  it("accepts only bounded Main-issued planned rebase guards", () => {
    const request = {
      requestId: "renderer_planned_rebase",
      call: {
        toolCallId: "planned_rebase_1",
        toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
        input: {
          label: "Continue translated target",
          rebaseGuard: {
            fromRevision: 4,
            targets: [
              {
                frameId: "frame_1",
                pageId: "page_1",
                width: 1440,
                height: 960,
              },
            ],
          },
          commands: [
            {
              commandId: "update_title",
              type: "update_properties",
              nodeId: "title_1",
              name: "Updated title",
            },
          ],
        },
      },
      context,
    };

    expect(isRendererDesignToolRequest(request)).toBe(true);
    expect(
      isRendererDesignToolRequest({
        ...request,
        call: {
          ...request.call,
          input: {
            ...request.call.input,
            rebaseGuard: {
              ...request.call.input.rebaseGuard,
              targets: [
                {
                  ...request.call.input.rebaseGuard.targets[0],
                  filePath: "C:\\private\\draft",
                },
              ],
            },
          },
        },
      }),
    ).toBe(false);
  });

  it("accepts only bounded structured transaction failures", () => {
    const failure = {
      requestId: "renderer_failure_1",
      ok: false as const,
      error: {
        code: "design.invalid",
        message: "Transaction would violate document invariants",
        retryable: false,
        recoverable: true,
        details: {
          kind: "design-transaction" as const,
          fingerprint: "design_deadbeef",
          issues: [
            {
              commandId: "update_card",
              nodeId: "card_1",
              path: "/nodesById/card_1/properties",
              message: "Expected union value",
            },
          ],
          recovery: {
            action: "inspect-and-revise" as const,
            toolName: "opendesign_inspect_document" as const,
            required: true as const,
          },
        },
      },
    };

    expect(isRendererDesignToolResponse(failure)).toBe(true);
    expect(
      isTrustedToolFailure({
        code: "renderer_circuit_open",
        message: "Canvas renderer repeatedly stalled",
        retryable: false,
        recoverable: false,
        runTerminal: true,
      }),
    ).toBe(true);
    expect(
      isTrustedToolFailure({
        code: "renderer_circuit_open",
        message: "Canvas renderer repeatedly stalled",
        retryable: false,
        recoverable: false,
        runTerminal: false,
      }),
    ).toBe(false);
    expect(
      isTrustedToolFailure({
        code: "renderer_circuit_open",
        message: "Canvas renderer repeatedly stalled",
        retryable: false,
        recoverable: false,
        runTerminal: true,
        restartCommand: "open /Applications/OpenDesign.app",
      }),
    ).toBe(false);
    expect(
      isRendererDesignToolResponse({
        ...failure,
        error: { ...failure.error, filePath: "C:\\private\\draft" },
      }),
    ).toBe(false);
    expect(
      isRendererDesignToolResponse({
        ...failure,
        error: {
          ...failure.error,
          details: {
            ...failure.error.details,
            issues: [{ ...failure.error.details.issues[0], prompt: "hidden" }],
          },
        },
      }),
    ).toBe(false);
  });
});
