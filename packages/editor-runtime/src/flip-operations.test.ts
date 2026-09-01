import type { DesignTransaction } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  createWelcomeDocument,
  EditorRuntime,
  getNodeBounds,
  getWorldTransform,
  normalizeDesignDocument,
  planFlipNodes,
  resolveAutoLayoutInPlace,
} from "./index.js";

function applyFlip(
  runtime: EditorRuntime,
  nodeIds: readonly string[],
  axis: "horizontal" | "vertical",
) {
  const before = runtime.getSnapshot().document;
  const plan = planFlipNodes(
    before,
    "page_welcome",
    nodeIds,
    axis,
    `flip_${axis}`,
  );
  if (!plan.ok) throw new Error(plan.message);
  const transaction: DesignTransaction = {
    transactionId: `flip_${axis}_${before.revision}`,
    documentId: before.documentId,
    baseRevision: before.revision,
    actor: { type: "user", id: "flip-test" },
    label: `flip_${axis}`,
    commands: plan.commands,
  };
  expect(runtime.apply(transaction).ok).toBe(true);
  return plan;
}

function expectTransformClose(
  actual: readonly number[] | null,
  expected: readonly number[] | null,
) {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  expected?.forEach((value, index) =>
    expect(actual?.[index]).toBeCloseTo(value, 9),
  );
}

describe("flip operations", () => {
  it("flips one layer around its document-space center and round-trips", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const before = runtime.getSnapshot().document;
    const bounds = getNodeBounds(before, "title_welcome");
    const world = getWorldTransform(before, "title_welcome");

    applyFlip(runtime, ["title_welcome"], "horizontal");
    const flipped = runtime.getSnapshot();
    expect(getNodeBounds(flipped.document, "title_welcome")).toEqual(bounds);
    expect(flipped.document.nodesById.title_welcome?.transform[0]).toBe(-1);
    expect(flipped.document.revision).toBe(1);
    expect(flipped.state.history.undo).toHaveLength(1);

    applyFlip(runtime, ["title_welcome"], "horizontal");
    expectTransformClose(
      getWorldTransform(runtime.getSnapshot().document, "title_welcome"),
      world,
    );
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.redo().ok).toBe(true);
  });

  it("mirrors a multi-parent selection as one document-space selection", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.frame_welcome!.transform = [
      0.8, 0.2, -0.2, 0.8, 120, 80,
    ];
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const before = runtime.getSnapshot().document;
    const title = getNodeBounds(before, "title_welcome")!;
    const feature = getNodeBounds(before, "feature_one")!;
    const centerX =
      (Math.min(title.x, feature.x) +
        Math.max(title.x + title.width, feature.x + feature.width)) /
      2;

    applyFlip(runtime, ["title_welcome", "feature_one"], "horizontal");
    const flipped = runtime.getSnapshot().document;
    const nextTitle = getNodeBounds(flipped, "title_welcome")!;
    const nextFeature = getNodeBounds(flipped, "feature_one")!;
    expect(nextTitle.x).toBeCloseTo(2 * centerX - title.x - title.width, 9);
    expect(nextFeature.x).toBeCloseTo(
      2 * centerX - feature.x - feature.width,
      9,
    );
  });

  it("uses the selected layer's local axis when it is rotated", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.title_welcome!.transform = [0, 1, -1, 0, 200, 100];
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const beforeBounds = getNodeBounds(
      runtime.getSnapshot().document,
      "title_welcome",
    );

    applyFlip(runtime, ["title_welcome"], "horizontal");
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.transform,
    ).toEqual([0, -1, -1, 0, 200, 820]);
    expect(
      getNodeBounds(runtime.getSnapshot().document, "title_welcome"),
    ).toEqual(beforeBounds);
  });

  it("deduplicates nested selections and preserves child order", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const before = runtime.getSnapshot().document;
    const childIds = [...before.nodesById.feature_group!.childIds];
    const plan = applyFlip(
      runtime,
      ["feature_group", "feature_one"],
      "vertical",
    );

    expect(plan.selectionNodeIds).toEqual(["feature_group"]);
    expect(
      runtime.getSnapshot().document.nodesById.feature_group?.childIds,
    ).toEqual(childIds);
  });

  it("flips an ordinary Instance root without mutating its component reference", () => {
    const document = structuredClone(createWelcomeDocument());
    const source = document.nodesById.feature_two!;
    document.nodesById.component_source = {
      ...document.nodesById.feature_group!,
      id: "component_source",
      name: "Test component source",
      parentId: null,
      childIds: [],
      transform: [1, 0, 0, 1, 900, 100],
    };
    document.pagesById.page_welcome!.rootNodeIds.push("component_source");
    document.componentsById.test_component = {
      id: "test_component",
      name: "Test component",
      rootNodeId: "component_source",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    document.nodesById.feature_two = {
      ...source,
      childIds: [],
      kind: "instance",
      properties: {
        componentId: "test_component",
        componentProperties: {},
        overrides: [],
      },
    };
    const runtime = new EditorRuntime(normalizeDesignDocument(document));

    applyFlip(runtime, ["feature_two"], "horizontal");

    expect(runtime.getSnapshot().document.nodesById.feature_two).toMatchObject({
      kind: "instance",
      properties: { componentId: "test_component", overrides: [] },
      transform: [-1, 0, 0, 1, 640, 0],
    });
  });

  it("keeps Auto Layout flow positions while preserving the flip on reflow", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome!;
    if (frame.kind !== "frame") throw new Error("Missing welcome frame");
    frame.properties.autoLayout = {
      mode: "horizontal",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 24,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    const runtime = new EditorRuntime(normalizeDesignDocument(document));

    applyFlip(runtime, ["title_welcome", "subtitle_welcome"], "horizontal");
    const flipped = runtime.getSnapshot().document;
    const firstX = getNodeBounds(flipped, "title_welcome")?.x;
    const secondX = getNodeBounds(flipped, "subtitle_welcome")?.x;
    expect(flipped.nodesById.title_welcome?.transform[0]).toBe(-1);
    expect(flipped.nodesById.subtitle_welcome?.transform[0]).toBe(-1);
    expect(firstX).toBeLessThan(secondX ?? Number.NEGATIVE_INFINITY);

    const reopened = structuredClone(
      normalizeDesignDocument(JSON.parse(JSON.stringify(flipped))),
    );
    expect(resolveAutoLayoutInPlace(reopened).ok).toBe(true);
    expect(reopened.nodesById.title_welcome?.transform[0]).toBe(-1);
    expect(reopened.nodesById.subtitle_welcome?.transform[0]).toBe(-1);
    expect(getNodeBounds(reopened, "title_welcome")?.x).toBeCloseTo(firstX!, 9);
    expect(getNodeBounds(reopened, "subtitle_welcome")?.x).toBeCloseTo(
      secondX!,
      9,
    );
  });

  it("rejects stale targets, locked layers, foreign Pages, and singular parents", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.feature_group!.locked = true;
    expect(
      planFlipNodes(
        document,
        "page_welcome",
        ["feature_one"],
        "horizontal",
        "locked",
      ),
    ).toMatchObject({ ok: false, code: "locked" });
    expect(
      planFlipNodes(
        document,
        "missing_page",
        ["title_welcome"],
        "horizontal",
        "page",
      ),
    ).toMatchObject({ ok: false, code: "not-found" });
    expect(
      planFlipNodes(
        document,
        "page_welcome",
        ["missing"],
        "vertical",
        "missing",
      ),
    ).toMatchObject({ ok: false, code: "not-found" });

    document.nodesById.feature_group!.locked = false;
    document.nodesById.feature_group!.transform = [0, 0, 0, 0, 64, 340];
    expect(
      planFlipNodes(
        document,
        "page_welcome",
        ["feature_one"],
        "horizontal",
        "singular",
      ),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });
  });
});
