import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  DesignNodeSchema,
  DesignOperationSchema,
  DesignPageSchema,
  GuideCollectionSchema,
  GuideSchema,
} from "./index.js";

describe("ruler guide contract", () => {
  it("uses the Figma public axis and owner-relative offset shape", () => {
    expect(Value.Check(GuideSchema, { axis: "X", offset: 120 })).toBe(true);
    expect(Value.Check(GuideSchema, { axis: "Y", offset: -24.5 })).toBe(true);
    expect(Value.Check(GuideSchema, { axis: "horizontal", offset: 0 })).toBe(
      false,
    );
  });

  it("persists guides on Pages and Frames", () => {
    expect(
      Value.Check(DesignPageSchema, {
        id: "page_guides",
        name: "Guides",
        rootNodeIds: [],
        guides: [{ axis: "X", offset: 80 }],
        extensions: {},
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        id: "frame_guides",
        name: "Frame",
        parentId: null,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0],
        size: { width: 320, height: 180 },
        exportSettings: [],
        opacity: 1,
        extensions: {},
        kind: "frame",
        properties: {
          fills: [],
          strokes: [],
          strokeWidth: 0,
          cornerRadius: 0,
          clipsContent: false,
          guides: [{ axis: "Y", offset: 24 }],
        },
      }),
    ).toBe(true);
  });

  it("shares one bounded collection contract across guide owners", () => {
    const guides = Array.from({ length: 4_097 }, (_, offset) => ({
      axis: "X" as const,
      offset,
    }));
    expect(Value.Check(GuideCollectionSchema, guides.slice(0, 4_096))).toBe(
      true,
    );
    expect(Value.Check(GuideCollectionSchema, guides)).toBe(false);
  });

  it("updates Page guides without requiring a rename", () => {
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "page_guides",
        type: "update_page",
        pageId: "page_guides",
        guides: [{ axis: "X", offset: 80 }],
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "page_name_and_guides",
        type: "update_page",
        pageId: "page_guides",
        name: "Measured page",
        guides: [{ axis: "Y", offset: 120 }],
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "empty_page_update",
        type: "update_page",
        pageId: "page_guides",
      }),
    ).toBe(false);
  });
});
