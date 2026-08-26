import type { DesignTransaction } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  createWelcomeDocument,
  getArrangementSelectionMetrics,
  getNodeBounds,
  getWorldTransform,
  normalizeDesignDocument,
  planArrangeNodes,
  planSmartSelectionSpacing,
} from "./index.js";

function transaction(
  runtime: EditorRuntime,
  id: string,
  commands: DesignTransaction["commands"],
): DesignTransaction {
  const document = runtime.getSnapshot().document;
  return {
    transactionId: id,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "arrange-test" },
    label: id,
    commands,
  };
}

function expectWorldClose(
  actual: readonly number[] | null,
  expected: readonly number[] | null,
) {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  expected?.forEach((value, index) =>
    expect(actual?.[index]).toBeCloseTo(value, 9),
  );
}

describe("arrange operations", () => {
  it("distributes unequal child positions and keeps the outer Group normalized", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.feature_two!.transform[4] = 440;
    document.nodesById.feature_three!.transform[4] = 800;
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const before = runtime.getSnapshot().document;
    const firstWorld = getWorldTransform(before, "feature_one");
    const thirdWorld = getWorldTransform(before, "feature_three");
    const plan = planArrangeNodes(
      before,
      "page_welcome",
      ["feature_one", "feature_two", "feature_three"],
      { action: "distribute-horizontal" },
      "distribute_features",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.resolvedSpacing).toBe(96);
    expect(
      runtime.apply(transaction(runtime, "distribute_features", plan.commands))
        .ok,
    ).toBe(true);
    const moved = runtime.getSnapshot();
    expect(moved.document.nodesById.feature_group?.size).toEqual({
      width: 972,
      height: 220,
    });
    expect(getNodeBounds(moved.document, "feature_two")?.x).toBe(544);
    expectWorldClose(
      getWorldTransform(moved.document, "feature_one"),
      firstWorld,
    );
    expectWorldClose(
      getWorldTransform(moved.document, "feature_three"),
      thirdWorld,
    );
    expect(moved.state.history.undo).toHaveLength(1);
  });

  it("sets explicit negative spacing in one transaction and survives reopen/undo/redo", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(
      ["feature_one", "feature_two", "feature_three"],
      "feature_one",
    );
    const before = runtime.getSnapshot();
    const plan = planArrangeNodes(
      before.document,
      "page_welcome",
      before.state.selection.nodeIds,
      { action: "set-horizontal-spacing", spacing: -20 },
      "overlap_features",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(
      runtime.apply(transaction(runtime, "overlap_features", plan.commands)).ok,
    ).toBe(true);
    const arranged = runtime.getSnapshot();
    expect(arranged.document.nodesById.feature_group?.size.width).toBe(740);
    expect(getNodeBounds(arranged.document, "feature_two")?.x).toBe(428);
    expect(getNodeBounds(arranged.document, "feature_three")?.x).toBe(712);
    expect(arranged.state.selection).toEqual(before.state.selection);
    const reopened = normalizeDesignDocument(
      JSON.parse(JSON.stringify(arranged.document)),
    );
    expect(reopened.nodesById.feature_group?.size.width).toBe(740);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.redo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.feature_group?.size.width,
    ).toBe(740);
  });

  it("aligns across transformed parents using document-space bounds", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.frame_welcome!.transform = [
      0.8, 0.2, -0.2, 0.8, 120, 80,
    ];
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const plan = planArrangeNodes(
      runtime.getSnapshot().document,
      "page_welcome",
      ["title_welcome", "feature_one"],
      { action: "align-left" },
      "align_cross_parent",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(
      runtime.apply(transaction(runtime, "align_cross_parent", plan.commands))
        .ok,
    ).toBe(true);
    const aligned = runtime.getSnapshot().document;
    expect(getNodeBounds(aligned, "title_welcome")?.x).toBeCloseTo(
      getNodeBounds(aligned, "feature_one")?.x ?? Number.NaN,
      9,
    );
  });

  it("reports current spacing metrics without mutating the document", () => {
    const document = createWelcomeDocument();
    expect(
      getArrangementSelectionMetrics(document, "page_welcome", [
        "feature_one",
        "feature_two",
        "feature_three",
      ]),
    ).toMatchObject({
      horizontalSpacing: null,
      canDistributeHorizontal: true,
      canDistributeVertical: false,
      canTidyUp: true,
      tidyUpDimension: "horizontal",
    });
    expect(document.revision).toBe(0);
  });

  it("tidies an unequal two-dimensional selection through one reversible transaction", () => {
    const document = structuredClone(createWelcomeDocument());
    const template = document.nodesById.feature_one!;
    const placements = [
      ["grid_a", 0, 0, 120, 80],
      ["grid_b", 160, 4, 100, 60],
      ["grid_c", 310, 2, 80, 70],
      ["grid_d", 6, 140, 90, 90],
      ["grid_e", 170, 150, 110, 50],
      ["grid_f", 340, 146, 70, 75],
    ] as const;
    for (const [id, x, y, width, height] of placements) {
      document.nodesById[id] = {
        ...structuredClone(template),
        id,
        name: id,
        transform: [1, 0, 0, 1, x, y],
        size: { width, height },
      };
    }
    document.nodesById.feature_group!.childIds = placements.map(([id]) => id);
    document.nodesById.feature_group!.size = { width: 410, height: 240 };
    delete document.nodesById.feature_one;
    delete document.nodesById.feature_two;
    delete document.nodesById.feature_three;
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const before = runtime.getSnapshot().document;
    const plan = planArrangeNodes(
      before,
      "page_welcome",
      placements.map(([id]) => id),
      { action: "tidy-up" },
      "tidy_grid",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(plan).toMatchObject({
      tidyUpDimension: "grid",
      resolvedHorizontalSpacing: 40,
      resolvedVerticalSpacing: 60,
      orderedNodeIds: placements.map(([id]) => id),
    });
    expect(
      runtime.apply(transaction(runtime, "tidy_grid", plan.commands)).ok,
    ).toBe(true);
    const arranged = runtime.getSnapshot();
    expect(getNodeBounds(arranged.document, "grid_a")).toMatchObject({
      x: 144,
      y: 404,
    });
    expect(getNodeBounds(arranged.document, "grid_e")).toMatchObject({
      x: 304,
      y: 544,
    });
    expect(arranged.state.history.undo).toHaveLength(1);
    expect(runtime.undo().ok).toBe(true);
    expect(getNodeBounds(runtime.getSnapshot().document, "grid_e")).toEqual(
      getNodeBounds(before, "grid_e"),
    );
    expect(runtime.redo().ok).toBe(true);
    expect(getNodeBounds(runtime.getSnapshot().document, "grid_e")?.x).toBe(
      304,
    );
  });

  it("changes one Smart grid spacing axis in one revision without flattening rows", () => {
    const document = structuredClone(createWelcomeDocument());
    const template = document.nodesById.feature_one!;
    const placements = [
      ["smart_a", 0, 0, 30, 20],
      ["smart_b", 50, 0, 40, 30],
      ["smart_c", 110, 0, 20, 25],
      ["smart_d", 0, 70, 20, 40],
      ["smart_e", 50, 70, 30, 20],
      ["smart_f", 110, 70, 50, 35],
    ] as const;
    for (const [id, x, y, width, height] of placements) {
      document.nodesById[id] = {
        ...structuredClone(template),
        id,
        name: id,
        transform: [1, 0, 0, 1, x, y],
        size: { width, height },
      };
    }
    document.nodesById.feature_group!.childIds = placements.map(([id]) => id);
    document.nodesById.feature_group!.size = { width: 160, height: 110 };
    delete document.nodesById.feature_one;
    delete document.nodesById.feature_two;
    delete document.nodesById.feature_three;
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const before = runtime.getSnapshot();
    const plan = planSmartSelectionSpacing(
      before.document,
      "page_welcome",
      placements.map(([id]) => id),
      "horizontal",
      10,
      "smart_horizontal",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(plan).toMatchObject({
      action: "set-horizontal-spacing",
      resolvedHorizontalSpacing: 10,
      resolvedVerticalSpacing: 40,
      tidyUpDimension: "grid",
    });
    expect(runtime.apply(transaction(runtime, "smart", plan.commands)).ok).toBe(
      true,
    );
    const result = runtime.getSnapshot();
    expect(getNodeBounds(result.document, "smart_b")).toMatchObject({
      x: 184,
      y: 404,
    });
    expect(getNodeBounds(result.document, "smart_e")).toMatchObject({
      x: 184,
      y: 474,
    });
    expect(result.document.revision).toBe(before.document.revision + 1);
    expect(result.state.history.undo).toHaveLength(
      before.state.history.undo.length + 1,
    );
    expect(runtime.undo().ok).toBe(true);
    expect(getNodeBounds(runtime.getSnapshot().document, "smart_e")?.x).toBe(
      194,
    );
  });

  it("rejects locked, singular, no-op, and insufficient selections atomically", () => {
    const locked = structuredClone(createWelcomeDocument());
    locked.nodesById.feature_group!.locked = true;
    expect(
      planArrangeNodes(
        locked,
        "page_welcome",
        ["feature_one", "feature_two"],
        { action: "align-left" },
        "locked",
      ),
    ).toMatchObject({ ok: false, code: "locked" });

    const singular = structuredClone(createWelcomeDocument());
    singular.nodesById.feature_group!.transform = [0, 0, 0, 0, 64, 340];
    expect(
      planArrangeNodes(
        singular,
        "page_welcome",
        ["feature_one", "feature_two"],
        { action: "set-horizontal-spacing", spacing: 20 },
        "singular",
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });

    const document = structuredClone(createWelcomeDocument());
    document.nodesById.feature_three!.transform[4] = 672;
    expect(
      planArrangeNodes(
        document,
        "page_welcome",
        ["feature_one", "feature_two", "feature_three"],
        { action: "distribute-horizontal" },
        "noop",
      ),
    ).toMatchObject({ ok: false, code: "no-op" });
    expect(
      planArrangeNodes(
        document,
        "page_welcome",
        ["feature_one"],
        { action: "align-left" },
        "one",
      ),
    ).toMatchObject({ ok: false, code: "invalid-selection" });
  });

  it("rejects arrangements whose Group compensation exceeds the transaction command limit", () => {
    const document = structuredClone(createWelcomeDocument());
    const template = document.nodesById.feature_one!;
    delete document.nodesById.feature_one;
    delete document.nodesById.feature_two;
    delete document.nodesById.feature_three;
    const nodeIds = Array.from({ length: 500 }, (_, index) => `dense_${index}`);
    for (const [index, nodeId] of nodeIds.entries()) {
      document.nodesById[nodeId] = {
        ...structuredClone(template),
        id: nodeId,
        name: `Dense ${index}`,
        transform: [1, 0, 0, 1, 10 + index * 40, 0],
      };
    }
    document.nodesById.feature_group!.childIds = nodeIds;
    document.nodesById.feature_group!.size = { width: 20_000, height: 220 };
    const plan = planArrangeNodes(
      document,
      "page_welcome",
      nodeIds,
      { action: "set-horizontal-spacing", spacing: 10 },
      "over_limit",
    );

    expect(plan).toMatchObject({ ok: false, code: "operation-limit" });
    expect(document.revision).toBe(0);
    expect(document.nodesById.feature_group?.childIds).toHaveLength(500);
  });
});
