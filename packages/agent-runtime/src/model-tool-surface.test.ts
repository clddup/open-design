import { describe, expect, it } from "vitest";
import type { AgentRunRequest } from "./index.js";
import { resolveInitialModelToolSurface } from "./model-tool-surface.js";

describe("initial model tool surface", () => {
  it("selects the compact surface only for an exact host-inspected blank Page creation", () => {
    expect(resolveInitialModelToolSurface(request())).toBe("new-design");
    expect(
      resolveInitialModelToolSurface(
        request({ prompt: "Inspect and refine the dashboard" }),
      ),
    ).toBe("general");
    expect(
      resolveInitialModelToolSurface(
        request({ attachments: [{ attachmentId: "image_1" } as never] }),
      ),
    ).toBe("general");
    expect(
      resolveInitialModelToolSurface(
        request({
          scope: {
            kind: "page",
            pageId: "page_1",
            selectedNodeIds: ["node_1"],
          },
        }),
      ),
    ).toBe("general");
  });

  it("lets empty host state outrank later-stage wording inside a creation brief", () => {
    expect(
      resolveInitialModelToolSurface(
        request({
          prompt:
            "设计四个真实 Logo 画板，选择最强方向继续完成，并调整小尺寸比例",
        }),
      ),
    ).toBe("new-design");
    expect(
      resolveInitialModelToolSurface(
        request({
          prompt: "继续优化当前 dashboard",
          initialDesignInspection: inspection([
            { ...emptyFrame(), childIds: ["title"] },
          ]),
        }),
      ),
    ).toBe("general");
  });

  it("accepts one empty starter Frame and allocates isolated new artboards beside existing content", () => {
    expect(
      resolveInitialModelToolSurface(
        request({ initialDesignInspection: inspection([emptyFrame()]) }),
      ),
    ).toBe("new-design");
    expect(
      resolveInitialModelToolSurface(
        request({
          initialDesignInspection: inspection([
            { ...emptyFrame(), childIds: ["title"] },
          ]),
        }),
      ),
    ).toBe("new-design");
  });
});

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: "run_1",
    sessionId: "conversation_1",
    prompt: "Create a polished dashboard",
    documentId: "document_1",
    revision: 3,
    scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
    mutationTarget: { kind: "page", pageId: "page_1" },
    modelSelection: { providerId: "provider_1", modelId: "model_1" },
    modelContext: { contextWindow: 100_000, maxOutputTokens: 8_000 },
    initialDesignInspection: inspection([]),
    ...overrides,
  };
}

function inspection(nodes: Array<{ id: string } & Record<string, unknown>>) {
  return {
    version: 1 as const,
    observedRevision: 3,
    content: JSON.stringify({
      document: {
        documentId: "document_1",
        revision: 3,
        pagesById: {
          page_1: {
            id: "page_1",
            rootNodeIds: nodes.map((node) => node.id),
          },
        },
        nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
      },
    }),
  };
}

function emptyFrame() {
  return {
    id: "starter",
    kind: "frame",
    parentId: null,
    childIds: [],
  };
}
