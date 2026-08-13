import { Type, type Static } from "@sinclair/typebox";

export const CONSTRAINTS_DESIGN_SCHEMA_VERSION = "1.12.0" as const;
export const AUTO_LAYOUT_DESIGN_SCHEMA_VERSION = "1.17.0" as const;

export const LayoutConstraintsSchema = Type.Object(
  {
    horizontal: Type.Union([
      Type.Literal("left"),
      Type.Literal("right"),
      Type.Literal("left-right"),
      Type.Literal("center"),
      Type.Literal("scale"),
    ]),
    vertical: Type.Union([
      Type.Literal("top"),
      Type.Literal("bottom"),
      Type.Literal("top-bottom"),
      Type.Literal("center"),
      Type.Literal("scale"),
    ]),
  },
  { additionalProperties: false },
);

export type LayoutConstraints = Static<typeof LayoutConstraintsSchema>;

const ChildLayoutAxisSizingSchema = Type.Union([
  Type.Literal("fixed"),
  Type.Literal("fill"),
]);

export const LayoutSizingSchema = Type.Object(
  {
    horizontal: ChildLayoutAxisSizingSchema,
    vertical: ChildLayoutAxisSizingSchema,
  },
  { additionalProperties: false },
);

export type LayoutSizing = Static<typeof LayoutSizingSchema>;
export const DEFAULT_LAYOUT_SIZING: LayoutSizing = Object.freeze({
  horizontal: "fixed",
  vertical: "fixed",
});

const LayoutLimitSchema = Type.Number({ minimum: 0, maximum: 1_000_000 });

export const LayoutLimitsSchema = Type.Object(
  {
    minWidth: Type.Optional(LayoutLimitSchema),
    maxWidth: Type.Optional(LayoutLimitSchema),
    minHeight: Type.Optional(LayoutLimitSchema),
    maxHeight: Type.Optional(LayoutLimitSchema),
  },
  { additionalProperties: false, minProperties: 1 },
);

export type LayoutLimits = Static<typeof LayoutLimitsSchema>;

export function isValidLayoutLimits(value: LayoutLimits | undefined): boolean {
  if (value === undefined) return true;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, limit]) =>
        ["minWidth", "maxWidth", "minHeight", "maxHeight"].includes(key) &&
        typeof limit === "number" &&
        Number.isFinite(limit) &&
        limit >= 0 &&
        limit <= 1_000_000,
    ) &&
    (value.minWidth === undefined ||
      value.maxWidth === undefined ||
      value.minWidth <= value.maxWidth) &&
    (value.minHeight === undefined ||
      value.maxHeight === undefined ||
      value.minHeight <= value.maxHeight)
  );
}

const AutoLayoutFrameAxisSizingSchema = Type.Union([
  Type.Literal("fixed"),
  Type.Literal("hug"),
]);

export const AutoLayoutFrameSizingSchema = Type.Object(
  {
    horizontal: AutoLayoutFrameAxisSizingSchema,
    vertical: AutoLayoutFrameAxisSizingSchema,
  },
  { additionalProperties: false },
);

export type AutoLayoutFrameSizing = Static<typeof AutoLayoutFrameSizingSchema>;
export const DEFAULT_AUTO_LAYOUT_FRAME_SIZING: AutoLayoutFrameSizing =
  Object.freeze({ horizontal: "fixed", vertical: "fixed" });

export const AutoLayoutPaddingSchema = Type.Object(
  {
    top: Type.Number({ minimum: 0, maximum: 1_000_000 }),
    right: Type.Number({ minimum: 0, maximum: 1_000_000 }),
    bottom: Type.Number({ minimum: 0, maximum: 1_000_000 }),
    left: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  },
  { additionalProperties: false },
);

const AutoLayoutCounterAlignmentSchema = Type.Union([
  Type.Literal("start"),
  Type.Literal("center"),
  Type.Literal("end"),
]);

const AutoLayoutPrimaryAlignmentSchema = Type.Union([
  AutoLayoutCounterAlignmentSchema,
  Type.Literal("space-between"),
]);

const AutoLayoutFlowProperties = {
  padding: AutoLayoutPaddingSchema,
  gap: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  primaryAlignment: AutoLayoutPrimaryAlignmentSchema,
  counterAlignment: AutoLayoutCounterAlignmentSchema,
  sizing: Type.Optional(AutoLayoutFrameSizingSchema),
};

export const AutoLayoutWrapSchema = Type.Object(
  {
    mode: Type.Literal("wrap"),
    counterGap: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  },
  { additionalProperties: false },
);

export type AutoLayoutWrap = Static<typeof AutoLayoutWrapSchema>;

export const AutoLayoutSchema = Type.Union([
  Type.Object(
    {
      mode: Type.Literal("none"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("horizontal"),
      ...AutoLayoutFlowProperties,
      wrap: Type.Optional(AutoLayoutWrapSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("vertical"),
      ...AutoLayoutFlowProperties,
    },
    { additionalProperties: false },
  ),
]);

export type AutoLayout = Static<typeof AutoLayoutSchema>;
export type AutoLayoutFlow = Exclude<AutoLayout, { mode: "none" }>;
