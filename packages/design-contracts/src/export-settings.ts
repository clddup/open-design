import { Type, type Static } from "@sinclair/typebox";

export const MAX_EXPORT_SETTINGS_PER_NODE = 32;

export const ExportConstraintSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("SCALE"),
      value: Type.Number({ exclusiveMinimum: 0, maximum: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Union([Type.Literal("WIDTH"), Type.Literal("HEIGHT")]),
      value: Type.Integer({ minimum: 1, maximum: 16_384 }),
    },
    { additionalProperties: false },
  ),
]);

const CommonExportSettingProperties = {
  suffix: Type.String({
    maxLength: 128,
    pattern: "^[^\\u0000-\\u001f\\u007f]*$",
  }),
  contentsOnly: Type.Boolean(),
  useAbsoluteBounds: Type.Boolean(),
  colorProfile: Type.Union([
    Type.Literal("DOCUMENT"),
    Type.Literal("SRGB"),
    Type.Literal("DISPLAY_P3_V4"),
  ]),
};

export const ImageExportSettingSchema = Type.Object(
  {
    ...CommonExportSettingProperties,
    format: Type.Union([
      Type.Literal("PNG"),
      Type.Literal("JPG"),
      Type.Literal("WEBP"),
    ]),
    constraint: ExportConstraintSchema,
  },
  { additionalProperties: false },
);

export const SvgExportSettingSchema = Type.Object(
  {
    ...CommonExportSettingProperties,
    format: Type.Literal("SVG"),
    svgOutlineText: Type.Boolean(),
    svgIdAttribute: Type.Boolean(),
    svgSimplifyStroke: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const PdfExportSettingSchema = Type.Object(
  {
    ...CommonExportSettingProperties,
    format: Type.Literal("PDF"),
  },
  { additionalProperties: false },
);

export const ExportSettingSchema = Type.Union([
  ImageExportSettingSchema,
  SvgExportSettingSchema,
  PdfExportSettingSchema,
]);

export const ExportSettingsSchema = Type.Array(ExportSettingSchema, {
  maxItems: MAX_EXPORT_SETTINGS_PER_NODE,
});

export type ExportConstraint = Static<typeof ExportConstraintSchema>;
export type ImageExportSetting = Static<typeof ImageExportSettingSchema>;
export type SvgExportSetting = Static<typeof SvgExportSettingSchema>;
export type PdfExportSetting = Static<typeof PdfExportSettingSchema>;
export type ExportSetting = Static<typeof ExportSettingSchema>;

export function migrateExportSettings(document: Record<string, unknown>): void {
  const nodes = document.nodesById;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return;
  for (const value of Object.values(nodes)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    node.exportSettings ??= [];
  }
}
