import { describe, expect, it } from "vitest";
import type { DesignNode } from "@opendesign/design-contracts";
import { planStoredExportSetting } from "./stored-export.js";

describe("stored export setting planner", () => {
  const node = {
    id: "frame",
    kind: "group",
    name: "Frame",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 100, height: 100 },
    exportSettings: [],
    opacity: 1,
    properties: {},
    extensions: {},
  } satisfies DesignNode;

  it("maps Figma image constraints to the delivery raster contract", () => {
    expect(
      planStoredExportSetting(node, {
        format: "PNG",
        suffix: "@2x",
        contentsOnly: true,
        useAbsoluteBounds: false,
        colorProfile: "DOCUMENT",
        constraint: { type: "SCALE", value: 2 },
      }),
    ).toEqual({
      ok: true,
      kind: "raster",
      format: "png",
      size: { mode: "scale", value: 2 },
      suffix: "@2x",
    });
  });

  it("rejects unsupported fidelity combinations instead of degrading", () => {
    expect(
      planStoredExportSetting(node, {
        format: "PDF",
        suffix: "",
        contentsOnly: true,
        useAbsoluteBounds: false,
        colorProfile: "DOCUMENT",
      }),
    ).toMatchObject({ ok: false, code: "unsupported" });
  });
});
