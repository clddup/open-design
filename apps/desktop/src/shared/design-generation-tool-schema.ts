import {
  MAX_TRANSACTION_COMMANDS,
  executableJsonSchema,
  Type,
  type Static,
  type TSchema,
} from "@opendesign/design-contracts";
import type { TObject } from "@sinclair/typebox";
import {
  CLOSED,
  COORDINATE_SCHEMA,
  DIMENSION_SCHEMA,
  idSchema,
  localIdSchema,
  textSchema,
} from "./design-generation-schema-primitives";
import {
  DESIGN_GENERATION_ELEMENT_SCHEMA,
  DESIGN_GENERATION_CANONICAL_ELEMENT_SCHEMA,
} from "./design-generation-element-schema";
export type { DesignGenerationElementInput } from "./design-generation-element-schema";

import {
  DESIGN_LOGO_OUTPUTS,
  LOGO_CONCEPT_PRINCIPLES,
} from "./design-agent-plan-review";
import { DESIGN_LOGO_COLOR_MODES } from "./design-logo-color";
import {
  COMPACT_DESIGN_INTENT_LIMITS,
  createDesignIntentSchema,
  DESIGN_INTENT_SCHEMA,
} from "./design-intent-contract";

const COMPACT_DESIGN_INTENT_SCHEMA = createDesignIntentSchema(
  COMPACT_DESIGN_INTENT_LIMITS,
);
const DELIVERABLE_SCHEMA = Type.Union([
  Type.Literal("ui"),
  Type.Literal("poster"),
  Type.Literal("logo"),
  Type.Literal("brand-asset"),
  Type.Literal("illustration"),
  Type.Literal("presentation-visual"),
  Type.Literal("other"),
]);

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

const FRAME_MODEL_SCHEMA = Type.Object(
  {
    width: DIMENSION_SCHEMA,
    height: DIMENSION_SCHEMA,
  },
  {
    ...CLOSED,
    description:
      "Requested artboard size. Main owns its identity and placement.",
  },
);

const TARGET_MODEL_SCHEMA = Type.Object(
  {
    frame: FRAME_MODEL_SCHEMA,
  },
  {
    ...CLOSED,
    description:
      "Artboard size for the one Main-bound current target. The editable element hierarchy is the only authored structure; do not submit a parallel region plan.",
  },
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
    objective: textSchema(2_000),
    frame: FRAME_SCHEMA,
    layout: textSchema(1_000),
    spacing: textSchema(500),
    qualityProfile: Type.Union([
      GRAPHIC_QUALITY_PROFILE_SCHEMA,
      UI_QUALITY_PROFILE_SCHEMA,
    ]),
  },
  CLOSED,
);

function designGenerationPayloadSchema<
  TElement extends TSchema,
  TTargetId extends TSchema,
>(elementSchema: TElement, targetIdSchema: TTargetId) {
  return Type.Object(
    {
      targetId: targetIdSchema,
      label: idSchema(),
      elements: Type.Array(elementSchema, {
        minItems: 1,
        maxItems: MAX_TRANSACTION_COMMANDS - 1,
        description:
          "One coherent material batch committed immediately as a real design revision. Author one parent-first editable hierarchy: omit parentId for artboard children and use an earlier element ID for nested children. Stop once one complete, useful visual section is ready; use later edit calls for additional progressive batches. The element bound leaves room for the host-created artboard inside the shared DesignTransaction command safety limit.",
      }),
    },
    {
      ...CLOSED,
      description:
        "Materialize targets[0] from one editable parent-first element hierarchy. targetId must equal targets[0].targetId. Element parentId must name an earlier element or the host-bound artboard.",
    },
  );
}

const DESIGN_GENERATION_MODEL_SCHEMA = Type.Omit(
  designGenerationPayloadSchema(
    DESIGN_GENERATION_ELEMENT_SCHEMA,
    idSchema(128),
  ),
  ["targetId"],
);
const DESIGN_GENERATION_CANONICAL_SCHEMA = designGenerationPayloadSchema(
  DESIGN_GENERATION_CANONICAL_ELEMENT_SCHEMA,
  idSchema(128),
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
    description:
      "Logo outputs materially present in this current one-target stage only. The reviewed Delivery Scope, not this array, retains outputs assigned to later targets.",
  },
);

const LOGO_COLOR_STRATEGY_SCHEMA = Type.Object(
  {
    mode: Type.Union(
      DESIGN_LOGO_COLOR_MODES.map((mode) => Type.Literal(mode)) as [
        ReturnType<typeof Type.Literal>,
        ...ReturnType<typeof Type.Literal>[],
      ],
    ),
    rationale: textSchema(1_000),
    lightDarkAdaptation: textSchema(1_000),
  },
  CLOSED,
);

const LOGO_DIRECTION_COLOR_SYSTEM_SCHEMA = Type.Object(
  {
    palette: Type.Array(textSchema(128), {
      minItems: 1,
      maxItems: 6,
      uniqueItems: true,
    }),
    rationale: textSchema(1_000),
  },
  CLOSED,
);

function logoExplorationSchema<
  TDocumentId extends TSchema,
  TTargetId extends TSchema,
>(documentIdSchema: TDocumentId, targetIdSchema: TTargetId) {
  return Type.Object(
    {
      targetId: targetIdSchema,
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
            thesis: textSchema(1_000),
            constructionLogic: textSchema(1_000),
            colorSystem: LOGO_DIRECTION_COLOR_SYSTEM_SCHEMA,
            rootNodeId: Type.Intersect([documentIdSchema], {
              description:
                "ID of this direction's actual Frame/Group element in designGeneration, not a planned region ID.",
            }),
            masterNodeId: Type.Intersect([documentIdSchema], {
              description:
                "ID of the direction's editable master symbol root beneath rootNodeId. Author one intentional primary mark; do not add mechanically scaled evidence clones.",
            }),
          },
          CLOSED,
        ),
        { minItems: 1, maxItems: 8 },
      ),
    },
    CLOSED,
  );
}

const LOGO_EXPLORATION_MODEL_SCHEMA = Type.Omit(
  logoExplorationSchema(localIdSchema(), idSchema(128)),
  ["targetId"],
);
const LOGO_EXPLORATION_CANONICAL_SCHEMA = logoExplorationSchema(
  idSchema(),
  idSchema(128),
);

const FIDELITY_ITEM_SCHEMA = textSchema(500);
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
    formLanguage: textSchema(320),
    palette: Type.Array(textSchema(128), { minItems: 1, maxItems: 8 }),
    surfaceAndDepth: textSchema(320),
    typography: Type.Array(textSchema(160), { minItems: 1, maxItems: 4 }),
    effects: Type.Optional(Type.Array(textSchema(160), { maxItems: 6 })),
  },
  {
    ...CLOSED,
    description:
      "Executable visual tokens and relationships. Keep only decisions that affect the current committed design batch.",
  },
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
    synthesis: textSchema(1_000),
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
          application: textSchema(1_000),
          preserve: Type.Array(textSchema(256), {
            maxItems: 6,
            uniqueItems: true,
          }),
          avoid: Type.Array(textSchema(256), {
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

const SKILL_REFS_SCHEMA = Type.Array(Type.Object({ id: idSchema() }, CLOSED), {
  minItems: 1,
  maxItems: 8,
});

const DESIGN_GENERATION_MODEL_PROPERTIES = {
  deliverable: DELIVERABLE_SCHEMA,
  designIntent: Type.Optional(COMPACT_DESIGN_INTENT_SCHEMA),
  targets: Type.Array(TARGET_MODEL_SCHEMA, { minItems: 1, maxItems: 1 }),
  visualSystem: Type.Optional(VISUAL_SYSTEM_SCHEMA),
  rasterAssetRoles: RASTER_ASSET_ROLES_SCHEMA,
  logoOutputs: Type.Optional(LOGO_OUTPUTS_SCHEMA),
  logoExploration: Type.Optional(LOGO_EXPLORATION_MODEL_SCHEMA),
  logoColorStrategy: Type.Optional(LOGO_COLOR_STRATEGY_SCHEMA),
  designGeneration: DESIGN_GENERATION_MODEL_SCHEMA,
};

const DESIGN_GENERATION_CANONICAL_PROPERTIES = {
  version: Type.Literal(2),
  deliverable: DELIVERABLE_SCHEMA,
  objective: textSchema(2_000),
  designIntent: DESIGN_INTENT_SCHEMA,
  skillRefs: SKILL_REFS_SCHEMA,
  briefFidelity: BRIEF_FIDELITY_SCHEMA,
  targets: Type.Array(TARGET_CANONICAL_SCHEMA, {
    minItems: 1,
    maxItems: 1,
  }),
  visualSystem: VISUAL_SYSTEM_SCHEMA,
  rasterAssetRoles: RASTER_ASSET_ROLES_SCHEMA,
  referenceStrategy: Type.Optional(REFERENCE_STRATEGY_SCHEMA),
  logoOutputs: Type.Optional(LOGO_OUTPUTS_SCHEMA),
  logoExploration: Type.Optional(LOGO_EXPLORATION_CANONICAL_SCHEMA),
  logoColorStrategy: Type.Optional(LOGO_COLOR_STRATEGY_SCHEMA),
  designGeneration: DESIGN_GENERATION_CANONICAL_SCHEMA,
};

const DESIGN_GENERATION_MODEL_PROPERTIES_SCHEMA = Type.Object(
  DESIGN_GENERATION_MODEL_PROPERTIES,
  CLOSED,
);
const DESIGN_GENERATION_CANONICAL_PROPERTIES_SCHEMA = Type.Object(
  DESIGN_GENERATION_CANONICAL_PROPERTIES,
  CLOSED,
);

function designGenerationSchema<TProperties extends Record<string, TSchema>>(
  base: TObject<TProperties>,
  description?: string,
): TSchema {
  return executableJsonSchema({
    ...base,
    ...(description === undefined ? {} : { description }),
  });
}

const DESIGN_GENERATION_LOGO_DESCRIPTION =
  "Logo work should establish a brief-specific primary color treatment, with monochrome kept as evidence unless explicitly requested as the identity; logoColorStrategy is optional guidance, not a write gate.";

export const DESIGN_GENERATION_TOOL_INPUT_SCHEMA = designGenerationSchema(
  DESIGN_GENERATION_MODEL_PROPERTIES_SCHEMA,
  `Generate one Main-bound target as progressive editable design. This call commits one coherent material batch immediately; continue with ordinary edit calls when more batches are needed instead of waiting to submit the entire design at once. Submit the artboard size, image roles, and one parent-first editable element hierarchy; omit parentId for artboard children and never duplicate that hierarchy in a separate region plan. Do not repeat target identity, planning prose, visual rationale, host state, or artificial stage metadata. Frame, Rectangle, Ellipse, Path, Text and persistent Image appearance uses the same canonical document semantics; use an assetId returned by image generation when real subject evidence is required instead of a geometric placeholder. Use canonical paints and effects directly instead of approximating depth with extra flat rectangles. Reusable Component decisions happen after this real hierarchy exists, using inspected Frame/Group roots like Figma's create-component-from-node flow. ${DESIGN_GENERATION_LOGO_DESCRIPTION} Main derives the executable Plan metadata, binds stable identities, skills, brief fidelity and quality defaults from that same hierarchy, then validates the authored geometry.`,
);

export const DESIGN_GENERATION_CANONICAL_INPUT_SCHEMA = designGenerationSchema(
  DESIGN_GENERATION_CANONICAL_PROPERTIES_SCHEMA,
);

export type DesignGenerationModelInput = Static<
  typeof DESIGN_GENERATION_MODEL_PROPERTIES_SCHEMA
>;
export type DesignGenerationCanonicalInput = Static<
  typeof DESIGN_GENERATION_CANONICAL_PROPERTIES_SCHEMA
>;
