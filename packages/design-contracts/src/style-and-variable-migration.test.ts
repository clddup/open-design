import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import {
  DESIGN_SCHEMA_VERSION,
  COMPONENT_PROPERTY_ORDER_DESIGN_SCHEMA_VERSION,
  FIGMA_VARIABLES_DESIGN_SCHEMA_VERSION,
  FIGMA_SHARED_STYLES_DESIGN_SCHEMA_VERSION,
  FONT_FACE_IDENTITY_DESIGN_SCHEMA_VERSION,
  TYPOGRAPHY_CORE_V2_DESIGN_SCHEMA_VERSION,
  DesignNodeSchema,
  SharedStyleDefinitionSchema,
  isDesignDocument,
  migrateDesignDocument,
  type DesignDocument,
} from "./index.js";
import { textDocumentFixture } from "./index-test-fixtures.js";

it("migrates 1.30 text nodes to canonical empty rich-text runs", () => {
  const source = textDocumentFixture() as unknown as Record<string, unknown>;
  source.schemaVersion = FONT_FACE_IDENTITY_DESIGN_SCHEMA_VERSION;
  const nodes = source.nodesById as Record<
    string,
    { properties: Record<string, unknown> }
  >;
  delete nodes.text_1!.properties.runs;
  expect(migrateDesignDocument(source)).toMatchObject({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    nodesById: { text_1: { properties: { runs: [] } } },
  });
});

it("migrates 1.29 font requests without inventing a face style name", () => {
  const source = textDocumentFixture() as unknown as Record<string, unknown>;
  source.schemaVersion = TYPOGRAPHY_CORE_V2_DESIGN_SCHEMA_VERSION;
  const nodes = source.nodesById as Record<
    string,
    { properties: Record<string, unknown> }
  >;
  delete nodes.text_1!.properties.fontStyleName;
  delete nodes.text_1!.properties.fontSlant;
  source.styleOrderByType = {
    PAINT: [],
    TEXT: ["legacy-text-style"],
    EFFECT: [],
    GRID: [],
  };
  source.stylesById = {
    "legacy-text-style": {
      id: "legacy-text-style",
      key: "legacy-text-style-key",
      name: "Legacy/Body",
      description: "",
      hiddenFromPublishing: false,
      extensions: {},
      styleType: "TEXT",
      textStyle: {
        fontFamily: "Legacy Sans",
        fontSize: 16,
        fontWeight: 600,
        lineHeight: 24,
        letterSpacing: 0,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        listSpacing: 0,
        hangingList: false,
        textCase: "original",
        textDecoration: "none",
      },
    },
  };

  expect(migrateDesignDocument(source)).toMatchObject({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    nodesById: {
      text_1: {
        properties: { fontStyleName: null, fontSlant: "normal" },
      },
    },
    stylesById: {
      "legacy-text-style": {
        textStyle: { fontStyleName: null, fontSlant: "normal" },
      },
    },
  });

  const malformedCurrent = textDocumentFixture() as unknown as Record<
    string,
    unknown
  >;
  const currentNodes = malformedCurrent.nodesById as Record<
    string,
    { properties: Record<string, unknown> }
  >;
  delete currentNodes.text_1!.properties.fontSlant;
  expect(migrateDesignDocument(malformedCurrent)).toBeNull();
});

it("migrates 1.27 nodes to empty export settings and keeps current documents strict", () => {
  const legacy = textDocumentFixture() as unknown as Record<string, unknown>;
  legacy.schemaVersion = FIGMA_SHARED_STYLES_DESIGN_SCHEMA_VERSION;
  const nodes = legacy.nodesById as Record<string, Record<string, unknown>>;
  for (const node of Object.values(nodes)) delete node.exportSettings;
  const migrated = migrateDesignDocument(legacy);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById.text_1?.exportSettings).toEqual([]);

  const malformedCurrent = textDocumentFixture() as unknown as Record<
    string,
    unknown
  >;
  const currentNodes = malformedCurrent.nodesById as Record<
    string,
    Record<string, unknown>
  >;
  delete currentNodes.text_1?.exportSettings;
  expect(migrateDesignDocument(malformedCurrent)).toBeNull();
});

it("validates Slice and ordered Figma-shaped export settings", () => {
  const base = textDocumentFixture().nodesById.text_1;
  expect(
    Value.Check(DesignNodeSchema, {
      ...base,
      kind: "slice",
      childIds: [],
      properties: {},
      exportSettings: [
        {
          format: "PNG",
          suffix: "@2x",
          contentsOnly: true,
          useAbsoluteBounds: false,
          colorProfile: "DOCUMENT",
          constraint: { type: "SCALE", value: 2 },
        },
        {
          format: "SVG",
          suffix: "-vector",
          contentsOnly: true,
          useAbsoluteBounds: false,
          colorProfile: "SRGB",
          svgOutlineText: false,
          svgIdAttribute: true,
          svgSimplifyStroke: true,
        },
      ],
    }),
  ).toBe(true);
  expect(
    Value.Check(DesignNodeSchema, {
      ...base,
      kind: "slice",
      childIds: ["illegal-child"],
      properties: {},
    }),
  ).toBe(false);
});

it("migrates 1.26 documents to an empty shared-style registry and keeps 1.27 strict", () => {
  const legacy = textDocumentFixture() as Record<string, unknown>;
  legacy.schemaVersion = FIGMA_VARIABLES_DESIGN_SCHEMA_VERSION;
  delete legacy.styleOrderByType;
  delete legacy.stylesById;
  expect(migrateDesignDocument(legacy)).toMatchObject({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
  });

  const malformedCurrent = textDocumentFixture() as Record<string, unknown>;
  delete malformedCurrent.stylesById;
  expect(migrateDesignDocument(malformedCurrent)).toBeNull();
});

it("defines strict Paint, Text, Effect and Grid shared-style payloads", () => {
  const base = {
    id: "style_1",
    key: "style_key_1",
    name: "Brand/Primary",
    description: "Primary brand style",
    hiddenFromPublishing: false,
    extensions: {},
  };
  const styles = [
    {
      ...base,
      styleType: "PAINT",
      paints: [{ type: "solid", color: "#2563eb", opacity: 1 }],
    },
    {
      ...base,
      styleType: "TEXT",
      textStyle: {
        fontFamily: "Inter",
        fontStyleName: null,
        fontSize: 16,
        fontWeight: 600,
        fontSlant: "normal",
        lineHeight: 24,
        letterSpacing: 0,
        paragraphIndent: 0,
        paragraphSpacing: 8,
        listSpacing: 0,
        hangingList: false,
        textCase: "original",
        textDecoration: "none",
        textDecorationStyle: null,
        textDecorationOffset: null,
        textDecorationThickness: null,
        textDecorationColor: null,
        textDecorationSkipInk: null,
      },
    },
    {
      ...base,
      styleType: "EFFECT",
      effects: [{ type: "layer-blur", radius: 8 }],
    },
    {
      ...base,
      styleType: "GRID",
      layoutGuides: [
        {
          id: "guide_1",
          type: "grid",
          size: 8,
          color: "#2563eb",
          opacity: 0.2,
        },
      ],
    },
  ];
  for (const style of styles) {
    expect(Value.Check(SharedStyleDefinitionSchema, style)).toBe(true);
  }
  expect(
    Value.Check(SharedStyleDefinitionSchema, {
      ...styles[0],
      unexpected: true,
    }),
  ).toBe(false);

  const duplicateOrder = textDocumentFixture() as unknown as DesignDocument;
  duplicateOrder.styleOrderByType.PAINT = ["style_1", "style_1"];
  expect(isDesignDocument(duplicateOrder)).toBe(false);
});

it("migrates empty 1.25 token placeholders and refuses unknown non-empty token data", () => {
  const legacy = textDocumentFixture() as Record<string, unknown>;
  legacy.schemaVersion = COMPONENT_PROPERTY_ORDER_DESIGN_SCHEMA_VERSION;
  delete legacy.variableCollectionOrder;
  delete legacy.variableCollectionsById;
  delete legacy.variablesById;
  legacy.tokenCollectionsById = {};
  legacy.tokensById = {};
  expect(migrateDesignDocument(legacy)).toMatchObject({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
  });
  legacy.tokensById = { unknown: { value: 4 } };
  expect(migrateDesignDocument(legacy)).toBeNull();
});
