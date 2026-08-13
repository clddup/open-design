import type {
  AutoLayout,
  LayoutConstraints,
  LayoutSizing,
} from "@opendesign/design-contracts";

export type DesignArrangeToolInput =
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
    "Align requires at least two explicit layers. Distribute and Tidy up require at least three. Set-spacing accepts finite positive, zero, or negative pixels. Constraints v1 applies only to direct children of ordinary Frames; resize-frame deterministically resizes that Frame and its constrained descendants in one transaction. set-auto-layout configures Frame Fixed/Hug axis sizing and horizontal Wrap with an independent vertical gap; set-layout-sizing configures direct-child Fixed/Fill sizing. Wrap requires Fixed width and visible Fixed-size children. The host derives all flow geometry.",
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
            primaryAlignment: { enum: ["start", "center", "end"] },
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
            primaryAlignment: { enum: ["start", "center", "end"] },
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
      ],
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

function isAutoLayout(value: unknown): value is AutoLayout {
  if (!isRecord(value)) return false;
  if (value.mode === "none") return onlyKeys(value, ["mode"]);
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
    ["start", "center", "end"].includes(String(value.primaryAlignment)) &&
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
