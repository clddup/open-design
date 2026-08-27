import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  FIGMA_EXPORT_SETTINGS_DESIGN_SCHEMA_VERSION,
  DesignNodeSchema,
  migrateDesignDocument,
  migrateVariantSets,
} from "./index.js";
import { textDocumentFixture } from "./index-test-fixtures.js";

describe("text and component migrations", () => {
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
});
