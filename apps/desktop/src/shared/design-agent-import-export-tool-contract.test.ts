import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  EXPORT_RASTER_TOOL_INPUT_SCHEMA,
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_INPUT_SCHEMA,
  EXPORT_SVG_TOOL_NAME,
  ExportRasterContract,
  ExportSvgContract,
  IMPORT_SVG_TOOL_INPUT_SCHEMA,
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_INPUT_SCHEMA,
  ImportSvgContract,
  InternalImportSvgContract,
  type ExportRasterToolInput,
  type ExportSvgToolInput,
  type ImportSvgToolInput,
} from "./design-agent-tools.js";

const importInput: ImportSvgToolInput = {
  attachmentId: `svg_${"a".repeat(64)}`,
  pageId: "page_brand",
  parentId: "frame_brand",
  index: 2,
  x: 48,
  y: 72,
};

const svgExportInput: ExportSvgToolInput = {
  pageId: "page_brand",
  rootNodeIds: ["logo_symbol", "logo_wordmark"],
  suggestedName: "OpenDesign Brand.svg",
  includeLayerIds: true,
  padding: 24,
};

const rasterInputs: ExportRasterToolInput[] = [
  {
    pageId: "page_brand",
    rootNodeId: "logo_symbol",
    suggestedName: "OpenDesign Symbol.png",
    format: "png",
    size: { mode: "scale", value: 3 },
    background: { mode: "transparent" },
    resampling: "smooth",
  },
  {
    pageId: "page_brand",
    rootNodeId: "brand_preview",
    suggestedName: "OpenDesign Preview.jpg",
    format: "jpeg",
    size: { mode: "width", value: 2400 },
    background: { mode: "color", color: "#FFFFFF" },
    quality: 0.92,
    resampling: "smooth",
  },
  {
    pageId: "page_brand",
    rootNodeId: "app_icon",
    suggestedName: "OpenDesign App Icon.webp",
    format: "webp",
    size: { mode: "height", value: 1024 },
    background: { mode: "transparent" },
    quality: 0.9,
    resampling: "pixelated",
  },
];

describe("Import and export Agent contracts", () => {
  it("uses one executable schema per public tool at Provider and Runtime", () => {
    expect(ImportSvgContract.schema).toBe(IMPORT_SVG_TOOL_INPUT_SCHEMA);
    expect(ExportSvgContract.schema).toBe(EXPORT_SVG_TOOL_INPUT_SCHEMA);
    expect(ExportRasterContract.schema).toBe(EXPORT_RASTER_TOOL_INPUT_SCHEMA);
    for (const [name, contract] of [
      [IMPORT_SVG_TOOL_NAME, ImportSvgContract],
      [EXPORT_SVG_TOOL_NAME, ExportSvgContract],
      [EXPORT_RASTER_TOOL_NAME, ExportRasterContract],
    ] as const) {
      const spec = DESIGN_AGENT_TOOL_SPECS.find(
        (candidate) => candidate.name === name,
      );
      expect(spec?.inputSchema).toBe(contract.schema);
      expect(
        spec && "validateInputIssues" in spec
          ? spec.validateInputIssues
          : undefined,
      ).toBe(contract.issues);
    }
    expect(ImportSvgContract.parse(importInput)).toEqual({
      ok: true,
      value: importInput,
    });
    expect(ExportSvgContract.parse(svgExportInput)).toEqual({
      ok: true,
      value: svgExportInput,
    });
    for (const input of rasterInputs) {
      expect(
        schemaValidationIssues(ExportRasterContract.schema, input),
      ).toEqual([]);
      expect(ExportRasterContract.parse(input)).toEqual({
        ok: true,
        value: input,
      });
    }
    expect(JSON.stringify(EXPORT_RASTER_TOOL_INPUT_SCHEMA)).not.toContain(
      '"oneOf"',
    );
  });

  it("rejects paths and Windows reserved names at suggestedName", () => {
    for (const suggestedName of ["../brand.svg", "CON.svg", "logo. "]) {
      expect(
        ExportSvgContract.issues({ ...svgExportInput, suggestedName }),
        suggestedName,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "/suggestedName" }),
        ]),
      );
    }
  });

  it("enforces public raster scale, quality, and background branches", () => {
    expect(
      ExportRasterContract.issues({
        ...rasterInputs[0],
        size: { mode: "scale", value: 4 },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/size/value" }),
      ]),
    );
    expect(
      ExportRasterContract.issues({ ...rasterInputs[0], quality: 0.8 }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/quality" })]),
    );
    expect(
      ExportRasterContract.issues({
        ...rasterInputs[1],
        background: { mode: "transparent" },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/background/mode" }),
      ]),
    );
  });

  it("keeps trusted SVG materialization internal to the canonical bridge", () => {
    expect(
      InternalImportSvgContract.parse({
        ...importInput,
        name: "Brand source.svg",
        svg: '<svg viewBox="0 0 24 24"></svg>',
        idPrefix: "od_brand",
      }).ok,
    ).toBe(true);
    expect(InternalImportSvgContract.schema).toBe(
      INTERNAL_IMPORT_SVG_TOOL_INPUT_SCHEMA,
    );
    expect(
      InternalImportSvgContract.issues({
        ...importInput,
        name: "Brand source.svg",
        svg: '<svg viewBox="0 0 24 24"></svg>',
        idPrefix: "9-invalid",
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/idPrefix" })]),
    );
    expect(
      ImportSvgContract.issues({
        ...importInput,
        svg: "<svg></svg>",
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/svg" })]),
    );
  });
});
