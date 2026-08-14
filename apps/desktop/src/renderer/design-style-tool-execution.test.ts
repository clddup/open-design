import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { executeDesignStyleTool } from "./design-style-tool-execution";
import { createScopedStyleInspection } from "./design-style-inspection";

describe("Styles Agent execution", () => {
  it("previews and applies one atomic style revision using inspected node properties", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const document = runtime.getSnapshot().document;
    const response = executeDesignStyleTool({
      document,
      input: {
        action: "create-from-node",
        label: "Create brand style",
        pageId: "page_welcome",
        nodeId: "title_welcome",
        field: "fillStyleId",
        styleId: "brand-primary",
        key: "brand-primary-key",
        name: "Brand/Primary",
      },
      requestId: "request",
      runtime,
      sessionId: "session",
      toolCallId: "call",
      throwTransactionFailure(error) {
        throw new Error(error.message);
      },
    });
    expect(response).toMatchObject({
      ok: true,
      result: {
        observedRevision: 1,
        content: {
          kind: "style-operation-result",
          action: "create-from-node",
          styleId: "brand-primary",
          atomic: true,
        },
      },
    });
    expect(runtime.getSnapshot().document).toMatchObject({
      stylesById: {
        "brand-primary": { styleType: "PAINT", name: "Brand/Primary" },
      },
      nodesById: { title_welcome: { fillStyleId: "brand-primary" } },
    });
    const inspection = createScopedStyleInspection(
      runtime.getSnapshot().document,
      new Set(["title_welcome"]),
    );
    expect(inspection).toMatchObject({
      styleConsumersById: {
        "brand-primary": [{ nodeId: "title_welcome", field: "fillStyleId" }],
      },
      designSystemIds: { styles: ["brand-primary"] },
    });
  });
});
