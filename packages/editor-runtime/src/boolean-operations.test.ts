import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  type BooleanNode,
  type BooleanOperation,
  type DesignDocument,
  type DesignNode,
  type DesignTransaction,
  type PathNode,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  canCreateBooleanGroup,
  canUngroupBooleanGroup,
  getWorldTransform,
  normalizeDesignDocument,
  planCreateBooleanGroup,
  planReparentNodes,
  planSetBooleanOperation,
  planUngroupBooleanGroup,
} from "./index.js";

function transaction(
  runtime: EditorRuntime,
  transactionId: string,
  commands: DesignTransaction["commands"],
  baseRevision = runtime.getSnapshot().document.revision,
): DesignTransaction {
  return {
    transactionId,
    documentId: runtime.getSnapshot().document.documentId,
    baseRevision,
    actor: { type: "user", id: "boolean-test" },
    label: transactionId,
    commands,
  };
}

function pathNode(
  id: string,
  name: string,
  transform: PathNode["transform"],
  color: string,
  opacity: number,
): PathNode {
  return {
    id,
    kind: "path",
    name,
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform,
    size: { width: 100, height: 100 },
    exportSettings: [],
    opacity,
    effects: [
      {
        type: "outer-glow",
        color,
        opacity: 0.4,
        radius: 12,
        spread: 1,
      },
    ],
    properties: {
      path: "M0 0H100V100H0Z",
      fillRule: "evenodd",
      fills: [{ type: "solid", color, opacity: 1 }],
      strokes: [{ type: "solid", color: "#ffffff", opacity: 0.7 }],
      strokeWidth: 4,
      strokeAlign: "center",
      strokeCap: "round",
      strokeJoin: "round",
      dashPattern: [],
    },
    extensions: {},
  };
}

function booleanDocument(): DesignDocument {
  const bottom = pathNode(
    "path_bottom",
    "Bottom",
    [0.96, 0.2, -0.2, 0.96, 20, 30],
    "#ef4444",
    0.8,
  );
  const top = pathNode("path_top", "Top", [1, 0, 0, 1, 68, 42], "#2563eb", 0.6);
  const unrelated: DesignNode = {
    id: "rect_unrelated",
    kind: "rectangle",
    name: "Unrelated",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 260, 20],
    size: { width: 80, height: 80 },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [{ type: "solid", color: "#22c55e", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 12,
    },
    extensions: {},
  };
  return normalizeDesignDocument({
    format: DESIGN_FORMAT,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "document_boolean",
    revision: 0,
    pageOrder: ["page_boolean"],
    pagesById: {
      page_boolean: {
        id: "page_boolean",
        name: "Boolean",
        rootNodeIds: [bottom.id, top.id, unrelated.id],
        extensions: {},
      },
    },
    nodesById: {
      [bottom.id]: bottom,
      [top.id]: top,
      [unrelated.id]: unrelated,
    },
    componentsById: {},
    variantSetsById: {},
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
    interactionsById: {},
    assetsById: {},
    extensions: {},
  });
}

function createPlan(
  document: DesignDocument,
  operation: BooleanOperation = "union",
) {
  return planCreateBooleanGroup(
    document,
    "page_boolean",
    ["path_top", "path_bottom"],
    operation,
    {
      booleanId: `boolean_${operation}`,
      name: `${operation} mark`,
      commandPrefix: `boolean_${operation}`,
    },
  );
}

function expectTransformClose(
  actual: readonly number[] | null,
  expected: readonly number[] | null,
): void {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  expected?.forEach((value, index) =>
    expect(actual?.[index]).toBeCloseTo(value, 10),
  );
}

describe("non-destructive Boolean operations", () => {
  it("creates an ordered Boolean group and preserves source geometry", () => {
    const runtime = new EditorRuntime(booleanDocument());
    const before = runtime.getSnapshot().document;
    const bottomWorld = getWorldTransform(before, "path_bottom");
    const topWorld = getWorldTransform(before, "path_top");
    const plan = createPlan(before);

    expect(plan.ok).toBe(true);
    expect(
      canCreateBooleanGroup(before, "page_boolean", [
        "path_top",
        "path_bottom",
      ]),
    ).toBe(true);
    if (!plan.ok) return;
    expect(
      runtime.apply(transaction(runtime, "create_union", plan.commands)),
    ).toMatchObject({ ok: true, revision: { revision: 1 } });

    const snapshot = runtime.getSnapshot();
    const booleanNode = snapshot.document.nodesById.boolean_union;
    expect(booleanNode).toMatchObject({
      kind: "boolean",
      name: "union mark",
      parentId: null,
      childIds: ["path_bottom", "path_top"],
      exportSettings: [],
      opacity: 0.6,
      properties: {
        operation: "union",
        fillRule: "evenodd",
        fills: [{ type: "solid", color: "#2563eb", opacity: 1 }],
        strokeWidth: 4,
      },
    });
    expect(booleanNode?.properties).not.toHaveProperty("path");
    expect(snapshot.document.pagesById.page_boolean?.rootNodeIds).toEqual([
      "boolean_union",
      "rect_unrelated",
    ]);
    expectTransformClose(
      getWorldTransform(snapshot.document, "path_bottom"),
      bottomWorld,
    );
    expectTransformClose(
      getWorldTransform(snapshot.document, "path_top"),
      topWorld,
    );
    expect(snapshot.document.nodesById.path_bottom).toMatchObject({
      properties: {
        fills: [{ type: "solid", color: "#ef4444", opacity: 1 }],
      },
    });
    expect(
      planReparentNodes(snapshot.document, "page_boolean", ["path_top"], {
        parentId: null,
        index: 1,
        commandPrefix: "invalid_boolean_escape",
      }),
    ).toMatchObject({
      ok: false,
      code: "invalid-target",
      message:
        "Moving these layers would leave fewer than two Boolean operands; ungroup the Boolean instead",
    });
  });

  it("uses the Figma-compatible bottom appearance for subtract", () => {
    const plan = createPlan(booleanDocument(), "subtract");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const insert = plan.commands[0];
    expect(insert?.type).toBe("insert_element");
    if (insert?.type !== "insert_element") return;
    expect(insert.node).toMatchObject({
      kind: "boolean",
      exportSettings: [],
      opacity: 0.8,
      properties: {
        operation: "subtract",
        fills: [{ type: "solid", color: "#ef4444", opacity: 1 }],
      },
    });
  });

  it("round-trips through persistence, undo, redo, and ungroup", () => {
    const runtime = new EditorRuntime(booleanDocument());
    const original = runtime.getSnapshot().document;
    const originalBottomWorld = getWorldTransform(original, "path_bottom");
    const originalTopWorld = getWorldTransform(original, "path_top");
    const plan = createPlan(original);
    if (!plan.ok) throw new Error(plan.message);
    expect(
      runtime.apply(transaction(runtime, "create_round_trip", plan.commands))
        .ok,
    ).toBe(true);
    const grouped = runtime.getSnapshot().document;
    expect(
      normalizeDesignDocument(JSON.parse(JSON.stringify(grouped))),
    ).toEqual(grouped);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.nodesById.boolean_union).toBeFalsy();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    expect(runtime.getSnapshot().document.nodesById.boolean_union).toBeTruthy();

    const ungroup = planUngroupBooleanGroup(
      runtime.getSnapshot().document,
      "page_boolean",
      "boolean_union",
      "release_union",
    );
    expect(ungroup.ok).toBe(true);
    expect(
      canUngroupBooleanGroup(runtime.getSnapshot().document, "page_boolean", [
        "boolean_union",
      ]),
    ).toBe(true);
    if (!ungroup.ok) return;
    expect(
      runtime.apply(transaction(runtime, "release_union", ungroup.commands)).ok,
    ).toBe(true);
    const released = runtime.getSnapshot().document;
    expect(released.nodesById.boolean_union).toBeUndefined();
    expect(released.pagesById.page_boolean?.rootNodeIds).toEqual([
      "path_bottom",
      "path_top",
      "rect_unrelated",
    ]);
    expectTransformClose(
      getWorldTransform(released, "path_bottom"),
      originalBottomWorld,
    );
    expectTransformClose(
      getWorldTransform(released, "path_top"),
      originalTopWorld,
    );
  });

  it("allows operand geometry edits but rejects per-operand appearance edits", () => {
    const runtime = new EditorRuntime(booleanDocument());
    const plan = createPlan(runtime.getSnapshot().document);
    if (!plan.ok) throw new Error(plan.message);
    runtime.apply(transaction(runtime, "create_for_edit", plan.commands));

    expect(
      runtime.apply(
        transaction(runtime, "edit_operand_geometry", [
          {
            commandId: "edit_path",
            type: "update_properties",
            nodeId: "path_top",
            properties: { path: "M0 0H80V100H0Z" },
          },
        ]),
      ),
    ).toMatchObject({ ok: true });
    expect(
      runtime.apply(
        transaction(runtime, "edit_operand_appearance", [
          {
            commandId: "edit_fill",
            type: "update_properties",
            nodeId: "path_top",
            properties: {
              fills: [{ type: "solid", color: "#000000", opacity: 1 }],
            },
          },
        ]),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid",
        message:
          "Boolean operand fill and stroke are controlled by its Boolean parent",
      },
    });
  });

  it("changes only the group operation and retains its independent appearance", () => {
    const runtime = new EditorRuntime(booleanDocument());
    const create = createPlan(runtime.getSnapshot().document);
    if (!create.ok) throw new Error(create.message);
    runtime.apply(
      transaction(runtime, "create_for_operation", create.commands),
    );
    const before = runtime.getSnapshot().document.nodesById.boolean_union;
    const change = planSetBooleanOperation(
      runtime.getSnapshot().document,
      "page_boolean",
      "boolean_union",
      "exclude",
      "set_exclude",
    );
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(
      runtime.apply(transaction(runtime, "set_exclude", change.commands)).ok,
    ).toBe(true);
    const after = runtime.getSnapshot().document.nodesById.boolean_union;
    expect(after).toMatchObject({
      kind: "boolean",
      properties: { operation: "exclude" },
    });
    expect(after?.kind === "boolean" && before?.kind === "boolean").toBe(true);
    if (after?.kind !== "boolean" || before?.kind !== "boolean") return;
    expect(after.properties.fills).toEqual(before.properties.fills);
  });

  it("rejects unsupported, masked, locked, and stale requests without mutation", () => {
    const document = structuredClone(booleanDocument());
    document.nodesById.path_top!.locked = true;
    const locked = normalizeDesignDocument(document);
    expect(createPlan(locked)).toMatchObject({ ok: false, code: "locked" });

    const maskedDraft = structuredClone(booleanDocument());
    maskedDraft.nodesById.path_top!.maskMode = "alpha";
    const masked = normalizeDesignDocument(maskedDraft);
    expect(createPlan(masked)).toMatchObject({
      ok: false,
      code: "visual-fidelity",
    });

    expect(
      planCreateBooleanGroup(
        booleanDocument(),
        "page_boolean",
        ["path_bottom", "rect_unrelated"],
        "divide" as BooleanOperation,
        {
          booleanId: "boolean_invalid",
          name: "Invalid",
          commandPrefix: "invalid",
        },
      ),
    ).toMatchObject({ ok: false, code: "invalid-operation" });

    const runtime = new EditorRuntime(booleanDocument());
    const plan = createPlan(runtime.getSnapshot().document);
    if (!plan.ok) throw new Error(plan.message);
    expect(
      runtime.apply(transaction(runtime, "stale_boolean", plan.commands, 1)),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(runtime.getSnapshot().document.revision).toBe(0);
  });

  it("enforces Boolean document invariants independently of transaction order", () => {
    const document = structuredClone(booleanDocument());
    const bottom = document.nodesById.path_bottom!;
    bottom.parentId = "boolean_invalid";
    const invalid: BooleanNode = {
      id: "boolean_invalid",
      kind: "boolean",
      name: "Invalid",
      parentId: null,
      childIds: [bottom.id],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      properties: {
        operation: "union",
        fills: [],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    document.nodesById[invalid.id] = invalid;
    document.pagesById.page_boolean!.rootNodeIds = [
      invalid.id,
      "path_top",
      "rect_unrelated",
    ];
    expect(() => normalizeDesignDocument(document)).toThrow(
      "boolean nodes require at least two operands",
    );
  });

  it("rejects an open Line as a Boolean operand until outline stroke is explicit", () => {
    const document = structuredClone(booleanDocument());
    const bottom = document.nodesById.path_bottom!;
    bottom.parentId = "boolean_with_line";
    document.nodesById.line_open = {
      id: "line_open",
      kind: "line",
      name: "Open line",
      parentId: "boolean_with_line",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 0 },
      exportSettings: [],
      opacity: 1,
      properties: {
        fills: [],
        strokes: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokeWidth: 4,
        strokeAlign: "center",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [],
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        startEndpoint: "none",
        endEndpoint: "line-arrow",
      },
      extensions: {},
    };
    document.nodesById.boolean_with_line = {
      id: "boolean_with_line",
      kind: "boolean",
      name: "Invalid open operand",
      parentId: null,
      childIds: [bottom.id, "line_open"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      properties: {
        operation: "union",
        fills: [],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    document.pagesById.page_boolean!.rootNodeIds = [
      "boolean_with_line",
      "path_top",
      "rect_unrelated",
    ];

    expect(() => normalizeDesignDocument(document)).toThrow(
      "line nodes cannot be boolean operands",
    );
  });

  it("accepts sharp Polygon and Star operands but rejects rounded outlines", () => {
    const document = structuredClone(booleanDocument());
    const star: DesignNode = {
      id: "star_operand",
      kind: "star",
      name: "Star operand",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 140, 30],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      properties: {
        pointCount: 5,
        innerRadius: 0.4,
        cornerRadius: 0,
        fills: [{ type: "solid", color: "#f59e0b", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    document.nodesById[star.id] = star;
    document.pagesById.page_boolean!.rootNodeIds.push(star.id);
    const sharp = normalizeDesignDocument(document);

    expect(
      planCreateBooleanGroup(
        sharp,
        "page_boolean",
        ["path_bottom", star.id],
        "union",
        {
          booleanId: "boolean_regular_shape",
          name: "Regular shape union",
          commandPrefix: "regular_shape",
        },
      ),
    ).toMatchObject({ ok: true });

    const roundedDraft = structuredClone(sharp);
    const rounded = roundedDraft.nodesById[star.id];
    if (!rounded || rounded.kind !== "star") throw new Error("Missing star");
    rounded.properties.cornerRadius = 8;
    const roundedPlan = planCreateBooleanGroup(
      normalizeDesignDocument(roundedDraft),
      "page_boolean",
      ["path_bottom", star.id],
      "union",
      {
        booleanId: "boolean_rounded_shape",
        name: "Rounded shape union",
        commandPrefix: "rounded_shape",
      },
    );
    expect(roundedPlan).toMatchObject({
      ok: false,
      code: "visual-fidelity",
    });
    if (roundedPlan.ok) throw new Error("Expected rounded shape rejection");
    expect(roundedPlan.message).toContain("exact rounded outline");
  });
});
