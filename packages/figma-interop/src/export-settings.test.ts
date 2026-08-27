import { describe, expect, it } from "vitest";
import type { DesignNode } from "@opendesign/design-contracts";
import { toFigmaExportSettings, toFigmaNodeType } from "./index.js";

describe("Figma Slice and export settings compatibility", () => {
  it("projects Slice identity and public export settings without private format data", () => {
    const node: DesignNode = {
      id: "slice",
      kind: "slice",
      name: "Hero",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 180 },
      exportSettings: [
        {
          format: "PNG",
          suffix: "@2x",
          contentsOnly: true,
          useAbsoluteBounds: false,
          colorProfile: "DOCUMENT",
          constraint: { type: "SCALE", value: 2 },
        },
      ],
      opacity: 1,
      properties: {},
      extensions: {},
    };
    expect(toFigmaNodeType(node)).toBe("SLICE");
    expect(toFigmaExportSettings(node)).toEqual({
      ok: true,
      settings: [
        expect.objectContaining({
          format: "PNG",
          suffix: "@2x",
          constraint: { type: "SCALE", value: 2 },
        }),
      ],
    });
    node.exportSettings = [
      {
        format: "WEBP",
        suffix: "",
        contentsOnly: true,
        useAbsoluteBounds: false,
        colorProfile: "DOCUMENT",
        constraint: { type: "SCALE", value: 1 },
      },
    ];
    expect(toFigmaExportSettings(node)).toMatchObject({
      ok: false,
      issues: [expect.stringContaining("OpenDesign WEBP extension")],
    });
  });
});
