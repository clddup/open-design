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

  it("expands paragraph fields to complete paragraphs and remaps them through editing", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    apply(runtime, "paragraph_content", {
      commandId: "paragraph_content",
      type: "update_properties",
      nodeId: "title_welcome",
      properties: { content: "First\nSecond\nThird" },
    });
    apply(runtime, "paragraph_style", {
      commandId: "paragraph_style",
      type: "update_text_range_style",
      nodeId: "title_welcome",
      start: 8,
      end: 10,
      style: { paragraphIndent: 28, paragraphSpacing: 12 },
    });
    expect(text(runtime).properties.paragraphRuns).toEqual([
      {
        start: 0,
        end: 6,
        style: paragraphStyle(),
      },
      {
        start: 6,
        end: 13,
        style: paragraphStyle({
          paragraphIndent: 28,
          paragraphSpacing: 12,
        }),
      },
      {
        start: 13,
        end: 18,
        style: paragraphStyle(),
      },
    ]);
    expect(text(runtime).properties.runs).toEqual([]);

    apply(runtime, "split_paragraph", {
      commandId: "split_paragraph",
      type: "update_properties",
      nodeId: "title_welcome",
      properties: { content: "First\nSec\nond\nThird" },
    });
    expect(text(runtime).properties.paragraphRuns).toEqual([
      {
        start: 0,
        end: 6,
        style: paragraphStyle(),
      },
      {
        start: 6,
        end: 14,
        style: paragraphStyle({
          paragraphIndent: 28,
          paragraphSpacing: 12,
        }),
      },
      {
        start: 14,
        end: 19,
        style: paragraphStyle(),
      },
    ]);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(text(runtime).properties.paragraphRuns?.[1]).toMatchObject({
      start: 6,
      end: 13,
      style: { paragraphIndent: 28, paragraphSpacing: 12 },
    });
  });

  it("detaches a bound Text Style across touched paragraphs after a direct paragraph edit", () => {
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.textStyleId = "body-style";
    document.styleOrderByType.TEXT = ["body-style"];
    document.stylesById["body-style"] = {
      id: "body-style",
      key: "body-style-key",
      name: "Typography/Body",
      description: "",
      hiddenFromPublishing: false,
      styleType: "TEXT",
      textStyle: {
        fontFamily: title.properties.fontFamily,
        fontStyleName: title.properties.fontStyleName,
        fontSize: title.properties.fontSize,
        fontWeight: title.properties.fontWeight,
        fontSlant: title.properties.fontSlant,
        letterSpacing: title.properties.letterSpacing,
        lineHeight: title.properties.lineHeight,
        paragraphIndent: title.properties.paragraphIndent,
        paragraphSpacing: title.properties.paragraphSpacing,
        listSpacing: 0,
        hangingList: false,
        textCase: title.properties.textCase,
        textDecoration: title.properties.textDecoration,
      },
      extensions: {},
    };
    const runtime = new EditorRuntime(document);
    apply(runtime, "detach_paragraph_style", {
      commandId: "detach_paragraph_style",
      type: "update_text_range_style",
      nodeId: title.id,
      start: 0,
      end: 4,
      style: { paragraphSpacing: 18 },
    });
    expect(text(runtime).properties.runs).toEqual([
      expect.objectContaining({
        start: 0,
        end: title.properties.content.length,
        style: expect.not.objectContaining({ textStyleId: "body-style" }),
      }),
    ]);
    expect(text(runtime).properties.paragraphRuns).toEqual([
      {
        start: 0,
        end: title.properties.content.length,
        style: paragraphStyle({ paragraphSpacing: 18 }),
      },
    ]);
  });

  it("applies ordered and nested list semantics as paragraph facts with one undoable revision", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    apply(runtime, "list_content", {
      commandId: "list_content",
      type: "update_properties",
      nodeId: "title_welcome",
      properties: { content: "One\nTwo\nPlain" },
    });
    const before = runtime.getSnapshot().document.revision;
    const result = apply(runtime, "list_style", {
      commandId: "list_style",
      type: "update_text_range_style",
      nodeId: "title_welcome",
      start: 0,
      end: 7,
      style: {
        listOptions: { type: "ordered" },
        listSpacing: 10,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      revision: { revision: before + 1 },
    });
    expect(text(runtime).properties.paragraphRuns).toEqual([
      {
        start: 0,
        end: 8,
        style: paragraphStyle({
          listOptions: { type: "ordered" },
          indentation: 1,
          listSpacing: 10,
        }),
      },
      { start: 8, end: 13, style: paragraphStyle() },
    ]);

    apply(runtime, "nested_list", {
      commandId: "nested_list",
      type: "update_text_range_style",
      nodeId: "title_welcome",
      start: 4,
      end: 7,
      style: { indentation: 2 },
    });
    expect(text(runtime).properties.paragraphRuns?.[1]).toEqual({
      start: 4,
      end: 8,
      style: paragraphStyle({
        listOptions: { type: "ordered" },
        indentation: 2,
        listSpacing: 10,
      }),
    });
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(text(runtime).properties.paragraphRuns?.[0]?.end).toBe(8);
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expect(text(reopened).properties.paragraphRuns).toEqual(
      text(runtime).properties.paragraphRuns,
    );
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

function paragraphStyle(
  overrides: Partial<
    NonNullable<
      ReturnType<typeof text>["properties"]["paragraphRuns"]
    >[number]["style"]
  > = {},
) {
  return {
    listOptions: { type: "none" as const },
    indentation: 0,
    listSpacing: 0,
    paragraphIndent: 0,
    paragraphSpacing: 0,
    ...overrides,
  };
}
