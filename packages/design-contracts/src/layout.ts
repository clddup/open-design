import { Type, type Static } from "@sinclair/typebox";

export const CONSTRAINTS_DESIGN_SCHEMA_VERSION = "1.12.0" as const;
export const AUTO_LAYOUT_DESIGN_SCHEMA_VERSION = "1.18.0" as const;

const LayoutGuideAppearanceSchema = {
  id: Type.String({ minLength: 1, maxLength: 256 }),
  color: Type.String({ minLength: 1, maxLength: 128 }),
  opacity: Type.Number({ minimum: 0, maximum: 1 }),
};

export const UniformLayoutGuideSchema = Type.Object(
  {
    ...LayoutGuideAppearanceSchema,
    type: Type.Literal("grid"),
    size: Type.Number({ minimum: 1, maximum: 10_000 }),
  },
  { additionalProperties: false },
);

const LayoutGuideAxisTypeSchema = Type.Union([
  Type.Literal("columns"),
  Type.Literal("rows"),
]);
const LayoutGuideCountSchema = Type.Integer({ minimum: 1, maximum: 4_096 });
const LayoutGuideDistanceSchema = Type.Number({
  minimum: 0,
  maximum: 1_000_000,
});

export const StretchLayoutGuideSchema = Type.Object(
  {
    ...LayoutGuideAppearanceSchema,
    type: LayoutGuideAxisTypeSchema,
    alignment: Type.Literal("stretch"),
    count: LayoutGuideCountSchema,
    gutter: LayoutGuideDistanceSchema,
    margin: LayoutGuideDistanceSchema,
  },
  { additionalProperties: false },
);

export const CenteredLayoutGuideSchema = Type.Object(
  {
    ...LayoutGuideAppearanceSchema,
    type: LayoutGuideAxisTypeSchema,
    alignment: Type.Literal("center"),
    count: LayoutGuideCountSchema,
    gutter: LayoutGuideDistanceSchema,
    sectionSize: Type.Number({ exclusiveMinimum: 0, maximum: 1_000_000 }),
  },
  { additionalProperties: false },
);

export const EdgeAlignedLayoutGuideSchema = Type.Object(
  {
    ...LayoutGuideAppearanceSchema,
    type: LayoutGuideAxisTypeSchema,
    alignment: Type.Union([Type.Literal("start"), Type.Literal("end")]),
    count: LayoutGuideCountSchema,
    gutter: LayoutGuideDistanceSchema,
    sectionSize: Type.Number({ exclusiveMinimum: 0, maximum: 1_000_000 }),
    offset: LayoutGuideDistanceSchema,
  },
  { additionalProperties: false },
);

export const LayoutGuideSchema = Type.Union([
  UniformLayoutGuideSchema,
  StretchLayoutGuideSchema,
  CenteredLayoutGuideSchema,
  EdgeAlignedLayoutGuideSchema,
]);

export type LayoutGuide = Static<typeof LayoutGuideSchema>;

export function layoutGuidePrimitiveCount(
  frameSize: { width: number; height: number },
  guide: LayoutGuide,
): number {
  if (guide.type !== "grid") return guide.count;
  return (
    Math.max(0, Math.ceil(frameSize.width / guide.size) - 1) +
    Math.max(0, Math.ceil(frameSize.height / guide.size) - 1)
  );
}

export function layoutGuideGeometryIsValid(
  frameSize: { width: number; height: number },
  guide: LayoutGuide,
): boolean {
  if (layoutGuidePrimitiveCount(frameSize, guide) > 4_096) return false;
  if (guide.type === "grid" || guide.alignment !== "stretch") return true;
  const axisSize =
    guide.type === "columns" ? frameSize.width : frameSize.height;
  return axisSize - guide.margin * 2 - guide.gutter * (guide.count - 1) > 0;
}

export const LayoutPositioningSchema = Type.Literal("absolute");
export type LayoutPositioning = Static<typeof LayoutPositioningSchema>;

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

export const MAX_GRID_TRACK_VALUE = 1_000_000;

export const GridTrackSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("fixed"),
      value: Type.Number({ minimum: 0, maximum: MAX_GRID_TRACK_VALUE }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("fill"),
      value: Type.Number({
        exclusiveMinimum: 0,
        maximum: MAX_GRID_TRACK_VALUE,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal("hug") }, { additionalProperties: false }),
]);

export type GridTrack = Static<typeof GridTrackSchema>;

const GridIndexSchema = Type.Integer({ minimum: 0, maximum: 4_095 });
const GridSpanSchema = Type.Integer({ minimum: 1, maximum: 4_096 });
const GridChildAlignmentSchema = Type.Union([
  Type.Literal("start"),
  Type.Literal("center"),
  Type.Literal("end"),
  Type.Literal("auto"),
]);

export const GridChildPlacementSchema = Type.Object(
  {
    row: GridIndexSchema,
    column: GridIndexSchema,
    rowSpan: GridSpanSchema,
    columnSpan: GridSpanSchema,
    horizontalAlign: GridChildAlignmentSchema,
    verticalAlign: GridChildAlignmentSchema,
  },
  { additionalProperties: false },
);

export type GridChildPlacement = Static<typeof GridChildPlacementSchema>;

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
  Type.Literal("baseline"),
]);

const AutoLayoutPrimaryAlignmentSchema = Type.Union([
  Type.Literal("start"),
  Type.Literal("center"),
  Type.Literal("end"),
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
    counterAxisAlignContent: Type.Optional(
      Type.Union([Type.Literal("auto"), Type.Literal("space-between")]),
    ),
  },
  { additionalProperties: false },
);

export type AutoLayoutWrap = Static<typeof AutoLayoutWrapSchema>;

export const HorizontalAutoLayoutSchema = Type.Object(
  {
    mode: Type.Literal("horizontal"),
    ...AutoLayoutFlowProperties,
    wrap: Type.Optional(AutoLayoutWrapSchema),
  },
  { additionalProperties: false },
);

export const VerticalAutoLayoutSchema = Type.Object(
  {
    mode: Type.Literal("vertical"),
    ...AutoLayoutFlowProperties,
  },
  { additionalProperties: false },
);

export const LinearAutoLayoutSchema = Type.Union([
  HorizontalAutoLayoutSchema,
  VerticalAutoLayoutSchema,
]);

export const AutoLayoutSchema = Type.Union([
  Type.Object(
    {
      mode: Type.Literal("none"),
    },
    { additionalProperties: false },
  ),
  HorizontalAutoLayoutSchema,
  VerticalAutoLayoutSchema,
  Type.Object(
    {
      mode: Type.Literal("grid"),
      padding: AutoLayoutPaddingSchema,
      rowGap: Type.Number({ minimum: 0, maximum: 1_000_000 }),
      columnGap: Type.Number({ minimum: 0, maximum: 1_000_000 }),
      rows: Type.Array(GridTrackSchema, { minItems: 1, maxItems: 4_096 }),
      columns: Type.Array(GridTrackSchema, {
        minItems: 1,
        maxItems: 4_096,
      }),
      itemsPositioning: Type.Union([
        Type.Literal("manual"),
        Type.Literal("row-auto-flow"),
      ]),
      autoTracks: Type.Optional(Type.Literal("rows")),
      sizing: Type.Optional(AutoLayoutFrameSizingSchema),
    },
    { additionalProperties: false },
  ),
]);

export type AutoLayout = Static<typeof AutoLayoutSchema>;
export type AutoLayoutFlow = Exclude<AutoLayout, { mode: "none" }>;
export type LinearAutoLayoutFlow = Extract<
  AutoLayout,
  { mode: "horizontal" | "vertical" }
>;
export type GridAutoLayout = Extract<AutoLayout, { mode: "grid" }>;
