import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { responsiveFrameResizeRequest } from "./canvas-responsive-resize";

describe("canvas responsive Frame resize routing", () => {
  it("extracts only a single populated Frame size and ignores child projection updates", () => {
    const document = createWelcomeDocument();
    expect(
      responsiveFrameResizeRequest(document, {
        kind: "resize",
        selectionNodeIds: ["frame_welcome"],
        operations: [
          {
            commandId: "frame",
            type: "update_properties",
            nodeId: "frame_welcome",
            size: { width: 1600, height: 900 },
          },
          {
            commandId: "child",
            type: "update_properties",
            nodeId: "title_welcome",
            size: { width: 999, height: 99 },
          },
        ],
      }),
    ).toEqual({ frameId: "frame_welcome", size: { width: 1600, height: 900 } });
    expect(
      responsiveFrameResizeRequest(document, {
        kind: "resize",
        selectionNodeIds: ["feature_one"],
        operations: [],
      }),
    ).toBeNull();
  });
});
