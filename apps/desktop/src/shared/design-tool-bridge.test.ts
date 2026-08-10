import { describe, expect, it } from "vitest";
import { INTERNAL_UPDATE_IMAGE_TOOL_NAME } from "./design-agent-tools";
import { isRendererDesignToolRequest } from "./design-tool-bridge";

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
});
