import type {
  AutoLayout,
  LayoutConstraints,
  LayoutGuide,
  LayoutLimits,
  LayoutPositioning,
  LayoutSizing,
  GridChildPlacement,
} from "@opendesign/design-contracts";
import { isValidLayoutLimits } from "@opendesign/design-contracts";

export type DesignArrangeToolInput =
  | {
      action: "set-grid-placement";
      label: string;
      pageId: string;
      nodeId: string;
      placement: GridChildPlacement;
    }
  | {
      action:
        | "align-left"
        | "align-horizontal-center"
        | "align-right"
        | "align-top"
        | "align-vertical-center"
        | "align-bottom"
        | "distribute-horizontal"
        | "distribute-vertical"
        | "tidy-up";
      label: string;
      pageId: string;
      nodeIds: string[];
    }
  | {
      action: "set-horizontal-spacing" | "set-vertical-spacing";
      label: string;
      pageId: string;
      nodeIds: string[];
      spacing: number;
    }
  | {
      action: "set-constraints";
      label: string;
      pageId: string;
      nodeId: string;
      constraints: LayoutConstraints;
    }
  | {
      action: "resize-frame";
      label: string;
      pageId: string;
      frameId: string;
      width: number;
      height: number;
    }
  | {
      action: "set-auto-layout";
      label: string;
      pageId: string;
      frameId: string;
      autoLayout: AutoLayout;
    }
  | {
      action: "set-layout-sizing";
      label: string;
      pageId: string;
      nodeId: string;
      sizing: LayoutSizing;
    }
  | {
      action: "set-layout-positioning";
      label: string;
      pageId: string;
      nodeId: string;
      positioning: "flow" | LayoutPositioning;
      constraints?: LayoutConstraints;
    }
  | {
      action: "set-layout-limits";
      label: string;
      pageId: string;
      nodeId: string;
      limits: LayoutLimits | null;
    }
  | {
      action: "set-layout-guides";
      label: string;
      pageId: string;
      frameId: string;
      layoutGuides: LayoutGuide[];
    };

const label = { type: "string", minLength: 1, maxLength: 256 } as const;
const pageId = { type: "string", minLength: 1, maxLength: 256 } as const;
const nodeIds = {
  type: "array",
  minItems: 2,
  maxItems: 500,
  uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 256 },
  description:
    "Explicit stable layer IDs from inspection. Selection is context only and is never an implicit target.",
} as const;

export const DESIGN_ARRANGE_TOOL_INPUT_SCHEMA = {
  type: "object",
  description:
    "Align requires at least two explicit layers. Distribute and Tidy up require at least three. Set-spacing accepts finite positive, zero, or negative pixels. Constraints v1 applies to direct children of ordinary Frames and absolute children of Auto Layout Frames; resize-frame deterministically resizes that Frame and its constrained descendants in one transaction. set-auto-layout configures linear Fixed/Hug sizing, fixed or Auto gap, Horizontal Wrap, or a two-dimensional Grid with explicit Fixed/Fill(fr)/Hug rows and columns, independent gaps, and Manual or row-major automatic positioning. set-grid-placement configures one Grid child's zero-based cell, positive span and cell alignment. Grid capacity is explicit; automatic rows and track reorder are not supported yet. set-layout-positioning atomically toggles a child between flow and absolute, clearing incompatible sizing, constraints, or Grid placement. set-layout-sizing configures flow-child Fixed/Fill sizing; set-layout-limits adds or clears min/max. set-layout-guides replaces non-exported visual guides and never alters child geometry. The host derives all flow geometry.",
  properties: {
    action: {
      enum: [
        "align-left",
        "align-horizontal-center",
        "align-right",
        "align-top",
        "align-vertical-center",
        "align-bottom",
        "distribute-horizontal",
        "distribute-vertical",
        "tidy-up",
        "set-horizontal-spacing",
        "set-vertical-spacing",
        "set-constraints",
        "resize-frame",
        "set-auto-layout",
        "set-layout-sizing",
        "set-layout-positioning",
        "set-layout-limits",
        "set-layout-guides",
        "set-grid-placement",
      ],
    },
    label,
    pageId,
    nodeIds,
    spacing: {
      type: "number",
      minimum: -1_000_000,
      maximum: 1_000_000,
      description: "Exact pixels between adjacent bounds for set-spacing.",
    },
    nodeId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "Direct Frame child for set-constraints.",
    },
    constraints: {
      type: "object",
      properties: {
        horizontal: {
          enum: ["left", "right", "left-right", "center", "scale"],
        },
        vertical: {
          enum: ["top", "bottom", "top-bottom", "center", "scale"],
        },
      },
      required: ["horizontal", "vertical"],
      additionalProperties: false,
    },
    positioning: { enum: ["flow", "absolute"] },
    frameId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "Frame to resize through constraints v1.",
    },
    width: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 },
    height: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 },
    autoLayout: {
      anyOf: [
        {
          type: "object",
          properties: { mode: { const: "none" } },
          required: ["mode"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            mode: { const: "horizontal" },
            padding: {
              type: "object",
              properties: {
                top: { type: "number", minimum: 0, maximum: 1_000_000 },
                right: { type: "number", minimum: 0, maximum: 1_000_000 },
                bottom: { type: "number", minimum: 0, maximum: 1_000_000 },
                left: { type: "number", minimum: 0, maximum: 1_000_000 },
              },
              required: ["top", "right", "bottom", "left"],
              additionalProperties: false,
            },
            gap: { type: "number", minimum: 0, maximum: 1_000_000 },
            primaryAlignment: {
              enum: ["start", "center", "end", "space-between"],
            },
            counterAlignment: { enum: ["start", "center", "end"] },
            sizing: {
              type: "object",
              properties: {
                horizontal: { enum: ["fixed", "hug"] },
                vertical: { enum: ["fixed", "hug"] },
              },
              required: ["horizontal", "vertical"],
              additionalProperties: false,
            },
            wrap: {
              type: "object",
              properties: {
                mode: { const: "wrap" },
                counterGap: {
                  type: "number",
                  minimum: 0,
                  maximum: 1_000_000,
                },
              },
              required: ["mode", "counterGap"],
              additionalProperties: false,
            },
          },
          required: [
            "mode",
            "padding",
            "gap",
            "primaryAlignment",
            "counterAlignment",
          ],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            mode: { const: "vertical" },
            padding: {
              type: "object",
              properties: {
                top: { type: "number", minimum: 0, maximum: 1_000_000 },
                right: { type: "number", minimum: 0, maximum: 1_000_000 },
                bottom: { type: "number", minimum: 0, maximum: 1_000_000 },
                left: { type: "number", minimum: 0, maximum: 1_000_000 },
              },
              required: ["top", "right", "bottom", "left"],
              additionalProperties: false,
            },
            gap: { type: "number", minimum: 0, maximum: 1_000_000 },
            primaryAlignment: {
              enum: ["start", "center", "end", "space-between"],
            },
            counterAlignment: { enum: ["start", "center", "end"] },
            sizing: {
              type: "object",
              properties: {
                horizontal: { enum: ["fixed", "hug"] },
                vertical: { enum: ["fixed", "hug"] },
              },
              required: ["horizontal", "vertical"],
              additionalProperties: false,
            },
          },
          required: [
            "mode",
            "padding",
            "gap",
            "primaryAlignment",
            "counterAlignment",
          ],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            mode: { const: "grid" },
            padding: {
              type: "object",
              properties: {
                top: { type: "number", minimum: 0, maximum: 1_000_000 },
                right: { type: "number", minimum: 0, maximum: 1_000_000 },
                bottom: { type: "number", minimum: 0, maximum: 1_000_000 },
                left: { type: "number", minimum: 0, maximum: 1_000_000 },
              },
              required: ["top", "right", "bottom", "left"],
              additionalProperties: false,
            },
            rowGap: { type: "number", minimum: 0, maximum: 1_000_000 },
            columnGap: { type: "number", minimum: 0, maximum: 1_000_000 },
            rows: {
              type: "array",
              minItems: 1,
              maxItems: 4096,
              items: gridTrackSchema(),
            },
            columns: {
              type: "array",
              minItems: 1,
              maxItems: 4096,
              items: gridTrackSchema(),
            },
            itemsPositioning: { enum: ["manual", "row-auto-flow"] },
            sizing: {
              type: "object",
              properties: {
                horizontal: { enum: ["fixed", "hug"] },
                vertical: { enum: ["fixed", "hug"] },
              },
              required: ["horizontal", "vertical"],
              additionalProperties: false,
            },
          },
          required: [
            "mode",
            "padding",
            "rowGap",
            "columnGap",
            "rows",
            "columns",
            "itemsPositioning",
          ],
          additionalProperties: false,
        },
      ],
    },
    placement: {
      type: "object",
      properties: {
        row: { type: "integer", minimum: 0, maximum: 4095 },
        column: { type: "integer", minimum: 0, maximum: 4095 },
        rowSpan: { type: "integer", minimum: 1, maximum: 4096 },
        columnSpan: { type: "integer", minimum: 1, maximum: 4096 },
        horizontalAlign: { enum: ["start", "center", "end", "auto"] },
        verticalAlign: { enum: ["start", "center", "end", "auto"] },
      },
      required: [
        "row",
        "column",
        "rowSpan",
        "columnSpan",
        "horizontalAlign",
        "verticalAlign",
      ],
      additionalProperties: false,
    },
    sizing: {
      type: "object",
      properties: {
        horizontal: { enum: ["fixed", "fill"] },
        vertical: { enum: ["fixed", "fill"] },
      },
      required: ["horizontal", "vertical"],
      additionalProperties: false,
    },
    limits: {
      anyOf: [
        {
          type: "object",
          minProperties: 1,
          properties: {
            minWidth: { type: "number", minimum: 0, maximum: 1_000_000 },
            maxWidth: { type: "number", minimum: 0, maximum: 1_000_000 },
            minHeight: { type: "number", minimum: 0, maximum: 1_000_000 },
            maxHeight: { type: "number", minimum: 0, maximum: 1_000_000 },
          },
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    layoutGuides: {
      type: "array",
      maxItems: 8,
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              id: { type: "string", minLength: 1, maxLength: 256 },
              type: { const: "grid" },
              size: { type: "number", minimum: 1, maximum: 10_000 },
              color: { type: "string", minLength: 1, maxLength: 128 },
              opacity: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["id", "type", "size", "color", "opacity"],
            additionalProperties: false,
          },
          ...(["columns", "rows"] as const).flatMap((type) => [
            {
              type: "object",
              properties: {
                id: { type: "string", minLength: 1, maxLength: 256 },
                type: { const: type },
                alignment: { const: "stretch" },
                count: { type: "integer", minimum: 1, maximum: 4_096 },
                gutter: { type: "number", minimum: 0, maximum: 1_000_000 },
                margin: { type: "number", minimum: 0, maximum: 1_000_000 },
                color: { type: "string", minLength: 1, maxLength: 128 },
                opacity: { type: "number", minimum: 0, maximum: 1 },
              },
              required: [
                "id",
                "type",
                "alignment",
                "count",
                "gutter",
                "margin",
                "color",
                "opacity",
              ],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                id: { type: "string", minLength: 1, maxLength: 256 },
                type: { const: type },
                alignment: { const: "center" },
                count: { type: "integer", minimum: 1, maximum: 4_096 },
                gutter: { type: "number", minimum: 0, maximum: 1_000_000 },
                sectionSize: {
                  type: "number",
                  exclusiveMinimum: 0,
                  maximum: 1_000_000,
                },
                color: { type: "string", minLength: 1, maxLength: 128 },
                opacity: { type: "number", minimum: 0, maximum: 1 },
              },
              required: [
                "id",
                "type",
                "alignment",
                "count",
                "gutter",
                "sectionSize",
                "color",
                "opacity",
              ],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                id: { type: "string", minLength: 1, maxLength: 256 },
                type: { const: type },
                alignment: { enum: ["start", "end"] },
                count: { type: "integer", minimum: 1, maximum: 4_096 },
                gutter: { type: "number", minimum: 0, maximum: 1_000_000 },
                sectionSize: {
                  type: "number",
                  exclusiveMinimum: 0,
                  maximum: 1_000_000,
                },
                offset: { type: "number", minimum: 0, maximum: 1_000_000 },
                color: { type: "string", minLength: 1, maxLength: 128 },
                opacity: { type: "number", minimum: 0, maximum: 1 },
              },
              required: [
                "id",
                "type",
                "alignment",
                "count",
                "gutter",
                "sectionSize",
                "offset",
                "color",
                "opacity",
              ],
              additionalProperties: false,
            },
          ]),
        ],
      },
    },
  },
  required: ["action", "label", "pageId"],
  additionalProperties: false,
} as const;

export function isDesignArrangeToolInput(
  input: unknown,
): input is DesignArrangeToolInput {
  if (!isRecord(input) || !validLabelAndPage(input)) return false;
  const action = input.action;
  if (action === "set-constraints") {
    return (
      safeId(input.nodeId) &&
      isLayoutConstraints(input.constraints) &&
      onlyKeys(input, ["action", "label", "pageId", "nodeId", "constraints"])
    );
  }
  if (action === "resize-frame") {
    return (
      safeId(input.frameId) &&
      finitePositiveBounded(input.width) &&
      finitePositiveBounded(input.height) &&
      onlyKeys(input, [
        "action",
        "label",
        "pageId",
        "frameId",
        "width",
        "height",
      ])
    );
  }
  if (action === "set-auto-layout") {
    return (
      safeId(input.frameId) &&
      isAutoLayout(input.autoLayout) &&
      onlyKeys(input, ["action", "label", "pageId", "frameId", "autoLayout"])
    );
  }
  if (action === "set-layout-sizing") {
    return (
      safeId(input.nodeId) &&
      isLayoutSizing(input.sizing) &&
      onlyKeys(input, ["action", "label", "pageId", "nodeId", "sizing"])
    );
  }
  if (action === "set-grid-placement") {
    return (
      safeId(input.nodeId) &&
      isGridPlacement(input.placement) &&
      onlyKeys(input, ["action", "label", "pageId", "nodeId", "placement"])
    );
  }
  if (action === "set-layout-positioning") {
    return (
      safeId(input.nodeId) &&
      (input.positioning === "flow" || input.positioning === "absolute") &&
      (input.constraints === undefined ||
        (input.positioning === "absolute" &&
          isLayoutConstraints(input.constraints))) &&
      onlyKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "positioning",
        "constraints",
      ])
    );
  }
  if (action === "set-layout-limits") {
    return (
      safeId(input.nodeId) &&
      (input.limits === null ||
        (isRecord(input.limits) && isValidLayoutLimits(input.limits))) &&
      onlyKeys(input, ["action", "label", "pageId", "nodeId", "limits"])
    );
  }
  if (action === "set-layout-guides") {
    return (
      safeId(input.frameId) &&
      isLayoutGuides(input.layoutGuides) &&
      onlyKeys(input, ["action", "label", "pageId", "frameId", "layoutGuides"])
    );
  }
  const layerActions = [
    "align-left",
    "align-horizontal-center",
    "align-right",
    "align-top",
    "align-vertical-center",
    "align-bottom",
    "distribute-horizontal",
    "distribute-vertical",
    "tidy-up",
    "set-horizontal-spacing",
    "set-vertical-spacing",
  ] as const;
  if (!layerActions.includes(action as (typeof layerActions)[number])) {
    return false;
  }
  const setSpacing =
    action === "set-horizontal-spacing" || action === "set-vertical-spacing";
  const requiresThree =
    action === "distribute-horizontal" ||
    action === "distribute-vertical" ||
    action === "tidy-up";
  return (
    Array.isArray(input.nodeIds) &&
    input.nodeIds.length >= (requiresThree ? 3 : 2) &&
    input.nodeIds.length <= 500 &&
    input.nodeIds.every(safeId) &&
    new Set(input.nodeIds).size === input.nodeIds.length &&
    (setSpacing
      ? finite(input.spacing) && Math.abs(input.spacing) <= 1_000_000
      : input.spacing === undefined) &&
    onlyKeys(
      input,
      setSpacing
        ? ["action", "label", "pageId", "nodeIds", "spacing"]
        : ["action", "label", "pageId", "nodeIds"],
    )
  );
}

function validLabelAndPage(input: Record<string, unknown>): boolean {
  return (
    typeof input.label === "string" &&
    input.label.trim().length > 0 &&
    input.label.length <= 256 &&
    safeId(input.pageId)
  );
}

function isLayoutConstraints(value: unknown): value is LayoutConstraints {
  return (
    isRecord(value) &&
    ["left", "right", "left-right", "center", "scale"].includes(
      String(value.horizontal),
    ) &&
    ["top", "bottom", "top-bottom", "center", "scale"].includes(
      String(value.vertical),
    ) &&
    onlyKeys(value, ["horizontal", "vertical"])
  );
}

function isLayoutSizing(value: unknown): value is LayoutSizing {
  return (
    isRecord(value) &&
    ["fixed", "fill"].includes(String(value.horizontal)) &&
    ["fixed", "fill"].includes(String(value.vertical)) &&
    onlyKeys(value, ["horizontal", "vertical"])
  );
}

function isLayoutGuides(value: unknown): value is LayoutGuide[] {
  if (!Array.isArray(value) || value.length > 8) return false;
  const ids = new Set<string>();
  return value.every((guide) => {
    if (!isRecord(guide)) return false;
    const appearanceIsValid =
      safeId(guide.id) &&
      typeof guide.color === "string" &&
      guide.color.length > 0 &&
      guide.color.length <= 128 &&
      finite(guide.opacity) &&
      guide.opacity >= 0 &&
      guide.opacity <= 1;
    const valid = appearanceIsValid && layoutGuideShapeIsValid(guide);
    if (!valid || ids.has(String(guide.id))) return false;
    ids.add(String(guide.id));
    return true;
  });
}

function layoutGuideShapeIsValid(guide: Record<string, unknown>): boolean {
  if (guide.type === "grid") {
    return (
      finite(guide.size) &&
      guide.size >= 1 &&
      guide.size <= 10_000 &&
      onlyKeys(guide, ["id", "type", "size", "color", "opacity"])
    );
  }
  if (
    (guide.type !== "columns" && guide.type !== "rows") ||
    !Number.isInteger(guide.count) ||
    Number(guide.count) < 1 ||
    Number(guide.count) > 4_096 ||
    !finiteNonNegativeBounded(guide.gutter)
  ) {
    return false;
  }
  if (guide.alignment === "stretch") {
    return (
      finiteNonNegativeBounded(guide.margin) &&
      onlyKeys(guide, [
        "id",
        "type",
        "alignment",
        "count",
        "gutter",
        "margin",
        "color",
        "opacity",
      ])
    );
  }
  const fixed =
    finite(guide.sectionSize) &&
    guide.sectionSize > 0 &&
    guide.sectionSize <= 1_000_000;
  if (guide.alignment === "center") {
    return (
      fixed &&
      onlyKeys(guide, [
        "id",
        "type",
        "alignment",
        "count",
        "gutter",
        "sectionSize",
        "color",
        "opacity",
      ])
    );
  }
  return (
    fixed &&
    (guide.alignment === "start" || guide.alignment === "end") &&
    finiteNonNegativeBounded(guide.offset) &&
    onlyKeys(guide, [
      "id",
      "type",
      "alignment",
      "count",
      "gutter",
      "sectionSize",
      "offset",
      "color",
      "opacity",
    ])
  );
}

function isAutoLayout(value: unknown): value is AutoLayout {
  if (!isRecord(value)) return false;
  if (value.mode === "none") return onlyKeys(value, ["mode"]);
  if (value.mode === "grid") {
    return (
      isPadding(value.padding) &&
      finiteNonNegativeBounded(value.rowGap) &&
      finiteNonNegativeBounded(value.columnGap) &&
      isGridTracks(value.rows) &&
      isGridTracks(value.columns) &&
      (value.itemsPositioning === "manual" ||
        value.itemsPositioning === "row-auto-flow") &&
      isFrameSizing(value.sizing) &&
      onlyKeys(value, [
        "mode",
        "padding",
        "rowGap",
        "columnGap",
        "rows",
        "columns",
        "itemsPositioning",
        "sizing",
      ])
    );
  }
  if (value.mode !== "horizontal" && value.mode !== "vertical") return false;
  const padding = value.padding;
  const sizing = value.sizing;
  const wrap = value.wrap;
  return (
    isRecord(padding) &&
    ["top", "right", "bottom", "left"].every((side) =>
      finiteNonNegativeBounded(padding[side]),
    ) &&
    onlyKeys(padding, ["top", "right", "bottom", "left"]) &&
    finiteNonNegativeBounded(value.gap) &&
    ["start", "center", "end", "space-between"].includes(
      String(value.primaryAlignment),
    ) &&
    ["start", "center", "end"].includes(String(value.counterAlignment)) &&
    (sizing === undefined ||
      (isRecord(sizing) &&
        ["fixed", "hug"].includes(String(sizing.horizontal)) &&
        ["fixed", "hug"].includes(String(sizing.vertical)) &&
        onlyKeys(sizing, ["horizontal", "vertical"]))) &&
    (wrap === undefined ||
      (value.mode === "horizontal" &&
        isRecord(wrap) &&
        wrap.mode === "wrap" &&
        finiteNonNegativeBounded(wrap.counterGap) &&
        onlyKeys(wrap, ["mode", "counterGap"]))) &&
    onlyKeys(value, [
      "mode",
      "padding",
      "gap",
      "primaryAlignment",
      "counterAlignment",
      "sizing",
      "wrap",
    ])
  );
}

function gridTrackSchema() {
  return {
    oneOf: [
      {
        type: "object",
        properties: {
          type: { const: "fixed" },
          value: { type: "number", minimum: 0, maximum: 1_000_000 },
        },
        required: ["type", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "fill" },
          value: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 },
        },
        required: ["type", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { type: { const: "hug" } },
        required: ["type"],
        additionalProperties: false,
      },
    ],
  } as const;
}

function isPadding(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["top", "right", "bottom", "left"].every((side) =>
      finiteNonNegativeBounded(value[side]),
    ) &&
    onlyKeys(value, ["top", "right", "bottom", "left"])
  );
}

function isFrameSizing(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      ["fixed", "hug"].includes(String(value.horizontal)) &&
      ["fixed", "hug"].includes(String(value.vertical)) &&
      onlyKeys(value, ["horizontal", "vertical"]))
  );
}

function isGridTracks(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 4096 &&
    value.every(
      (track) =>
        isRecord(track) &&
        (track.type === "hug"
          ? onlyKeys(track, ["type"])
          : (track.type === "fixed" || track.type === "fill") &&
            finiteNonNegativeBounded(track.value) &&
            (track.type !== "fill" || Number(track.value) > 0) &&
            onlyKeys(track, ["type", "value"])),
    )
  );
}

function isGridPlacement(value: unknown): value is GridChildPlacement {
  return (
    isRecord(value) &&
    Number.isInteger(value.row) &&
    Number(value.row) >= 0 &&
    Number(value.row) <= 4095 &&
    Number.isInteger(value.column) &&
    Number(value.column) >= 0 &&
    Number(value.column) <= 4095 &&
    Number.isInteger(value.rowSpan) &&
    Number(value.rowSpan) >= 1 &&
    Number(value.rowSpan) <= 4096 &&
    Number.isInteger(value.columnSpan) &&
    Number(value.columnSpan) >= 1 &&
    Number(value.columnSpan) <= 4096 &&
    ["start", "center", "end", "auto"].includes(
      String(value.horizontalAlign),
    ) &&
    ["start", "center", "end", "auto"].includes(String(value.verticalAlign)) &&
    onlyKeys(value, [
      "row",
      "column",
      "rowSpan",
      "columnSpan",
      "horizontalAlign",
      "verticalAlign",
    ])
  );
}

function finitePositiveBounded(value: unknown): value is number {
  return finite(value) && value > 0 && value <= 1_000_000;
}

function finiteNonNegativeBounded(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1_000_000;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
