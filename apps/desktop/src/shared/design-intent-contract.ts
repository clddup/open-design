import { Type, type Static } from "@sinclair/typebox";

const CLOSED = { additionalProperties: false } as const;
const TEXT = { pattern: "\\S" } as const;

type DesignIntentLimits = Readonly<{
  coreText: number;
  directionText: number;
  languageText: number;
  antiPatternText: number;
  antiPatterns: number;
}>;

const CANONICAL_LIMITS: DesignIntentLimits = {
  coreText: 500,
  directionText: 1_000,
  languageText: 1_000,
  antiPatternText: 256,
  antiPatterns: 12,
};

export const COMPACT_DESIGN_INTENT_LIMITS: DesignIntentLimits = {
  coreText: 240,
  directionText: 320,
  languageText: 240,
  antiPatternText: 160,
  antiPatterns: 5,
};

export function createDesignIntentSchema(
  limits: DesignIntentLimits = CANONICAL_LIMITS,
) {
  return Type.Object(
    {
      subject: Type.String({
        ...TEXT,
        minLength: 1,
        maxLength: limits.coreText,
      }),
      audience: Type.String({
        ...TEXT,
        minLength: 1,
        maxLength: limits.coreText,
      }),
      primaryJob: Type.String({
        ...TEXT,
        minLength: 1,
        maxLength: limits.coreText,
      }),
      calibration: Type.Object(
        {
          surfaceMode: Type.Union([
            Type.Literal("persuade"),
            Type.Literal("operate"),
            Type.Literal("read"),
            Type.Literal("experience"),
            Type.Literal("graphic"),
          ]),
          expressiveness: Type.Union([
            Type.Literal("restrained"),
            Type.Literal("balanced"),
            Type.Literal("expressive"),
          ]),
          density: Type.Union([
            Type.Literal("airy"),
            Type.Literal("balanced"),
            Type.Literal("dense"),
          ]),
        },
        CLOSED,
      ),
      visualThesis: Type.String({
        ...TEXT,
        minLength: 1,
        maxLength: limits.directionText,
      }),
      signatureDecision: Type.String({
        ...TEXT,
        minLength: 1,
        maxLength: limits.directionText,
        description:
          "Brief-specific signature decision. It may be structural, typographic, behavioral, material, or geometric; do not invent decorative motifs merely to fill this field.",
      }),
      typographyLanguage: Type.String({
        ...TEXT,
        minLength: 1,
        maxLength: limits.languageText,
      }),
      colorMaterialLanguage: Type.String({
        ...TEXT,
        minLength: 1,
        maxLength: limits.languageText,
      }),
      compositionTension: Type.String({
        ...TEXT,
        minLength: 1,
        maxLength: limits.languageText,
      }),
      antiPatterns: Type.Array(
        Type.String({
          ...TEXT,
          minLength: 1,
          maxLength: limits.antiPatternText,
        }),
        { minItems: 1, maxItems: limits.antiPatterns, uniqueItems: true },
      ),
    },
    {
      ...CLOSED,
      description:
        "One concise brief-specific visual direction for the delivery, not a per-element rationale or user-facing design essay.",
    },
  );
}

export const DESIGN_INTENT_SCHEMA = createDesignIntentSchema();

export type DesignIntent = Static<typeof DESIGN_INTENT_SCHEMA>;
