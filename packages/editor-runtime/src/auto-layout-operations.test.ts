import type {
  AutoLayoutFlow,
  DesignDocument,
  DesignNode,
  DesignTransaction,
} from "@opendesign/design-contracts";
import type { TextLayoutProvider } from "@opendesign/text-service";
import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  createEmptyDesignDocument,
  normalizeDesignDocument,
  planResizeFrameWithConstraints,
  planSetFrameAutoLayout,
  planSetNodeLayoutLimits,
  planSetNodeLayoutPositioning,
  planSetNodeLayoutSizing,
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

  it("keeps absolute children out of flow and restores them atomically", () => {
    const runtime = enabledRuntime();
    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "initialize_flow_geometry",
            type: "update_properties",
            nodeId: "frame",
            name: "Initialized flow",
          },
        ]),
      ).ok,
    ).toBe(true);
    const absolute = planSetNodeLayoutPositioning(
      runtime.getSnapshot().document,
      "page_layout",
      "two",
      "absolute",
      "absolute_two",
      { horizontal: "right", vertical: "bottom" },
    );
    if (!absolute.ok) throw new Error(absolute.message);
    expect(runtime.apply(transaction(runtime, absolute.commands)).ok).toBe(
      true,
    );
    let document = runtime.getSnapshot().document;
    expect(document.nodesById.two).toMatchObject({
      layoutPositioning: "absolute",
      constraints: { horizontal: "right", vertical: "bottom" },
    });
    expectRect(document, "one", 20, 40, 40, 20);
    expectRect(document, "two", 72, 35, 60, 30);

    const resize = planResizeFrameWithConstraints(
      document,
      "page_layout",
      "frame",
      { width: 400, height: 160 },
      "resize_absolute_parent",
    );
    if (!resize.ok) throw new Error(resize.message);
    expect(runtime.apply(transaction(runtime, resize.commands)).ok).toBe(true);
    document = runtime.getSnapshot().document;
    expectRect(document, "one", 20, 70, 40, 20);
    expectRect(document, "two", 172, 95, 60, 30);

    const flow = planSetNodeLayoutPositioning(
      document,
      "page_layout",
      "two",
      "flow",
      "flow_two",
    );
    if (!flow.ok) throw new Error(flow.message);
    expect(runtime.apply(transaction(runtime, flow.commands)).ok).toBe(true);
    document = runtime.getSnapshot().document;
    expect(document.nodesById.two?.layoutPositioning).toBeUndefined();
    expect(document.nodesById.two?.constraints).toBeUndefined();
    expectRect(document, "two", 72, 65, 60, 30);
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.two?.layoutPositioning,
    ).toBe("absolute");
    expect(runtime.redo().ok).toBe(true);
    expect(
      normalizeDesignDocument(
        JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
      ).nodesById.two?.layoutPositioning,
    ).toBeUndefined();
  });

  it("preserves absolute constraints across flow changes and retains them when flow is disabled", () => {
    const runtime = enabledRuntime();
    const absolute = planSetNodeLayoutPositioning(
      runtime.getSnapshot().document,
      "page_layout",
      "two",
      "absolute",
      "preserve_absolute",
      { horizontal: "right", vertical: "bottom" },
    );
    if (!absolute.ok) throw new Error(absolute.message);
    expect(runtime.apply(transaction(runtime, absolute.commands)).ok).toBe(
      true,
    );

    const changeFlow = planSetFrameAutoLayout(
      runtime.getSnapshot().document,
      "page_layout",
      "frame",
      { ...horizontal, gap: 24 },
      "change_flow",
    );
    if (!changeFlow.ok) throw new Error(changeFlow.message);
    expect(changeFlow.commands).not.toContainEqual(
      expect.objectContaining({ nodeId: "two", constraints: null }),
    );
    expect(runtime.apply(transaction(runtime, changeFlow.commands)).ok).toBe(
      true,
    );
    expect(runtime.getSnapshot().document.nodesById.two).toMatchObject({
      layoutPositioning: "absolute",
      constraints: { horizontal: "right", vertical: "bottom" },
    });

    const disable = planSetFrameAutoLayout(
      runtime.getSnapshot().document,
      "page_layout",
      "frame",
      { mode: "none" },
      "disable_flow",
    );
    if (!disable.ok) throw new Error(disable.message);
    expect(runtime.apply(transaction(runtime, disable.commands)).ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.two?.layoutPositioning,
    ).toBeUndefined();
    expect(runtime.getSnapshot().document.nodesById.two?.constraints).toEqual({
      horizontal: "right",
      vertical: "bottom",
    });
  });

  it("ignores absolute children when a Hug parent resolves", () => {
    const document = layoutDocument();
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing Frame");
    frame.properties.autoLayout = {
      ...horizontal,
      sizing: { horizontal: "hug", vertical: "hug" },
    };
    delete document.nodesById.one!.constraints;
    document.nodesById.two!.layoutPositioning = "absolute";
    document.nodesById.two!.visible = false;
    document.nodesById.two!.constraints = {
      horizontal: "right",
      vertical: "bottom",
    };
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "resolve_hug_with_absolute",
            type: "update_properties",
            nodeId: "frame",
            name: "Resolve Hug",
          },
        ]),
      ).ok,
    ).toBe(true);
    const resolved = runtime.getSnapshot().document;
    expect(resolved.nodesById.frame?.size).toEqual({ width: 80, height: 40 });
    expectRect(resolved, "one", 20, 10, 40, 20);
    expectRect(resolved, "two", -220, -60, 60, 30);
  });

  it("enforces constraint fidelity for absolute container, Instance, and Auto Size text children", () => {
    const document = structuredClone(enabledRuntime().getSnapshot().document);
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing Frame");
    document.nodesById.group = {
      ...rectangle("group", "frame", 0, 0, 40, 40),
      kind: "group",
      properties: {},
    };
    document.nodesById.boolean = {
      ...rectangle("boolean", "frame", 0, 0, 40, 40),
      kind: "boolean",
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        operation: "union",
      },
    };
    document.nodesById.instance = {
      ...rectangle("instance", "frame", 0, 0, 40, 40),
      kind: "instance",
      properties: {
        componentId: "component",
        componentProperties: {},
        overrides: [],
      },
    };
    document.nodesById.copy = autoHeightText("copy", "frame", 120);
    frame.childIds.push("group", "boolean", "instance", "copy");

    expect(
      planSetNodeLayoutPositioning(
        document,
        "page_layout",
        "group",
        "absolute",
        "absolute_group",
      ),
    ).toMatchObject({ ok: true });
    expect(
      planSetNodeLayoutPositioning(
        document,
        "page_layout",
        "boolean",
        "absolute",
        "absolute_boolean",
      ),
    ).toMatchObject({ ok: true });
    expect(
      planSetNodeLayoutPositioning(
        document,
        "page_layout",
        "group",
        "absolute",
        "constrained_group",
        { horizontal: "right", vertical: "top" },
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });
    expect(
      planSetNodeLayoutPositioning(
        document,
        "page_layout",
        "instance",
        "absolute",
        "position_instance",
        { horizontal: "right", vertical: "bottom" },
      ),
    ).toMatchObject({ ok: true });
    expect(
      planSetNodeLayoutPositioning(
        document,
        "page_layout",
        "instance",
        "absolute",
        "stretch_instance",
        { horizontal: "left-right", vertical: "top" },
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });
    expect(
      planSetNodeLayoutPositioning(
        document,
        "page_layout",
        "copy",
        "absolute",
        "position_copy",
        { horizontal: "center", vertical: "bottom" },
      ),
    ).toMatchObject({ ok: true });
    expect(
      planSetNodeLayoutPositioning(
        document,
        "page_layout",
        "copy",
        "absolute",
        "scale_copy",
        { horizontal: "scale", vertical: "top" },
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });
  });

  it("rejects absolute positioning outside flow and incompatible child sizing", () => {
    const ordinary = layoutDocument();
    ordinary.nodesById.one!.layoutPositioning = "absolute";
    expect(() => new EditorRuntime(ordinary)).toThrow(
      "absolute positioning is only valid",
    );

    const flow = layoutDocument();
    const frame = flow.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing Frame");
    frame.properties.autoLayout = horizontal;
    flow.nodesById.one!.layoutPositioning = "absolute";
    flow.nodesById.one!.layoutSizing = {
      horizontal: "fill",
      vertical: "fixed",
    };
    expect(() => new EditorRuntime(flow)).toThrow(
      "layout sizing is only valid on flow children",
    );
  });

  it("reflows Auto gap after insert, hide, resize, reorder, and Frame resize", () => {
    const document = layoutDocument();
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    frame.properties.autoLayout = {
      ...horizontal,
      primaryAlignment: "space-between",
    };
    delete document.nodesById.one?.constraints;
    const runtime = new EditorRuntime(normalizeDesignDocument(document));

    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "resolve_auto_gap",
            type: "update_properties",
            nodeId: "frame",
            name: "Responsive navigation",
          },
        ]),
      ).ok,
    ).toBe(true);
    expectRect(runtime.getSnapshot().document, "one", 20, 40, 40, 20);
    expectRect(runtime.getSnapshot().document, "two", 220, 35, 60, 30);

    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "insert_middle",
            type: "insert_element",
            pageId: "page_layout",
            parentId: "frame",
            index: 1,
            node: rectangle("middle", "frame", 0, 0, 20, 40),
          },
        ]),
      ).ok,
    ).toBe(true);
    expectRect(runtime.getSnapshot().document, "middle", 130, 30, 20, 40);
    expectRect(runtime.getSnapshot().document, "two", 220, 35, 60, 30);

    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "hide_middle",
            type: "update_properties",
            nodeId: "middle",
            visible: false,
          },
          {
            commandId: "grow_one",
            type: "update_properties",
            nodeId: "one",
            size: { width: 80, height: 20 },
          },
          {
            commandId: "widen_frame",
            type: "update_properties",
            nodeId: "frame",
            size: { width: 400, height: 120 },
          },
          {
            commandId: "reverse_children",
            type: "move_element",
            nodeId: "two",
            pageId: "page_layout",
            parentId: "frame",
            index: 0,
          },
        ]),
      ).ok,
    ).toBe(true);
    expectRect(runtime.getSnapshot().document, "two", 20, 45, 60, 30);
    expectRect(runtime.getSnapshot().document, "one", 300, 50, 80, 20);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.redo().ok).toBe(true);
    const reopened = normalizeDesignDocument(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expectRect(reopened, "one", 300, 50, 80, 20);
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

  it("hugs visible content and shares fixed-frame remainder across Fill children", () => {
    const document = layoutDocument();
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    frame.properties.autoLayout = {
      ...horizontal,
      sizing: { horizontal: "fixed", vertical: "hug" },
    };
    document.nodesById.two!.layoutSizing = {
      horizontal: "fill",
      vertical: "fixed",
    };
    document.nodesById.three = rectangle("three", "frame", 0, 0, 1, 40);
    document.nodesById.three.layoutSizing = {
      horizontal: "fill",
      vertical: "fixed",
    };
    document.nodesById.hidden = rectangle("hidden", "frame", 0, 0, 900, 900);
    document.nodesById.hidden.visible = false;
    document.nodesById.hidden.layoutSizing = {
      horizontal: "fill",
      vertical: "fill",
    };
    frame.childIds.push("three", "hidden");
    delete document.nodesById.one?.constraints;
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "trigger_flow",
            type: "update_properties",
            nodeId: "frame",
            name: "Resolved flow",
          },
        ]),
      ).ok,
    ).toBe(true);
    const resolved = runtime.getSnapshot().document;
    expect(resolved.nodesById.frame?.size).toEqual({ width: 300, height: 60 });
    expectRect(resolved, "one", 20, 20, 40, 20);
    expectRect(resolved, "two", 72, 15, 98, 30);
    expectRect(resolved, "three", 182, 10, 98, 40);
    expectRect(resolved, "hidden", 0, 0, 900, 900);
  });

  it("converges nested Hug Frames from inner content to outer bounds", () => {
    const document = layoutDocument();
    const outer = document.nodesById.frame;
    if (outer?.kind !== "frame") throw new Error("missing frame");
    const nested = structuredClone(outer);
    nested.id = "nested";
    nested.parentId = "frame";
    nested.childIds = ["nested_child"];
    nested.size = { width: 1, height: 1 };
    nested.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 5, right: 5, bottom: 5, left: 5 },
      gap: 0,
      primaryAlignment: "start",
      counterAlignment: "start",
      sizing: { horizontal: "hug", vertical: "hug" },
    };
    document.nodesById.nested = nested;
    document.nodesById.nested_child = rectangle(
      "nested_child",
      "nested",
      0,
      0,
      40,
      20,
    );
    outer.childIds = ["nested"];
    outer.properties.autoLayout = {
      ...horizontal,
      sizing: { horizontal: "hug", vertical: "hug" },
    };
    delete document.nodesById.one;
    delete document.nodesById.two;
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const result = runtime.apply(
      transaction(runtime, [
        {
          commandId: "grow_nested_content",
          type: "update_properties",
          nodeId: "nested_child",
          size: { width: 60, height: 30 },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    const resolved = runtime.getSnapshot().document;
    expectRect(resolved, "nested", 20, 10, 70, 40);
    expectRect(resolved, "nested_child", 5, 5, 60, 30);
    expect(resolved.nodesById.frame?.size).toEqual({ width: 110, height: 60 });
  });

  it("remeasures horizontal Fill + Auto Height text before ancestor Hug settles", () => {
    const document = layoutDocument();
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    frame.childIds = ["one", "copy"];
    frame.properties.autoLayout = {
      ...horizontal,
      sizing: { horizontal: "fixed", vertical: "hug" },
    };
    delete document.nodesById.one?.constraints;
    document.nodesById.copy = autoHeightText("copy", "frame", 10);
    document.nodesById.copy.layoutSizing = {
      horizontal: "fill",
      vertical: "fixed",
    };
    delete document.nodesById.two;
    const widths: number[] = [];
    const provider: TextLayoutProvider = {
      id: "auto-layout-text",
      version: "1",
      measure: (request) => {
        widths.push(request.width ?? 0);
        return {
          ok: true,
          provider: "auto-layout-text",
          providerVersion: "1",
          size: {
            width: request.width ?? 0,
            height: (request.width ?? 0) >= 200 ? 48 : 96,
          },
          warnings: [],
        };
      },
    };
    const runtime = new EditorRuntime(normalizeDesignDocument(document), {
      textLayoutProvider: provider,
    });
    const tx = transaction(runtime, [
      {
        commandId: "update_copy",
        type: "update_properties",
        nodeId: "copy",
        properties: { content: "A longer responsive sentence" },
      },
    ]);
    const preview = runtime.preview(tx);
    const applied = runtime.apply(tx);
    expect(preview).toMatchObject({ ok: true });
    expect(applied).toMatchObject({ ok: true });
    const resolved = runtime.getSnapshot().document;
    expectRect(resolved, "copy", 72, 10, 208, 48);
    expect(resolved.nodesById.frame?.size).toEqual({ width: 300, height: 68 });
    expect(widths).toContain(208);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.redo().ok).toBe(true);
    expect(
      normalizeDesignDocument(JSON.parse(JSON.stringify(resolved))),
    ).toEqual(resolved);
  });

  it("plans child sizing through strict conflicts, no-op, and reversible cleanup", () => {
    const runtime = enabledRuntime();
    const document = runtime.getSnapshot().document;
    const plan = planSetNodeLayoutSizing(
      document,
      "page_layout",
      "two",
      { horizontal: "fill", vertical: "fixed" },
      "fill_two",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(runtime.apply(transaction(runtime, plan.commands)).ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.two?.layoutSizing).toEqual({
      horizontal: "fill",
      vertical: "fixed",
    });
    expect(
      planSetNodeLayoutSizing(
        runtime.getSnapshot().document,
        "page_layout",
        "two",
        { horizontal: "fill", vertical: "fixed" },
        "again",
      ),
    ).toMatchObject({ ok: false, code: "no-op" });
    const disable = planSetFrameAutoLayout(
      runtime.getSnapshot().document,
      "page_layout",
      "frame",
      { mode: "none" },
      "disable",
    );
    if (!disable.ok) throw new Error(disable.message);
    expect(runtime.apply(transaction(runtime, disable.commands)).ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.two?.layoutSizing,
    ).toBeUndefined();

    const conflict = layoutDocument();
    const conflictFrame = conflict.nodesById.frame;
    if (conflictFrame?.kind !== "frame") throw new Error("missing frame");
    conflictFrame.properties.autoLayout = {
      ...horizontal,
      sizing: { horizontal: "hug", vertical: "fixed" },
    };
    delete conflict.nodesById.one?.constraints;
    expect(
      planSetNodeLayoutSizing(
        normalizeDesignDocument(conflict),
        "page_layout",
        "two",
        { horizontal: "fill", vertical: "fixed" },
        "conflict",
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });
  });

  it("converges an empty zero-padding Hug Frame without a phantom revision failure", () => {
    const document = layoutDocument();
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    frame.childIds = [];
    frame.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0,
      primaryAlignment: "start",
      counterAlignment: "start",
      sizing: { horizontal: "hug", vertical: "hug" },
    };
    delete document.nodesById.one;
    delete document.nodesById.two;
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const result = runtime.apply(
      transaction(runtime, [
        {
          commandId: "rename_empty_hug",
          type: "update_properties",
          nodeId: "frame",
          name: "Empty Hug",
        },
      ]),
    );
    expect(result).toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.nodesById.frame?.size).toEqual({
      width: 0,
      height: 0,
    });
  });

  it("wraps children after insert, hide, resize, reorder, and Frame resize", () => {
    const runtime = wrappedRuntime();
    expectRect(runtime.getSnapshot().document, "one", 10, 15, 80, 20);
    expectRect(runtime.getSnapshot().document, "two", 100, 10, 90, 30);
    expect(runtime.getSnapshot().document.nodesById.frame?.size.height).toBe(
      50,
    );

    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "insert_wrap_three",
            type: "insert_element",
            pageId: "page_layout",
            parentId: "frame",
            index: 2,
            node: rectangle("three", "frame", 0, 0, 60, 25),
          },
        ]),
      ).ok,
    ).toBe(true);
    expectRect(runtime.getSnapshot().document, "three", 10, 52, 60, 25);
    expect(runtime.getSnapshot().document.nodesById.frame?.size.height).toBe(
      87,
    );

    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "hide_wrap_two",
            type: "update_properties",
            nodeId: "two",
            visible: false,
          },
          {
            commandId: "grow_wrap_three",
            type: "update_properties",
            nodeId: "three",
            size: { width: 80, height: 25 },
          },
          {
            commandId: "reorder_wrap_three",
            type: "move_element",
            nodeId: "three",
            pageId: "page_layout",
            parentId: "frame",
            index: 0,
          },
        ]),
      ).ok,
    ).toBe(true);
    expectRect(runtime.getSnapshot().document, "three", 10, 10, 80, 25);
    expectRect(runtime.getSnapshot().document, "one", 100, 12.5, 80, 20);
    expect(runtime.getSnapshot().document.nodesById.frame?.size.height).toBe(
      45,
    );

    const resize = planResizeFrameWithConstraints(
      runtime.getSnapshot().document,
      "page_layout",
      "frame",
      { width: 180, height: 45 },
      "narrow_wrap",
    );
    if (!resize.ok) throw new Error(resize.message);
    expect(runtime.apply(transaction(runtime, resize.commands)).ok).toBe(true);
    expectRect(runtime.getSnapshot().document, "one", 10, 47, 80, 20);
    expect(runtime.getSnapshot().document.nodesById.frame?.size.height).toBe(
      77,
    );
  });

  it("keeps wrapped preview/apply/history/reopen deterministic", () => {
    const runtime = wrappedRuntime();
    const tx = transaction(runtime, [
      {
        commandId: "make_wrap_item_taller",
        type: "update_properties",
        nodeId: "two",
        size: { width: 130, height: 40 },
      },
    ]);
    const preview = runtime.preview(tx);
    const applied = runtime.apply(tx);
    expect(preview).toMatchObject({ ok: true });
    expect(applied).toMatchObject({ ok: true });
    if (!preview.ok || !applied.ok) return;
    expect(preview.changes).toEqual(applied.changes);
    expectRect(runtime.getSnapshot().document, "two", 10, 42, 130, 40);
    const resolved = runtime.getSnapshot().document;
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.redo().ok).toBe(true);
    expect(
      normalizeDesignDocument(JSON.parse(JSON.stringify(resolved))),
    ).toEqual(resolved);
  });

  it("propagates wrapped Hug height into a nested Hug ancestor", () => {
    const document = layoutDocument();
    const outer = document.nodesById.frame;
    if (outer?.kind !== "frame") throw new Error("missing frame");
    const wrapped = structuredClone(outer);
    wrapped.id = "wrapped";
    wrapped.parentId = "frame";
    wrapped.childIds = ["wrap_one", "wrap_two", "wrap_three"];
    wrapped.size = { width: 180, height: 1 };
    wrapped.properties.autoLayout = wrapLayout();
    document.nodesById.wrapped = wrapped;
    document.nodesById.wrap_one = rectangle(
      "wrap_one",
      "wrapped",
      0,
      0,
      80,
      20,
    );
    document.nodesById.wrap_two = rectangle(
      "wrap_two",
      "wrapped",
      0,
      0,
      80,
      30,
    );
    document.nodesById.wrap_three = rectangle(
      "wrap_three",
      "wrapped",
      0,
      0,
      80,
      25,
    );
    outer.childIds = ["wrapped"];
    outer.properties.autoLayout = {
      ...horizontal,
      sizing: { horizontal: "hug", vertical: "hug" },
    };
    delete document.nodesById.one;
    delete document.nodesById.two;
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "trigger_nested_wrap",
            type: "update_properties",
            nodeId: "wrap_three",
            name: "Third tag",
          },
        ]),
      ).ok,
    ).toBe(true);
    const resolved = runtime.getSnapshot().document;
    expect(resolved.nodesById.wrapped?.size).toEqual({
      width: 180,
      height: 119,
    });
    expect(resolved.nodesById.frame?.size).toEqual({ width: 220, height: 139 });
  });

  it("rejects Wrap with Hug width or visible Fill children before apply", () => {
    const document = layoutDocument();
    expect(
      planSetFrameAutoLayout(
        document,
        "page_layout",
        "frame",
        {
          ...wrapLayout(),
          sizing: { horizontal: "hug", vertical: "hug" },
        },
        "invalid_wrap_hug",
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });
    document.nodesById.two!.layoutSizing = {
      horizontal: "fill",
      vertical: "fixed",
    };
    expect(
      planSetFrameAutoLayout(
        document,
        "page_layout",
        "frame",
        wrapLayout(),
        "invalid_wrap_fill",
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });
  });

  it("applies Frame and fixed-child limits with padding as the hard minimum", () => {
    const document = layoutDocument();
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    frame.size = { width: 50, height: 20 };
    frame.layoutLimits = { maxWidth: 55, minHeight: 70 };
    frame.properties.autoLayout = {
      ...horizontal,
      padding: { top: 30, right: 30, bottom: 30, left: 30 },
      gap: 0,
      sizing: { horizontal: "fixed", vertical: "hug" },
    };
    frame.childIds = ["one"];
    document.nodesById.one!.layoutLimits = {
      minWidth: 120,
      maxWidth: 140,
      maxHeight: 8,
    };
    delete document.nodesById.one?.constraints;
    delete document.nodesById.two;
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const tx = transaction(runtime, [
      {
        commandId: "resolve_limits",
        type: "update_properties",
        nodeId: "one",
        name: "Bounded child",
      },
    ]);

    const preview = runtime.preview(tx);
    expect(preview).toMatchObject({ ok: true });
    expect(runtime.apply(tx)).toMatchObject({ ok: true });
    const resolved = runtime.getSnapshot().document;
    expect(resolved.nodesById.frame?.size).toEqual({ width: 60, height: 70 });
    expectRect(resolved, "one", 30, 31, 120, 8);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.redo().ok).toBe(true);
    expect(
      normalizeDesignDocument(JSON.parse(JSON.stringify(resolved))),
    ).toEqual(resolved);
  });

  it("redistributes Fill siblings at min/max bounds and remeasures bounded Auto Height text", () => {
    const document = layoutDocument();
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    frame.size = { width: 360, height: 80 };
    frame.properties.autoLayout = {
      ...horizontal,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      gap: 10,
      sizing: { horizontal: "fixed", vertical: "hug" },
    };
    frame.childIds = ["one", "two", "copy"];
    delete document.nodesById.one?.constraints;
    for (const nodeId of ["one", "two"] as const) {
      document.nodesById[nodeId]!.layoutSizing = {
        horizontal: "fill",
        vertical: "fixed",
      };
    }
    document.nodesById.one!.layoutLimits = { maxWidth: 60 };
    document.nodesById.two!.layoutLimits = { minWidth: 120 };
    document.nodesById.copy = autoHeightText("copy", "frame", 1);
    document.nodesById.copy.layoutSizing = {
      horizontal: "fill",
      vertical: "fixed",
    };
    document.nodesById.copy.layoutLimits = { minWidth: 100, maxWidth: 140 };
    const measuredWidths: number[] = [];
    const runtime = new EditorRuntime(normalizeDesignDocument(document), {
      textLayoutProvider: {
        id: "bounded-auto-height",
        version: "1",
        measure: (request) => {
          measuredWidths.push(request.width ?? 0);
          return {
            ok: true,
            provider: "bounded-auto-height",
            providerVersion: "1",
            size: { width: request.width ?? 0, height: 48 },
            warnings: [],
          };
        },
      },
    });
    expect(
      runtime.apply(
        transaction(runtime, [
          {
            commandId: "resolve_bounded_fill",
            type: "update_properties",
            nodeId: "copy",
            properties: { content: "Bounded responsive copy" },
          },
        ]),
      ).ok,
    ).toBe(true);
    const resolved = runtime.getSnapshot().document;
    expectRect(resolved, "one", 10, 24, 60, 20);
    expectRect(resolved, "two", 80, 19, 130, 30);
    expectRect(resolved, "copy", 220, 10, 130, 48);
    expect(resolved.nodesById.frame?.size.height).toBe(68);
    expect(measuredWidths).toContain(130);
  });

  it("plans layout limits strictly and rejects invalid generic scope atomically", () => {
    const runtime = enabledRuntime();
    const plan = planSetNodeLayoutLimits(
      runtime.getSnapshot().document,
      "page_layout",
      "two",
      { minWidth: 80, maxWidth: 160, minHeight: 24 },
      "bound_two",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(runtime.apply(transaction(runtime, plan.commands)).ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.two?.layoutLimits).toEqual({
      minWidth: 80,
      maxWidth: 160,
      minHeight: 24,
    });
    expect(
      planSetNodeLayoutLimits(
        runtime.getSnapshot().document,
        "page_layout",
        "two",
        { minWidth: 80, maxWidth: 160, minHeight: 24 },
        "again",
      ),
    ).toMatchObject({ ok: false, code: "no-op" });
    expect(
      planSetNodeLayoutLimits(
        runtime.getSnapshot().document,
        "page_layout",
        "two",
        { minWidth: 200, maxWidth: 100 },
        "inverted",
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });

    const ordinary = layoutDocument();
    const ordinaryRuntime = new EditorRuntime(
      normalizeDesignDocument(ordinary),
    );
    const revision = ordinaryRuntime.getSnapshot().document.revision;
    const invalid = ordinaryRuntime.apply(
      transaction(ordinaryRuntime, [
        {
          commandId: "bypass_limits_scope",
          type: "update_properties",
          nodeId: "two",
          layoutLimits: { minWidth: 80 },
        },
      ]),
    );
    expect(invalid).toMatchObject({ ok: false });
    expect(ordinaryRuntime.getSnapshot().document.revision).toBe(revision);
    expect(ordinaryRuntime.getSnapshot().state.history.undo).toHaveLength(0);
  });

  it("clears orphaned limits when flow is disabled but preserves nested Frame limits", () => {
    const runtime = enabledRuntime();
    const document = structuredClone(runtime.getSnapshot().document);
    const frame = document.nodesById.frame;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    document.nodesById.one!.layoutLimits = { minWidth: 40 };
    const nested = structuredClone(frame);
    nested.id = "nested_limits";
    nested.parentId = "frame";
    nested.childIds = [];
    nested.layoutLimits = { minWidth: 100, maxWidth: 240 };
    nested.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 4, right: 4, bottom: 4, left: 4 },
      gap: 4,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    document.nodesById.nested_limits = nested;
    frame.childIds.push("nested_limits");
    const nestedRuntime = new EditorRuntime(normalizeDesignDocument(document));
    const disable = planSetFrameAutoLayout(
      nestedRuntime.getSnapshot().document,
      "page_layout",
      "frame",
      { mode: "none" },
      "disable_limits",
    );
    if (!disable.ok) throw new Error(disable.message);
    expect(
      nestedRuntime.apply(transaction(nestedRuntime, disable.commands)).ok,
    ).toBe(true);
    const result = nestedRuntime.getSnapshot().document;
    expect(result.nodesById.one?.layoutLimits).toBeUndefined();
    expect(result.nodesById.nested_limits?.layoutLimits).toEqual({
      minWidth: 100,
      maxWidth: 240,
    });
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

function wrappedRuntime(): EditorRuntime {
  const document = layoutDocument();
  const frame = document.nodesById.frame;
  if (frame?.kind !== "frame") throw new Error("missing frame");
  frame.size = { width: 200, height: 1 };
  frame.properties.autoLayout = wrapLayout();
  document.nodesById.one!.size = { width: 80, height: 20 };
  document.nodesById.two!.size = { width: 90, height: 30 };
  delete document.nodesById.one?.constraints;
  const runtime = new EditorRuntime(normalizeDesignDocument(document));
  const initialized = runtime.apply(
    transaction(runtime, [
      {
        commandId: "initialize_wrap",
        type: "update_properties",
        nodeId: "frame",
        name: "Wrapped Frame",
      },
    ]),
  );
  if (!initialized.ok) throw new Error(initialized.error.message);
  return runtime;
}

function wrapLayout(): AutoLayoutFlow {
  return {
    mode: "horizontal",
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
    gap: 10,
    primaryAlignment: "start",
    counterAlignment: "center",
    sizing: { horizontal: "fixed", vertical: "hug" },
    wrap: { mode: "wrap", counterGap: 12 },
  };
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

function autoHeightText(
  id: string,
  parentId: string,
  width: number,
): Extract<DesignNode, { kind: "text" }> {
  return {
    id,
    kind: "text",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width, height: 24 },
    exportSettings: [],
    opacity: 1,
    properties: {
      content: "Responsive copy",
      fontFamily: "Inter",
      fontStyleName: null,
      fontSize: 16,
      fontWeight: 400,
      fontSlant: "normal",
      lineHeight: 24,
      letterSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      textCase: "original",
      textDecoration: "none",
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textResize: "auto-height",
      textWrap: "word",
      textOverflow: "visible",
      textTruncation: "disabled",
      maxLines: null,
      fills: [],
      strokes: [],
      strokeWidth: 0,
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
