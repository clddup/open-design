import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import {
  createGridEditorOverlayPlan,
  gridTrackReorderChangesOrder,
  nearestGridInsertionIndex,
} from "./grid-editor-overlay.js";

describe("Grid editor overlay geometry", () => {
  it("resolves authoritative fixed/fill track geometry and insertion slots", () => {
    const document = gridDocument();
    const plan = createGridEditorOverlayPlan(document, "frame_welcome");

    expect(plan).toMatchObject({
      frameId: "frame_welcome",
      rows: [
        { index: 0, start: 16, end: 116, center: 66 },
        { index: 1, start: 124, end: 224, center: 174 },
      ],
      columns: [
        { index: 0, start: 20, end: 140, center: 80 },
        { index: 1, start: 152, end: 1180, center: 666 },
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

  it("fails closed for locked, rotated, or unresolved Grid frames", () => {
    const locked = gridDocument();
    locked.nodesById.frame_welcome!.locked = true;
    expect(createGridEditorOverlayPlan(locked, "frame_welcome")).toBeNull();

    const rotated = gridDocument();
    rotated.nodesById.frame_welcome!.transform = [0, 1, -1, 0, 80, 64];
    expect(createGridEditorOverlayPlan(rotated, "frame_welcome")).toBeNull();

    const invalid = gridDocument();
    invalid.nodesById.feature_one!.transform = [2, 0, 0, 1, 0, 0];
    expect(createGridEditorOverlayPlan(invalid, "frame_welcome")).toBeNull();
  });

  it("distinguishes a real reorder from either adjacent no-op slot", () => {
    expect(gridTrackReorderChangesOrder(1, 0)).toBe(true);
    expect(gridTrackReorderChangesOrder(1, 1)).toBe(false);
    expect(gridTrackReorderChangesOrder(1, 2)).toBe(false);
    expect(gridTrackReorderChangesOrder(1, 3)).toBe(true);
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
