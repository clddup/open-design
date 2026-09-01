import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
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
  IMAGE_PAINT_CROP_DESIGN_SCHEMA_VERSION,
  ADVANCED_TEXT_DECORATION_DESIGN_SCHEMA_VERSION,
  IMAGE_ASSET_DERIVATIONS_DESIGN_SCHEMA_VERSION,
  IMAGE_BACKGROUND_REPLACEMENT_DESIGN_SCHEMA_VERSION,
  IMAGE_RELIGHTING_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_WRAP_FILL_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_WRAP_DISTRIBUTION_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_BASELINE_DESIGN_SCHEMA_VERSION,
  VECTOR_REGION_FILL_DESIGN_SCHEMA_VERSION,
  VECTOR_REGION_FILL_STYLE_DESIGN_SCHEMA_VERSION,
  VECTOR_VERTEX_STROKE_APPEARANCE_DESIGN_SCHEMA_VERSION,
  VECTOR_VERTEX_CORNER_RADIUS_DESIGN_SCHEMA_VERSION,
  VECTOR_CORNER_SMOOTHING_DESIGN_SCHEMA_VERSION,
  FONT_FACE_IDENTITY_DESIGN_SCHEMA_VERSION,
  FIGMA_TEXT_LISTS_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_GRID_DESIGN_SCHEMA_VERSION,
  AUTO_LAYOUT_GRID_V2_DESIGN_SCHEMA_VERSION,
  PARAGRAPH_STYLE_RUNS_DESIGN_SCHEMA_VERSION,
  RICH_TEXT_RUNS_DESIGN_SCHEMA_VERSION,
  TYPOGRAPHY_CORE_V2_DESIGN_SCHEMA_VERSION,
  DesignOperationSchema,
  AUTO_LAYOUT_DESIGN_SCHEMA_VERSION,
  LAYOUT_GUIDE_COLUMNS_ROWS_DESIGN_SCHEMA_VERSION,
  LAYOUT_GUIDE_DESIGN_SCHEMA_VERSION,
  DesignCapabilitiesSchema,
  EditorEventSchema,
  ExportArtifactSchema,
  HistoryStateSchema,
  SelectionStateSchema,
  migrateDesignDocument,
  migrateLibraryReleaseSnapshot,
  schemaValidationIssues,
  type DesignDocument,
} from "./index.js";
import { textDocumentFixture } from "./index-test-fixtures.js";

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

describe("editor wire schemas", () => {
  const eventBase = {
    eventId: "event_1",
    sequence: 1,
    occurredAt: "2026-08-27T00:00:00.000Z",
    documentId: "document_1",
    revision: 0,
  };

  it("selects the concrete event branch before reporting field errors", () => {
    expect(
      schemaValidationIssues(EditorEventSchema, {
        ...eventBase,
        type: "viewport.changed",
        viewport: { panX: 0, panY: 0, zoom: 0, width: 100, height: 100 },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/viewport/zoom" }),
      ]),
    );
    expect(
      schemaValidationIssues(EditorEventSchema, {
        ...eventBase,
        type: "unknown.changed",
      }),
    ).toEqual([expect.objectContaining({ path: "/type" })]);
  });

  it("keeps injected transaction, history, and export schemas authoritative", () => {
    expect(
      schemaValidationIssues(EditorEventSchema, {
        ...eventBase,
        type: "document.changed",
        result: { ok: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/result/mode" }),
      ]),
    );
    expect(
      schemaValidationIssues(EditorEventSchema, {
        ...eventBase,
        type: "runtime.error",
        error: {
          code: "invalid",
          message: "invalid transaction",
          retryable: false,
          issues: [],
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/error/issues" }),
      ]),
    );
    expect(
      schemaValidationIssues(HistoryStateSchema, {
        canUndo: true,
        canRedo: false,
        undo: [{}],
        redo: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/undo/0/transactionId" }),
      ]),
    );
    expect(
      schemaValidationIssues(ExportArtifactSchema, {
        artifactId: "artifact_1",
        mimeType: "image/svg+xml",
        path: "/tmp/artifact.svg",
        fidelity: {
          status: "degraded",
          warnings: [{ feature: "", fallback: "path", message: "fallback" }],
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/fidelity/warnings/0/feature" }),
      ]),
    );
  });

  it("keeps capability literals and closed fields unchanged", () => {
    const capability = {
      schemaVersion: DESIGN_SCHEMA_VERSION,
      nodeKinds: ["frame"],
      operations: ["insert_element"],
      limits: { maxCommandsPerTransaction: 32 },
      features: {
        preview: true,
        atomicTransactions: true,
        undoRedo: true,
        hitTesting: true,
        displayList: true,
      },
      importFormats: ["svg"],
      exportFormats: ["svg"],
      extensions: {},
    };
    expect(
      schemaValidationIssues(DesignCapabilitiesSchema, capability),
    ).toEqual([]);
    expect(
      schemaValidationIssues(DesignCapabilitiesSchema, {
        ...capability,
        unsupported: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/unsupported" }),
      ]),
    );
  });
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
  expect(VECTOR_REGION_FILL_DESIGN_SCHEMA_VERSION).toBe("1.48.0");
  expect(VECTOR_REGION_FILL_STYLE_DESIGN_SCHEMA_VERSION).toBe("1.49.0");
  expect(VECTOR_VERTEX_STROKE_APPEARANCE_DESIGN_SCHEMA_VERSION).toBe("1.50.0");
  expect(VECTOR_VERTEX_CORNER_RADIUS_DESIGN_SCHEMA_VERSION).toBe("1.51.0");
  expect(VECTOR_CORNER_SMOOTHING_DESIGN_SCHEMA_VERSION).toBe("1.52.0");
  expect(IMAGE_PAINT_CROP_DESIGN_SCHEMA_VERSION).toBe("1.53.0");
  expect(ADVANCED_TEXT_DECORATION_DESIGN_SCHEMA_VERSION).toBe("1.54.0");
  expect(DESIGN_SCHEMA_VERSION).toBe(
    ADVANCED_TEXT_DECORATION_DESIGN_SCHEMA_VERSION,
  );
});

it("migrates 1.52 documents without inventing Image Paint crop transforms", () => {
  const source = textDocumentFixture();
  source.schemaVersion =
    VECTOR_CORNER_SMOOTHING_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById).toEqual(source.nodesById);
});

it("migrates 1.51 documents without inventing Vector corner smoothing", () => {
  const source = textDocumentFixture();
  source.schemaVersion =
    VECTOR_VERTEX_CORNER_RADIUS_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById).toEqual(source.nodesById);
});

it("migrates 1.50 documents without inventing Vector corner radii", () => {
  const source = textDocumentFixture();
  source.schemaVersion =
    VECTOR_VERTEX_STROKE_APPEARANCE_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById).toEqual(source.nodesById);
});

it("migrates 1.49 documents without inventing vertex stroke overrides", () => {
  const source = textDocumentFixture();
  source.schemaVersion =
    VECTOR_REGION_FILL_STYLE_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById).toEqual(source.nodesById);
});

it("migrates 1.48 documents without inventing Vector region Style links", () => {
  const source = textDocumentFixture();
  source.schemaVersion =
    VECTOR_REGION_FILL_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById).toEqual(source.nodesById);
});

it("migrates 1.47 documents without inventing Vector region Paint", () => {
  const source = textDocumentFixture();
  source.schemaVersion =
    AUTO_LAYOUT_BASELINE_DESIGN_SCHEMA_VERSION as typeof source.schemaVersion;
  const migrated = migrateDesignDocument(source);
  expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  expect(migrated?.nodesById).toEqual(source.nodesById);
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
