import type {
  AutoLayoutFlow,
  DesignDocument,
  DesignNode,
  DesignTransaction,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  createEmptyDesignDocument,
  normalizeDesignDocument,
  planResizeFrameWithConstraints,
  planSetFrameAutoLayout,
  planSetNodeConstraints,
} from "./index.js";

const horizontal: AutoLayoutFlow = {
  mode: "horizontal",
  padding: { top: 10, right: 20, bottom: 10, left: 20 },
  gap: 12,
  primaryAlignment: "start",
  counterAlignment: "center",
};

describe("linear Auto Layout Runtime", () => {
  it("activates layout, clears constraints, and reflows in one reversible revision", () => {
    const runtime = new EditorRuntime(layoutDocument());
    const plan = planSetFrameAutoLayout(
      runtime.getSnapshot().document,
      "page_layout",
      "frame",
      horizontal,
      "enable",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.commands).toHaveLength(2);
    expect(runtime.apply(transaction(runtime, plan.commands)).ok).toBe(true);
    let document = runtime.getSnapshot().document;
    expect(document.nodesById.frame).toMatchObject({
      properties: { autoLayout: horizontal },
    });
    expect(document.nodesById.one?.constraints).toBeUndefined();
    expectRect(document, "one", 20, 40, 40, 20);
    expectRect(document, "two", 72, 35, 60, 30);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);

    expect(runtime.undo().ok).toBe(true);
    document = runtime.getSnapshot().document;
    expect(document.nodesById.frame).not.toHaveProperty(
      "properties.autoLayout",
    );
    expect(document.nodesById.one?.constraints).toEqual({
      horizontal: "right",
      vertical: "bottom",
    });
    expect(runtime.redo().ok).toBe(true);
    const reopened = normalizeDesignDocument(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expectRect(reopened, "two", 72, 35, 60, 30);
  });

  it("reflows after insert, hide, resize, reorder, delete, and parent resize", () => {
    const runtime = enabledRuntime();
    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "insert_three",
            type: "insert_element",
            pageId: "page_layout",
            parentId: "frame",
            index: 1,
            node: rectangle("three", "frame", 999, 999, 30, 40),
          },
        ]),
      ).ok,
    ).toBe(true);
    expectRect(runtime.getSnapshot().document, "three", 72, 30, 30, 40);
    expectRect(runtime.getSnapshot().document, "two", 114, 35, 60, 30);

    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "hide_three",
            type: "update_properties",
            nodeId: "three",
            visible: false,
          },
          {
            commandId: "resize_one",
            type: "update_properties",
            nodeId: "one",
            size: { width: 80, height: 20 },
          },
          {
            commandId: "move_two",
            type: "move_element",
            nodeId: "two",
            pageId: "page_layout",
            parentId: "frame",
            index: 0,
          },
        ]),
      ).ok,
    ).toBe(true);
    expectRect(runtime.getSnapshot().document, "two", 20, 35, 60, 30);
    expectRect(runtime.getSnapshot().document, "one", 92, 40, 80, 20);
    expect(runtime.getSnapshot().document.nodesById.three?.transform).toEqual([
      1, 0, 0, 1, 72, 30,
    ]);

    expect(
      runtime.apply(
        transaction(runtime, [
          { commandId: "delete_two", type: "delete_element", nodeId: "two" },
          {
            commandId: "resize_frame",
            type: "update_properties",
            nodeId: "frame",
            size: { width: 400, height: 160 },
          },
        ]),
      ).ok,
    ).toBe(true);
    expectRect(runtime.getSnapshot().document, "one", 20, 70, 80, 20);
  });

  it("resolves nested Frames deepest-first after Auto Size text measurement", () => {
    const document = layoutDocument();
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    document.nodesById.nested = {
      ...frame,
      id: "nested",
      name: "Nested",
      parentId: "frame",
      childIds: ["nested_child"],
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 50 },
      properties: {
        ...frame.properties,
        autoLayout: {
          mode: "vertical",
          padding: { top: 5, right: 5, bottom: 5, left: 5 },
          gap: 0,
          primaryAlignment: "start",
          counterAlignment: "end",
        },
      },
    };
    document.nodesById.nested_child = rectangle(
      "nested_child",
      "nested",
      0,
      0,
      20,
      20,
    );
    frame.childIds = ["nested", "one", "two"];
    frame.properties.autoLayout = horizontal;
    delete document.nodesById.one?.constraints;
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "resize_nested_child",
            type: "update_properties",
            nodeId: "nested_child",
            size: { width: 40, height: 20 },
          },
        ]),
      ).ok,
    ).toBe(true);
    expectRect(runtime.getSnapshot().document, "nested_child", 55, 5, 40, 20);
    expectRect(runtime.getSnapshot().document, "nested", 20, 25, 100, 50);
  });

  it("rejects constraints, transformed children, and generic invalid flow state", () => {
    const document = layoutDocument();
    document.nodesById.frame!.properties = {
      ...(document.nodesById.frame as Extract<DesignNode, { kind: "frame" }>)
        .properties,
      autoLayout: horizontal,
    };
    expect(() => normalizeDesignDocument(document)).toThrow(
      /ordinary constraints are not valid/,
    );

    const regular = layoutDocument();
    regular.nodesById.two!.transform = [0, 1, -1, 0, 0, 0];
    expect(
      planSetFrameAutoLayout(
        regular,
        "page_layout",
        "frame",
        horizontal,
        "invalid",
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });

    const enabled = enabledRuntime();
    expect(
      planSetNodeConstraints(
        enabled.getSnapshot().document,
        "page_layout",
        "one",
        { horizontal: "left", vertical: "top" },
        "constraints",
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    const resize = planResizeFrameWithConstraints(
      enabled.getSnapshot().document,
      "page_layout",
      "frame",
      { width: 400, height: 160 },
      "resize",
    );
    if (!resize.ok) throw new Error(resize.message);
    expect(resize.commands).toHaveLength(1);
  });
});

function enabledRuntime(): EditorRuntime {
  const document = layoutDocument();
  const frame = document.nodesById.frame;
  if (frame?.kind !== "frame") throw new Error("missing frame");
  frame.properties.autoLayout = horizontal;
  delete document.nodesById.one?.constraints;
  return new EditorRuntime(normalizeDesignDocument(document));
}

function layoutDocument(): DesignDocument {
  const document = structuredClone(
    createEmptyDesignDocument("document_layout", "page_layout"),
  );
  document.nodesById.frame = {
    id: "frame",
    kind: "frame",
    name: "Frame",
    parentId: null,
    childIds: ["one", "two"],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 300, height: 100 },
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
  document.nodesById.one = {
    ...rectangle("one", "frame", 100, 0, 40, 20),
    constraints: { horizontal: "right", vertical: "bottom" },
  };
  document.nodesById.two = rectangle("two", "frame", 0, 0, 60, 30);
  document.pagesById.page_layout!.rootNodeIds = ["frame"];
  return document;
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
    transactionId: `auto_layout_${document.revision}`,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "auto-layout-test" },
    label: "Auto Layout",
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
