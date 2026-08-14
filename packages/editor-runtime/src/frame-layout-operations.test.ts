import type {
  DesignDocument,
  DesignNode,
  DesignTransaction,
  LayoutConstraints,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  createEmptyDesignDocument,
  normalizeDesignDocument,
  planResizeFrameWithConstraints,
  planSetNodeConstraints,
} from "./index.js";

describe("Frame constraints planner", () => {
  it("resizes a Frame and all constraint modes in one reversible transaction", () => {
    const runtime = new EditorRuntime(layoutDocument());
    const plan = planResizeFrameWithConstraints(
      runtime.getSnapshot().document,
      "page_layout",
      "frame",
      { width: 400, height: 400 },
      "responsive",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.commands).toHaveLength(5);
    expect(runtime.apply(transaction(runtime, plan.commands)).ok).toBe(true);
    const resized = runtime.getSnapshot().document;
    expect(resized.nodesById.frame?.size).toEqual({ width: 400, height: 400 });
    expectRect(resized, "left_top", 20, 30, 40, 50);
    expectRect(resized, "right_bottom", 220, 230, 40, 50);
    expectRect(resized, "stretch", 20, 30, 240, 250);
    expectRect(resized, "center", 120, 130, 40, 50);
    expectRect(resized, "scale", 40, 60, 80, 100);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.frame?.size).toEqual({
      width: 200,
      height: 200,
    });
    expect(runtime.redo().ok).toBe(true);
    const reopened = normalizeDesignDocument(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expectRect(reopened, "scale", 40, 60, 80, 100);
  });

  it("sets constraints only on direct Frame children and keeps defaults implicit", () => {
    const document = structuredClone(layoutDocument());
    expect(
      planSetNodeConstraints(
        document,
        "page_layout",
        "left_top",
        { horizontal: "left", vertical: "top" },
        "default",
      ),
    ).toMatchObject({ ok: false, code: "no-op" });
    expect(
      planSetNodeConstraints(
        document,
        "page_layout",
        "left_top",
        { horizontal: "right", vertical: "bottom" },
        "set",
      ),
    ).toMatchObject({
      ok: true,
      commands: [
        expect.objectContaining({
          constraints: { horizontal: "right", vertical: "bottom" },
        }),
      ],
    });
    document.nodesById.root_layer = rectangle("root_layer", null, 0, 0, 10, 10);
    document.pagesById.page_layout!.rootNodeIds.push("root_layer");
    expect(
      planSetNodeConstraints(
        document,
        "page_layout",
        "root_layer",
        { horizontal: "right", vertical: "bottom" },
        "root",
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });

    const autoText = structuredClone(document);
    const template = autoText.nodesById.left_top!;
    autoText.nodesById.auto_text = {
      ...template,
      id: "auto_text",
      kind: "text",
      properties: {
        content: "Auto",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        textAlignHorizontal: "left",
        textAlignVertical: "top",
        textResize: "auto-width",
        textWrap: "none",
        textOverflow: "visible",
        fills: [],
        strokes: [],
        strokeWidth: 0,
      },
    };
    autoText.nodesById.frame!.childIds.push("auto_text");
    expect(
      planSetNodeConstraints(
        autoText,
        "page_layout",
        "auto_text",
        { horizontal: "scale", vertical: "top" },
        "auto",
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });
  });

  it("recursively resizes nested Frames and rejects lossy transformed children", () => {
    const document = structuredClone(layoutDocument());
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    document.nodesById.nested = {
      ...frame,
      id: "nested",
      name: "Nested",
      parentId: "frame",
      childIds: ["nested_child"],
      transform: [1, 0, 0, 1, 20, 20],
      size: { width: 100, height: 100 },
      constraints: { horizontal: "left-right", vertical: "top-bottom" },
    };
    document.nodesById.nested_child = {
      ...rectangle("nested_child", "nested", 10, 10, 20, 20),
      constraints: { horizontal: "right", vertical: "bottom" },
    };
    frame.childIds.push("nested");
    const normalized = normalizeDesignDocument(document);
    const plan = planResizeFrameWithConstraints(
      normalized,
      "page_layout",
      "frame",
      { width: 300, height: 300 },
      "nested",
    );
    if (!plan.ok) throw new Error(plan.message);
    const runtime = new EditorRuntime(normalized);
    expect(runtime.apply(transaction(runtime, plan.commands)).ok).toBe(true);
    expectRect(runtime.getSnapshot().document, "nested", 20, 20, 200, 200);
    expectRect(
      runtime.getSnapshot().document,
      "nested_child",
      110,
      110,
      20,
      20,
    );

    const rotated = structuredClone(normalized);
    rotated.nodesById.left_top!.transform = [0, 1, -1, 0, 20, 30];
    expect(
      planResizeFrameWithConstraints(
        rotated,
        "page_layout",
        "frame",
        { width: 300, height: 300 },
        "rotated",
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });
  });

  it("switches only manually resized Hug axes to Fixed", () => {
    const document = structuredClone(layoutDocument());
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    frame.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0,
      primaryAlignment: "start",
      counterAlignment: "start",
      sizing: { horizontal: "hug", vertical: "hug" },
    };
    for (const childId of frame.childIds)
      delete document.nodesById[childId]?.constraints;
    const normalized = normalizeDesignDocument(document);
    const plan = planResizeFrameWithConstraints(
      normalized,
      "page_layout",
      "frame",
      { width: 260, height: normalized.nodesById.frame!.size.height },
      "manual_hug_resize",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.commands).toHaveLength(1);
    const command = plan.commands[0];
    expect(command).toMatchObject({
      nodeId: "frame",
      size: { width: 260, height: 200 },
    });
    expect(
      command?.type === "update_properties"
        ? command.properties?.autoLayout
        : undefined,
    ).toMatchObject({ sizing: { horizontal: "fixed", vertical: "hug" } });
    const runtime = new EditorRuntime(normalized);
    expect(runtime.apply(transaction(runtime, plan.commands)).ok).toBe(true);
    expect(
      (
        runtime.getSnapshot().document.nodesById.frame as Extract<
          DesignNode,
          { kind: "frame" }
        >
      ).properties.autoLayout,
    ).toMatchObject({ sizing: { horizontal: "fixed", vertical: "hug" } });
  });
});

function layoutDocument(): DesignDocument {
  const document = structuredClone(
    createEmptyDesignDocument("document_layout", "page_layout"),
  );
  const children: Array<[string, LayoutConstraints | undefined]> = [
    ["left_top", undefined],
    ["right_bottom", { horizontal: "right", vertical: "bottom" }],
    ["stretch", { horizontal: "left-right", vertical: "top-bottom" }],
    ["center", { horizontal: "center", vertical: "center" }],
    ["scale", { horizontal: "scale", vertical: "scale" }],
  ];
  document.nodesById.frame = {
    id: "frame",
    kind: "frame",
    name: "Frame",
    parentId: null,
    childIds: children.map(([id]) => id),
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 200, height: 200 },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent: true,
    },
    extensions: {},
  };
  for (const [id, constraints] of children) {
    document.nodesById[id] = {
      ...rectangle(id, "frame", 20, 30, 40, 50),
      ...(constraints ? { constraints } : {}),
    };
  }
  document.pagesById.page_layout!.rootNodeIds = ["frame"];
  return normalizeDesignDocument(document);
}

function rectangle(
  id: string,
  parentId: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
): Extract<DesignNode, { kind: "rectangle" }> {
  return {
    id,
    kind: "rectangle",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, x, y],
    size: { width, height },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
    },
    extensions: {},
  };
}

function transaction(
  runtime: EditorRuntime,
  commands: DesignTransaction["commands"],
): DesignTransaction {
  const document = runtime.getSnapshot().document;
  return {
    transactionId: `constraints_${document.revision}`,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "constraints-test" },
    label: "Responsive resize",
    commands,
  };
}

function expectRect(
  document: DesignDocument,
  nodeId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  expect(document.nodesById[nodeId]).toMatchObject({
    transform: [1, 0, 0, 1, x, y],
    size: { width, height },
  });
}
