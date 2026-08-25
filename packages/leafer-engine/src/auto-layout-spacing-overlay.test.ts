import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { createAutoLayoutSpacingOverlayPlan } from "./auto-layout-spacing-overlay.js";

describe("Auto Layout spacing overlay geometry", () => {
  it("exposes four padding controls and fixed horizontal gap controls", () => {
    const document = linearDocument("horizontal");
    const plan = createAutoLayoutSpacingOverlayPlan(document, "frame_welcome");

    expect(plan).toMatchObject({
      frameId: "frame_welcome",
      padding: { top: 16, right: 24, bottom: 20, left: 24 },
    });
    expect(plan?.handles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "padding-top",
          axis: "y",
          x: 300,
          y: 8,
          value: 16,
        }),
        expect.objectContaining({
          kind: "padding-right",
          axis: "x",
          x: 588,
          value: 24,
        }),
        expect.objectContaining({
          kind: "gap",
          axis: "x",
          x: 130,
          y: 50,
          value: 12,
        }),
      ]),
    );
    expect(
      plan?.handles.filter((handle) => handle.kind === "gap"),
    ).toHaveLength(2);
  });

  it("uses vertical handles for vertical flow and omits Auto gap controls", () => {
    const fixed = linearDocument("vertical");
    const fixedPlan = createAutoLayoutSpacingOverlayPlan(
      fixed,
      "frame_welcome",
    );
    expect(
      fixedPlan?.handles.filter((handle) => handle.kind === "gap"),
    ).toEqual([
      expect.objectContaining({ axis: "y", x: 70, y: 90, value: 12 }),
      expect.objectContaining({ axis: "y", x: 70, y: 162, value: 12 }),
    ]);

    const frame = fixed.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing Frame");
    const layout = frame.properties.autoLayout;
    if (layout?.mode !== "vertical") throw new Error("Missing layout");
    layout.primaryAlignment = "space-between";
    const autoPlan = createAutoLayoutSpacingOverlayPlan(fixed, frame.id);
    expect(
      autoPlan?.handles.filter((handle) => handle.kind === "gap"),
    ).toHaveLength(0);
    expect(autoPlan?.handles).toHaveLength(4);
  });

  it("creates row-local gap and counter-gap controls for fixed Wrap spacing", () => {
    const document = linearDocument("horizontal");
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing Frame");
    const layout = frame.properties.autoLayout;
    if (layout?.mode !== "horizontal") throw new Error("Missing layout");
    layout.wrap = { mode: "wrap", counterGap: 18 };
    document.nodesById.feature_three!.transform = [1, 0, 0, 1, 24, 98];

    const plan = createAutoLayoutSpacingOverlayPlan(document, frame.id);
    expect(plan?.handles.filter((handle) => handle.kind === "gap")).toEqual([
      expect.objectContaining({ x: 130, value: 12 }),
    ]);
    expect(
      plan?.handles.filter((handle) => handle.kind === "counter-gap"),
    ).toEqual([
      expect.objectContaining({ axis: "y", x: 300, y: 89, value: 18 }),
    ]);

    layout.wrap.counterAxisAlignContent = "space-between";
    const autoPlan = createAutoLayoutSpacingOverlayPlan(document, frame.id);
    expect(
      autoPlan?.handles.filter((handle) => handle.kind === "counter-gap"),
    ).toHaveLength(0);
  });

  it("recognizes a wrapped row after one wide child even when the next row starts farther right", () => {
    const document = linearDocument("horizontal");
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing Frame");
    const layout = frame.properties.autoLayout;
    if (layout?.mode !== "horizontal") throw new Error("Missing layout");
    layout.wrap = { mode: "wrap", counterGap: 18 };
    document.nodesById.feature_one!.size.width = 500;
    document.nodesById.feature_two!.transform = [1, 0, 0, 1, 200, 98];
    document.nodesById.feature_three!.transform = [1, 0, 0, 1, 312, 98];

    const plan = createAutoLayoutSpacingOverlayPlan(document, frame.id);
    expect(plan?.handles.filter((handle) => handle.kind === "gap")).toEqual([
      expect.objectContaining({ x: 306, value: 12 }),
    ]);
    expect(
      plan?.handles.filter((handle) => handle.kind === "counter-gap"),
    ).toHaveLength(1);
  });

  it("keeps padding available for Grid and for children without handle-safe transforms", () => {
    const grid = linearDocument("horizontal");
    const frame = grid.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing Frame");
    frame.properties.autoLayout = {
      mode: "grid",
      padding: { top: 8, right: 12, bottom: 8, left: 12 },
      rowGap: 8,
      columnGap: 12,
      rows: [{ type: "fixed", value: 80 }],
      columns: [{ type: "fill", value: 1 }],
      itemsPositioning: "row-auto-flow",
    };
    expect(
      createAutoLayoutSpacingOverlayPlan(grid, frame.id)?.handles,
    ).toHaveLength(4);

    frame.properties.autoLayout = {
      mode: "horizontal",
      padding: { top: 8, right: 12, bottom: 8, left: 12 },
      gap: 12,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    grid.nodesById.feature_two!.transform = [0, 1, -1, 0, 140, 20];
    const plan = createAutoLayoutSpacingOverlayPlan(grid, frame.id);
    expect(plan?.handles).toHaveLength(4);
  });

  it("fails closed for locked or rotated selected Frames", () => {
    const locked = linearDocument("horizontal");
    locked.nodesById.frame_welcome!.locked = true;
    expect(
      createAutoLayoutSpacingOverlayPlan(locked, "frame_welcome"),
    ).toBeNull();

    const rotated = linearDocument("horizontal");
    rotated.nodesById.frame_welcome!.transform = [0, 1, -1, 0, 80, 64];
    expect(
      createAutoLayoutSpacingOverlayPlan(rotated, "frame_welcome"),
    ).toBeNull();
  });
});

function linearDocument(direction: "horizontal" | "vertical") {
  const document = structuredClone(createWelcomeDocument());
  const frame = document.nodesById.frame_welcome;
  if (frame?.kind !== "frame") throw new Error("Missing Frame");
  frame.size = { width: 600, height: 260 };
  frame.childIds = ["feature_one", "feature_two", "feature_three"];
  frame.properties.autoLayout = {
    mode: direction,
    padding: { top: 16, right: 24, bottom: 20, left: 24 },
    gap: 12,
    primaryAlignment: "start",
    counterAlignment: "start",
  };
  const positions =
    direction === "horizontal"
      ? [
          [24, 20],
          [136, 20],
          [248, 20],
        ]
      : [
          [20, 24],
          [20, 96],
          [20, 168],
        ];
  frame.childIds.forEach((childId, index) => {
    const child = document.nodesById[childId];
    if (!child) throw new Error(`Missing ${childId}`);
    child.size = { width: 100, height: 60 };
    child.transform = [
      1,
      0,
      0,
      1,
      positions[index]![0]!,
      positions[index]![1]!,
    ];
  });
  return document;
}
