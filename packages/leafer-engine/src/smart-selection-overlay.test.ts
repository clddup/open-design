import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import {
  createSmartSelectionOverlayPlan,
  documentDeltaToNodeParent,
} from "./smart-selection-overlay.js";

describe("Smart selection overlay geometry", () => {
  it("projects uniform one-dimensional gaps and center rings from world bounds", () => {
    const document = smartRowDocument();
    const plan = createSmartSelectionOverlayPlan(document, "page_welcome", [
      "feature_three",
      "feature_one",
      "feature_two",
    ]);

    expect(plan).toMatchObject({
      dimension: "horizontal",
      nodeIds: ["feature_one", "feature_two", "feature_three"],
      handles: [
        { axis: "horizontal", value: 20 },
        { axis: "horizontal", value: 20 },
      ],
    });
    expect(plan?.rings).toHaveLength(3);
    expect(plan?.bounds.width).toBe(820);
  });

  it("projects both axes for an unequal Smart grid", () => {
    const document = smartGridDocument();
    const ids = ["a", "b", "c", "d", "e", "f"];
    const plan = createSmartSelectionOverlayPlan(document, "page_welcome", ids);

    expect(plan).toMatchObject({
      dimension: "grid",
      nodeIds: ids,
    });
    expect(
      plan?.handles.filter((handle) => handle.axis === "horizontal"),
    ).toHaveLength(4);
    expect(
      plan?.handles.filter((handle) => handle.axis === "vertical"),
    ).toHaveLength(3);
  });

  it("fails closed for nonuniform, locked, and Auto Layout flow selections", () => {
    const nonuniform = smartRowDocument();
    nonuniform.nodesById.feature_three!.transform[4] += 5;
    expect(
      createSmartSelectionOverlayPlan(nonuniform, "page_welcome", [
        "feature_one",
        "feature_two",
        "feature_three",
      ]),
    ).toBeNull();

    const locked = smartRowDocument();
    locked.nodesById.feature_group!.locked = true;
    expect(
      createSmartSelectionOverlayPlan(locked, "page_welcome", [
        "feature_one",
        "feature_two",
        "feature_three",
      ]),
    ).toBeNull();

    const flow = smartRowDocument();
    const frame = flow.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("missing frame");
    frame.childIds = ["feature_one", "feature_two", "feature_three"];
    frame.properties.autoLayout = {
      mode: "horizontal",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 20,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    for (const id of frame.childIds) flow.nodesById[id]!.parentId = frame.id;
    expect(
      createSmartSelectionOverlayPlan(flow, "page_welcome", [
        "feature_one",
        "feature_two",
        "feature_three",
      ]),
    ).toBeNull();

    const hierarchical = smartRowDocument();
    expect(
      createSmartSelectionOverlayPlan(hierarchical, "page_welcome", [
        "feature_group",
        "feature_one",
        "feature_two",
      ]),
    ).toBeNull();

    const otherPage = smartRowDocument();
    otherPage.pageOrder.push("page_other");
    otherPage.pagesById.page_other = {
      id: "page_other",
      name: "Other",
      rootNodeIds: [],
      extensions: {},
    };
    expect(
      createSmartSelectionOverlayPlan(otherPage, "page_other", [
        "feature_one",
        "feature_two",
        "feature_three",
      ]),
    ).toBeNull();
  });

  it("converts document preview deltas through a rotated parent", () => {
    const document = smartRowDocument();
    document.nodesById.feature_group!.transform = [0, 1, -1, 0, 400, 200];
    expect(
      documentDeltaToNodeParent(document, "feature_one", { x: 10, y: 20 }),
    ).toEqual({ x: 20, y: -10 });
  });
});

function smartRowDocument() {
  const document = structuredClone(createWelcomeDocument());
  document.nodesById.feature_one!.transform = [1, 0, 0, 1, 0, 0];
  document.nodesById.feature_two!.transform = [1, 0, 0, 1, 280, 0];
  document.nodesById.feature_three!.transform = [1, 0, 0, 1, 560, 0];
  document.nodesById.feature_one!.size = { width: 260, height: 100 };
  document.nodesById.feature_two!.size = { width: 260, height: 80 };
  document.nodesById.feature_three!.size = { width: 260, height: 120 };
  document.nodesById.feature_group!.size = { width: 820, height: 120 };
  return document;
}

function smartGridDocument() {
  const document = structuredClone(createWelcomeDocument());
  const group = document.nodesById.feature_group;
  const template = document.nodesById.feature_one!;
  if (group?.kind !== "group") throw new Error("missing group");
  const placements = [
    ["a", 0, 0, 30, 20],
    ["b", 50, 0, 40, 30],
    ["c", 110, 0, 20, 25],
    ["d", 0, 70, 20, 40],
    ["e", 50, 70, 30, 20],
    ["f", 110, 70, 50, 35],
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
  group.childIds = placements.map(([id]) => id);
  group.size = { width: 160, height: 110 };
  delete document.nodesById.feature_one;
  delete document.nodesById.feature_two;
  delete document.nodesById.feature_three;
  return document;
}
