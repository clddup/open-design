import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { createSliceOverlayPlan } from "./slice-overlay.js";

describe("Slice editor overlay", () => {
  it("projects visible Slice bounds in world space without document decoration", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.slice_1 = {
      id: "slice_1",
      kind: "slice",
      name: "Hero export",
      parentId: "frame_welcome",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 20, 30],
      size: { width: 300, height: 180 },
      exportSettings: [],
      opacity: 1,
      properties: {},
      extensions: {},
    };
    document.nodesById.frame_welcome!.childIds.push("slice_1");
    expect(createSliceOverlayPlan(document, "page_welcome")).toMatchObject({
      specs: [
        {
          id: "slice_1",
          width: 300,
          height: 180,
          transform: [1, 0, 0, 1, 100, 94],
        },
      ],
    });
    expect(document.nodesById.slice_1.extensions).toEqual({});
  });
});
