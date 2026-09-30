// @vitest-environment happy-dom

import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextEditDomController } from "./text-edit-dom-controller.js";
import { TextRunEditController } from "./text-run-edit-controller.js";
import { applyTextRunDomStyle } from "./text-edit-dom-rendering.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("native TextEditor inline text flow", () => {
  it.each([
    "08.10 — 20:30  /  MAIN STAGE\nSHANGHAI · STREAMING WORLDWIDE",
    "Alpha\n\nBeta",
    "Alpha\n",
    "",
  ])("keeps %j in one flex item without changing the session", (content) => {
    const { controller, editor, root } = editingFixture(content);
    controller.attach(root);

    expect(root.children).toHaveLength(1);
    const flow = root.firstElementChild as HTMLElement;
    expect(flow.style.display).toBe("block");
    expect(flow.style.whiteSpace).toBe("inherit");
    expect(flow.style.getPropertyValue("white-space-collapse")).toBe(
      "preserve",
    );
    expect(flow.querySelectorAll("br")).toHaveLength(
      content.split("\n").length - 1,
    );

    controller.detach(true);
    expect(editor.activeContent).toBe(content);
    expect(editor.finish({ disposed: false, synchronizing: false })).toEqual({
      kind: "restore",
    });
  });

  it("keeps adjacent character styles inline rather than separate flex rows", () => {
    const { controller, editor, root } = editingFixture("Alpha Beta");
    editor.selection({ start: 6, end: 10 });
    editor.updateStyle({ fontWeight: 800 });
    controller.attach(root);

    expect(root.children).toHaveLength(1);
    const spans = root.firstElementChild?.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(spans?.[1]?.style.fontWeight).toBe("800");
    expect(root.querySelectorAll("br")).toHaveLength(0);
    expect(root.textContent).toBe("Alpha Beta");
    controller.dispose();
  });

  it("preserves authored breaks after an input event", () => {
    const { controller, editor, root } = editingFixture("Alpha\nBeta");
    controller.attach(root);
    const last = root.querySelectorAll("span")[1];
    if (!last) throw new Error("Missing second line");
    last.textContent = "Updated";
    root.dispatchEvent(new InputEvent("input", { bubbles: true }));
    controller.detach(true);

    expect(
      editor.finish({ disposed: false, synchronizing: false }),
    ).toMatchObject({
      kind: "commit",
      content: "Alpha\nUpdated",
    });
  });

  it.each([
    [7.68, "0.512"],
    [15, "1"],
    [30, "2"],
  ])(
    "matches native font size %s after the editor updates its scale",
    async (fontSize, scale) => {
      const content =
        "08.10 — 20:30  /  MAIN STAGE\nSHANGHAI · STREAMING WORLDWIDE";
      const { controller, editor, root } = editingFixture(content);
      controller.attach(root);
      const flow = root.firstElementChild;
      const selection = editor.activeSelection;
      root.style.fontSize = `${fontSize}px`;

      await vi.waitFor(() => {
        expect(root.style.getPropertyValue("--opendesign-text-scale")).toBe(
          scale,
        );
      });
      expect(root.firstElementChild).toBe(flow);
      expect(editor.activeSelection).toEqual(selection);
      controller.detach(true);
      expect(editor.activeContent).toBe(content);
      expect(editor.finish({ disposed: false, synchronizing: false })).toEqual({
        kind: "restore",
      });
    },
  );

  it("scales all run metrics against the native root, not a parent run", () => {
    const { controller, editor } = editingFixture("Alpha");
    const style = editor.activeRuns?.[0]?.style;
    if (!style) throw new Error("Missing character style");
    // happy-dom cannot parse nested calc(var()); verify emitted declarations here.
    // Native Chromium rendering is checked separately in the Electron editor.
    const fontSize = vi.spyOn(CSSStyleDeclaration.prototype, "fontSize", "set");
    const lineHeight = vi.spyOn(
      CSSStyleDeclaration.prototype,
      "lineHeight",
      "set",
    );
    const letterSpacing = vi.spyOn(
      CSSStyleDeclaration.prototype,
      "letterSpacing",
      "set",
    );
    applyTextRunDomStyle(document.createElement("span"), style);
    expect(fontSize).toHaveBeenCalledWith(
      "calc(15px * var(--opendesign-text-scale, 1))",
    );
    expect(lineHeight).toHaveBeenCalledWith(
      "calc(28px * var(--opendesign-text-scale, 1))",
    );
    expect(letterSpacing).toHaveBeenCalledWith(
      "calc(1.8px * var(--opendesign-text-scale, 1))",
    );
    controller.dispose();
  });

  it("tracks zoom changes without replacing the active DOM and stops on detach", async () => {
    const { controller, root } = editingFixture("Alpha Beta");
    root.style.fontSize = "15px";
    controller.attach(root);
    const flow = root.firstElementChild;
    expect(root.style.getPropertyValue("--opendesign-text-scale")).toBe("1");
    root.style.fontSize = "30px";
    await vi.waitFor(() => {
      expect(root.style.getPropertyValue("--opendesign-text-scale")).toBe("2");
    });
    expect(root.firstElementChild).toBe(flow);
    controller.detach(false);
    root.style.fontSize = "15px";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.style.getPropertyValue("--opendesign-text-scale")).toBe("2");
  });
});

function editingFixture(content: string) {
  const designDocument = structuredClone(createWelcomeDocument());
  const node = designDocument.nodesById.title_welcome;
  if (!node || node.kind !== "text") throw new Error("Missing Text fixture");
  node.properties.content = content;
  node.properties.fontSize = 15;
  node.properties.lineHeight = 28;
  node.properties.letterSpacing = 1.8;
  const element = { forceUpdate: vi.fn(), set: vi.fn(), text: content };
  const editor = new TextRunEditController({
    applySpecData: vi.fn(),
    current: () => ({
      baseProjection: null,
      document: designDocument,
      projection: null,
    }),
    element: () => element,
    openProxy: vi.fn(),
    readText: () => element.text,
    scheduleBounds: vi.fn(),
    writeText: (_, value) => {
      element.text = value;
    },
  });
  editor.begin(node.id);
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.whiteSpace = "normal";
  root.textContent = content;
  document.body.appendChild(root);
  const controller = new TextEditDomController({
    currentDocument: () => designDocument,
    editor,
    element: () => element,
    publish: vi.fn(),
    report: (error) => {
      throw error;
    },
    writeText: (_, value) => {
      element.text = value;
    },
  });
  return { controller, editor, root };
}
