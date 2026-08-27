import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  ComponentOverridePatchSchema,
  DesignNodeSchema,
  DesignDocumentContract,
  DesignOperationSchema,
  DesignTransactionSchema,
  EffectSchema,
  MAX_TRANSACTION_COMMANDS,
  PaintSchema,
  isDesignTransaction,
  migrateDesignDocument,
  schemaValidationIssues,
  type DesignDocument,
} from "./index.js";
import {
  actor,
  textDocumentFixture,
  operation,
} from "./index-test-fixtures.js";

describe("design contract core", () => {
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
});
