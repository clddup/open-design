import { Type, type Static } from "@sinclair/typebox";
import {
  DESIGN_FIRST_SLICE_MAX_ELEMENTS,
  DESIGN_FIRST_SLICE_MAX_STAGES,
} from "./design-first-slice-budget";
import {
  DESIGN_LOGO_OUTPUTS,
  LOGO_CONCEPT_PRINCIPLES,
} from "./design-agent-plan-review";

const CLOSED = { additionalProperties: false } as const;
const ID_PATTERN = "^[^\\u0000-\\u001F\\u007F]+$";
const NON_WHITESPACE_PATTERN = "\\S";

function idSchema(maxLength = 256) {
  return Type.String({
    minLength: 1,
    maxLength,
    pattern: ID_PATTERN,
  });
}

function textSchema(minLength: number, maxLength: number) {
  return Type.String({
    minLength,
    maxLength,
    pattern: NON_WHITESPACE_PATTERN,
  });
}

const COORDINATE_SCHEMA = Type.Number({
  minimum: -1_000_000,
  maximum: 1_000_000,
});
const NONNEGATIVE_COORDINATE_SCHEMA = Type.Number({
  minimum: 0,
  maximum: 100_000,
});
const DIMENSION_SCHEMA = Type.Number({
  exclusiveMinimum: 0,
  maximum: 100_000,
});
const UNIT_SCHEMA = Type.Number({ minimum: 0, maximum: 1 });

const DELIVERABLE_SCHEMA = Type.Union([
  Type.Literal("ui"),
  Type.Literal("poster"),
  Type.Literal("logo"),
  Type.Literal("brand-asset"),
  Type.Literal("illustration"),
  Type.Literal("presentation-visual"),
  Type.Literal("other"),
]);

const PAINT_SCHEMA = Type.Object(
  {
    color: textSchema(1, 128),
    opacity: Type.Optional(UNIT_SCHEMA),
  },
  CLOSED,
);

const STROKE_SCHEMA = Type.Object(
  {
    color: textSchema(1, 128),
    opacity: Type.Optional(UNIT_SCHEMA),
    width: Type.Number({ exclusiveMinimum: 0, maximum: 10_000 }),
  },
  CLOSED,
);

const ELEMENT_BASE_PROPERTIES = {
  id: idSchema(),
  name: idSchema(),
  parentId: idSchema(),
  x: COORDINATE_SCHEMA,
  y: COORDINATE_SCHEMA,
  width: DIMENSION_SCHEMA,
  height: DIMENSION_SCHEMA,
  opacity: Type.Optional(UNIT_SCHEMA),
};

const GROUP_ELEMENT_SCHEMA = Type.Object(
  {
    ...ELEMENT_BASE_PROPERTIES,
    kind: Type.Literal("group"),
  },
  CLOSED,
);

const FRAME_ELEMENT_SCHEMA = Type.Object(
  {
    ...ELEMENT_BASE_PROPERTIES,
    kind: Type.Literal("frame"),
    fill: Type.Optional(PAINT_SCHEMA),
    stroke: Type.Optional(STROKE_SCHEMA),
    cornerRadius: Type.Optional(Type.Number({ minimum: 0, maximum: 100_000 })),
    clipsContent: Type.Optional(Type.Boolean()),
  },
  CLOSED,
);

const RECTANGLE_ELEMENT_SCHEMA = Type.Object(
  {
    ...ELEMENT_BASE_PROPERTIES,
    kind: Type.Literal("rectangle"),
    fill: PAINT_SCHEMA,
    stroke: Type.Optional(STROKE_SCHEMA),
    cornerRadius: Type.Optional(Type.Number({ minimum: 0, maximum: 100_000 })),
  },
  CLOSED,
);

const ELLIPSE_ELEMENT_SCHEMA = Type.Object(
  {
    ...ELEMENT_BASE_PROPERTIES,
    kind: Type.Literal("ellipse"),
    fill: PAINT_SCHEMA,
    stroke: Type.Optional(STROKE_SCHEMA),
  },
  CLOSED,
);

const PATH_ELEMENT_SCHEMA = Type.Object(
  {
    ...ELEMENT_BASE_PROPERTIES,
    kind: Type.Literal("path"),
    path: Type.String({ minLength: 1, maxLength: 20_000 }),
    fill: PAINT_SCHEMA,
  },
  CLOSED,
);

const TEXT_ELEMENT_SCHEMA = Type.Object(
  {
    ...ELEMENT_BASE_PROPERTIES,
    kind: Type.Literal("text"),
    text: Type.Object(
      {
        content: Type.String({ minLength: 1, maxLength: 100_000 }),
        fontFamily: idSchema(4_096),
        fontStyleName: textSchema(1, 512),
        fontWeight: Type.Integer({ minimum: 1, maximum: 1_000 }),
        fontSlant: Type.Union([Type.Literal("normal"), Type.Literal("italic")]),
        fontSize: DIMENSION_SCHEMA,
        lineHeight: DIMENSION_SCHEMA,
        letterSpacing: Type.Optional(Type.Number()),
        color: textSchema(1, 128),
        textResize: Type.Union([
          Type.Literal("auto-width"),
          Type.Literal("auto-height"),
          Type.Literal("fixed"),
        ]),
        align: Type.Optional(
          Type.Union([
            Type.Literal("left"),
            Type.Literal("center"),
            Type.Literal("right"),
            Type.Literal("justify"),
          ]),
        ),
      },
      CLOSED,
    ),
  },
  CLOSED,
);

export const DESIGN_FIRST_SLICE_ELEMENT_SCHEMA = Type.Union([
  GROUP_ELEMENT_SCHEMA,
  FRAME_ELEMENT_SCHEMA,
  RECTANGLE_ELEMENT_SCHEMA,
  ELLIPSE_ELEMENT_SCHEMA,
  PATH_ELEMENT_SCHEMA,
  TEXT_ELEMENT_SCHEMA,
]);

const REGION_SCHEMA = Type.Object(
  {
    nodeId: idSchema(),
    name: textSchema(1, 128),
    parentId: idSchema(),
    role: Type.Union([
      Type.Literal("structure"),
      Type.Literal("content"),
      Type.Literal("typography"),
      Type.Literal("media"),
      Type.Literal("graphic"),
      Type.Literal("decoration"),
      Type.Literal("interaction"),
      Type.Literal("other"),
    ]),
    x: NONNEGATIVE_COORDINATE_SCHEMA,
    y: NONNEGATIVE_COORDINATE_SCHEMA,
    width: DIMENSION_SCHEMA,
    height: DIMENSION_SCHEMA,
  },
  {
    ...CLOSED,
    description:
      "Parent-first planned region with bounds local to parentId. Main creates the real Frame; firstSlice elements only reference this ID.",
  },
);

const FRAME_SCHEMA = Type.Object(
  {
    frameId: idSchema(),
    x: COORDINATE_SCHEMA,
    y: COORDINATE_SCHEMA,
    width: DIMENSION_SCHEMA,
    height: DIMENSION_SCHEMA,
  },
  CLOSED,
);

const TARGET_MODEL_SCHEMA = Type.Object(
  {
    targetId: idSchema(128),
    label: idSchema(),
    pageId: idSchema(),
    frame: FRAME_SCHEMA,
    regions: Type.Array(REGION_SCHEMA, { minItems: 1, maxItems: 12 }),
  },
  CLOSED,
);

const GRAPHIC_QUALITY_PROFILE_SCHEMA = Type.Object(
  { kind: Type.Literal("graphic") },
  CLOSED,
);

const UI_QUALITY_PROFILE_SCHEMA = Type.Object(
  {
    kind: Type.Literal("ui"),
    platform: Type.Union([
      Type.Literal("web"),
      Type.Literal("macos"),
      Type.Literal("windows"),
      Type.Literal("ios"),
      Type.Literal("ipados"),
      Type.Literal("android"),
      Type.Literal("other"),
    ]),
    input: Type.Union([
      Type.Literal("pointer"),
      Type.Literal("touch"),
      Type.Literal("mixed"),
    ]),
    insets: Type.Tuple([
      Type.Number({ minimum: 0, maximum: 10_000 }),
      Type.Number({ minimum: 0, maximum: 10_000 }),
      Type.Number({ minimum: 0, maximum: 10_000 }),
      Type.Number({ minimum: 0, maximum: 10_000 }),
    ]),
    safeNodeIds: Type.Array(idSchema(), {
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
    }),
    hitNodeIds: Type.Array(idSchema(), {
      maxItems: 64,
      uniqueItems: true,
    }),
  },
  CLOSED,
);

const TARGET_CANONICAL_SCHEMA = Type.Object(
  {
    targetId: idSchema(128),
    label: idSchema(),
    pageId: idSchema(),
    objective: textSchema(1, 2_000),
    frame: FRAME_SCHEMA,
    layout: textSchema(1, 1_000),
    spacing: textSchema(1, 500),
    qualityProfile: Type.Union([
      GRAPHIC_QUALITY_PROFILE_SCHEMA,
      UI_QUALITY_PROFILE_SCHEMA,
    ]),
    regions: Type.Array(REGION_SCHEMA, { minItems: 1, maxItems: 12 }),
  },
  CLOSED,
);

const FIRST_SLICE_SCHEMA = Type.Object(
  {
    targetId: idSchema(128),
    label: idSchema(),
    stages: Type.Array(
      Type.Object(
        {
          stageId: idSchema(128),
          label: idSchema(),
          elements: Type.Array(DESIGN_FIRST_SLICE_ELEMENT_SCHEMA, {
            minItems: 1,
            maxItems: DESIGN_FIRST_SLICE_MAX_ELEMENTS,
          }),
        },
        CLOSED,
      ),
      {
        minItems: 1,
        maxItems: DESIGN_FIRST_SLICE_MAX_STAGES,
        description: `At most ${DESIGN_FIRST_SLICE_MAX_ELEMENTS} model-authored elements total across all stages.`,
      },
    ),
  },
  CLOSED,
);

const LOGO_OUTPUTS_SCHEMA = Type.Array(
  Type.Union(
    DESIGN_LOGO_OUTPUTS.map((output) => Type.Literal(output)) as [
      ReturnType<typeof Type.Literal>,
      ...ReturnType<typeof Type.Literal>[],
    ],
  ),
  {
    minItems: 1,
    maxItems: DESIGN_LOGO_OUTPUTS.length,
    uniqueItems: true,
  },
);

const LOGO_EXPLORATION_SCHEMA = Type.Object(
  {
    targetId: idSchema(128),
    directions: Type.Array(
      Type.Object(
        {
          conceptId: idSchema(128),
          principle: Type.Union(
            LOGO_CONCEPT_PRINCIPLES.map((principle) =>
              Type.Literal(principle),
            ) as [
              ReturnType<typeof Type.Literal>,
              ...ReturnType<typeof Type.Literal>[],
            ],
          ),
          thesis: textSchema(16, 1_000),
          constructionLogic: textSchema(24, 1_000),
          rootNodeId: idSchema(),
          evidenceNodeIds: Type.Array(idSchema(), {
            minItems: 4,
            maxItems: 4,
            uniqueItems: true,
          }),
        },
        CLOSED,
      ),
      { minItems: 3, maxItems: 3 },
    ),
  },
  CLOSED,
);

const DESIGN_INTENT_SCHEMA = Type.Object(
  {
    subject: textSchema(8, 500),
    audience: textSchema(8, 500),
    primaryJob: textSchema(8, 500),
    visualThesis: textSchema(16, 1_000),
    signatureMotif: textSchema(16, 1_000),
    typographyLanguage: textSchema(12, 1_000),
    colorMaterialLanguage: textSchema(12, 1_000),
    compositionTension: textSchema(12, 1_000),
    antiPatterns: Type.Array(textSchema(8, 256), {
      minItems: 3,
      maxItems: 12,
      uniqueItems: true,
    }),
  },
  CLOSED,
);

const FIDELITY_ITEM_SCHEMA = textSchema(1, 500);
const BRIEF_FIDELITY_SCHEMA = Type.Object(
  {
    requiredContent: Type.Array(FIDELITY_ITEM_SCHEMA, {
      minItems: 1,
      maxItems: 24,
    }),
    preservedSemantics: Type.Array(FIDELITY_ITEM_SCHEMA, { maxItems: 24 }),
    prohibitedAdditions: Type.Array(FIDELITY_ITEM_SCHEMA, {
      minItems: 1,
      maxItems: 24,
    }),
    assumptions: Type.Array(FIDELITY_ITEM_SCHEMA, { maxItems: 12 }),
  },
  CLOSED,
);

const VISUAL_SYSTEM_SCHEMA = Type.Object(
  {
    formLanguage: textSchema(1, 1_000),
    palette: Type.Array(textSchema(1, 128), { minItems: 1, maxItems: 12 }),
    surfaceAndDepth: textSchema(1, 1_000),
    typography: Type.Array(textSchema(1, 256), { minItems: 1, maxItems: 8 }),
    effects: Type.Optional(Type.Array(textSchema(1, 256), { maxItems: 12 })),
  },
  CLOSED,
);

const RASTER_ASSET_ROLES_SCHEMA = Type.Array(
  Type.Union([
    Type.Literal("reference"),
    Type.Literal("background"),
    Type.Literal("hero"),
    Type.Literal("supporting-content"),
  ]),
  { maxItems: 4, uniqueItems: true },
);

const REFERENCE_STRATEGY_SCHEMA = Type.Object(
  {
    synthesis: textSchema(12, 1_000),
    references: Type.Array(
      Type.Object(
        {
          attachmentId: Type.String({ pattern: "^image_[a-f0-9]{64}$" }),
          decision: Type.Union([
            Type.Literal("style-reference"),
            Type.Literal("composition-reference"),
            Type.Literal("brand-reference"),
            Type.Literal("content-asset"),
            Type.Literal("ignore"),
          ]),
          application: textSchema(12, 1_000),
          preserve: Type.Array(textSchema(4, 256), {
            maxItems: 6,
            uniqueItems: true,
          }),
          avoid: Type.Array(textSchema(4, 256), {
            maxItems: 6,
            uniqueItems: true,
          }),
        },
        CLOSED,
      ),
      { maxItems: 6 },
    ),
  },
  CLOSED,
);

const OCCURRENCE_SCHEMA = Type.Object(
  { targetId: idSchema(128), nodeId: idSchema() },
  CLOSED,
);

const SEMANTIC_OBJECT_SCHEMA = Type.Union([
  Type.Object(
    {
      decisionId: idSchema(128),
      label: idSchema(),
      decision: Type.Literal("ordinary"),
      occurrences: Type.Array(OCCURRENCE_SCHEMA, {
        minItems: 1,
        maxItems: 33,
      }),
    },
    CLOSED,
  ),
  Type.Object(
    {
      decisionId: idSchema(128),
      label: idSchema(),
      decision: Type.Literal("component"),
      componentId: idSchema(),
      main: OCCURRENCE_SCHEMA,
      instances: Type.Array(OCCURRENCE_SCHEMA, { maxItems: 32 }),
    },
    CLOSED,
  ),
  Type.Object(
    {
      decisionId: idSchema(128),
      label: idSchema(),
      decision: Type.Literal("reuse-component"),
      componentId: idSchema(),
      instances: Type.Array(OCCURRENCE_SCHEMA, {
        minItems: 1,
        maxItems: 32,
      }),
    },
    CLOSED,
  ),
]);

const SKILL_REFS_SCHEMA = Type.Array(Type.Object({ id: idSchema() }, CLOSED), {
  minItems: 1,
  maxItems: 8,
});

export const DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    deliverable: DELIVERABLE_SCHEMA,
    objective: textSchema(1, 2_000),
    targets: Type.Array(TARGET_MODEL_SCHEMA, { minItems: 1, maxItems: 32 }),
    logoOutputs: Type.Optional(LOGO_OUTPUTS_SCHEMA),
    logoExploration: Type.Optional(LOGO_EXPLORATION_SCHEMA),
    firstSlice: FIRST_SLICE_SCHEMA,
  },
  {
    ...CLOSED,
    description:
      "Real artboard roots and one editable first slice. Main binds host-owned skills, brief fidelity, planning metadata, and quality defaults before domain refinement.",
  },
);

export const DESIGN_FIRST_SLICE_CANONICAL_INPUT_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    deliverable: DELIVERABLE_SCHEMA,
    objective: textSchema(1, 2_000),
    designIntent: DESIGN_INTENT_SCHEMA,
    skillRefs: SKILL_REFS_SCHEMA,
    briefFidelity: BRIEF_FIDELITY_SCHEMA,
    targets: Type.Array(TARGET_CANONICAL_SCHEMA, {
      minItems: 1,
      maxItems: 32,
    }),
    visualSystem: VISUAL_SYSTEM_SCHEMA,
    rasterAssetRoles: RASTER_ASSET_ROLES_SCHEMA,
    referenceStrategy: Type.Optional(REFERENCE_STRATEGY_SCHEMA),
    logoOutputs: Type.Optional(LOGO_OUTPUTS_SCHEMA),
    logoExploration: Type.Optional(LOGO_EXPLORATION_SCHEMA),
    semanticObjects: Type.Optional(
      Type.Array(SEMANTIC_OBJECT_SCHEMA, { maxItems: 24 }),
    ),
    firstSlice: FIRST_SLICE_SCHEMA,
  },
  CLOSED,
);

export type DesignFirstSliceModelInput = Static<
  typeof DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA
>;
export type DesignFirstSliceCanonicalInput = Static<
  typeof DESIGN_FIRST_SLICE_CANONICAL_INPUT_SCHEMA
>;
export type DesignFirstSliceElementInput = Static<
  typeof DESIGN_FIRST_SLICE_ELEMENT_SCHEMA
>;
