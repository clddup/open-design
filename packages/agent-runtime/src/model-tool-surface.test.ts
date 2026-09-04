import { describe, expect, it } from "vitest";
import type { AgentRunRequest } from "./index.js";
import {
  resolveDeliveryScopeReview,
  resolveInitialModelToolSurface,
} from "./model-tool-surface.js";

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
        request({
          attachments: [
            {
              attachmentId: `image_${"a".repeat(64)}`,
              name: "reference.png",
              mimeType: "image/png",
              byteSize: 1024,
            },
          ],
        }),
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

  it("keeps document briefs on the compact creation surface", () => {
    expect(
      resolveInitialModelToolSurface(
        request({
          attachments: [
            {
              attachmentId: `file_${"b".repeat(64)}`,
              name: "product-brief.md",
              mimeType: "text/markdown",
              byteSize: 4096,
            },
          ],
        }),
      ),
    ).toBe("new-design");
  });

  it("requires an explicit one-or-many target scope for every new composition", () => {
    expect(resolveDeliveryScopeReview(request())).toBe("required");
    expect(
      resolveDeliveryScopeReview(
        request({
          prompt: "按照附件设计完整产品",
          attachments: [
            {
              attachmentId: `file_${"b".repeat(64)}`,
              name: "完整产品需求.md",
              mimeType: "text/markdown",
              byteSize: 4096,
            },
          ],
        }),
      ),
    ).toBe("required");
    expect(
      resolveDeliveryScopeReview(
        request({
          prompt: "参考这张图创建登录页",
          attachments: [
            {
              attachmentId: `image_${"a".repeat(64)}`,
              name: "reference.png",
              mimeType: "image/png",
              byteSize: 1024,
            },
          ],
        }),
      ),
    ).toBe("required");
  });

  it("keeps existing-design edits and Page lifecycle operations direct", () => {
    const populated = inspection([{ ...emptyFrame(), childIds: ["title"] }]);
    expect(
      resolveDeliveryScopeReview(
        request({
          prompt: "继续优化当前 dashboard",
          initialDesignInspection: populated,
        }),
      ),
    ).toBe("direct");
    expect(
      resolveDeliveryScopeReview(
        request({
          prompt: "删除页面",
          initialDesignInspection: populated,
        }),
      ),
    ).toBe("direct");
  });

  it("preserves the parent scope policy for automatic continuation", () => {
    expect(
      resolveDeliveryScopeReview(
        request({
          deliveryScopeReview: "required",
          continuation: {
            parentRunId: "run_parent",
            rootRunId: "run_parent",
            attempt: 1,
            maxAttempts: 3,
            reason: "budget",
          },
        }),
      ),
    ).toBe("required");
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
          prompt:
            "创建四个真实 Logo 画板，先探索三个方向，再选择最强方向继续完成，并调整小尺寸比例",
          initialDesignInspection: inspection([
            { ...emptyFrame(), childIds: ["existing-title"] },
          ]),
        }),
      ),
    ).toBe("new-design");
    expect(
      resolveInitialModelToolSurface(
        request({
          prompt: "继续优化当前 dashboard",
          initialDesignInspection: inspection([
            { ...emptyFrame(), childIds: ["existing-title"] },
          ]),
        }),
      ),
    ).toBe("general");
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

function inspection(
  nodes: Array<
    { id: string; kind: string; childIds: string[] } & Record<string, unknown>
  >,
) {
  return {
    version: 1 as const,
    observedRevision: 3,
    content: {
      inspection: {
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
      },
    },
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
