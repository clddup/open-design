import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  COMPONENT_SET_VARIANT_DESIGN_SCHEMA_VERSION,
  COMPONENT_SLOT_DESIGN_SCHEMA_VERSION,
  COMPONENT_PROPERTY_ORDER_DESIGN_SCHEMA_VERSION,
  VARIANT_PROPERTY_MATRIX_DESIGN_SCHEMA_VERSION,
  FIGMA_COMPONENT_PROPERTIES_DESIGN_SCHEMA_VERSION,
  FIGMA_VARIABLES_DESIGN_SCHEMA_VERSION,
  FIGMA_SHARED_STYLES_DESIGN_SCHEMA_VERSION,
  FIGMA_EXPORT_SETTINGS_DESIGN_SCHEMA_VERSION,
  FIGMA_LAYER_STATE_DESIGN_SCHEMA_VERSION,
  LIBRARY_COMPONENT_SOURCE_DESIGN_SCHEMA_VERSION,
  LIBRARY_STYLE_SOURCE_DESIGN_SCHEMA_VERSION,
  LIBRARY_VARIABLE_SOURCE_DESIGN_SCHEMA_VERSION,
  IMAGE_ADJUSTMENTS_DESIGN_SCHEMA_VERSION,
  IMAGE_PAINT_ADJUSTMENTS_DESIGN_SCHEMA_VERSION,
  IMAGE_ASSET_DERIVATIONS_DESIGN_SCHEMA_VERSION,
  IMAGE_BACKGROUND_REPLACEMENT_DESIGN_SCHEMA_VERSION,
  IMAGE_RELIGHTING_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_WRAP_FILL_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_WRAP_DISTRIBUTION_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_BASELINE_DESIGN_SCHEMA_VERSION,
  FONT_FACE_IDENTITY_DESIGN_SCHEMA_VERSION,
  FIGMA_TEXT_LISTS_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_GRID_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_GRID_V2_DESIGN_SCHEMA_VERSION,
  PARAGRAPH_STYLE_RUNS_DESIGN_SCHEMA_VERSION,
  RICH_TEXT_RUNS_DESIGN_SCHEMA_VERSION,
  TYPOGRAPHY_CORE_V2_DESIGN_SCHEMA_VERSION,
  ComponentOverridePatchSchema,
  DesignNodeSchema,
  DesignDocumentContract,
  DesignTransactionContract,
  DesignOperationSchema,
  DesignTransactionSchema,
  EffectSchema,
  MAX_TRANSACTION_COMMANDS,
  AUTO_LAYOUT_DESIGN_SCHEMA_VERSION,
  LAYOUT_GUIDE_COLUMNS_ROWS_DESIGN_SCHEMA_VERSION,
  LAYOUT_GUIDE_DESIGN_SCHEMA_VERSION,
  LayoutGuideSchema,
  PaintSchema,
  SelectionStateSchema,
  SharedStyleDefinitionSchema,
  isDesignDocument,
  isDesignTransaction,
  migrateDesignDocument,
  migrateLibraryReleaseSnapshot,
  migrateVariantSets,
  normalizeLineEndpoints,
  resolveRegularPolygonPoints,
  resolveLineEndpointPoint,
  resolveStarPoints,
  schemaValidationIssues,
  executableJsonSchema,
  type DesignDocument,
} from "./index.js";

const actor = { type: "user" as const, id: "user_1" };

describe("executable JSON Schema", () => {
  it("keeps Provider JSON unchanged while enforcing the same Runtime tree", () => {
    const source = {
      type: "object",
      properties: {
        action: { enum: ["insert", "remove"] },
        label: { type: "string", minLength: 1 },
      },
      required: ["action", "label"],
      additionalProperties: false,
    } as const;
    const schema = executableJsonSchema(source);

    expect(JSON.stringify(schema)).toBe(JSON.stringify(source));
    expect(
      schemaValidationIssues(schema, { action: "insert", label: "A" }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(schema, { action: "rename", label: "A" }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/action" })]),
    );
    expect(
      schemaValidationIssues(schema, { action: "insert", label: "" }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/label" })]),
    );
  });

  it("rejects unsupported schema composition instead of silently weakening it", () => {
    expect(() =>
      executableJsonSchema({ oneOf: [{ type: "string" }, { type: "number" }] }),
    ).toThrow("Unsupported executable JSON Schema keyword: oneOf");
  });

  it("executes a closed object and its discriminated branches as one schema", () => {
    const source = {
      type: "object",
      properties: {
        action: { enum: ["insert", "remove"] },
        label: { type: "string" },
        nodeId: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
      anyOf: [
        {
          type: "object",
          properties: {
            action: { const: "insert" },
            label: { type: "string", minLength: 1 },
          },
          required: ["action", "label"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            action: { const: "remove" },
            nodeId: { type: "string", minLength: 1 },
          },
          required: ["action", "nodeId"],
          additionalProperties: false,
        },
      ],
    } as const;
    const schema = executableJsonSchema(source);

    expect(JSON.stringify(schema)).toBe(JSON.stringify(source));
    expect(
      schemaValidationIssues(schema, { action: "insert", label: "A" }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(schema, { action: "remove", nodeId: "node_1" }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(schema, { action: "insert", nodeId: "node_1" }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/label" })]),
    );
    expect(
      schemaValidationIssues(schema, {
        action: "remove",
        nodeId: "node_1",
        unexpected: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/unexpected" }),
      ]),
    );
  });

  it("follows nested discriminants before choosing union errors", () => {
    const schema = executableJsonSchema({
      anyOf: [
        { type: "boolean" },
        {
          anyOf: [
            {
              type: "object",
              properties: {
                type: { const: "CUSTOM" },
                amount: { type: "number" },
              },
              required: ["type", "amount"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "ALIAS" },
                id: { type: "string" },
              },
              required: ["type", "id"],
              additionalProperties: false,
            },
          ],
        },
      ],
    } as const);

    expect(schemaValidationIssues(schema, { type: "CUSTOM" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/amount" })]),
    );
    expect(schemaValidationIssues(schema, { type: "CUSTOM" })).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Expected boolean" }),
      ]),
    );
  });

  it("preserves empty-object runtime metadata when executable schemas are composed", () => {
    const nested = executableJsonSchema({
      type: "object",
      properties: {
        action: { const: "replace" },
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              extensions: { type: "object" },
            },
            required: ["extensions"],
            additionalProperties: false,
          },
        },
      },
      required: ["action", "nodes"],
      additionalProperties: false,
    } as const);
    const composed = executableJsonSchema({
      type: "object",
      properties: {
        version: { const: 1 },
        apply: { type: "object" },
      },
      required: ["version"],
      additionalProperties: false,
      anyOf: [
        {
          type: "object",
          properties: {
            version: { const: 1 },
            apply: nested,
          },
          required: ["version", "apply"],
          additionalProperties: false,
        },
      ],
    } as const);

    expect(
      schemaValidationIssues(composed, {
        version: 1,
        apply: { action: "replace", nodes: [{ extensions: {} }] },
      }),
    ).toHaveLength(0);
  });

  it("preserves tuple item metadata when executable schemas are composed", () => {
    const transform = executableJsonSchema({
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: [
        { type: "number" },
        { type: "number" },
        { type: "number" },
        { type: "number" },
        { type: "number" },
        { type: "number" },
      ],
    } as const);
    const composed = executableJsonSchema({
      type: "object",
      properties: { transform },
      required: ["transform"],
      additionalProperties: false,
    } as const);

    expect(
      schemaValidationIssues(composed, {
        transform: [1, 0, 0, 1, 32, 48],
      }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(composed, {
        transform: [1, 0, "invalid", 1, 32, 48],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/transform/2" }),
      ]),
    );
  });

  it("recomposes nested executable discriminated intersections", () => {
    const nested = executableJsonSchema({
      type: "object",
      properties: {
        kind: { enum: ["text", "shape"] },
        properties: { type: "object" },
      },
      required: ["kind", "properties"],
      additionalProperties: false,
      anyOf: [
        {
          type: "object",
          properties: {
            kind: { const: "text" },
            properties: {
              type: "object",
              properties: {
                mode: { enum: ["fixed", "auto"] },
                maxLines: { anyOf: [{ type: "integer" }, { type: "null" }] },
              },
              required: ["mode", "maxLines"],
              additionalProperties: false,
              anyOf: [
                {
                  type: "object",
                  properties: {
                    mode: { const: "fixed" },
                    maxLines: { type: "null" },
                  },
                  required: ["mode", "maxLines"],
                },
                {
                  type: "object",
                  properties: {
                    mode: { const: "auto" },
                    maxLines: { type: "integer", minimum: 1 },
                  },
                  required: ["mode", "maxLines"],
                },
              ],
            },
          },
          required: ["kind", "properties"],
        },
        {
          type: "object",
          properties: {
            kind: { const: "shape" },
            properties: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
          required: ["kind", "properties"],
        },
      ],
    } as const);

    expect(() =>
      executableJsonSchema({
        type: "object",
        properties: { node: nested },
        required: ["node"],
        additionalProperties: false,
      } as const),
    ).not.toThrow();
  });

  it("supports standard empty schemas for compact shared-field branches", () => {
    const schema = executableJsonSchema({
      type: "object",
      properties: {
        kind: { enum: ["text", "shape"] },
        value: { type: "string", minLength: 1 },
      },
      required: ["kind", "value"],
      additionalProperties: false,
      anyOf: [
        {
          type: "object",
          properties: { kind: { const: "text" }, value: {} },
          required: ["kind", "value"],
        },
        {
          type: "object",
          properties: { kind: { const: "shape" }, value: {} },
          required: ["kind", "value"],
        },
      ],
    } as const);

    expect(
      schemaValidationIssues(schema, { kind: "text", value: "A" }),
    ).toEqual([]);
    expect(schemaValidationIssues(schema, { kind: "text", value: "" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/value" })]),
    );
  });
});

it("validates typed image asset derivation commands", () => {
  const derivation = {
    id: "image_derivation_1",
    sourceAssetId: "asset_original",
    resultAssetId: "asset_retouch",
    operation: "prompt-edit",
    prompt: "Reduce background distraction",
    referenceAssetIds: ["asset_reference"],
    extensions: {},
  };
  expect(
    Value.Check(DesignOperationSchema, {
      commandId: "put_image_derivation",
      type: "put_image_asset_derivation",
      derivation,
    }),
  ).toBe(true);
  expect(
    Value.Check(DesignOperationSchema, {
      commandId: "put_relight_derivation",
      type: "put_image_asset_derivation",
      derivation: {
        id: "image_derivation_relight",
        sourceAssetId: "asset_original",
        resultAssetId: "asset_retouch",
        operation: "relight",
        lightingPreset: "neon",
        referenceAssetIds: [],
        extensions: {},
      },
    }),
  ).toBe(true);
  expect(
    Value.Check(DesignOperationSchema, {
      commandId: "put_invalid_relight_derivation",
      type: "put_image_asset_derivation",
      derivation: {
        id: "image_derivation_relight",
        sourceAssetId: "asset_original",
        resultAssetId: "asset_retouch",
        operation: "relight",
        lightingPreset: "party-mode",
        referenceAssetIds: [],
        extensions: {},
      },
    }),
  ).toBe(false);
  expect(
    Value.Check(DesignOperationSchema, {
      commandId: "put_background_derivation",
      type: "put_image_asset_derivation",
      derivation: {
        ...derivation,
        id: "image_derivation_background",
        operation: "replace-background",
        prompt: "A quiet cobalt studio",
        referenceAssetIds: [],
      },
    }),
  ).toBe(true);
  expect(
    Value.Check(DesignOperationSchema, {
      commandId: "delete_image_derivation",
      type: "delete_image_asset_derivation",
      derivationId: derivation.id,
    }),
  ).toBe(true);
  expect(
    Value.Check(DesignOperationSchema, {
      commandId: "invalid_image_derivation",
      type: "put_image_asset_derivation",
      derivation: { ...derivation, operation: "unknown-edit" },
    }),
  ).toBe(false);
});

it("validates bounded derived Component selection targets", () => {
  expect(
    schemaValidationIssues(SelectionStateSchema, {
      nodeIds: ["card_instance"],
      anchorNodeId: "card_instance",
      componentTarget: {
        instanceId: "card_instance",
        sourcePath: ["nested_row", "row_label"],
      },
    }),
  ).toEqual([]);
  expect(
    schemaValidationIssues(SelectionStateSchema, {
      nodeIds: ["card_instance"],
      componentTarget: {
        instanceId: "card_instance",
        sourcePath: [],
      },
    }),
  ).not.toEqual([]);
});

it("keeps Auto Layout and Layout Guide schema milestones distinct", () => {
  expect(AUTO_LAYOUT_DESIGN_SCHEMA_VERSION).toBe("1.18.0");
  expect(LAYOUT_GUIDE_DESIGN_SCHEMA_VERSION).toBe("1.19.0");
  expect(LAYOUT_GUIDE_COLUMNS_ROWS_DESIGN_SCHEMA_VERSION).toBe("1.20.0");
  expect(FIGMA_COMPONENT_PROPERTIES_DESIGN_SCHEMA_VERSION).toBe("1.21.0");
  expect(COMPONENT_SET_VARIANT_DESIGN_SCHEMA_VERSION).toBe("1.22.0");
  expect(VARIANT_PROPERTY_MATRIX_DESIGN_SCHEMA_VERSION).toBe("1.23.0");
  expect(COMPONENT_SLOT_DESIGN_SCHEMA_VERSION).toBe("1.24.0");
  expect(COMPONENT_PROPERTY_ORDER_DESIGN_SCHEMA_VERSION).toBe("1.25.0");
  expect(FIGMA_VARIABLES_DESIGN_SCHEMA_VERSION).toBe("1.26.0");
  expect(FIGMA_SHARED_STYLES_DESIGN_SCHEMA_VERSION).toBe("1.27.0");
  expect(FIGMA_EXPORT_SETTINGS_DESIGN_SCHEMA_VERSION).toBe("1.28.0");
  expect(TYPOGRAPHY_CORE_V2_DESIGN_SCHEMA_VERSION).toBe("1.29.0");
  expect(FONT_FACE_IDENTITY_DESIGN_SCHEMA_VERSION).toBe("1.30.0");
  expect(RICH_TEXT_RUNS_DESIGN_SCHEMA_VERSION).toBe("1.31.0");
  expect(PARAGRAPH_STYLE_RUNS_DESIGN_SCHEMA_VERSION).toBe("1.32.0");
  expect(FIGMA_TEXT_LISTS_DESIGN_SCHEMA_VERSION).toBe("1.33.0");
  expect(AUTO_LAYOUT_GRID_DESIGN_SCHEMA_VERSION).toBe("1.34.0");
  expect(AUTO_LAYOUT_GRID_V2_DESIGN_SCHEMA_VERSION).toBe("1.35.0");
  expect(FIGMA_LAYER_STATE_DESIGN_SCHEMA_VERSION).toBe("1.36.0");
  expect(LIBRARY_COMPONENT_SOURCE_DESIGN_SCHEMA_VERSION).toBe("1.37.0");
  expect(LIBRARY_STYLE_SOURCE_DESIGN_SCHEMA_VERSION).toBe("1.38.0");
  expect(LIBRARY_VARIABLE_SOURCE_DESIGN_SCHEMA_VERSION).toBe("1.39.0");
  expect(IMAGE_ADJUSTMENTS_DESIGN_SCHEMA_VERSION).toBe("1.40.0");
  expect(IMAGE_PAINT_ADJUSTMENTS_DESIGN_SCHEMA_VERSION).toBe("1.41.0");
  expect(IMAGE_ASSET_DERIVATIONS_DESIGN_SCHEMA_VERSION).toBe("1.42.0");
  expect(IMAGE_BACKGROUND_REPLACEMENT_DESIGN_SCHEMA_VERSION).toBe("1.43.0");
  expect(IMAGE_RELIGHTING_DESIGN_SCHEMA_VERSION).toBe("1.44.0");
  expect(AUTO_LAYOUT_WRAP_DISTRIBUTION_DESIGN_SCHEMA_VERSION).toBe("1.45.0");
  expect(AUTO_LAYOUT_WRAP_FILL_DESIGN_SCHEMA_VERSION).toBe("1.46.0");
  expect(AUTO_LAYOUT_BASELINE_DESIGN_SCHEMA_VERSION).toBe("1.47.0");
  expect(DESIGN_SCHEMA_VERSION).toBe(
    AUTO_LAYOUT_BASELINE_DESIGN_SCHEMA_VERSION,
  );
});

it("migrates 1.44 documents without inventing wrapped row distribution", () => {
  const source = textDocumentFixture();
  source.schemaVersion =
    IMAGE_RELIGHTING_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  source.pagesById.page_1.rootNodeIds = ["frame_1"];
  (source.nodesById.text_1 as { parentId: string | null }).parentId = "frame_1";
  Object.assign(source.nodesById, {
    frame_1: {
      id: "frame_1",
      kind: "frame",
      name: "Wrapped tags",
      parentId: null,
      childIds: ["text_1"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 160 },
      exportSettings: [],
      opacity: 1,
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
        autoLayout: {
          mode: "horizontal",
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
          gap: 8,
          primaryAlignment: "start",
          counterAlignment: "start",
          wrap: { mode: "wrap", counterGap: 12 },
        },
      },
      extensions: {},
    },
  });
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  const frame = migrated?.nodesById.frame_1;
  expect(frame?.kind).toBe("frame");
  expect(
    frame?.kind === "frame" ? frame.properties.autoLayout : undefined,
  ).toMatchObject({ wrap: { mode: "wrap", counterGap: 12 } });
  expect(
    frame?.kind === "frame" ? frame.properties.autoLayout : undefined,
  ).not.toHaveProperty("wrap.counterAxisAlignContent");
});

it("migrates 1.45 documents without rewriting layout data for Wrap Fill", () => {
  const source = textDocumentFixture();
  source.schemaVersion =
    AUTO_LAYOUT_WRAP_DISTRIBUTION_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  const nodes = structuredClone(source.nodesById);
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById).toEqual(nodes);
});

it("migrates 1.46 documents without inventing baseline alignment", () => {
  const source = textDocumentFixture();
  source.schemaVersion =
    AUTO_LAYOUT_WRAP_FILL_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  const nodes = structuredClone(source.nodesById);
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById).toEqual(nodes);
});

it("migrates the previous image Paint document with empty image source history", () => {
  const source = textDocumentFixture() as unknown as Record<string, unknown>;
  source.schemaVersion = IMAGE_PAINT_ADJUSTMENTS_DESIGN_SCHEMA_VERSION;
  delete source.imageAssetDerivationOrder;
  delete source.imageAssetDerivationsById;
  const migrated = migrateDesignDocument(source);
  expect(migrated).toMatchObject({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    imageAssetDerivationOrder: [],
    imageAssetDerivationsById: {},
  });
});

it("migrates the previous Variable Library document without inventing image adjustments", () => {
  const source = textDocumentFixture() as unknown as Record<string, unknown>;
  source.schemaVersion = LIBRARY_VARIABLE_SOURCE_DESIGN_SCHEMA_VERSION;
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById.text_1).not.toHaveProperty("properties.filters");
});

it("migrates the previous Image adjustments document without inventing Image Paint filters", () => {
  const source = textDocumentFixture() as unknown as Record<string, unknown>;
  source.schemaVersion = IMAGE_ADJUSTMENTS_DESIGN_SCHEMA_VERSION;
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById.text_1).not.toHaveProperty(
    "properties.fills.0.filters",
  );
});

it("migrates a Library release without Variables to the current release contract", () => {
  const migrated = migrateLibraryReleaseSnapshot({
    version: 2,
    libraryId: "library",
    releaseId: "release",
    sourceProjectId: "project",
    sourceDesignFileId: "design-system",
    sourceDocumentId: "document",
    name: "Library",
    publishedAt: "2026-08-22T08:00:00.000Z",
    componentsById: {},
    variantSetsById: {},
    stylesById: {},
  });
  expect(migrated).toMatchObject({
    version: 3,
    variableCollectionsById: {},
    variablesById: {},
  });
});

it("migrates 1.37 documents with an empty imported Library Style store", () => {
  const source = structuredClone(textDocumentFixture()) as unknown as Record<
    string,
    unknown
  >;
  source.schemaVersion = LIBRARY_COMPONENT_SOURCE_DESIGN_SCHEMA_VERSION;
  delete source.libraryStylesById;
  expect(migrateDesignDocument(source)).toMatchObject({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    libraryStylesById: {},
    libraryVariableCollectionsById: {},
    libraryVariablesById: {},
  });
});

it("migrates 1.36 documents with empty imported Library source stores", () => {
  const source = structuredClone(textDocumentFixture()) as unknown as Record<
    string,
    unknown
  >;
  source.schemaVersion = FIGMA_LAYER_STATE_DESIGN_SCHEMA_VERSION;
  delete source.libraryComponentsById;
  delete source.libraryVariantSetsById;
  delete source.libraryStylesById;
  expect(migrateDesignDocument(source)).toMatchObject({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    libraryStylesById: {},
  });
});

it("migrates 1.35 documents without inventing layer state overrides", () => {
  const source = textDocumentFixture() as unknown as DesignDocument;
  source.schemaVersion =
    AUTO_LAYOUT_GRID_V2_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById.text_1?.locked).toBe(false);
});

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

function textDocumentFixture() {
  return {
    format: DESIGN_FORMAT,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "document_text_current",
    revision: 0,
    pageOrder: ["page_1"],
    pagesById: {
      page_1: {
        id: "page_1",
        name: "Page 1",
        rootNodeIds: ["text_1"],
        extensions: {},
      },
    },
    nodesById: {
      text_1: {
        id: "text_1",
        name: "Text",
        parentId: null,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0] as const,
        size: { width: 240, height: 64 },
        exportSettings: [],
        opacity: 1,
        extensions: {},
        kind: "text" as const,
        properties: {
          content: "Text",
          runs: [],
          fontFamily: "Inter",
          fontStyleName: null,
          fontSize: 20,
          fontWeight: 500,
          fontSlant: "normal",
          lineHeight: 28,
          letterSpacing: 0,
          paragraphIndent: 0,
          paragraphSpacing: 0,
          listSpacing: 0,
          hangingList: false,
          paragraphRuns: [],
          textCase: "original" as const,
          textDecoration: "none" as const,
          textAlignHorizontal: "left" as const,
          textAlignVertical: "top" as const,
          textResize: "fixed" as const,
          textWrap: "word" as const,
          textOverflow: "clip" as const,
          textTruncation: "disabled" as const,
          maxLines: null,
          fills: [{ type: "solid" as const, color: "#111827", opacity: 1 }],
          strokes: [],
          strokeWidth: 0,
        },
      },
    },
    componentsById: {},
    variantSetsById: {},
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    libraryStylesById: {},
    libraryVariableCollectionsById: {},
    libraryVariablesById: {},
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
    interactionsById: {},
    assetsById: {},
    imageAssetDerivationOrder: [],
    imageAssetDerivationsById: {},
    extensions: {},
  };
}

function operation() {
  return {
    commandId: "command_1",
    type: "delete_element" as const,
    nodeId: "node_1",
  };
}

describe("design contract schemas", () => {
  it("validates component overrides without permitting structural edits", () => {
    expect(
      Value.Check(ComponentOverridePatchSchema, {
        visible: false,
        locked: true,
        opacity: 0.8,
        properties: { content: "Buy now" },
      }),
    ).toBe(true);
    expect(
      Value.Check(ComponentOverridePatchSchema, {
        transform: [1, 0, 0, 1, 40, 40],
      }),
    ).toBe(false);
  });

  it("rejects unknown operation and transaction properties", () => {
    expect(Value.Check(DesignOperationSchema, operation())).toBe(true);
    expect(
      Value.Check(DesignOperationSchema, { ...operation(), unexpected: true }),
    ).toBe(false);
    expect(
      Value.Check(DesignTransactionSchema, {
        transactionId: "transaction_1",
        documentId: "document_1",
        baseRevision: 0,
        actor,
        commands: [operation()],
        unexpected: true,
      }),
    ).toBe(false);
  });

  it("validates bounded explicit text reflow without admitting duplicate targets", () => {
    const reflow = {
      commandId: "reflow_inter",
      type: "reflow_text",
      nodeIds: ["title", "subtitle"],
      expectedFont: {
        fontFamily: "Inter",
        fontStyleName: null,
        fontWeight: 600,
        fontSlant: "normal",
      },
      replacementFont: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: null,
        fontWeight: 500,
        fontSlant: "normal",
      },
    };

    expect(Value.Check(DesignOperationSchema, reflow)).toBe(true);
    expect(
      Value.Check(DesignOperationSchema, {
        ...reflow,
        nodeIds: ["title", "title"],
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignOperationSchema, {
        ...reflow,
        expectedFont: {
          fontFamily: "Inter",
          fontStyleName: null,
          fontWeight: 0,
          fontSlant: "normal",
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignOperationSchema, {
        ...reflow,
        fontPath: "/Library/Fonts/Inter.ttf",
      }),
    ).toBe(false);
  });

  it("rejects cyclic JSON values without throwing", () => {
    const extensions: Record<string, unknown> = {};
    extensions.self = extensions;
    const value = {
      transactionId: "transaction_cyclic",
      documentId: "document_1",
      baseRevision: 0,
      actor,
      commands: [operation()],
      extensions,
    };

    expect(() => isDesignTransaction(value)).not.toThrow();
    expect(isDesignTransaction(value)).toBe(false);
    expect(schemaValidationIssues(DesignTransactionSchema, value)).toEqual([
      {
        path: "",
        message: "Value contains an unsupported cyclic structure",
      },
    ]);
  });

  it("reports current document domain failures with stable codes and paths", () => {
    const document = textDocumentFixture() as unknown as DesignDocument;
    document.nodesById.text_1!.layoutLimits = {
      minWidth: 320,
      maxWidth: 80,
    };

    const result = DesignDocumentContract.parse(document);

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design.document_layout_limits_invalid",
          path: "/nodesById/text_1/layoutLimits",
        }),
      ],
    });
    expect(migrateDesignDocument(document)).toBeNull();
  });

  it("expands discriminated node union failures to actionable fields", () => {
    const invalidFrame = {
      id: "frame_invalid",
      name: "Invalid frame",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "frame",
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
      },
    };

    const issues = schemaValidationIssues(DesignNodeSchema, invalidFrame);

    expect(issues).toContainEqual({
      path: "/properties/clipsContent",
      message: "Expected required property",
    });
    expect(
      issues.some((issue) => issue.message === "Expected union value"),
    ).toBe(false);

    const transactionIssues = schemaValidationIssues(DesignTransactionSchema, {
      transactionId: "transaction_invalid_frame",
      documentId: "document_1",
      baseRevision: 0,
      actor,
      commands: [
        {
          commandId: "insert_invalid_frame",
          type: "insert_element",
          pageId: "page_1",
          parentId: null,
          index: 0,
          node: invalidFrame,
        },
      ],
    });
    expect(transactionIssues).toContainEqual({
      path: "/commands/0/node/properties/clipsContent",
      message: "Expected required property",
    });
    expect(
      transactionIssues.some(
        (issue) => issue.message === "Expected union value",
      ),
    ).toBe(false);
  });

  it("enforces a non-empty command list capped at 500", () => {
    const transaction = {
      transactionId: "transaction_1",
      documentId: "document_1",
      baseRevision: 0,
      actor,
    };
    expect(
      Value.Check(DesignTransactionSchema, { ...transaction, commands: [] }),
    ).toBe(false);
    expect(
      Value.Check(DesignTransactionSchema, {
        ...transaction,
        commands: Array.from(
          { length: MAX_TRANSACTION_COMMANDS + 1 },
          (_, index) => ({
            ...operation(),
            commandId: `command_${index}`,
          }),
        ),
      }),
    ).toBe(false);
  });

  it("validates explicit non-destructive image placement modes", () => {
    const base = {
      id: "image_1",
      name: "Hero",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 640, height: 360 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "image",
      properties: {
        assetId: "asset_1",
        altText: "Hero image",
        cornerRadius: 0,
      },
    };
    expect(
      Value.Check(DesignNodeSchema, {
        ...base,
        properties: {
          ...base.properties,
          placement: {
            mode: "crop",
            focalPoint: { x: 0.3, y: 0.65 },
            zoom: 1.4,
            rotation: -12,
            flipHorizontal: false,
            flipVertical: true,
          },
          filters: {
            exposure: 0.25,
            contrast: -0.5,
            saturation: 1,
            temperature: -1,
            tint: 0.4,
            highlights: -0.2,
            shadows: 0.35,
          },
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...base,
        properties: {
          ...base.properties,
          placement: { mode: "fit" },
          filters: { exposure: 1.01 },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...base,
        properties: {
          ...base.properties,
          placement: {
            mode: "crop",
            focalPoint: { x: 1.1, y: 0.5 },
            zoom: 0.5,
            rotation: 0,
            flipHorizontal: false,
            flipVertical: false,
          },
        },
      }),
    ).toBe(false);
  });

  it("accepts complex paints and effects as engine-independent design semantics", () => {
    expect(
      Value.Check(PaintSchema, {
        type: "linear-gradient",
        opacity: 0.9,
        from: { x: 0, y: 0.5 },
        to: { x: 1, y: 0.5 },
        stops: [
          { offset: 0, color: "#3366ff", opacity: 1 },
          { offset: 1, color: "#9b5cff", opacity: 0.35 },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(PaintSchema, {
        type: "image",
        assetId: "asset_photo",
        fit: "cover",
        opacity: 1,
        filters: { exposure: 0.2, saturation: -0.35, shadows: 0.4 },
      }),
    ).toBe(true);
    expect(
      Value.Check(PaintSchema, {
        type: "image",
        assetId: "asset_photo",
        fit: "cover",
        opacity: 1,
        filters: { tint: -1.1 },
      }),
    ).toBe(false);
    expect(
      Value.Check(EffectSchema, {
        type: "outer-glow",
        color: "#4f7fff",
        opacity: 0.6,
        radius: 28,
        spread: 3,
      }),
    ).toBe(true);
  });

  it("defines portable SVG path geometry with the same appearance semantics as shapes", () => {
    const pathNode = {
      id: "path_penguin",
      name: "Penguin silhouette",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 160, height: 220 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "path",
      properties: {
        path: "M 80 4 C 126 4 154 46 148 108 C 143 171 118 214 80 216 C 42 214 17 171 12 108 C 6 46 34 4 80 4 Z",
        fillRule: "evenodd",
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [{ type: "solid", color: "#030712", opacity: 0.8 }],
        strokeWidth: 3,
        strokeAlign: "inside",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [],
      },
    };

    expect(Value.Check(DesignNodeSchema, pathNode)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...pathNode,
        properties: { ...pathNode.properties, path: "<script>bad()</script>" },
      }),
    ).toBe(false);
  });

  it("defines editable vector networks as an exclusive path geometry source", () => {
    const vectorNode = {
      id: "vector_mark",
      name: "Editable mark",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 20, 30],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "vector",
      properties: {
        network: {
          vertices: [
            { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
            { id: "vertex_b", x: 100, y: 0, handleMode: "smooth" },
            { id: "vertex_c", x: 50, y: 100, handleMode: "independent" },
          ],
          segments: [
            {
              id: "segment_ab",
              startVertexId: "vertex_a",
              endVertexId: "vertex_b",
            },
            {
              id: "segment_bc",
              startVertexId: "vertex_b",
              endVertexId: "vertex_c",
            },
            {
              id: "segment_ca",
              startVertexId: "vertex_c",
              endVertexId: "vertex_a",
            },
          ],
          paths: [
            {
              id: "path_outer",
              closed: true,
              segments: [
                { segmentId: "segment_ab", reversed: false },
                { segmentId: "segment_bc", reversed: false },
                { segmentId: "segment_ca", reversed: false },
              ],
            },
          ],
          regions: [
            {
              id: "region_outer",
              windingRule: "nonzero",
              loops: [{ pathId: "path_outer", reversed: false }],
            },
          ],
        },
        fillRule: "nonzero",
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokeWidth: 2,
      },
    };

    expect(Value.Check(DesignNodeSchema, vectorNode)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...vectorNode,
        properties: { ...vectorNode.properties, path: "M 0 0 L 100 0" },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...vectorNode,
        properties: {
          ...vectorNode.properties,
          network: {
            ...vectorNode.properties.network,
            vertices: [
              {
                ...vectorNode.properties.network.vertices[0],
                handleMode: "automatic",
              },
              ...vectorNode.properties.network.vertices.slice(1),
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...vectorNode,
        properties: {
          ...vectorNode.properties,
          network: {
            ...vectorNode.properties.network,
            vertices: [
              { id: "invalid id", x: 0, y: 0 },
              ...vectorNode.properties.network.vertices.slice(1),
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...vectorNode,
        properties: { ...vectorNode.properties, unsupportedGeometry: true },
      }),
    ).toBe(false);
  });

  it("defines a directed editable line with independent endpoint decorations", () => {
    const lineNode = {
      id: "line_flow",
      name: "Directed flow",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 40, 32],
      size: { width: 240, height: 120 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "line",
      properties: {
        fills: [],
        strokes: [{ type: "solid", color: "#2563eb", opacity: 1 }],
        strokeWidth: 3,
        strokeAlign: "center",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [12, 6],
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        startEndpoint: "circle",
        endEndpoint: "triangle-arrow",
      },
    };

    expect(Value.Check(DesignNodeSchema, lineNode)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...lineNode,
        properties: {
          ...lineNode.properties,
          endEndpoint: "custom-unsafe-marker",
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...lineNode,
        properties: {
          ...lineNode.properties,
          fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...lineNode,
        properties: { ...lineNode.properties, strokeAlign: "inside" },
      }),
    ).toBe(false);
    expect(
      resolveLineEndpointPoint(lineNode.size, lineNode.properties.start),
    ).toEqual({ x: 240, y: 0 });
  });

  it("normalizes line direction without losing horizontal or reverse endpoints", () => {
    expect(normalizeLineEndpoints({ x: 80, y: 40 }, { x: 20, y: 40 })).toEqual({
      bounds: { x: 20, y: 40, width: 60, height: 0 },
      start: { x: 1, y: 0.5 },
      end: { x: 0, y: 0.5 },
    });
  });

  it("defines bounded semantic Polygon and Star nodes", () => {
    const base = {
      id: "shape_1",
      name: "Semantic shape",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 40, 32],
      size: { width: 200, height: 160 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
    };
    const shape = {
      fills: [{ type: "solid", color: "#f59e0b", opacity: 1 }],
      strokes: [{ type: "solid", color: "#78350f", opacity: 1 }],
      strokeWidth: 2,
      strokeAlign: "inside",
      strokeJoin: "round",
      dashPattern: [],
      pointCount: 6,
      cornerRadius: 8,
    };
    const polygon = { ...base, kind: "polygon", properties: shape };
    const star = {
      ...base,
      id: "star_1",
      kind: "star",
      properties: { ...shape, pointCount: 5, innerRadius: 0.382 },
    };

    expect(Value.Check(DesignNodeSchema, polygon)).toBe(true);
    expect(Value.Check(DesignNodeSchema, star)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...polygon,
        properties: { ...shape, pointCount: 2 },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...star,
        properties: { ...star.properties, innerRadius: 1.01 },
      }),
    ).toBe(false);
  });

  it("resolves Polygon and Star vertices from the top in local bounds", () => {
    const polygon = resolveRegularPolygonPoints({ width: 100, height: 80 }, 4);
    const expectedPolygon = [
      { x: 50, y: 0 },
      { x: 100, y: 40 },
      { x: 50, y: 80 },
      { x: 0, y: 40 },
    ];
    polygon.forEach((point, index) => {
      expect(point.x).toBeCloseTo(expectedPolygon[index]!.x, 10);
      expect(point.y).toBeCloseTo(expectedPolygon[index]!.y, 10);
    });
    const star = resolveStarPoints({ width: 100, height: 100 }, 5, 0.5);
    expect(star).toHaveLength(10);
    expect(star[0]).toEqual({ x: 50, y: 0 });
    expect(star[1]?.x).toBeCloseTo(64.6946, 4);
    expect(star[1]?.y).toBeCloseTo(29.7746, 4);
    expect(() =>
      resolveRegularPolygonPoints({ width: 10, height: 10 }, 61),
    ).toThrow("pointCount");
  });

  it("defines a non-destructive Boolean container without persisting derived provider geometry", () => {
    const booleanNode = {
      id: "boolean_logo",
      name: "Logo cutout",
      parentId: null,
      childIds: ["path_base", "path_cutout"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 160, height: 160 },
      exportSettings: [],
      opacity: 1,
      effects: [
        {
          type: "outer-glow",
          color: "#5b8cff",
          opacity: 0.45,
          radius: 20,
          spread: 2,
        },
      ],
      extensions: {},
      kind: "boolean",
      properties: {
        operation: "subtract",
        fillRule: "evenodd",
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
    };

    expect(Value.Check(DesignNodeSchema, booleanNode)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...booleanNode,
        properties: { ...booleanNode.properties, operation: "divide" },
      }),
    ).toBe(false);
    expect(booleanNode.properties).not.toHaveProperty("path");
  });

  it("migrates 1.0 documents to the versioned appearance contract", () => {
    const legacy = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.0.0",
      documentId: "document_legacy",
      revision: 0,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: [],
          extensions: {},
        },
      },
      nodesById: {},
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: {},
    };
    expect(migrateDesignDocument(legacy)?.schemaVersion).toBe(
      DESIGN_SCHEMA_VERSION,
    );
    expect(
      migrateDesignDocument({ ...legacy, schemaVersion: "0.9.0" }),
    ).toBeNull();
  });

  it("migrates 1.1 path placeholders without losing their legacy payload", () => {
    const legacyPathProperties = {
      path: [1, 10, 10, 2, 80, 80, 11],
      customGeometryHint: "legacy compact command stream",
    };
    const legacy = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.1.0",
      documentId: "document_path_legacy",
      revision: 3,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: ["path_1"],
          extensions: {},
        },
      },
      nodesById: {
        path_1: {
          id: "path_1",
          name: "Legacy path",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 100, height: 100 },
          exportSettings: [],
          opacity: 1,
          extensions: {},
          kind: "path",
          properties: legacyPathProperties,
        },
      },
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: {},
    };

    const migrated = migrateDesignDocument(legacy);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const path = migrated?.nodesById.path_1;
    expect(path?.kind).toBe("path");
    if (!path || path.kind !== "path") throw new Error("Missing path node");
    expect(path.properties).toMatchObject({
      path: "M 0 0",
      fills: [],
      strokes: [],
      strokeWidth: 0,
    });
    expect(path.extensions["dev.opendesign.path.migration"]).toEqual({
      sourceSchemaVersion: "1.1.0",
      originalProperties: legacyPathProperties,
      usedPlaceholderPath: true,
    });
  });

  it.each([
    ["fill", { mode: "stretch" }],
    ["contain", { mode: "fit" }],
    ["cover", { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } }],
  ])("migrates 1.2 image fit %s to explicit placement", (fit, placement) => {
    const legacy = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.2.0",
      documentId: `document_image_${fit}`,
      revision: 2,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: ["image_1"],
          extensions: {},
        },
      },
      nodesById: {
        image_1: {
          id: "image_1",
          name: "Legacy image",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 320, height: 240 },
          exportSettings: [],
          opacity: 1,
          extensions: {},
          kind: "image",
          properties: {
            assetId: "asset_1",
            fit,
            altText: "Legacy image",
            cornerRadius: 0,
          },
        },
      },
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {
        asset_1: {
          id: "asset_1",
          kind: "image",
          name: "Legacy asset",
          mimeType: "image/png",
          source: { type: "data", value: "aW1hZ2U=" },
          size: { width: 640, height: 480 },
          extensions: {},
        },
      },
      extensions: {},
    };

    const migrated = migrateDesignDocument(legacy);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const image = migrated?.nodesById.image_1;
    expect(image?.kind).toBe("image");
    if (!image || image.kind !== "image") throw new Error("Missing image");
    expect(image.properties.placement).toEqual(placement);
    expect(
      image.extensions["dev.opendesign.image-placement.migration"],
    ).toEqual({ sourceSchemaVersion: "1.2.0", legacyFit: fit });
  });

  it("migrates a 1.3 document to the current schema without inventing state", () => {
    const imagePlacementDocument = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.3.0",
      documentId: "document_image_placement",
      revision: 7,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: [],
          extensions: {},
        },
      },
      nodesById: {},
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.3-fixture" },
    };

    expect(migrateDesignDocument(imagePlacementDocument)).toEqual({
      ...imagePlacementDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
      libraryComponentsById: {},
      libraryVariantSetsById: {},
      libraryStylesById: {},
      libraryVariableCollectionsById: {},
      libraryVariablesById: {},
      imageAssetDerivationOrder: [],
      imageAssetDerivationsById: {},
    });
  });

  it("migrates a 1.4 document to the current schema without inventing Line state", () => {
    const maskDocument = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.4.0",
      documentId: "document_mask",
      revision: 9,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: [],
          extensions: {},
        },
      },
      nodesById: {},
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.4-fixture" },
    };

    expect(migrateDesignDocument(maskDocument)).toEqual({
      ...maskDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
      libraryComponentsById: {},
      libraryVariantSetsById: {},
      libraryStylesById: {},
      libraryVariableCollectionsById: {},
      libraryVariablesById: {},
      imageAssetDerivationOrder: [],
      imageAssetDerivationsById: {},
    });
  });

  it("migrates a 1.5 document without inventing Polygon, Star, or vector state", () => {
    const lineDocument = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.5.0",
      documentId: "document_line",
      revision: 10,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: [],
          extensions: {},
        },
      },
      nodesById: {},
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.5-fixture" },
    };

    expect(migrateDesignDocument(lineDocument)).toEqual({
      ...lineDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
      libraryComponentsById: {},
      libraryVariantSetsById: {},
      libraryStylesById: {},
      libraryVariableCollectionsById: {},
      libraryVariablesById: {},
      imageAssetDerivationOrder: [],
      imageAssetDerivationsById: {},
    });
  });

  it("migrates a 1.6 document without converting exact path data into an editable network", () => {
    const regularShapeDocument = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.6.0",
      documentId: "document_regular_shape",
      revision: 11,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: ["path_1"],
          extensions: {},
        },
      },
      nodesById: {
        path_1: {
          id: "path_1",
          name: "Exact imported path",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 100, height: 100 },
          exportSettings: [],
          opacity: 1,
          extensions: {},
          kind: "path",
          properties: {
            path: "M 0 0 L 100 0 L 50 100 Z",
            fills: [{ type: "solid", color: "#111827", opacity: 1 }],
            strokes: [],
            strokeWidth: 0,
          },
        },
      },
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.6-fixture" },
    };

    const migrated = migrateDesignDocument(regularShapeDocument);
    expect(migrated).toEqual({
      ...regularShapeDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
      libraryComponentsById: {},
      libraryVariantSetsById: {},
      libraryStylesById: {},
      libraryVariableCollectionsById: {},
      libraryVariablesById: {},
      imageAssetDerivationOrder: [],
      imageAssetDerivationsById: {},
    });
    const path = migrated?.nodesById.path_1;
    expect(path?.kind).toBe("path");
    if (!path || path.kind !== "path") throw new Error("Missing path");
    expect(path.properties).toHaveProperty("path");
    expect(path.properties).not.toHaveProperty("network");
  });

  it("migrates a 1.7 editable network without inventing handle behavior", () => {
    const source = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.7.0",
      documentId: "document_vector_1_7",
      revision: 3,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: ["vector_1"],
          extensions: {},
        },
      },
      nodesById: {
        vector_1: {
          id: "vector_1",
          name: "Legacy editable vector",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 100, height: 0 },
          exportSettings: [],
          opacity: 1,
          extensions: {},
          kind: "vector",
          properties: {
            network: {
              vertices: [
                { id: "vertex_a", x: 0, y: 0 },
                { id: "vertex_b", x: 100, y: 0 },
              ],
              segments: [
                {
                  id: "segment_ab",
                  startVertexId: "vertex_a",
                  endVertexId: "vertex_b",
                },
              ],
              paths: [
                {
                  id: "path_open",
                  closed: false,
                  segments: [{ segmentId: "segment_ab", reversed: false }],
                },
              ],
              regions: [],
            },
            fills: [],
            strokes: [{ type: "solid", color: "#151515", opacity: 1 }],
            strokeWidth: 2,
          },
        },
      },
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: {},
    };

    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const node = migrated?.nodesById.vector_1;
    if (!node || node.kind !== "vector" || !("network" in node.properties)) {
      throw new Error("Missing migrated vector");
    }
    expect(node.properties.network.vertices).toEqual(
      source.nodesById.vector_1.properties.network.vertices,
    );
  });

  it("migrates 1.8 Text to explicit wrapping and overflow without changing its bounds", () => {
    const source = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.8.0",
      documentId: "document_text_1_8",
      revision: 12,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: ["text_1"],
          extensions: {},
        },
      },
      nodesById: {
        text_1: {
          id: "text_1",
          name: "Legacy text box",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 20, 24],
          size: { width: 240, height: 64 },
          exportSettings: [],
          opacity: 1,
          extensions: {},
          kind: "text",
          properties: {
            content: "A long line from an older document",
            fontFamily: "Inter",
            fontStyleName: null,
            fontSize: 20,
            fontWeight: 500,
            fontSlant: "normal",
            lineHeight: 28,
            letterSpacing: 0,
            textAlignHorizontal: "left",
            textAlignVertical: "top",
            fills: [{ type: "solid", color: "#111827", opacity: 1 }],
            strokes: [],
            strokeWidth: 0,
          },
        },
      },
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: {},
    };

    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const text = migrated?.nodesById.text_1;
    if (!text || text.kind !== "text") throw new Error("Missing text");
    expect(text.size).toEqual(source.nodesById.text_1.size);
    expect(text.properties).toMatchObject({
      textResize: "fixed",
      textWrap: "character",
      textOverflow: "visible",
      textTruncation: "disabled",
      maxLines: null,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      textCase: "original",
      textDecoration: "none",
    });
    expect(Value.Check(DesignNodeSchema, text)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: { ...text.properties, textOverflow: "fade" },
      }),
    ).toBe(false);
  });

  it("migrates 1.9 fixed text boxes to explicit Fixed resizing", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.9.0" as typeof source.schemaVersion;
    const text = Object.values(source.nodesById).find(
      (node) => node.kind === "text",
    );
    if (!text || text.kind !== "text") throw new Error("Missing text");
    delete (text.properties as Partial<typeof text.properties>).textResize;

    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const migratedText = migrated?.nodesById[text.id];
    expect(migratedText).toMatchObject({
      kind: "text",
      size: text.size,
      properties: { textResize: "fixed" },
    });
  });

  it("migrates 1.28 ellipsis text and Text Styles to Typography Core v2", () => {
    const source = textDocumentFixture() as unknown as Record<string, unknown>;
    source.schemaVersion = FIGMA_EXPORT_SETTINGS_DESIGN_SCHEMA_VERSION;
    const nodes = source.nodesById as Record<
      string,
      { properties: Record<string, unknown> }
    >;
    const properties = nodes.text_1!.properties;
    properties.textOverflow = "ellipsis";
    delete properties.textTruncation;
    delete properties.maxLines;
    delete properties.paragraphIndent;
    delete properties.paragraphSpacing;
    delete properties.textCase;
    delete properties.textDecoration;
    source.styleOrderByType = {
      PAINT: [],
      TEXT: ["text-style"],
      EFFECT: [],
      GRID: [],
    };
    source.stylesById = {
      "text-style": {
        id: "text-style",
        key: "text-style-key",
        name: "Body",
        description: "",
        hiddenFromPublishing: false,
        extensions: {},
        styleType: "TEXT",
        textStyle: {
          fontFamily: "Inter",
          fontStyleName: null,
          fontSize: 16,
          fontWeight: 400,
          fontSlant: "normal",
          lineHeight: 24,
          letterSpacing: 0,
        },
      },
    };

    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1).toMatchObject({
      kind: "text",
      properties: {
        textOverflow: "clip",
        textTruncation: "ending",
        maxLines: null,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        listSpacing: 0,
        hangingList: false,
        textCase: "original",
        textDecoration: "none",
      },
    });
    expect(migrated?.stylesById["text-style"]).toMatchObject({
      styleType: "TEXT",
      textStyle: {
        paragraphIndent: 0,
        paragraphSpacing: 0,
        listSpacing: 0,
        hangingList: false,
        textCase: "original",
        textDecoration: "none",
      },
    });
  });

  it("migrates 1.10 documents but refuses ambiguous legacy instance semantics", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.10.0" as typeof source.schemaVersion;
    expect(migrateDesignDocument(source)?.schemaVersion).toBe(
      DESIGN_SCHEMA_VERSION,
    );

    const legacyInstance = structuredClone(source) as Record<string, unknown>;
    legacyInstance.nodesById = {
      instance_legacy: {
        id: "instance_legacy",
        kind: "instance",
        name: "Unknown legacy instance",
        parentId: null,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0],
        size: { width: 100, height: 40 },
        exportSettings: [],
        opacity: 1,
        properties: {},
        extensions: {},
      },
    };
    expect(migrateDesignDocument(legacyInstance)).toBeNull();
  });

  it("migrates 1.11 component documents through constraints to current layout semantics", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.11.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.constraints).toBeUndefined();
  });

  it("migrates 1.12 documents without inventing Auto Layout", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.12.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.constraints).toBeUndefined();
  });

  it("migrates 1.13 Auto Layout without inventing Hug or Fill sizing", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.13.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.layoutSizing).toBeUndefined();
    expect(migrated?.nodesById.text_1).not.toHaveProperty(
      "properties.autoLayout.sizing",
    );
  });

  it("migrates 1.14 sizing without inventing Auto Layout wrap", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.14.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1).not.toHaveProperty(
      "properties.autoLayout.wrap",
    );
  });

  it("migrates 1.15 wrap without inventing layout limits", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.15.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.layoutLimits).toBeUndefined();
  });

  it("migrates 1.16 limits without inventing Auto gap", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.16.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.layoutLimits).toBeUndefined();
  });

  it("migrates 1.17 Auto gap documents without inventing absolute children", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.17.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.layoutPositioning).toBeUndefined();
  });

  it("migrates 1.18 absolute-child documents without inventing layout guides", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.18.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.kind).toBe("text");
  });

  it("migrates 1.20 components and instances with empty Figma property maps", () => {
    const source = textDocumentFixture() as unknown as {
      schemaVersion: string;
      componentsById: Record<string, Record<string, unknown>>;
      nodesById: Record<string, Record<string, unknown>>;
      pagesById: Record<string, { rootNodeIds: string[] }>;
    };
    source.schemaVersion = "1.20.0";
    source.componentsById.component_text = {
      id: "component_text",
      name: "Text component",
      rootNodeId: "text_1",
      extensions: {},
    };
    source.nodesById.instance_text = {
      id: "instance_text",
      name: "Text instance",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 280, 0],
      size: { width: 240, height: 64 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "instance",
      properties: { componentId: "component_text", overrides: [] },
    };
    source.pagesById.page_1!.rootNodeIds.push("instance_text");

    const migrated = migrateDesignDocument(source);

    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(
      migrated?.componentsById.component_text?.componentPropertyDefinitions,
    ).toEqual({});
    expect(migrated?.componentsById.component_text?.variantProperties).toEqual(
      {},
    );
    const instance = migrated?.nodesById.instance_text;
    expect(
      instance?.kind === "instance"
        ? instance.properties.componentProperties
        : undefined,
    ).toEqual({});
  });

  it("migrates 1.21 Components without guessing Variant Set membership", () => {
    const source = textDocumentFixture() as unknown as {
      schemaVersion: string;
      componentsById: Record<string, Record<string, unknown>>;
    };
    source.schemaVersion = "1.21.0";
    source.componentsById.component_text = {
      id: "component_text",
      name: "Text component",
      rootNodeId: "text_1",
      componentPropertyDefinitions: {},
      extensions: {},
    };

    const migrated = migrateDesignDocument(source);

    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.componentsById.component_text).toMatchObject({
      componentPropertyDefinitions: {},
      variantProperties: {},
    });
    expect(
      migrated?.componentsById.component_text?.variantSetId,
    ).toBeUndefined();
    expect(migrated?.variantSetsById).toEqual({});
  });

  it("migrates 1.22 Variant Sets with deterministic property order", () => {
    const source = {
      componentsById: {},
      variantSetsById: {
        button_set: {
          componentPropertyDefinitions: {
            Size: {
              type: "VARIANT",
              defaultValue: "Small",
              variantOptions: ["Small", "Large"],
            },
            State: {
              type: "VARIANT",
              defaultValue: "Default",
              variantOptions: ["Default", "Hover"],
            },
          },
        },
      },
    };

    migrateVariantSets(source);

    expect(source.variantSetsById.button_set).toMatchObject({
      propertyOrder: ["Size", "State"],
    });
  });

  it("migrates 1.23 documents without inventing Slot state", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.23.0" as typeof source.schemaVersion;

    const migrated = migrateDesignDocument(source);

    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.kind).toBe("text");
    expect(migrated?.componentsById).toEqual({});
  });

  it("migrates 1.24 ordinary Component properties with deterministic order", () => {
    const source = textDocumentFixture() as unknown as {
      schemaVersion: string;
      componentsById: Record<string, Record<string, unknown>>;
    };
    source.schemaVersion = "1.24.0";
    source.componentsById.component_text = {
      id: "component_text",
      name: "Text component",
      rootNodeId: "text_1",
      componentPropertyDefinitions: {
        "Label#text:label": { type: "TEXT", defaultValue: "Text" },
        "Visible#text:visible": { type: "BOOLEAN", defaultValue: true },
      },
      variantProperties: {},
      extensions: {},
    };

    const migrated = migrateDesignDocument(source);

    expect(
      migrated?.componentsById.component_text?.componentPropertyOrder,
    ).toEqual(["Label#text:label", "Visible#text:visible"]);
  });

  it("validates strict uniform layout guides on Frames", () => {
    const frame = {
      id: "frame_guides",
      name: "Guides",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 180 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "frame" as const,
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: false,
        layoutGuides: [
          {
            id: "grid_8",
            type: "grid" as const,
            size: 8,
            color: "#ff5a5f",
            opacity: 0.12,
          },
        ],
      },
    };
    expect(Value.Check(DesignNodeSchema, frame)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          layoutGuides: [
            frame.properties.layoutGuides[0],
            frame.properties.layoutGuides[0],
          ],
        },
      }),
    ).toBe(true);
  });

  it("validates strict fixed and stretch Columns/Rows guide variants", () => {
    const base = {
      id: "guide",
      color: "#ff5a5f",
      opacity: 0.1,
    };
    for (const guide of [
      {
        ...base,
        type: "columns",
        alignment: "stretch",
        count: 12,
        gutter: 24,
        margin: 64,
      },
      {
        ...base,
        type: "columns",
        alignment: "start",
        count: 4,
        sectionSize: 80,
        gutter: 16,
        offset: 24,
      },
      {
        ...base,
        type: "rows",
        alignment: "center",
        count: 6,
        sectionSize: 48,
        gutter: 12,
      },
      {
        ...base,
        type: "rows",
        alignment: "end",
        count: 6,
        sectionSize: 48,
        gutter: 12,
        offset: 32,
      },
    ]) {
      expect(Value.Check(LayoutGuideSchema, guide)).toBe(true);
    }
    expect(
      Value.Check(LayoutGuideSchema, {
        ...base,
        type: "columns",
        alignment: "stretch",
        count: 12,
        gutter: 24,
        margin: 64,
        sectionSize: 80,
      }),
    ).toBe(false);
    expect(
      Value.Check(LayoutGuideSchema, {
        ...base,
        type: "rows",
        alignment: "center",
        count: 6,
        sectionSize: 48,
        gutter: 12,
        offset: 32,
      }),
    ).toBe(false);
  });

  it("validates strict linear Auto Layout only on Frame properties", () => {
    const frame = {
      id: "frame_layout",
      name: "Auto Layout",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 120 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "frame",
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
        autoLayout: {
          mode: "horizontal",
          padding: { top: 12, right: 16, bottom: 12, left: 16 },
          gap: 8,
          primaryAlignment: "start",
          counterAlignment: "center",
        },
      },
    };
    expect(Value.Check(DesignNodeSchema, frame)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            counterAlignment: "baseline",
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
            primaryAlignment: "baseline",
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            primaryAlignment: "space-between",
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
            counterAlignment: "space-between",
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: { ...frame.properties.autoLayout, wrap: true },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            wrap: { mode: "wrap", counterGap: 12 },
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
            mode: "vertical",
            wrap: { mode: "wrap", counterGap: 12 },
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            wrap: { mode: "wrap", counterGap: 12, future: true },
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        kind: "rectangle",
        properties: {
          fills: [],
          strokes: [],
          strokeWidth: 0,
          cornerRadius: 0,
          autoLayout: frame.properties.autoLayout,
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            sizing: { horizontal: "hug", vertical: "fixed" },
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
            sizing: { horizontal: "fill", vertical: "fixed" },
          },
        },
      }),
    ).toBe(false);
  });

  it("validates strict child Fixed/Fill sizing and nullable removal", () => {
    const text = textDocumentFixture().nodesById.text_1;
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutSizing: { horizontal: "fill", vertical: "fixed" },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutSizing: { horizontal: "hug", vertical: "fixed" },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "clear_layout_sizing",
        type: "update_properties",
        nodeId: "text_1",
        layoutSizing: null,
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "unknown_layout_sizing",
        type: "update_properties",
        nodeId: "text_1",
        layoutSizing: {
          horizontal: "fixed",
          vertical: "fixed",
          future: true,
        },
      }),
    ).toBe(false);
  });

  it("validates strict layout limits and rejects inverted intervals at public guards", () => {
    const text = textDocumentFixture().nodesById.text_1;
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutLimits: { minWidth: 80, maxWidth: 320, minHeight: 24 },
      }),
    ).toBe(true);
    for (const layoutLimits of [
      {},
      { minWidth: -1 },
      { maxHeight: 1_000_001 },
      { minWidth: 20, future: 40 },
    ]) {
      expect(Value.Check(DesignNodeSchema, { ...text, layoutLimits })).toBe(
        false,
      );
    }
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "set_layout_limits",
        type: "update_properties",
        nodeId: "text_1",
        layoutLimits: { minWidth: 80, maxWidth: 320 },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "clear_layout_limits",
        type: "update_properties",
        nodeId: "text_1",
        layoutLimits: null,
      }),
    ).toBe(true);
    const inverted = {
      commandId: "invert_layout_limits",
      type: "update_properties" as const,
      nodeId: "text_1",
      layoutLimits: { minWidth: 320, maxWidth: 80 },
    };
    expect(Value.Check(DesignOperationSchema, inverted)).toBe(true);
    expect(
      isDesignTransaction({
        transactionId: "transaction_limits",
        documentId: "document_1",
        baseRevision: 0,
        actor,
        commands: [inverted],
      }),
    ).toBe(false);
    expect(
      DesignTransactionContract.parse({
        transactionId: "transaction_limits",
        documentId: "document_1",
        baseRevision: 0,
        actor,
        commands: [inverted],
      }),
    ).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design.operation_layout_limits_invalid",
          path: "/commands/0/layoutLimits",
        }),
      ],
    });
  });

  it("owns transaction command identity and operation cross-field rules", () => {
    const command = operation();
    const duplicate = DesignTransactionContract.parse({
      transactionId: "transaction_duplicate_commands",
      documentId: "document_1",
      baseRevision: 0,
      actor,
      commands: [command, command],
    });
    expect(duplicate).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design.transaction_command_id_duplicate",
          path: "/commands/1/commandId",
        }),
      ],
    });

    const emptyUpdate = DesignTransactionContract.parse({
      transactionId: "transaction_empty_update",
      documentId: "document_1",
      baseRevision: 0,
      actor,
      commands: [
        {
          commandId: "empty_update",
          type: "update_properties",
          nodeId: "node_1",
        },
      ],
    });
    expect(emptyUpdate).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design.transaction_structure_invalid",
          path: "/commands/0",
        }),
      ],
    });
  });

  it("validates explicit constraints and nullable update removal", () => {
    const text = textDocumentFixture().nodesById.text_1;
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        constraints: { horizontal: "left-right", vertical: "bottom" },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        constraints: { horizontal: "stretch", vertical: "bottom" },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "clear_constraints",
        type: "update_properties",
        nodeId: "text_1",
        constraints: null,
      }),
    ).toBe(true);
  });

  it("validates strict absolute child positioning and nullable removal", () => {
    const text = textDocumentFixture().nodesById.text_1;
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutPositioning: "absolute",
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutPositioning: "flow",
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "clear_positioning",
        type: "update_properties",
        nodeId: text.id,
        layoutPositioning: null,
      }),
    ).toBe(true);
  });

  it("enforces canonical wrapping and overflow for Auto Size text", () => {
    const source = textDocumentFixture();
    const text = Object.values(source.nodesById).find(
      (node) => node.kind === "text",
    );
    if (!text || text.kind !== "text") throw new Error("Missing text");
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: {
          ...text.properties,
          textResize: "auto-width",
          textWrap: "none",
          textOverflow: "visible",
          textTruncation: "disabled",
          maxLines: null,
        },
      }),
    ).toBe(true);
    const invalidAutoWidth = {
      ...text,
      properties: {
        ...text.properties,
        textResize: "auto-width" as const,
        textWrap: "word" as const,
        textOverflow: "visible" as const,
      },
    };
    expect(Value.Check(DesignNodeSchema, invalidAutoWidth)).toBe(false);
    const issues = schemaValidationIssues(DesignNodeSchema, invalidAutoWidth);
    expect(issues.some((issue) => issue.path.startsWith("/properties"))).toBe(
      true,
    );
    expect(
      issues.some((issue) => issue.message === "Expected union value"),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: {
          ...text.properties,
          textResize: "auto-height",
          textWrap: "word",
          textOverflow: "clip",
          textTruncation: "disabled",
          maxLines: null,
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: {
          ...text.properties,
          textResize: "auto-height",
          textWrap: "word",
          textOverflow: "visible",
          textTruncation: "ending",
          maxLines: 3,
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: {
          ...text.properties,
          textResize: "auto-height",
          textWrap: "word",
          textOverflow: "visible",
          textTruncation: "ending",
          maxLines: null,
        },
      }),
    ).toBe(false);
  });
});
