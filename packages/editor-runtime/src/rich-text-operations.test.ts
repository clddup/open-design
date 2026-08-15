import type {
  DesignOperation,
  DesignTransaction,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { EditorRuntime } from "./runtime.js";

describe("EditorRuntime rich text ranges", () => {
  it("persists an undoable UTF-16 range style and survives reopen", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    apply(runtime, "seed", {
      commandId: "seed_content",
      type: "update_properties",
      nodeId: "title_welcome",
      properties: { content: "A😀BC" },
    });
    const before = runtime.getSnapshot().document.revision;
    const result = apply(runtime, "range", {
      commandId: "style_emoji",
      type: "update_text_range_style",
      nodeId: "title_welcome",
      start: 1,
      end: 3,
      style: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: "SemiBold",
        fontWeight: 600,
        fills: [{ type: "solid", color: "#ff3366", opacity: 1 }],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      revision: { revision: before + 1 },
    });
    const styled = text(runtime);
    expect(styled.properties.runs).toEqual([
      expect.objectContaining({ start: 0, end: 1 }),
      expect.objectContaining({
        start: 1,
        end: 3,
        style: expect.objectContaining({
          fontFamily: "IBM Plex Sans",
          fontStyleName: "SemiBold",
          fontWeight: 600,
          fills: [{ type: "solid", color: "#ff3366", opacity: 1 }],
        }),
      }),
      expect.objectContaining({ start: 3, end: 5 }),
    ]);

    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(text(runtime).properties.runs).toEqual([]);
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expect(text(reopened).properties.runs).toEqual(
      text(runtime).properties.runs,
    );
  });

  it("rejects half-surrogate ranges without writing a revision", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    apply(runtime, "seed", {
      commandId: "seed_content",
      type: "update_properties",
      nodeId: "title_welcome",
      properties: { content: "A😀B" },
    });
    const revision = runtime.getSnapshot().document.revision;
    const result = apply(runtime, "invalid", {
      commandId: "split_emoji",
      type: "update_text_range_style",
      nodeId: "title_welcome",
      start: 1,
      end: 2,
      style: { fontWeight: 700 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid",
        commandId: "split_emoji",
        path: "/nodesById/title_welcome/properties/runs",
      },
    });
    expect(runtime.getSnapshot().document.revision).toBe(revision);
  });

  it("remaps existing runs through direct text editing", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    apply(runtime, "seed", {
      commandId: "seed_content",
      type: "update_properties",
      nodeId: "title_welcome",
      properties: { content: "Hello world" },
    });
    apply(runtime, "style", {
      commandId: "style_world",
      type: "update_text_range_style",
      nodeId: "title_welcome",
      start: 6,
      end: 11,
      style: { fontWeight: 700 },
    });
    apply(runtime, "edit", {
      commandId: "edit_content",
      type: "update_properties",
      nodeId: "title_welcome",
      properties: { content: "Hello brave world" },
    });
    expect(text(runtime).properties.runs).toEqual([
      expect.objectContaining({ start: 0, end: 12 }),
      expect.objectContaining({
        start: 12,
        end: 17,
        style: expect.objectContaining({ fontWeight: 700 }),
      }),
    ]);
  });
});

function apply(runtime: EditorRuntime, id: string, command: DesignOperation) {
  const document = runtime.getSnapshot().document;
  const transaction: DesignTransaction = {
    transactionId: `transaction_${id}_${document.revision}`,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "local-user" },
    commands: [command],
  };
  return runtime.apply(transaction);
}

function text(runtime: EditorRuntime) {
  const node = runtime.getSnapshot().document.nodesById.title_welcome;
  if (!node || node.kind !== "text") throw new Error("Missing title");
  return node;
}
