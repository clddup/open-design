import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import {
  createGridEditorOverlayPlan,
  gridAreaForPlacement,
  gridChildSpanTargetFromBounds,
  gridTrackReorderChangesOrder,
  gridTrackSelectionReorderChangesOrder,
  nearestGridCell,
  nearestGridInsertionIndex,
} from "./grid-editor-overlay.js";

describe("Grid editor overlay geometry", () => {
  it("resolves authoritative fixed/fill track geometry and insertion slots", () => {
    const document = gridDocument();
    const plan = createGridEditorOverlayPlan(document, "frame_welcome");

    expect(plan).toMatchObject({
      frameId: "frame_welcome",
      rows: [
        {
          authoredTrack: { type: "fixed", value: 100 },
          index: 0,
          start: 16,
          end: 116,
          center: 66,
          resolvedSize: 100,
        },
        {
          authoredTrack: { type: "fixed", value: 100 },
          index: 1,
          start: 124,
          end: 224,
          center: 174,
          resolvedSize: 100,
        },
      ],
      columns: [
        {
          authoredTrack: { type: "fixed", value: 120 },
          index: 0,
          start: 20,
          end: 140,
          center: 80,
          resolvedSize: 120,
        },
        {
          authoredTrack: { type: "fill", value: 1 },
          index: 1,
          start: 152,
          end: 1180,
          center: 666,
          resolvedSize: 1028,
        },
      ],
      rowInsertions: [
        { index: 0, coordinate: 16 },
        { index: 1, coordinate: 120 },
        { index: 2, coordinate: 224 },
      ],
    });
    expect(nearestGridInsertionIndex(plan!, "columns", 1_170)).toBe(2);
    expect(nearestGridInsertionIndex(plan!, "rows", 118)).toBe(1);
  });

  it("supports rotated Grid frames and fails closed for locked, mirrored, skewed, or unresolved frames", () => {
    const locked = gridDocument();
    locked.nodesById.frame_welcome!.locked = true;
    expect(createGridEditorOverlayPlan(locked, "frame_welcome")).toBeNull();

    const rotated = gridDocument();
    rotated.nodesById.frame_welcome!.transform = [0, 1, -1, 0, 80, 64];
    expect(
      createGridEditorOverlayPlan(rotated, "frame_welcome")?.transform,
    ).toEqual([0, 1, -1, 0, 80, 64]);

    const mirrored = gridDocument();
    mirrored.nodesById.frame_welcome!.transform = [-1, 0, 0, 1, 80, 64];
    expect(createGridEditorOverlayPlan(mirrored, "frame_welcome")).toBeNull();

    const skewed = gridDocument();
    skewed.nodesById.frame_welcome!.transform = [1, 0.25, 0, 1, 80, 64];
    expect(createGridEditorOverlayPlan(skewed, "frame_welcome")).toBeNull();

    const degenerate = gridDocument();
    degenerate.nodesById.frame_welcome!.transform = [0, 0, 0, 0, 80, 64];
    expect(createGridEditorOverlayPlan(degenerate, "frame_welcome")).toBeNull();

    const invalid = gridDocument();
    invalid.nodesById.feature_one!.transform = [2, 0, 0, 1, 0, 0];
    expect(createGridEditorOverlayPlan(invalid, "frame_welcome")).toBeNull();
  });

  it("keeps generated automatic rows visible but not directly editable", () => {
    const document = gridDocument();
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing welcome Frame");
    const grid = frame.properties.autoLayout;
    if (!grid || grid.mode !== "grid") throw new Error("Missing Grid flow");
    grid.autoTracks = "rows";
    const plan = createGridEditorOverlayPlan(document, frame.id);

    expect(plan?.rows.length).toBeGreaterThan(0);
    expect(plan?.rows.every((track) => !track.editable)).toBe(true);
    expect(plan?.columns.every((track) => track.editable)).toBe(true);
  });

  it("distinguishes a real reorder from either adjacent no-op slot", () => {
    expect(gridTrackReorderChangesOrder(1, 0)).toBe(true);
    expect(gridTrackReorderChangesOrder(1, 1)).toBe(false);
    expect(gridTrackReorderChangesOrder(1, 2)).toBe(false);
    expect(gridTrackReorderChangesOrder(1, 3)).toBe(true);
    expect(gridTrackSelectionReorderChangesOrder([1, 2], 1, 4)).toBe(false);
    expect(gridTrackSelectionReorderChangesOrder([1, 2], 3, 4)).toBe(false);
    expect(gridTrackSelectionReorderChangesOrder([1, 2], 4, 4)).toBe(true);
    expect(gridTrackSelectionReorderChangesOrder([2, 0], 4, 4)).toBe(true);
  });

  it("maps a Frame-local pointer to the nearest real Grid cell", () => {
    const plan = createGridEditorOverlayPlan(gridDocument(), "frame_welcome");
    expect(plan && nearestGridCell(plan, { x: 700, y: 180 })).toEqual({
      column: 1,
      height: 100,
      row: 1,
      width: 1_028,
      x: 152,
      y: 124,
    });
  });

  it("snaps Fill child resize bounds to real row and column span edges", () => {
    const plan = createGridEditorOverlayPlan(gridDocument(), "frame_welcome");
    if (!plan) throw new Error("missing Grid plan");
    const placement = {
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 1,
      horizontalAlign: "auto" as const,
      verticalAlign: "auto" as const,
    };
    const before = gridAreaForPlacement(plan, placement);
    if (!before) throw new Error("missing Grid area");

    expect(
      gridChildSpanTargetFromBounds(
        plan,
        placement,
        { horizontal: "fill", vertical: "fill" },
        before,
        { ...before, width: 1_160, height: 208 },
      ),
    ).toEqual({ row: 0, column: 0, rowSpan: 2, columnSpan: 2 });
    expect(
      gridChildSpanTargetFromBounds(
        plan,
        placement,
        { horizontal: "fixed", vertical: "fill" },
        before,
        { ...before, width: 1_160, height: 208 },
      ),
    ).toEqual({ row: 0, column: 0, rowSpan: 2, columnSpan: 1 });

    const secondPlacement = { ...placement, column: 1 };
    const secondBefore = gridAreaForPlacement(plan, secondPlacement);
    if (!secondBefore) throw new Error("missing second Grid area");
    expect(
      gridChildSpanTargetFromBounds(
        plan,
        secondPlacement,
        { horizontal: "fill", vertical: "fixed" },
        secondBefore,
        {
          ...secondBefore,
          x: plan.columns[0]!.start,
          width: secondBefore.x + secondBefore.width - plan.columns[0]!.start,
        },
      ),
    ).toBeNull();
  });

  it("keeps pathological track counts on the Inspector path", () => {
    const document = gridDocument();
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing welcome Frame");
    const grid = frame.properties.autoLayout;
    if (grid?.mode !== "grid") throw new Error("Missing Grid Auto Layout");
    grid.columns = Array.from({ length: 511 }, () => ({
      type: "fixed",
      value: 1,
    }));
    expect(createGridEditorOverlayPlan(document, frame.id)).toBeNull();
  });
});

function gridDocument() {
  const document = structuredClone(createWelcomeDocument());
  const frame = document.nodesById.frame_welcome;
  if (frame?.kind !== "frame") throw new Error("Missing welcome Frame");
  frame.size = { width: 1_200, height: 240 };
  frame.childIds = ["feature_one", "feature_two"];
  frame.properties.autoLayout = {
    mode: "grid",
    padding: { top: 16, right: 20, bottom: 16, left: 20 },
    rowGap: 8,
    columnGap: 12,
    rows: [
      { type: "fixed", value: 100 },
      { type: "fixed", value: 100 },
    ],
    columns: [
      { type: "fixed", value: 120 },
      { type: "fill", value: 1 },
    ],
    itemsPositioning: "row-auto-flow",
  };
  return document;
}
