import type {
  DesignNode,
  DesignTransaction,
  FidelityWarning,
} from "@opendesign/design-contracts";
import {
  memoizeTextLayoutProvider,
  type TextLayoutProvider,
} from "@opendesign/text-service";
import { describe, expect, it, vi } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { EditorRuntime } from "./runtime.js";

describe("EditorRuntime text Auto Size", () => {
  it("projects provider-owned font availability without persisting environment state", () => {
    const document = structuredClone(createWelcomeDocument());
    const runtime = new EditorRuntime(document, {
      textLayoutProvider: {
        id: "test-text-layout",
        version: "4",
        inspectFont: (font) => ({
          status: font.fontFamily === "Inter" ? "available" : "missing",
          provider: "test-text-layout",
          providerVersion: "4",
          message: `${font.fontFamily} availability`,
        }),
        measure: () => ({
          ok: true,
          provider: "test-text-layout",
          providerVersion: "4",
          size: { width: 120, height: 32 },
          warnings: [],
        }),
      },
    });

    expect(
      runtime.inspectTextFont({
        fontFamily: "Inter",
        fontStyleName: null,
        fontWeight: 600,
        fontSlant: "normal",
      }),
    ).toMatchObject({ status: "available" });
    expect(
      runtime.inspectTextFont({
        fontFamily: "Missing Sans",
        fontStyleName: null,
        fontWeight: 400,
        fontSlant: "normal",
      }),
    ).toMatchObject({ status: "missing" });
    expect(runtime.getSnapshot().document).toEqual(document);
  });

  it("measures Auto Width identically for preview/apply and persists undoable concrete bounds", () => {
    const measure = vi.fn<TextLayoutProvider["measure"]>((request) => ({
      ok: true,
      provider: "test-text-layout",
      providerVersion: "1",
      size: {
        width: request.content.length * 11.5,
        height: request.lineHeight,
      },
      warnings: [],
    }));
    const provider = memoizeTextLayoutProvider({
      id: "test-text-layout",
      version: "1",
      measure,
    });
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      textLayoutProvider: provider,
    });
    const before = runtime.getSnapshot().document;
    const frame = before.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    const node = autoWidthNode(frame.id);
    const transaction: DesignTransaction = {
      transactionId: "insert_auto_width",
      documentId: before.documentId,
      baseRevision: before.revision,
      actor: { type: "user", id: "local-user" },
      label: "Insert Auto Width text",
      commands: [
        {
          commandId: "insert_auto_width_text",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: frame.id,
          index: frame.childIds.length,
          node,
        },
      ],
    };

    const preview = runtime.preview(transaction);
    const applied = runtime.apply(transaction);
    expect(preview).toMatchObject({ ok: true, warnings: [] });
    expect(applied).toMatchObject({ ok: true, warnings: [] });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().document.nodesById[node.id]).toMatchObject({
      size: { width: node.properties.content.length * 11.5, height: 32 },
      properties: {
        textResize: "auto-width",
        textWrap: "none",
        textOverflow: "visible",
      },
    });

    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.nodesById[node.id]).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(reopened.getSnapshot().document.nodesById[node.id]).toEqual(
      runtime.getSnapshot().document.nodesById[node.id],
    );
  });

  it("reflows Auto Height content, then switches to Fixed on manual bounds editing", () => {
    const provider: TextLayoutProvider = {
      id: "test-text-layout",
      version: "1",
      measure: vi.fn<TextLayoutProvider["measure"]>((request) => ({
        ok: true as const,
        provider: "test-text-layout",
        providerVersion: "1",
        size: {
          width: request.width ?? 100,
          height: request.content.length > 20 ? 96 : 48,
        },
        warnings: [],
      })),
    };
    const document = createWelcomeDocument();
    const runtime = new EditorRuntime(document, {
      textLayoutProvider: provider,
    });
    const text = document.nodesById.title_welcome;
    if (!text || text.kind !== "text") throw new Error("Missing text");

    const autoHeight = apply(runtime, "auto_height", {
      commandId: "set_auto_height",
      type: "update_properties",
      nodeId: text.id,
      properties: {
        content: "A considerably longer paragraph that wraps",
        textResize: "auto-height",
      },
    });
    expect(autoHeight.ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById[text.id]).toMatchObject({
      size: { width: text.size.width, height: 96 },
      properties: {
        textResize: "auto-height",
        textWrap: "word",
        textOverflow: "visible",
      },
    });

    const fixed = apply(runtime, "manual_resize", {
      commandId: "resize_text",
      type: "update_properties",
      nodeId: text.id,
      size: { width: 320, height: 120 },
    });
    expect(fixed.ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById[text.id]).toMatchObject({
      size: { width: 320, height: 120 },
      properties: { textResize: "fixed", textWrap: "word" },
    });
  });

  it("returns a retryable structured failure until the layout provider is ready", () => {
    const document = createWelcomeDocument();
    const runtime = new EditorRuntime(document);
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");

    const result = apply(runtime, "provider_unavailable", {
      commandId: "insert_pending_auto_text",
      type: "insert_element",
      pageId: "page_welcome",
      parentId: frame.id,
      index: frame.childIds.length,
      node: autoWidthNode(frame.id),
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "engine-failure",
        retryable: true,
        issues: [
          {
            commandId: "insert_pending_auto_text",
            path: "/nodesById/auto_text/size",
            details: { recovery: "retry-after-canvas-ready" },
          },
        ],
      },
    });
    expect(runtime.getSnapshot().document.revision).toBe(document.revision);
  });

  it("keeps provider exceptions and identity mismatches structured", () => {
    const document = createWelcomeDocument();
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    const throwing = new EditorRuntime(document, {
      textLayoutProvider: {
        id: "throwing-provider",
        version: "1",
        measure: () => {
          throw new Error("font engine unavailable");
        },
      },
    });

    expect(
      apply(throwing, "provider_throws", {
        commandId: "insert_throwing_text",
        type: "insert_element",
        pageId: "page_welcome",
        parentId: frame.id,
        index: frame.childIds.length,
        node: autoWidthNode(frame.id),
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "engine-failure",
        retryable: true,
        issues: [
          {
            commandId: "insert_throwing_text",
            path: "/nodesById/auto_text/size",
            details: { providerCode: "provider-threw" },
          },
        ],
      },
    });

    const inconsistent = new EditorRuntime(document, {
      textLayoutProvider: {
        id: "expected-provider",
        version: "1",
        measure: () => ({
          ok: true,
          provider: "unexpected-provider",
          providerVersion: "2",
          size: { width: 120, height: 32 },
          warnings: [],
        }),
      },
    });
    expect(
      apply(inconsistent, "provider_identity", {
        commandId: "insert_inconsistent_text",
        type: "insert_element",
        pageId: "page_welcome",
        parentId: frame.id,
        index: frame.childIds.length,
        node: autoWidthNode(frame.id),
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "engine-failure",
        retryable: false,
        issues: [
          {
            commandId: "insert_inconsistent_text",
            path: "/nodesById/auto_text/size",
            details: {
              provider: "expected-provider",
              resultProvider: "unexpected-provider",
            },
          },
        ],
      },
    });
  });

  it("surfaces font fallback as a fidelity warning while retaining measured size", () => {
    const warning: FidelityWarning = {
      nodeId: "auto_text",
      feature: "text-layout.font-fallback",
      fallback: "Persisted fallback bounds",
      message: "Requested font is unavailable",
    };
    const provider: TextLayoutProvider = {
      id: "test-text-layout",
      version: "1",
      measure: () => ({
        ok: true,
        provider: "test-text-layout",
        providerVersion: "1",
        size: { width: 138, height: 32 },
        warnings: [
          {
            code: "font-fallback",
            fallback: warning.fallback,
            message: warning.message,
          },
        ],
      }),
    };
    const document = createWelcomeDocument();
    const runtime = new EditorRuntime(document, {
      textLayoutProvider: provider,
    });
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");

    expect(
      apply(runtime, "font_fallback", {
        commandId: "insert_fallback_text",
        type: "insert_element",
        pageId: "page_welcome",
        parentId: frame.id,
        index: frame.childIds.length,
        node: autoWidthNode(frame.id),
      }),
    ).toMatchObject({ ok: true, warnings: [warning] });
  });

  it("measures Auto Size text introduced through replace_subtree", () => {
    const provider: TextLayoutProvider = {
      id: "test-text-layout",
      version: "1",
      measure: () => ({
        ok: true,
        provider: "test-text-layout",
        providerVersion: "1",
        size: { width: 196, height: 40 },
        warnings: [],
      }),
    };
    const document = createWelcomeDocument();
    const runtime = new EditorRuntime(document, {
      textLayoutProvider: provider,
    });
    const current = document.nodesById.title_welcome;
    if (!current || current.kind !== "text") throw new Error("Missing text");
    const replacement = structuredClone(current);
    replacement.properties.textResize = "auto-width";
    replacement.properties.textWrap = "none";
    replacement.properties.textOverflow = "visible";
    replacement.properties.content = "Measured replacement";

    expect(
      apply(runtime, "replace_auto_text", {
        commandId: "replace_auto_text_command",
        type: "replace_subtree",
        rootNodeId: current.id,
        nodes: [replacement],
      }),
    ).toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.nodesById[current.id]).toMatchObject({
      size: { width: 196, height: 40 },
      properties: { textResize: "auto-width" },
    });
  });

  it("replaces matching fonts atomically, reflows Auto Size text, and preserves Fixed bounds", () => {
    const document = structuredClone(createWelcomeDocument());
    const subtitle = document.nodesById.subtitle_welcome;
    if (!subtitle || subtitle.kind !== "text")
      throw new Error("Missing subtitle");
    subtitle.properties.textResize = "auto-height";
    subtitle.properties.textWrap = "word";
    subtitle.properties.textOverflow = "visible";
    const originalTitleSize = structuredClone(
      document.nodesById.title_welcome?.size,
    );
    const runtime = new EditorRuntime(document, {
      textLayoutProvider: {
        id: "test-text-layout",
        version: "3",
        inspectFont: (font) => ({
          status: font.fontFamily === "IBM Plex Sans" ? "available" : "missing",
          provider: "test-text-layout",
          providerVersion: "3",
          message: `${font.fontFamily} availability`,
        }),
        measure: (request) => ({
          ok: true,
          provider: "test-text-layout",
          providerVersion: "3",
          size: { width: request.width ?? 300, height: 88 },
          warnings: [],
        }),
      },
    });

    const result = apply(runtime, "replace_font", {
      commandId: "replace_inter",
      type: "reflow_text",
      nodeIds: ["title_welcome", "subtitle_welcome"],
      expectedFont: {
        fontFamily: "Inter",
        fontStyleName: "Semi Bold",
        fontWeight: 600,
        fontSlant: "normal",
      },
      replacementFont: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: "Medium Italic",
        fontWeight: 500,
        fontSlant: "italic",
      },
    });

    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      size: originalTitleSize,
      properties: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: "Medium Italic",
        fontWeight: 500,
        fontSlant: "italic",
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.subtitle_welcome,
    ).toMatchObject({
      size: { width: subtitle.size.width, height: 88 },
      properties: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: "Medium Italic",
        fontWeight: 500,
        fontSlant: "italic",
      },
    });
    expect(runtime.undo()).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      properties: {
        fontFamily: "Inter",
        fontStyleName: "Semi Bold",
        fontWeight: 600,
        fontSlant: "normal",
      },
    });
    expect(runtime.redo()).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      properties: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: "Medium Italic",
        fontWeight: 500,
        fontSlant: "italic",
      },
    });
  });

  it("fails reflow atomically for stale, locked, missing, unavailable, and no-op requests", () => {
    const provider: TextLayoutProvider = {
      id: "test-text-layout",
      version: "4",
      inspectFont: (font) => ({
        status: font.fontFamily === "Missing Sans" ? "missing" : "available",
        provider: "test-text-layout",
        providerVersion: "4",
        message: `${font.fontFamily} availability`,
      }),
      measure: (request) => ({
        ok: true,
        provider: "test-text-layout",
        providerVersion: "4",
        size: { width: request.width ?? 720, height: 72 },
        warnings: [],
      }),
    };
    const assertUnchanged = (
      runtime: EditorRuntime,
      id: string,
      command: DesignTransaction["commands"][number],
      expected: object,
    ) => {
      const revision = runtime.getSnapshot().document.revision;
      expect(apply(runtime, id, command)).toMatchObject(expected);
      expect(runtime.getSnapshot().document.revision).toBe(revision);
    };

    const stale = new EditorRuntime(createWelcomeDocument(), {
      textLayoutProvider: provider,
    });
    assertUnchanged(
      stale,
      "stale_font",
      {
        commandId: "stale_font_command",
        type: "reflow_text",
        nodeIds: ["title_welcome"],
        expectedFont: {
          fontFamily: "Other",
          fontStyleName: null,
          fontWeight: 600,
          fontSlant: "normal",
        },
        replacementFont: {
          fontFamily: "Available Sans",
          fontStyleName: null,
          fontWeight: 400,
          fontSlant: "normal",
        },
      },
      { ok: false, error: { code: "conflict", retryable: true } },
    );

    const lockedDocument = structuredClone(createWelcomeDocument());
    lockedDocument.nodesById.frame_welcome!.locked = true;
    const locked = new EditorRuntime(lockedDocument, {
      textLayoutProvider: provider,
    });
    assertUnchanged(
      locked,
      "locked_font",
      {
        commandId: "locked_font_command",
        type: "reflow_text",
        nodeIds: ["title_welcome"],
        expectedFont: {
          fontFamily: "Inter",
          fontStyleName: "Semi Bold",
          fontWeight: 600,
          fontSlant: "normal",
        },
        replacementFont: {
          fontFamily: "Available Sans",
          fontStyleName: null,
          fontWeight: 400,
          fontSlant: "normal",
        },
      },
      { ok: false, error: { code: "permission-denied" } },
    );

    const missing = new EditorRuntime(createWelcomeDocument(), {
      textLayoutProvider: provider,
    });
    assertUnchanged(
      missing,
      "missing_font",
      {
        commandId: "missing_font_command",
        type: "reflow_text",
        nodeIds: ["title_welcome"],
        expectedFont: {
          fontFamily: "Inter",
          fontStyleName: "Semi Bold",
          fontWeight: 600,
          fontSlant: "normal",
        },
        replacementFont: {
          fontFamily: "Missing Sans",
          fontStyleName: null,
          fontWeight: 400,
          fontSlant: "normal",
        },
      },
      {
        ok: false,
        error: { issues: [{ details: { code: "font-missing" } }] },
      },
    );

    const unavailable = new EditorRuntime(createWelcomeDocument());
    assertUnchanged(
      unavailable,
      "unavailable_font",
      {
        commandId: "unavailable_font_command",
        type: "reflow_text",
        nodeIds: ["title_welcome"],
        expectedFont: {
          fontFamily: "Inter",
          fontStyleName: "Semi Bold",
          fontWeight: 600,
          fontSlant: "normal",
        },
        replacementFont: {
          fontFamily: "Available Sans",
          fontStyleName: null,
          fontWeight: 400,
          fontSlant: "normal",
        },
      },
      { ok: false, error: { code: "engine-failure", retryable: true } },
    );

    const noOp = new EditorRuntime(createWelcomeDocument(), {
      textLayoutProvider: provider,
    });
    assertUnchanged(
      noOp,
      "no_op_font",
      {
        commandId: "no_op_font_command",
        type: "reflow_text",
        nodeIds: ["title_welcome"],
        expectedFont: {
          fontFamily: "Inter",
          fontStyleName: "Semi Bold",
          fontWeight: 600,
          fontSlant: "normal",
        },
      },
      { ok: false, error: { issues: [{ details: { code: "no-op" } }] } },
    );
  });
});

function autoWidthNode(
  parentId: string,
): Extract<DesignNode, { kind: "text" }> {
  return {
    id: "auto_text",
    kind: "text",
    name: "Auto text",
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 64, 64],
    size: { width: 1, height: 1 },
    exportSettings: [],
    opacity: 1,
    properties: {
      content: "Auto width",
      fontFamily: "Inter, sans-serif",
      fontStyleName: null,
      fontSize: 24,
      fontWeight: 600,
      fontSlant: "normal",
      lineHeight: 32,
      letterSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      textCase: "original",
      textDecoration: "none",
      textDecorationStyle: null,
      textDecorationOffset: null,
      textDecorationThickness: null,
      textDecorationColor: null,
      textDecorationSkipInk: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textResize: "auto-width",
      textWrap: "none",
      textOverflow: "visible",
      textTruncation: "disabled",
      maxLines: null,
      fills: [{ type: "solid", color: "#151515", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
    extensions: {},
  };
}

function apply(
  runtime: EditorRuntime,
  transactionId: string,
  command: DesignTransaction["commands"][number],
) {
  const current = runtime.getSnapshot().document;
  return runtime.apply({
    transactionId,
    documentId: current.documentId,
    baseRevision: current.revision,
    actor: { type: "user", id: "local-user" },
    label: transactionId,
    commands: [command],
  });
}
