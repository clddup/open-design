import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { canvasGridEditorScope } from "./canvas-grid-editor-scope";

describe("canvas Grid editor scope", () => {
  it("opens track and spacing controls for a selected Grid Frame", () => {
    const document = gridDocument();
    expect(
      canvasGridEditorScope(document, {
        nodeIds: ["frame_welcome"],
        anchorNodeId: "frame_welcome",
      }),
    ).toEqual({
      autoLayoutSpacingFrameId: "frame_welcome",
      gridEditorFrameId: "frame_welcome",
    });
  });

  it("keeps Grid controls active for one or more direct flow children", () => {
    const document = gridDocument();
    expect(
      canvasGridEditorScope(document, {
        nodeIds: ["shape_accent", "title_welcome"],
        anchorNodeId: "title_welcome",
      }),
    ).toEqual({ gridEditorFrameId: "frame_welcome" });
  });

  it("fails closed for mixed parents and absolute children", () => {
    const document = gridDocument();
    document.nodesById.title_welcome.layoutPositioning = "absolute";
    expect(
      canvasGridEditorScope(document, {
        nodeIds: ["title_welcome"],
        anchorNodeId: "title_welcome",
      }),
    ).toEqual({});
    expect(
      canvasGridEditorScope(document, {
        nodeIds: ["shape_accent", "feature_one"],
      }),
    ).toEqual({});
  });
});

function gridDocument() {
  const document = structuredClone(createWelcomeDocument());
  const frame = document.nodesById.frame_welcome;
  if (frame?.kind !== "frame") throw new Error("missing Frame");
  frame.properties.autoLayout = {
    mode: "grid",
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    rowGap: 0,
    columnGap: 0,
    rows: [{ type: "fixed", value: 100 }],
    columns: frame.childIds.map(() => ({
      type: "fixed" as const,
      value: 100,
    })),
    itemsPositioning: "manual",
  };
  frame.childIds.forEach((nodeId, column) => {
    const node = document.nodesById[nodeId];
    if (!node) throw new Error("missing child");
    node.gridPlacement = {
      row: 0,
      column,
      rowSpan: 1,
      columnSpan: 1,
      horizontalAlign: "auto",
      verticalAlign: "auto",
    };
  });
  return document;
}
