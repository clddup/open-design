import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CanvasFrameLabels,
  resolveCanvasFrameLabels,
} from "./CanvasFrameLabels";

const viewport = {
  panX: 20,
  panY: 30,
  zoom: 1,
  width: 1_200,
  height: 800,
};

describe("canvas top-level Frame labels", () => {
  it("projects only visible on-screen top-level Frames at viewport coordinates", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.nested_frame = {
      ...structuredClone(document.nodesById.frame_welcome),
      id: "nested_frame",
      name: "Nested frame",
      parentId: "frame_welcome",
      childIds: [],
      transform: [1, 0, 0, 1, 12, 12],
    };
    document.nodesById.frame_welcome.childIds.push("nested_frame");
    document.pagesById.page_welcome.rootNodeIds.push("feature_group");
    const labels = resolveCanvasFrameLabels(
      document,
      "page_welcome",
      viewport,
      ["frame_welcome"],
    );

    expect(labels).toEqual([
      {
        kind: "frame",
        name: "Welcome canvas",
        nodeId: "frame_welcome",
        selected: true,
        x: 100,
        y: 74,
      },
    ]);

    document.nodesById.frame_welcome.visible = false;
    expect(
      resolveCanvasFrameLabels(document, "page_welcome", viewport, []),
    ).toEqual([]);

    document.nodesById.frame_welcome.visible = true;
    expect(
      resolveCanvasFrameLabels(
        document,
        "page_welcome",
        { ...viewport, panX: -5_000, panY: -5_000 },
        [],
      ),
    ).toEqual([]);
  });

  it("identifies a top-level Component root without creating another canvas fact", () => {
    const document = structuredClone(createWelcomeDocument());
    document.componentsById.component_welcome = {
      id: "component_welcome",
      name: "Welcome",
      rootNodeId: "frame_welcome",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };

    expect(
      resolveCanvasFrameLabels(document, "page_welcome", viewport, [])[0]?.kind,
    ).toBe("component");
  });

  it("selects the stable Frame ID from the canvas label", () => {
    const document = createWelcomeDocument();
    const onSelect = vi.fn();
    render(
      <CanvasFrameLabels
        document={document}
        onSelect={onSelect}
        pageId="page_welcome"
        selectedNodeIds={[]}
        viewport={viewport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Welcome canvas" }));
    expect(onSelect).toHaveBeenCalledWith("frame_welcome");
  });
});
