import {
  builtinDesignSkillRefsForDeliverable,
  BUILTIN_UI_DESIGN_SKILL_REFS,
  isBuiltinDesignSkillRefsForDeliverable,
  isKnownBuiltinDesignSkillRefs,
  type BuiltinDesignSkillRef,
} from "@opendesign/design-skills";
import {
  DESIGN_BRIEF_FIDELITY_SCHEMA,
  isDesignBriefFidelity,
  type DesignBriefFidelity,
} from "./design-brief-fidelity";
import {
  componentStrategyOccurrencesForTarget,
  DESIGN_PLAN_COMPONENT_STRATEGY_SCHEMA,
  isDesignPlanComponentStrategy,
  type DesignPlanComponentStrategy,
} from "./design-plan-component-strategy";
import {
  DESIGN_TARGET_QUALITY_PROFILE_SCHEMA,
  isDesignTargetQualityProfile,
  type DesignTargetQualityProfile,
} from "./design-plan-quality-profile";
import {
  boundedText,
  boundedTextArray,
  exactKeys,
  finite,
  finiteBounded,
  isRecord,
  positiveBounded,
  safeId,
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
  skillRefs: BuiltinDesignSkillRef[];
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
    frameId: { type: "string", minLength: 1, maxLength: 256 },
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
    direction: { type: "string", minLength: 1, maxLength: 1_000 },
    hierarchy: {
      type: "array",
      minItems: 2,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    regions: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      description:
        "Major composition regions in artboard-local coordinates. Each nodeId must later become a direct Group or Frame child of this target artboard.",
      items: {
        type: "object",
        properties: {
          nodeId: { type: "string", minLength: 1, maxLength: 256 },
          name: { type: "string", minLength: 1, maxLength: 128 },
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
      description:
        "How native shapes, vectors, typography, and any raster imagery form one editable composition. State an intentional no-raster strategy when appropriate.",
    },
    spacingRhythm: { type: "string", minLength: 1, maxLength: 500 },
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
    targetId: { type: "string", minLength: 1, maxLength: 128 },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    objective: { type: "string", minLength: 1, maxLength: 2_000 },
    artboard: DESIGN_PLAN_ARTBOARD_SCHEMA,
    composition: DESIGN_PLAN_COMPOSITION_SCHEMA,
    editableLayers: {
      type: "array",
      minItems: 2,
      maxItems: 24,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    implementationSteps: {
      type: "array",
      minItems: 2,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    validationChecks: {
      type: "array",
      minItems: 2,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 500 },
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
    subject: { type: "string", minLength: 8, maxLength: 500 },
    audience: { type: "string", minLength: 8, maxLength: 500 },
    primaryJob: { type: "string", minLength: 8, maxLength: 500 },
    visualThesis: { type: "string", minLength: 16, maxLength: 1_000 },
    signatureMotif: { type: "string", minLength: 16, maxLength: 1_000 },
    typographyLanguage: { type: "string", minLength: 12, maxLength: 1_000 },
    colorMaterialLanguage: {
      type: "string",
      minLength: 12,
      maxLength: 1_000,
    },
    compositionTension: {
      type: "string",
      minLength: 12,
      maxLength: 1_000,
    },
    antiPatterns: {
      type: "array",
      minItems: 3,
      maxItems: 12,
      uniqueItems: true,
      items: { type: "string", minLength: 8, maxLength: 256 },
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
    "Required when deliverable=logo. Three genuinely different concept directions with stable editable roots and rendered monochrome plus 32/24/16 px evidence. Cosmetic variants of one letterform are invalid.",
  properties: {
    targetId: { type: "string", minLength: 1, maxLength: 128 },
    directions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          conceptId: { type: "string", minLength: 1, maxLength: 128 },
          label: { type: "string", minLength: 1, maxLength: 256 },
          principle: { enum: [...LOGO_CONCEPT_PRINCIPLES] },
          thesis: { type: "string", minLength: 16, maxLength: 1_000 },
          constructionLogic: {
            type: "string",
            minLength: 16,
            maxLength: 1_000,
          },
          rootNodeId: { type: "string", minLength: 1, maxLength: 256 },
          monochromeNodeId: { type: "string", minLength: 1, maxLength: 256 },
          smallSizeNodeIds: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            uniqueItems: true,
            description:
              "Stable evidence nodes ordered 32 px, 24 px, then 16 px.",
            items: { type: "string", minLength: 1, maxLength: 256 },
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

export const DESIGN_PLAN_TOOL_INPUT_SCHEMA = {
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
    objective: { type: "string", minLength: 1, maxLength: 2_000 },
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
          items: { type: "string", minLength: 1, maxLength: 256 },
        },
        formLanguage: { type: "string", minLength: 1, maxLength: 1_000 },
        palette: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 128 },
        },
        surfaceAndDepth: {
          type: "string",
          minLength: 1,
          maxLength: 1_000,
        },
        typography: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: { type: "string", minLength: 1, maxLength: 256 },
        },
        effects: {
          type: "array",
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 256 },
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
    logoExploration: DESIGN_LOGO_EXPLORATION_SCHEMA,
    singleRasterEvidence: {
      type: "string",
      minLength: 1,
      maxLength: 200,
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

export function isDesignPlanToolInput(
  input: unknown,
): input is DesignPlanToolInput {
  if (!isRecord(input)) return false;
  if (
    input.version !== 1 ||
    !isDesignDeliverable(input.deliverable) ||
    !boundedText(input.objective, 2_000) ||
    (input.outputMode !== "editable-composition" &&
      input.outputMode !== "single-raster") ||
    !Array.isArray(input.targets) ||
    input.targets.length < 1 ||
    input.targets.length > 32 ||
    !input.targets.every(isDesignPlanTarget) ||
    !isDesignPlanVisualSystem(input.visualSystem) ||
    !Array.isArray(input.rasterAssetRoles) ||
    input.rasterAssetRoles.length > 5 ||
    !input.rasterAssetRoles.every(isRasterAssetRole) ||
    new Set(input.rasterAssetRoles).size !== input.rasterAssetRoles.length ||
    !isDesignPlanComponentStrategy(
      input.componentStrategy,
      input.targets.map((target) => target.targetId),
    ) ||
    !isDesignBriefFidelity(input.briefFidelity) ||
    !isDesignIntent(input.designIntent) ||
    !isBuiltinDesignSkillRefsForDeliverable(
      input.deliverable,
      input.skillRefs,
    ) ||
    !exactKeys(input, [
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
      "skillRefs",
      ...(input.logoExploration === undefined ? [] : ["logoExploration"]),
      ...(input.singleRasterEvidence === undefined
        ? []
        : ["singleRasterEvidence"]),
    ])
  ) {
    return false;
  }
  const targets = input.targets;
  const componentStrategy = input.componentStrategy;
  if (
    input.deliverable === "logo"
      ? !isDesignLogoExploration(input.logoExploration, targets)
      : input.logoExploration !== undefined
  ) {
    return false;
  }
  if (
    targets.some((target) =>
      input.deliverable === "ui"
        ? target.qualityProfile.kind !== "ui"
        : target.qualityProfile.kind !== "graphic",
    )
  ) {
    return false;
  }
  if (
    new Set(targets.map((target) => target.targetId)).size !== targets.length ||
    new Set(targets.map((target) => target.artboard.frameId)).size !==
      targets.length ||
    new Set(
      targets.flatMap((target) =>
        target.composition.regions.map((region) => region.nodeId),
      ),
    ).size !==
      targets.reduce(
        (count, target) => count + target.composition.regions.length,
        0,
      ) ||
    targets.some((target) =>
      targets.some(
        (candidate) =>
          candidate.targetId !== target.targetId &&
          candidate.composition.regions.some(
            (region) => region.nodeId === target.artboard.frameId,
          ),
      ),
    )
  ) {
    return false;
  }
  if (
    targets.some((target) =>
      componentStrategyOccurrencesForTarget(
        componentStrategy,
        target.targetId,
      ).some((occurrence) => occurrence.nodeId === target.artboard.frameId),
    )
  ) {
    return false;
  }
  if (input.outputMode === "single-raster") {
    return (
      targets.length === 1 &&
      boundedText(input.singleRasterEvidence, 200) &&
      input.rasterAssetRoles.includes("final-single-image") &&
      componentStrategy.candidates.length === 0
    );
  }
  return (
    input.singleRasterEvidence === undefined &&
    !input.rasterAssetRoles.includes("final-single-image")
  );
}

export function normalizeDesignPlanToolInput(
  input: unknown,
): DesignPlanToolInput | undefined {
  if (!isRecord(input)) return undefined;
  if (!isDesignDeliverable(input.deliverable)) return undefined;
  const skillRefs = builtinDesignSkillRefsForDeliverable(input.deliverable);
  const modelInput = { ...input };
  delete modelInput.skillRefs;
  const candidate = { ...modelInput, skillRefs };
  return isDesignPlanToolInput(candidate)
    ? structuredClone(candidate)
    : undefined;
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

function isDesignDeliverable(value: unknown): value is DesignDeliverable {
  return (
    value === "ui" ||
    value === "poster" ||
    value === "logo" ||
    value === "brand-asset" ||
    value === "illustration" ||
    value === "presentation-visual" ||
    value === "other"
  );
}

function isDesignIntent(value: unknown): value is DesignIntent {
  return (
    isRecord(value) &&
    boundedText(value.subject, 500) &&
    value.subject.trim().length >= 8 &&
    boundedText(value.audience, 500) &&
    value.audience.trim().length >= 8 &&
    boundedText(value.primaryJob, 500) &&
    value.primaryJob.trim().length >= 8 &&
    substantiveReviewText(value.visualThesis) &&
    substantiveReviewText(value.signatureMotif) &&
    substantiveReviewText(value.typographyLanguage) &&
    substantiveReviewText(value.colorMaterialLanguage) &&
    substantiveReviewText(value.compositionTension) &&
    boundedTextArray(value.antiPatterns, 3, 12, 256) &&
    value.antiPatterns.every((item) => item.trim().length >= 8) &&
    new Set(value.antiPatterns).size === value.antiPatterns.length &&
    exactKeys(value, [
      "subject",
      "audience",
      "primaryJob",
      "visualThesis",
      "signatureMotif",
      "typographyLanguage",
      "colorMaterialLanguage",
      "compositionTension",
      "antiPatterns",
    ])
  );
}

export function isDesignLogoExploration(
  value: unknown,
  targets: readonly Pick<DesignPlanTarget, "targetId">[],
): value is DesignLogoExploration {
  if (
    !isRecord(value) ||
    !safeId(value.targetId) ||
    !targets.some((target) => target.targetId === value.targetId) ||
    !Array.isArray(value.directions) ||
    value.directions.length !== 3 ||
    !exactKeys(value, ["targetId", "directions"])
  ) {
    return false;
  }
  const ids = new Set<string>();
  const principles = new Set<string>();
  for (const direction of value.directions) {
    if (
      !isRecord(direction) ||
      !safeId(direction.conceptId) ||
      !boundedText(direction.label, 256) ||
      !LOGO_CONCEPT_PRINCIPLES.includes(
        direction.principle as (typeof LOGO_CONCEPT_PRINCIPLES)[number],
      ) ||
      !substantiveReviewText(direction.thesis) ||
      !substantiveReviewText(direction.constructionLogic) ||
      !safeId(direction.rootNodeId) ||
      !safeId(direction.monochromeNodeId) ||
      !Array.isArray(direction.smallSizeNodeIds) ||
      direction.smallSizeNodeIds.length !== 3 ||
      !direction.smallSizeNodeIds.every((nodeId) => safeId(nodeId)) ||
      new Set(direction.smallSizeNodeIds).size !== 3 ||
      !exactKeys(direction, [
        "conceptId",
        "label",
        "principle",
        "thesis",
        "constructionLogic",
        "rootNodeId",
        "monochromeNodeId",
        "smallSizeNodeIds",
      ])
    ) {
      return false;
    }
    const principle = String(direction.principle);
    if (principles.has(principle)) return false;
    principles.add(principle);
    for (const id of [
      direction.conceptId,
      direction.rootNodeId,
      direction.monochromeNodeId,
      ...direction.smallSizeNodeIds,
    ]) {
      if (ids.has(id)) return false;
      ids.add(id);
    }
  }
  return true;
}

function isDesignPlanTarget(value: unknown): value is DesignPlanTarget {
  if (!isRecord(value)) return false;
  const artboard = value.artboard;
  const composition = value.composition;
  return (
    safeId(value.targetId) &&
    boundedText(value.label, 256) &&
    safeId(value.pageId) &&
    boundedText(value.objective, 2_000) &&
    isDesignPlanArtboard(artboard) &&
    isRecord(composition) &&
    boundedText(composition.direction, 1_000) &&
    boundedTextArray(composition.hierarchy, 2, 16, 256) &&
    Array.isArray(composition.regions) &&
    composition.regions.length >= 1 &&
    composition.regions.length <= 16 &&
    composition.regions.every((region) =>
      isDesignPlanRegion(region, artboard.width, artboard.height),
    ) &&
    !composition.regions.some(
      (region) => isRecord(region) && region.nodeId === artboard.frameId,
    ) &&
    new Set(
      composition.regions.flatMap((region) =>
        isRecord(region) && typeof region.nodeId === "string"
          ? [region.nodeId]
          : [],
      ),
    ).size === composition.regions.length &&
    boundedText(composition.assetIntegration, 1_000) &&
    boundedText(composition.spacingRhythm, 500) &&
    exactKeys(composition, [
      "direction",
      "hierarchy",
      "regions",
      "assetIntegration",
      "spacingRhythm",
    ]) &&
    boundedTextArray(value.editableLayers, 2, 24, 256) &&
    boundedTextArray(value.implementationSteps, 2, 16, 500) &&
    boundedTextArray(value.validationChecks, 2, 16, 500) &&
    isDesignTargetQualityProfile(value.qualityProfile, {
      width: artboard.width,
      height: artboard.height,
    }) &&
    exactKeys(value, [
      "targetId",
      "label",
      "pageId",
      "objective",
      "artboard",
      "composition",
      "editableLayers",
      "implementationSteps",
      "validationChecks",
      "qualityProfile",
    ])
  );
}

function isDesignPlanArtboard(value: unknown): value is DesignPlanArtboard {
  return (
    isRecord(value) &&
    (value.mode === "create" || value.mode === "existing") &&
    safeId(value.frameId) &&
    finiteBounded(value.x, 1_000_000) &&
    finiteBounded(value.y, 1_000_000) &&
    positiveBounded(value.width, 100_000) &&
    positiveBounded(value.height, 100_000) &&
    exactKeys(value, ["mode", "frameId", "x", "y", "width", "height"])
  );
}

function isDesignPlanVisualSystem(
  value: unknown,
): value is DesignPlanVisualSystem {
  return (
    isRecord(value) &&
    boundedTextArray(value.avoidances, 2, 12, 256) &&
    boundedText(value.formLanguage, 1_000) &&
    boundedTextArray(value.palette, 1, 12, 128) &&
    boundedText(value.surfaceAndDepth, 1_000) &&
    boundedTextArray(value.typography, 1, 8, 256) &&
    boundedTextArray(value.effects, 0, 12, 256) &&
    exactKeys(value, [
      "avoidances",
      "formLanguage",
      "palette",
      "surfaceAndDepth",
      "typography",
      "effects",
    ])
  );
}

function isDesignPlanRegion(
  value: unknown,
  artboardWidth: number,
  artboardHeight: number,
): value is DesignPlanRegion {
  return (
    isRecord(value) &&
    safeId(value.nodeId) &&
    boundedText(value.name, 128) &&
    isDesignPlanRegionRole(value.role) &&
    finite(value.x) &&
    finite(value.y) &&
    value.x >= 0 &&
    value.y >= 0 &&
    positiveBounded(value.width, 100_000) &&
    positiveBounded(value.height, 100_000) &&
    value.x + value.width <= artboardWidth &&
    value.y + value.height <= artboardHeight &&
    exactKeys(value, ["nodeId", "name", "role", "x", "y", "width", "height"])
  );
}

function isDesignPlanRegionRole(value: unknown): value is DesignPlanRegionRole {
  return (
    value === "structure" ||
    value === "content" ||
    value === "typography" ||
    value === "media" ||
    value === "graphic" ||
    value === "decoration" ||
    value === "interaction" ||
    value === "other"
  );
}
