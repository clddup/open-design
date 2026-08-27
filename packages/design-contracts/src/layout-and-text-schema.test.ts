import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import {
  DESIGN_SCHEMA_VERSION,
  FIGMA_TEXT_LISTS_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_GRID_DESIGN_SCHEMA_VERSION,
  PARAGRAPH_STYLE_RUNS_DESIGN_SCHEMA_VERSION,
  RICH_TEXT_RUNS_DESIGN_SCHEMA_VERSION,
  DesignNodeSchema,
  DesignOperationSchema,
  migrateDesignDocument,
  type DesignDocument,
} from "./index.js";
import { textDocumentFixture } from "./index-test-fixtures.js";

it("validates bounded Grid Auto Layout tracks and child placement", () => {
  const frame = {
    id: "grid",
    kind: "frame",
    name: "Grid",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 600, height: 400 },
    opacity: 1,
    exportSettings: [],
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent: true,
      autoLayout: {
        mode: "grid",
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        rowGap: 12,
        columnGap: 16,
        rows: [{ type: "hug" }, { type: "fixed", value: 120 }],
        columns: [
          { type: "fixed", value: 180 },
          { type: "fill", value: 1 },
        ],
        itemsPositioning: "manual",
      },
    },
    extensions: {},
  };
  expect(Value.Check(DesignNodeSchema, frame)).toBe(true);
  expect(
    Value.Check(DesignNodeSchema, {
      ...frame,
      properties: {
        ...frame.properties,
        autoLayout: {
          ...frame.properties.autoLayout,
          itemsPositioning: "row-auto-flow",
          autoTracks: "rows",
        },
      },
    }),
  ).toBe(true);
  expect(
    Value.Check(DesignNodeSchema, {
      ...frame,
      properties: {
        ...frame.properties,
        autoLayout: {
          ...frame.properties.autoLayout,
          columns: [{ type: "fill", value: 0 }],
        },
      },
    }),
  ).toBe(false);
});

it("migrates 1.33 documents without inventing Grid state", () => {
  const source = textDocumentFixture();
  source.schemaVersion =
    FIGMA_TEXT_LISTS_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById.text_1?.gridPlacement).toBeUndefined();
});

it("migrates 1.34 Grid documents without inventing automatic tracks", () => {
  const source = textDocumentFixture() as unknown as DesignDocument;
  source.schemaVersion =
    AUTO_LAYOUT_GRID_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  source.pagesById.page_1!.rootNodeIds = ["grid_1"];
  source.nodesById.text_1!.parentId = "grid_1";
  source.nodesById.text_1!.gridPlacement = {
    row: 0,
    column: 0,
    rowSpan: 1,
    columnSpan: 1,
    horizontalAlign: "auto",
    verticalAlign: "auto",
  };
  source.nodesById.grid_1 = {
    id: "grid_1",
    kind: "frame",
    name: "Legacy Grid",
    parentId: null,
    childIds: ["text_1"],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 240, height: 64 },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent: true,
      autoLayout: {
        mode: "grid",
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        rowGap: 0,
        columnGap: 0,
        rows: [{ type: "hug" }],
        columns: [{ type: "hug" }],
        itemsPositioning: "manual",
      },
    },
    extensions: {},
  };
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  const frame = migrated?.nodesById.grid_1;
  expect(frame).toMatchObject({ kind: "frame" });
  if (frame?.kind !== "frame") throw new Error("Expected migrated Grid");
  expect(frame.properties.autoLayout).toMatchObject({ mode: "grid" });
  if (frame.properties.autoLayout?.mode !== "grid")
    throw new Error("Expected migrated Grid Auto Layout");
  expect(frame.properties.autoLayout.autoTracks).toBeUndefined();
});

it("validates bounded semantic text editing session commits", () => {
  const valid = {
    commandId: "commit-list-edit",
    type: "commit_text_edit" as const,
    nodeId: "text_1",
    content: "Alpha\nBeta",
    paragraphPatches: [
      {
        start: 0,
        end: 6,
        style: {
          listOptions: { type: "ordered" as const },
          indentation: 1,
        },
      },
    ],
  };
  expect(Value.Check(DesignOperationSchema, valid)).toBe(true);
  expect(
    Value.Check(DesignOperationSchema, {
      ...valid,
      paragraphPatches: [
        { start: 0, end: 0, style: { listOptions: { type: "ordered" } } },
      ],
    }),
  ).toBe(false);
  expect(
    Value.Check(DesignOperationSchema, {
      ...valid,
      paragraphPatches: [{ start: 0, end: 6, style: { indentation: 6 } }],
    }),
  ).toBe(false);
  expect(
    Value.Check(DesignOperationSchema, {
      ...valid,
      paragraphPatches: [{ start: 0, end: 6, style: {} }],
    }),
  ).toBe(false);
});

it("migrates 1.32 paragraph runs to explicit non-list defaults", () => {
  const source = textDocumentFixture() as unknown as Record<string, unknown>;
  source.schemaVersion = PARAGRAPH_STYLE_RUNS_DESIGN_SCHEMA_VERSION;
  const nodes = source.nodesById as Record<
    string,
    { properties: Record<string, unknown> }
  >;
  const properties = nodes.text_1!.properties;
  delete properties.listSpacing;
  delete properties.hangingList;
  properties.paragraphRuns = [
    {
      start: 0,
      end: String(properties.content).length,
      style: { paragraphIndent: 12, paragraphSpacing: 8 },
    },
  ];
  expect(migrateDesignDocument(source)).toMatchObject({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    nodesById: {
      text_1: {
        properties: {
          listSpacing: 0,
          hangingList: false,
          paragraphRuns: [
            {
              style: {
                listOptions: { type: "none" },
                indentation: 0,
                listSpacing: 0,
                paragraphIndent: 12,
                paragraphSpacing: 8,
              },
            },
          ],
        },
      },
    },
  });
});

it("migrates 1.31 text nodes to canonical empty paragraph runs", () => {
  const source = textDocumentFixture() as unknown as Record<string, unknown>;
  source.schemaVersion = RICH_TEXT_RUNS_DESIGN_SCHEMA_VERSION;
  const nodes = source.nodesById as Record<
    string,
    { properties: Record<string, unknown> }
  >;
  delete nodes.text_1!.properties.paragraphRuns;
  expect(migrateDesignDocument(source)).toMatchObject({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    nodesById: { text_1: { properties: { paragraphRuns: [], runs: [] } } },
  });
});
