import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  DesignNodeSchema,
  DesignTransactionContract,
  DesignOperationSchema,
  LayoutGuideSchema,
  isDesignTransaction,
} from "./index.js";
import { actor, textDocumentFixture } from "./index-test-fixtures.js";

describe("layout design contracts", () => {
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
});
