import {
  EditorRuntime,
  createWelcomeDocument,
} from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { isTool } from "./editor";

describe("renderer editor state boundary", () => {
  it("keeps document, selection, tools, zoom, and history in EditorRuntime", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["title_welcome"], "title_welcome");
    runtime.setTool("rectangle");
    runtime.setViewport({ zoom: 2 });
    const result = runtime.apply({
      transactionId: "transaction_renderer_test",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "user", id: "local-user" },
      commands: [
        {
          commandId: "hide_accent",
          type: "update_properties",
          nodeId: "shape_accent",
          visible: false,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({
      document: {
        revision: 1,
        nodesById: { shape_accent: { visible: false } },
      },
      state: {
        selection: {
          nodeIds: ["title_welcome"],
          anchorNodeId: "title_welcome",
        },
        tool: "rectangle",
        viewport: { zoom: 2 },
        dirty: true,
        history: { canUndo: true, canRedo: false },
      },
    });
  });

  it("accepts only the tools implemented by the owned runtime", () => {
    expect(
      [
        "select",
        "frame",
        "rectangle",
        "ellipse",
        "line",
        "arrow",
        "polygon",
        "star",
        "pen",
        "text",
      ].every(isTool),
    ).toBe(true);
    expect(isTool("pan")).toBe(false);
  });
});
