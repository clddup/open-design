import {
  executableJsonSchema,
  schemaValidationIssues,
  type TSchema,
} from "@opendesign/design-contracts";
import {
  builtinDesignSkillRefsForDeliverable,
  BUILTIN_UI_DESIGN_SKILL_REFS,
  isBuiltinDesignSkillRefsForDeliverable,
  isKnownBuiltinDesignSkillRefs,
  type BuiltinDesignSkillRef,
} from "@opendesign/design-skills";
import {
  DESIGN_BRIEF_FIDELITY_SCHEMA,
  type DesignBriefFidelity,
} from "./design-brief-fidelity";
import {
  DESIGN_PLAN_COMPONENT_STRATEGY_SCHEMA,
  type DesignPlanComponentStrategy,
} from "./design-plan-component-strategy";
import {
  DESIGN_TARGET_QUALITY_PROFILE_SCHEMA,
  type DesignTargetQualityProfile,
} from "./design-plan-quality-profile";
import {
  isActiveVisualReferenceDecision,
  MAX_ACTIVE_VISUAL_REFERENCES,
  DESIGN_REFERENCE_STRATEGY_SCHEMA,
  type DesignReferenceStrategy,
} from "./design-reference-strategy";
import {
  type ValidationIssue,
  type ValidationIssueValue,
  type ValidationResult,
} from "./contract-validation";
import {
  boundedTextArray,
  exactKeys,
  isRecord,
  substantiveReviewText,
} from "./design-agent-validation";

export type DesignDeliverable =
  | "ui"
  | "poster"
  | "logo"
  | "brand-asset"
  | "illustration"
  | "presentation-visual"
  | "other";

export type RasterAssetRole =
  | "reference"
  | "background"
  | "hero"
  | "supporting-content"
  | "final-single-image";

export type PlaceableRasterAssetRole = Exclude<RasterAssetRole, "reference">;

export type DesignPlanRegionRole =
  | "structure"
  | "content"
  | "typography"
  | "media"
  | "graphic"
  | "decoration"
  | "interaction"
  | "other";

export type DesignPlanRegion = {
  nodeId: string;
  name: string;
  role: DesignPlanRegionRole;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesignPlanArtboard = {
  mode: "create" | "existing";
  frameId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesignPlanComposition = {
  assetIntegration: string;
  direction: string;
  hierarchy: string[];
  regions: DesignPlanRegion[];
  spacingRhythm: string;
};

export type DesignPlanTarget = {
  targetId: string;
  label: string;
  pageId: string;
  objective: string;
  artboard: DesignPlanArtboard;
  composition: DesignPlanComposition;
  editableLayers: string[];
  implementationSteps: string[];
  validationChecks: string[];
  qualityProfile: DesignTargetQualityProfile;
};

export type DesignPlanVisualSystem = {
  avoidances: string[];
  formLanguage: string;
  palette: string[];
  surfaceAndDepth: string;
  typography: string[];
  effects: string[];
};

export type DesignIntent = {
  subject: string;
  audience: string;
  primaryJob: string;
  visualThesis: string;
  signatureMotif: string;
  typographyLanguage: string;
  colorMaterialLanguage: string;
  compositionTension: string;
  antiPatterns: string[];
};

export const LOGO_CONCEPT_PRINCIPLES = [
  "negative-space",
  "modular-system",
  "path-contour",
  "spatial-layering",
  "typographic-relationship",
  "other",
] as const;

export const DESIGN_LOGO_OUTPUTS = [
  "symbol",
  "wordmark",
  "app-icon",
  "lockups",
  "usage-preview",
] as const;

export type DesignLogoOutput = (typeof DESIGN_LOGO_OUTPUTS)[number];

export type DesignLogoExploration = {
  targetId: string;
  directions: Array<{
    conceptId: string;
    label: string;
    principle: (typeof LOGO_CONCEPT_PRINCIPLES)[number];
    thesis: string;
    constructionLogic: string;
    rootNodeId: string;
    monochromeNodeId: string;
    smallSizeNodeIds: [string, string, string];
  }>;
};

export type DesignPlanToolInput = {
  version: 1;
  deliverable: DesignDeliverable;
  objective: string;
  outputMode: "editable-composition" | "single-raster";
  targets: DesignPlanTarget[];
  visualSystem: DesignPlanVisualSystem;
  rasterAssetRoles: RasterAssetRole[];
  componentStrategy: DesignPlanComponentStrategy;
  briefFidelity: DesignBriefFidelity;
  designIntent: DesignIntent;
  referenceStrategy?: DesignReferenceStrategy;
  skillRefs: BuiltinDesignSkillRef[];
  logoOutputs?: DesignLogoOutput[];
  logoExploration?: DesignLogoExploration;
  singleRasterEvidence?: string;
};

export const DESIGN_VISUAL_CRITERIA = [
  "visual-thesis",
  "signature-motif",
  "composition-tension",
  "typography-character",
  "material-coherence",
  "template-avoidance",
  "glance-legibility",
  "subject-specificity",
  "craft-precision",
] as const;

export type DesignVisualCriterion = (typeof DESIGN_VISUAL_CRITERIA)[number];

export type DesignVisualReviewToolInput = {
  version: 1;
  skillRefs: BuiltinDesignSkillRef[];
  briefFidelity: string;
  distinctiveness: string;
  signatureMotif: string;
  composition: string;
  hierarchy: string;
  typography: string;
  assetIntegration: string;
  formAndSurface: string;
  effects: string;
  antiTemplate: string;
  criteria: Record<DesignVisualCriterion, string>;
  failedCriteria: readonly DesignVisualCriterion[];
  refinements: string[];
};

const DESIGN_PLAN_ARTBOARD_SCHEMA = {
  type: "object",
  properties: {
    mode: { enum: ["create", "existing"] },
    frameId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      pattern: "^[^\\u0000-\\u001F\\u007F]+$",
    },
    x: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
    y: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
    width: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
    height: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
  },
  required: ["mode", "frameId", "x", "y", "width", "height"],
  additionalProperties: false,
} as const;

const DESIGN_PLAN_COMPOSITION_SCHEMA = {
  type: "object",
  properties: {
    direction: {
      type: "string",
      minLength: 1,
      maxLength: 1_000,
      pattern: "\\S",
    },
    hierarchy: {
      type: "array",
      minItems: 2,
      maxItems: 16,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        pattern: "\\S",
      },
    },
    regions: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      description:
        "Parent-first major composition regions. Omitted parentId means the target artboard; otherwise bounds are local to an earlier region parent. Main owns create-target region containers.",
      items: {
        type: "object",
        properties: {
          nodeId: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            pattern: "^[^\\u0000-\\u001F\\u007F]+$",
          },
          name: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "\\S",
          },
          parentId: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            pattern: "^[^\\u0000-\\u001F\\u007F]+$",
            description:
              "Optional parent region ID. Omit for a top-level artboard region. Bounds are local to the declared parent.",
          },
          role: {
            enum: [
              "structure",
              "content",
              "typography",
              "media",
              "graphic",
              "decoration",
              "interaction",
              "other",
            ],
          },
          x: { type: "number", minimum: 0, maximum: 100_000 },
          y: { type: "number", minimum: 0, maximum: 100_000 },
          width: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
          height: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
        },
        required: ["nodeId", "name", "role", "x", "y", "width", "height"],
        additionalProperties: false,
      },
    },
    assetIntegration: {
      type: "string",
      minLength: 1,
      maxLength: 1_000,
      pattern: "\\S",
      description:
        "How native shapes, vectors, typography, and any raster imagery form one editable composition. State an intentional no-raster strategy when appropriate.",
    },
    spacingRhythm: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      pattern: "\\S",
    },
  },
  required: [
    "direction",
    "hierarchy",
    "regions",
    "assetIntegration",
    "spacingRhythm",
  ],
  additionalProperties: false,
} as const;

const DESIGN_PLAN_TARGET_BASE_SCHEMA = {
  type: "object",
  description:
    "One required user-facing deliverable. Use exactly one target for a single requested design and one target per requested screen or asset for a set.",
  properties: {
    targetId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[^\\u0000-\\u001F\\u007F]+$",
    },
    label: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      pattern: "\\S",
    },
    pageId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      pattern: "^[^\\u0000-\\u001F\\u007F]+$",
    },
    objective: {
      type: "string",
      minLength: 1,
      maxLength: 2_000,
      pattern: "\\S",
    },
    artboard: DESIGN_PLAN_ARTBOARD_SCHEMA,
    composition: DESIGN_PLAN_COMPOSITION_SCHEMA,
    editableLayers: {
      type: "array",
      minItems: 2,
      maxItems: 24,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        pattern: "\\S",
      },
    },
    implementationSteps: {
      type: "array",
      minItems: 2,
      maxItems: 16,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 500,
        pattern: "\\S",
      },
    },
    validationChecks: {
      type: "array",
      minItems: 2,
      maxItems: 16,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 500,
        pattern: "\\S",
      },
    },
  },
  required: [
    "targetId",
    "label",
    "pageId",
    "objective",
    "artboard",
    "composition",
    "editableLayers",
    "implementationSteps",
    "validationChecks",
  ],
  additionalProperties: false,
} as const;

const DESIGN_PLAN_TARGET_SCHEMA = {
  ...DESIGN_PLAN_TARGET_BASE_SCHEMA,
  properties: {
    ...DESIGN_PLAN_TARGET_BASE_SCHEMA.properties,
    qualityProfile: DESIGN_TARGET_QUALITY_PROFILE_SCHEMA,
  },
  required: [...DESIGN_PLAN_TARGET_BASE_SCHEMA.required, "qualityProfile"],
} as const;

const DESIGN_INTENT_SCHEMA = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      minLength: 8,
      maxLength: 500,
      pattern: "\\S",
    },
    audience: {
      type: "string",
      minLength: 8,
      maxLength: 500,
      pattern: "\\S",
    },
    primaryJob: {
      type: "string",
      minLength: 8,
      maxLength: 500,
      pattern: "\\S",
    },
    visualThesis: {
      type: "string",
      minLength: 16,
      maxLength: 1_000,
      pattern: "\\S",
    },
    signatureMotif: {
      type: "string",
      minLength: 16,
      maxLength: 1_000,
      pattern: "\\S",
    },
    typographyLanguage: {
      type: "string",
      minLength: 12,
      maxLength: 1_000,
      pattern: "\\S",
    },
    colorMaterialLanguage: {
      type: "string",
      minLength: 12,
      maxLength: 1_000,
      pattern: "\\S",
    },
    compositionTension: {
      type: "string",
      minLength: 12,
      maxLength: 1_000,
      pattern: "\\S",
    },
    antiPatterns: {
      type: "array",
      minItems: 3,
      maxItems: 12,
      uniqueItems: true,
      items: {
        type: "string",
        minLength: 8,
        maxLength: 256,
        pattern: "\\S",
      },
    },
  },
  required: [
    "subject",
    "audience",
    "primaryJob",
    "visualThesis",
    "signatureMotif",
    "typographyLanguage",
    "colorMaterialLanguage",
    "compositionTension",
    "antiPatterns",
  ],
  additionalProperties: false,
} as const;

export const DESIGN_LOGO_EXPLORATION_SCHEMA = {
  type: "object",
  description:
    "Optional for a requested multi-direction Logo exploration. Three genuinely different concept directions with stable editable roots and rendered monochrome plus 32/24/16 px evidence. Each thesis states the relevant brand meaning; each constructionLogic names the visible geometric mechanism, memorable silhouette/counterform anchor, and feature that survives at 16 px. Cosmetic variants and caption-dependent arbitrary shapes are invalid.",
  properties: {
    targetId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[^\\u0000-\\u001F\\u007F]+$",
    },
    directions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          conceptId: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[^\\u0000-\\u001F\\u007F]+$",
          },
          label: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            pattern: "\\S",
          },
          principle: { enum: [...LOGO_CONCEPT_PRINCIPLES] },
          thesis: {
            type: "string",
            minLength: 16,
            maxLength: 1_000,
            pattern: "\\S",
          },
          constructionLogic: {
            type: "string",
            minLength: 16,
            maxLength: 1_000,
            pattern: "\\S",
            description:
              "Causal meaning-to-form mechanism, including the memorable silhouette or counterform anchor and what remains recognizable at 16 px.",
          },
          rootNodeId: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            pattern: "^[^\\u0000-\\u001F\\u007F]+$",
          },
          monochromeNodeId: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            pattern: "^[^\\u0000-\\u001F\\u007F]+$",
          },
          smallSizeNodeIds: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            uniqueItems: true,
            description:
              "Stable evidence nodes ordered 32 px, 24 px, then 16 px.",
            items: {
              type: "string",
              minLength: 1,
              maxLength: 256,
              pattern: "^[^\\u0000-\\u001F\\u007F]+$",
            },
          },
        },
        required: [
          "conceptId",
          "label",
          "principle",
          "thesis",
          "constructionLogic",
          "rootNodeId",
          "monochromeNodeId",
          "smallSizeNodeIds",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["targetId", "directions"],
  additionalProperties: false,
} as const;

const DESIGN_PLAN_MODEL_INPUT_JSON_SCHEMA = {
  type: "object",
  description:
    "Current executable delivery plan. targets must match the user's requested scope exactly. designIntent must commit to a subject-grounded visual thesis and signature motif before drawing. Main binds the exact locally loaded UI skill bundle. briefFidelity preserves requested and inspected product semantics without invented capabilities, componentStrategy explicitly judges reusable semantic objects, and every target declares an executable qualityProfile.",
  properties: {
    version: { const: 1 },
    deliverable: {
      enum: [
        "ui",
        "poster",
        "logo",
        "brand-asset",
        "illustration",
        "presentation-visual",
        "other",
      ],
    },
    objective: {
      type: "string",
      minLength: 1,
      maxLength: 2_000,
      pattern: "\\S",
    },
    outputMode: { enum: ["editable-composition", "single-raster"] },
    targets: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: DESIGN_PLAN_TARGET_SCHEMA,
    },
    visualSystem: {
      type: "object",
      properties: {
        avoidances: {
          type: "array",
          minItems: 2,
          maxItems: 12,
          items: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            pattern: "\\S",
          },
        },
        formLanguage: {
          type: "string",
          minLength: 1,
          maxLength: 1_000,
          pattern: "\\S",
        },
        palette: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "\\S",
          },
        },
        surfaceAndDepth: {
          type: "string",
          minLength: 1,
          maxLength: 1_000,
          pattern: "\\S",
        },
        typography: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            pattern: "\\S",
          },
        },
        effects: {
          type: "array",
          maxItems: 12,
          items: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            pattern: "\\S",
          },
        },
      },
      required: [
        "avoidances",
        "formLanguage",
        "palette",
        "surfaceAndDepth",
        "typography",
        "effects",
      ],
      additionalProperties: false,
    },
    rasterAssetRoles: {
      type: "array",
      maxItems: 5,
      uniqueItems: true,
      description:
        "Raster evidence required by the chosen visual strategy. Use a placeable role when credibility depends on real people, activity, place, product, food, interior, material, or environment. Keep this empty for logos, diagrams, intentional vector illustration, or briefs that do not need raster evidence. The model must make this judgment from the subject and communication job; generic vector shapes are not photographic evidence.",
      items: {
        enum: [
          "reference",
          "background",
          "hero",
          "supporting-content",
          "final-single-image",
        ],
      },
    },
    componentStrategy: DESIGN_PLAN_COMPONENT_STRATEGY_SCHEMA,
    briefFidelity: DESIGN_BRIEF_FIDELITY_SCHEMA,
    designIntent: DESIGN_INTENT_SCHEMA,
    referenceStrategy: DESIGN_REFERENCE_STRATEGY_SCHEMA,
    logoOutputs: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
      description:
        "Optional Logo scope hint. When present, list only the concrete Logo/Icon outputs requested by the user; omission must not block drawing.",
      items: { enum: [...DESIGN_LOGO_OUTPUTS] },
    },
    logoExploration: DESIGN_LOGO_EXPLORATION_SCHEMA,
    singleRasterEvidence: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      pattern: "\\S",
      description:
        "Allowed only for one target when the user explicitly requests a single flattened image.",
    },
  },
  required: [
    "version",
    "deliverable",
    "objective",
    "outputMode",
    "targets",
    "visualSystem",
    "rasterAssetRoles",
    "componentStrategy",
    "briefFidelity",
    "designIntent",
  ],
  additionalProperties: false,
} as const;

export const DESIGN_PLAN_TOOL_INPUT_SCHEMA = executableJsonSchema(
  DESIGN_PLAN_MODEL_INPUT_JSON_SCHEMA,
);

export const DESIGN_PLAN_CANONICAL_INPUT_SCHEMA = executableJsonSchema({
  ...DESIGN_PLAN_MODEL_INPUT_JSON_SCHEMA,
  properties: {
    ...DESIGN_PLAN_MODEL_INPUT_JSON_SCHEMA.properties,
    skillRefs: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, maxLength: 128 },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  required: [...DESIGN_PLAN_MODEL_INPUT_JSON_SCHEMA.required, "skillRefs"],
});

export const DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA = {
  type: "object",
  description:
    "Current concrete critique of the most recent rendered capture. Evaluate every non-compensating visual criterion against the active deliverable-scoped Plan and host-bound critic revision. Every field must identify what the image actually shows and refinements must be actionable edits, not generic praise.",
  properties: {
    version: { const: 1 },
    briefFidelity: { type: "string", minLength: 12, maxLength: 1_000 },
    distinctiveness: { type: "string", minLength: 12, maxLength: 1_000 },
    signatureMotif: { type: "string", minLength: 12, maxLength: 1_000 },
    composition: { type: "string", minLength: 12, maxLength: 1_000 },
    hierarchy: { type: "string", minLength: 12, maxLength: 1_000 },
    typography: { type: "string", minLength: 12, maxLength: 1_000 },
    assetIntegration: { type: "string", minLength: 12, maxLength: 1_000 },
    formAndSurface: { type: "string", minLength: 12, maxLength: 1_000 },
    effects: { type: "string", minLength: 12, maxLength: 1_000 },
    antiTemplate: { type: "string", minLength: 12, maxLength: 1_000 },
    criteria: {
      type: "object",
      properties: Object.fromEntries(
        DESIGN_VISUAL_CRITERIA.map((criterion) => [
          criterion,
          { type: "string", minLength: 12, maxLength: 1_000 },
        ]),
      ),
      required: [...DESIGN_VISUAL_CRITERIA],
      additionalProperties: false,
    },
    failedCriteria: {
      type: "array",
      minItems: 2,
      maxItems: DESIGN_VISUAL_CRITERIA.length,
      uniqueItems: true,
      items: { enum: [...DESIGN_VISUAL_CRITERIA] },
    },
    refinements: {
      type: "array",
      minItems: 2,
      maxItems: 12,
      items: { type: "string", minLength: 8, maxLength: 500 },
    },
  },
  required: [
    "version",
    "briefFidelity",
    "distinctiveness",
    "signatureMotif",
    "composition",
    "hierarchy",
    "typography",
    "assetIntegration",
    "formAndSurface",
    "effects",
    "antiTemplate",
    "criteria",
    "failedCriteria",
    "refinements",
  ],
  additionalProperties: false,
} as const;

export type DesignPlanContractContext = { canonical?: boolean };

function parseDesignPlan(
  input: unknown,
  context: DesignPlanContractContext = {},
): ValidationResult<DesignPlanToolInput> {
  const canonicalInput = context.canonical === true;
  const modelInput = canonicalInput ? input : removeModelSkillRefs(input);
  const structureIssues = planSchemaIssues(
    canonicalInput
      ? DESIGN_PLAN_CANONICAL_INPUT_SCHEMA
      : DESIGN_PLAN_TOOL_INPUT_SCHEMA,
    modelInput,
    canonicalInput
      ? "design_plan.canonical_schema_invalid"
      : "design_plan.schema_invalid",
  );
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }

  const value = canonicalInput
    ? (structuredClone(modelInput) as DesignPlanToolInput)
    : bindDesignPlanHostContext(
        modelInput as Omit<DesignPlanToolInput, "skillRefs">,
      );
  const canonicalIssues = canonicalInput
    ? []
    : planSchemaIssues(
        DESIGN_PLAN_CANONICAL_INPUT_SCHEMA,
        value,
        "design_plan.host_binding_invalid",
      );
  if (canonicalIssues.length > 0) {
    return { ok: false, issues: canonicalIssues };
  }

  const domainIssues = refineDesignPlan(value);
  return domainIssues.length > 0
    ? { ok: false, issues: domainIssues }
    : { ok: true, value: structuredClone(value) };
}

export const DesignPlanContract = {
  schema: DESIGN_PLAN_TOOL_INPUT_SCHEMA,
  canonicalSchema: DESIGN_PLAN_CANONICAL_INPUT_SCHEMA,
  parse: parseDesignPlan,
  issues: (
    input: unknown,
    context: DesignPlanContractContext = {},
  ): ValidationIssue[] => {
    const result = parseDesignPlan(input, context);
    return result.ok ? [] : result.issues;
  },
} as const;

function removeModelSkillRefs(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const modelInput = { ...input };
  delete modelInput.skillRefs;
  return modelInput;
}

function bindDesignPlanHostContext(
  input: Omit<DesignPlanToolInput, "skillRefs">,
): DesignPlanToolInput {
  return {
    ...structuredClone(input),
    skillRefs: builtinDesignSkillRefsForDeliverable(input.deliverable),
  };
}

function planSchemaIssues(
  schema: TSchema,
  value: unknown,
  code: string,
): ValidationIssue[] {
  return schemaValidationIssues(schema, value)
    .slice(0, 32)
    .map((schemaIssue) => ({
      code,
      path: schemaIssue.path || "/",
      message: schemaIssue.message,
      recovery:
        "Correct the reported Plan field and submit one revised call; do not repeat unchanged arguments.",
    }));
}

function refineDesignPlan(input: DesignPlanToolInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (
    !isBuiltinDesignSkillRefsForDeliverable(input.deliverable, input.skillRefs)
  ) {
    issues.push(
      planIssue(
        "design_plan.host_skill_binding_invalid",
        "/skillRefs",
        "Host-bound design skills do not match the deliverable",
      ),
    );
  }

  refinePlanIntent(input.designIntent, issues);
  const targetIds = new Map<string, string>();
  const documentNodeIds = new Map<string, string>();
  for (const [targetIndex, target] of input.targets.entries()) {
    registerPlanId(
      targetIds,
      target.targetId,
      `/targets/${targetIndex}/targetId`,
      "design_plan.duplicate_target_id",
      "Target ID",
      issues,
    );
    registerPlanId(
      documentNodeIds,
      target.artboard.frameId,
      `/targets/${targetIndex}/artboard/frameId`,
      "design_plan.duplicate_document_node_id",
      "Frame or region node ID",
      issues,
    );
  }

  for (const [targetIndex, target] of input.targets.entries()) {
    refinePlanTarget(
      input.deliverable,
      target,
      targetIndex,
      documentNodeIds,
      issues,
    );
  }
  refinePlanComponentStrategy(
    input.componentStrategy,
    input.targets,
    documentNodeIds,
    issues,
  );
  refinePlanReferenceStrategy(input.referenceStrategy, issues);
  refinePlanLogo(input, targetIds, issues);
  refinePlanOutputMode(input, issues);
  return issues;
}

function refinePlanIntent(
  intent: DesignIntent,
  issues: ValidationIssue[],
): void {
  for (const [field, value] of [
    ["visualThesis", intent.visualThesis],
    ["signatureMotif", intent.signatureMotif],
    ["typographyLanguage", intent.typographyLanguage],
    ["colorMaterialLanguage", intent.colorMaterialLanguage],
    ["compositionTension", intent.compositionTension],
  ] as const) {
    if (!substantiveReviewText(value)) {
      issues.push(
        planIssue(
          "design_plan.intent_not_substantive",
          `/designIntent/${field}`,
          `${field} must describe a concrete visible design decision`,
        ),
      );
    }
  }
}

function refinePlanTarget(
  deliverable: DesignDeliverable,
  target: DesignPlanTarget,
  targetIndex: number,
  documentNodeIds: Map<string, string>,
  issues: ValidationIssue[],
): void {
  const expectedQualityKind = deliverable === "ui" ? "ui" : "graphic";
  if (target.qualityProfile.kind !== expectedQualityKind) {
    issues.push(
      planIssue(
        "design_plan.quality_profile_kind_mismatch",
        `/targets/${targetIndex}/qualityProfile/kind`,
        "Target quality profile does not match the Plan deliverable",
        expectedQualityKind,
        target.qualityProfile.kind,
      ),
    );
  }
  if (target.qualityProfile.kind === "ui") {
    const horizontal =
      target.qualityProfile.safeAreaInsets.left +
      target.qualityProfile.safeAreaInsets.right;
    const vertical =
      target.qualityProfile.safeAreaInsets.top +
      target.qualityProfile.safeAreaInsets.bottom;
    if (horizontal >= target.artboard.width) {
      issues.push(
        planIssue(
          "design_plan.safe_area_exceeds_artboard",
          `/targets/${targetIndex}/qualityProfile/safeAreaInsets`,
          "Horizontal safe-area insets must leave positive artboard content width",
          `< ${target.artboard.width}`,
          horizontal,
        ),
      );
    }
    if (vertical >= target.artboard.height) {
      issues.push(
        planIssue(
          "design_plan.safe_area_exceeds_artboard",
          `/targets/${targetIndex}/qualityProfile/safeAreaInsets`,
          "Vertical safe-area insets must leave positive artboard content height",
          `< ${target.artboard.height}`,
          vertical,
        ),
      );
    }
  }

  const localParents = new Map<string, { width: number; height: number }>([
    [target.artboard.frameId, target.artboard],
  ]);
  for (const [regionIndex, region] of target.composition.regions.entries()) {
    const path = `/targets/${targetIndex}/composition/regions/${regionIndex}`;
    registerPlanId(
      documentNodeIds,
      region.nodeId,
      `${path}/nodeId`,
      "design_plan.duplicate_document_node_id",
      "Frame or region node ID",
      issues,
    );
    const parentId = region.parentId ?? target.artboard.frameId;
    const parent = localParents.get(parentId);
    if (!parent) {
      issues.push(
        planIssue(
          "design_plan.region_parent_not_declared_first",
          `${path}/parentId`,
          "Region parent must be the target artboard or an earlier region in the same target",
          "artboard frameId or earlier region nodeId",
          parentId,
        ),
      );
    } else if (
      region.x + region.width > parent.width ||
      region.y + region.height > parent.height
    ) {
      issues.push(
        planIssue(
          "design_plan.region_out_of_parent_bounds",
          path,
          "Region bounds must fit inside its parent-local bounds",
          { width: parent.width, height: parent.height },
          {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          },
        ),
      );
    }
    if (!localParents.has(region.nodeId)) {
      localParents.set(region.nodeId, region);
    }
  }
}

function refinePlanComponentStrategy(
  strategy: DesignPlanComponentStrategy,
  targets: readonly DesignPlanTarget[],
  documentNodeIds: ReadonlyMap<string, string>,
  issues: ValidationIssue[],
): void {
  const targetOrder = new Map(
    targets.map((target, index) => [target.targetId, index]),
  );
  const decisionIds = new Map<string, string>();
  const componentIds = new Map<string, string>();
  const occurrenceNodeIds = new Map<string, string>();
  for (const [candidateIndex, candidate] of strategy.candidates.entries()) {
    const candidatePath = `/componentStrategy/candidates/${candidateIndex}`;
    registerPlanId(
      decisionIds,
      candidate.decisionId,
      `${candidatePath}/decisionId`,
      "design_plan.duplicate_component_decision_id",
      "Component decision ID",
      issues,
    );
    if (candidate.decision !== "ordinary") {
      registerPlanId(
        componentIds,
        candidate.componentId,
        `${candidatePath}/componentId`,
        "design_plan.duplicate_component_id",
        "Component ID",
        issues,
      );
    }
    const occurrences =
      candidate.decision === "ordinary"
        ? candidate.occurrences.map((occurrence, index) => ({
            occurrence,
            path: `${candidatePath}/occurrences/${index}`,
          }))
        : candidate.decision === "reuse-component"
          ? candidate.instances.map((occurrence, index) => ({
              occurrence,
              path: `${candidatePath}/instances/${index}`,
            }))
          : [
              { occurrence: candidate.main, path: `${candidatePath}/main` },
              ...candidate.instances.map((occurrence, index) => ({
                occurrence,
                path: `${candidatePath}/instances/${index}`,
              })),
            ];
    for (const { occurrence, path } of occurrences) {
      if (!targetOrder.has(occurrence.targetId)) {
        issues.push(
          planIssue(
            "design_plan.component_target_unknown",
            `${path}/targetId`,
            "Component occurrence must reference a declared Plan target",
            [...targetOrder.keys()],
            occurrence.targetId,
          ),
        );
      }
      registerPlanId(
        occurrenceNodeIds,
        occurrence.nodeId,
        `${path}/nodeId`,
        "design_plan.duplicate_component_occurrence_node_id",
        "Component occurrence node ID",
        issues,
      );
      if (documentNodeIds.has(occurrence.nodeId)) {
        issues.push(
          planIssue(
            "design_plan.component_occurrence_reuses_container_id",
            `${path}/nodeId`,
            "Component occurrence cannot reuse a delivery Frame or planned region ID",
            "a unique semantic node ID",
            occurrence.nodeId,
          ),
        );
      }
    }
    if (candidate.decision === "component") {
      const mainIndex = targetOrder.get(candidate.main.targetId);
      if (mainIndex !== undefined) {
        for (const [instanceIndex, instance] of candidate.instances.entries()) {
          const instanceTargetIndex = targetOrder.get(instance.targetId);
          if (
            instanceTargetIndex !== undefined &&
            instanceTargetIndex < mainIndex
          ) {
            issues.push(
              planIssue(
                "design_plan.component_instance_precedes_main",
                `${candidatePath}/instances/${instanceIndex}/targetId`,
                "A newly created Component Main must be declared no later than its Instances",
                `target index >= ${mainIndex}`,
                instanceTargetIndex,
              ),
            );
          }
        }
      }
    }
  }
}

function refinePlanReferenceStrategy(
  strategy: DesignReferenceStrategy | undefined,
  issues: ValidationIssue[],
): void {
  if (!strategy) return;
  const attachmentIds = new Map<string, string>();
  let activeReferences = 0;
  for (const [referenceIndex, reference] of strategy.references.entries()) {
    registerPlanId(
      attachmentIds,
      reference.attachmentId,
      `/referenceStrategy/references/${referenceIndex}/attachmentId`,
      "design_plan.duplicate_reference_attachment",
      "Reference attachment ID",
      issues,
    );
    if (isActiveVisualReferenceDecision(reference.decision)) {
      activeReferences += 1;
    }
  }
  if (activeReferences > MAX_ACTIVE_VISUAL_REFERENCES) {
    issues.push(
      planIssue(
        "design_plan.active_reference_limit_exceeded",
        "/referenceStrategy/references",
        "Too many active visual references",
        MAX_ACTIVE_VISUAL_REFERENCES,
        activeReferences,
      ),
    );
  }
}

function refinePlanLogo(
  input: DesignPlanToolInput,
  targetIds: ReadonlyMap<string, string>,
  issues: ValidationIssue[],
): void {
  if (input.logoOutputs !== undefined && input.deliverable !== "logo") {
    issues.push(
      planIssue(
        "design_plan.logo_outputs_wrong_deliverable",
        "/logoOutputs",
        "Logo outputs are only valid for a logo deliverable",
        "logo",
        input.deliverable,
      ),
    );
  }
  const exploration = input.logoExploration;
  if (!exploration) return;
  if (input.deliverable !== "logo") {
    issues.push(
      planIssue(
        "design_plan.logo_exploration_wrong_deliverable",
        "/logoExploration",
        "Logo exploration is only valid for a logo deliverable",
        "logo",
        input.deliverable,
      ),
    );
  }
  if (!targetIds.has(exploration.targetId)) {
    issues.push(
      planIssue(
        "design_plan.logo_exploration_target_unknown",
        "/logoExploration/targetId",
        "Logo exploration must reference a declared target",
        [...targetIds.keys()],
        exploration.targetId,
      ),
    );
  }
  const principles = new Map<string, string>();
  const semanticAndEvidenceIds = new Map<string, string>();
  for (const [directionIndex, direction] of exploration.directions.entries()) {
    const path = `/logoExploration/directions/${directionIndex}`;
    registerPlanId(
      principles,
      direction.principle,
      `${path}/principle`,
      "design_plan.duplicate_logo_principle",
      "Logo concept principle",
      issues,
    );
    for (const [field, id] of [
      ["conceptId", direction.conceptId],
      ["rootNodeId", direction.rootNodeId],
      ["monochromeNodeId", direction.monochromeNodeId],
      ...direction.smallSizeNodeIds.map(
        (nodeId, index) => [`smallSizeNodeIds/${index}`, nodeId] as const,
      ),
    ] as const) {
      registerPlanId(
        semanticAndEvidenceIds,
        id,
        `${path}/${field}`,
        "design_plan.duplicate_logo_semantic_or_evidence_id",
        "Logo semantic or evidence ID",
        issues,
      );
    }
  }
}

function refinePlanOutputMode(
  input: DesignPlanToolInput,
  issues: ValidationIssue[],
): void {
  const finalRasterDeclared =
    input.rasterAssetRoles.includes("final-single-image");
  if (input.outputMode === "single-raster") {
    if (input.targets.length !== 1) {
      issues.push(
        planIssue(
          "design_plan.single_raster_target_count_invalid",
          "/targets",
          "Single-raster output requires exactly one delivery target",
          1,
          input.targets.length,
        ),
      );
    }
    if (!input.singleRasterEvidence) {
      issues.push(
        planIssue(
          "design_plan.single_raster_evidence_required",
          "/singleRasterEvidence",
          "Single-raster output requires explicit user-request evidence",
        ),
      );
    }
    if (!finalRasterDeclared) {
      issues.push(
        planIssue(
          "design_plan.single_raster_role_required",
          "/rasterAssetRoles",
          "Single-raster output requires the final-single-image role",
        ),
      );
    }
    if (input.componentStrategy.candidates.length > 0) {
      issues.push(
        planIssue(
          "design_plan.single_raster_components_not_permitted",
          "/componentStrategy/candidates",
          "Single-raster output cannot declare editable Component candidates",
          0,
          input.componentStrategy.candidates.length,
        ),
      );
    }
    return;
  }
  if (input.singleRasterEvidence !== undefined) {
    issues.push(
      planIssue(
        "design_plan.single_raster_evidence_not_permitted",
        "/singleRasterEvidence",
        "Editable composition cannot include single-raster evidence",
      ),
    );
  }
  if (finalRasterDeclared) {
    issues.push(
      planIssue(
        "design_plan.final_single_image_role_not_permitted",
        "/rasterAssetRoles",
        "Editable composition cannot declare the final-single-image role",
      ),
    );
  }
}

function registerPlanId(
  seen: Map<string, string>,
  id: string,
  path: string,
  code: string,
  label: string,
  issues: ValidationIssue[],
): void {
  const firstPath = seen.get(id);
  if (firstPath) {
    issues.push(
      planIssue(
        code,
        path,
        `${label} ${id} duplicates ${firstPath}`,
        "unique ID",
        id,
      ),
    );
    return;
  }
  seen.set(id, path);
}

function planIssue(
  code: string,
  path: string,
  message: string,
  expected?: ValidationIssueValue,
  actual?: ValidationIssueValue,
): ValidationIssue {
  return {
    code,
    path,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
    recovery:
      "Correct the reported Plan relationship and submit one revised call; do not repeat unchanged arguments.",
  };
}

export function designPlanTargets(
  plan: DesignPlanToolInput,
): DesignPlanTarget[] {
  return structuredClone(plan.targets);
}

export function designPlanComponentStrategy(
  plan: DesignPlanToolInput,
): DesignPlanComponentStrategy {
  return structuredClone(plan.componentStrategy);
}

export function designPlanBriefFidelity(
  plan: DesignPlanToolInput,
): DesignBriefFidelity {
  return structuredClone(plan.briefFidelity);
}

export function designPlanDesignIntent(
  plan: DesignPlanToolInput,
): DesignIntent {
  return structuredClone(plan.designIntent);
}

export function designPlanReferenceStrategy(
  plan: DesignPlanToolInput,
): DesignReferenceStrategy | undefined {
  return plan.referenceStrategy === undefined
    ? undefined
    : structuredClone(plan.referenceStrategy);
}

export function designPlanSkillRefs(
  plan: DesignPlanToolInput,
): BuiltinDesignSkillRef[] {
  return structuredClone(plan.skillRefs);
}

export function designPlanLogoExploration(
  plan: DesignPlanToolInput,
): DesignLogoExploration | undefined {
  return plan.logoExploration === undefined
    ? undefined
    : structuredClone(plan.logoExploration);
}

export function isDesignVisualReviewToolInput(
  input: unknown,
): input is DesignVisualReviewToolInput {
  if (!isRecord(input)) return false;
  const criteria = input.criteria;
  if (
    input.version !== 1 ||
    !isKnownBuiltinDesignSkillRefs(input.skillRefs) ||
    !substantiveReviewText(input.briefFidelity) ||
    !substantiveReviewText(input.distinctiveness) ||
    !substantiveReviewText(input.signatureMotif) ||
    !substantiveReviewText(input.composition) ||
    !substantiveReviewText(input.hierarchy) ||
    !substantiveReviewText(input.typography) ||
    !substantiveReviewText(input.assetIntegration) ||
    !substantiveReviewText(input.formAndSurface) ||
    !substantiveReviewText(input.effects) ||
    !substantiveReviewText(input.antiTemplate) ||
    !isRecord(criteria) ||
    !DESIGN_VISUAL_CRITERIA.every((criterion) =>
      substantiveReviewText(criteria[criterion]),
    ) ||
    !exactKeys(criteria, DESIGN_VISUAL_CRITERIA) ||
    !Array.isArray(input.failedCriteria) ||
    input.failedCriteria.length < 2 ||
    input.failedCriteria.length > DESIGN_VISUAL_CRITERIA.length ||
    !input.failedCriteria.every((criterion) =>
      DESIGN_VISUAL_CRITERIA.includes(criterion as DesignVisualCriterion),
    ) ||
    new Set(input.failedCriteria).size !== input.failedCriteria.length ||
    !boundedTextArray(input.refinements, 2, 12, 500) ||
    !input.refinements.every((item) => item.trim().length >= 8)
  ) {
    return false;
  }
  return exactKeys(input, [
    "version",
    "skillRefs",
    "briefFidelity",
    "distinctiveness",
    "signatureMotif",
    "composition",
    "hierarchy",
    "typography",
    "assetIntegration",
    "formAndSurface",
    "effects",
    "antiTemplate",
    "criteria",
    "failedCriteria",
    "refinements",
  ]);
}

export function normalizeDesignVisualReviewToolInput(
  input: unknown,
): DesignVisualReviewToolInput | undefined {
  if (!isRecord(input)) return undefined;
  const candidate =
    input.skillRefs === undefined
      ? {
          ...input,
          skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
            ...reference,
          })),
        }
      : input;
  return isDesignVisualReviewToolInput(candidate)
    ? structuredClone(candidate)
    : undefined;
}

export function isRasterAssetRole(value: unknown): value is RasterAssetRole {
  return (
    value === "reference" ||
    value === "background" ||
    value === "hero" ||
    value === "supporting-content" ||
    value === "final-single-image"
  );
}

export function isPlaceableRasterAssetRole(
  value: unknown,
): value is PlaceableRasterAssetRole {
  return isRasterAssetRole(value) && value !== "reference";
}
