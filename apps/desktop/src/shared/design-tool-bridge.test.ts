import { describe, expect, it } from "vitest";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
} from "./design-agent-tools";
import {
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
        call: {
          toolCallId: "inspect_1",
          toolName: "opendesign_inspect_document",
          input: {},
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
