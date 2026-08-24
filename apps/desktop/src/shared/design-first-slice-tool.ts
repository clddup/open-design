import {
  schemaValidationIssues,
  type TSchema,
} from "@opendesign/design-contracts";
import {
  builtinDesignSkillRefsForDeliverable,
  isBuiltinDesignSkillRefsForDeliverable,
  type BuiltinDesignSkillRef,
} from "@opendesign/design-skills";
import {
  type ValidationIssue,
  type ValidationIssueValue,
  type ValidationResult,
} from "./contract-validation";
import type { DesignIntent, RasterAssetRole } from "./design-agent-tools";
import type {
  LOGO_CONCEPT_PRINCIPLES,
  DesignLogoOutput,
} from "./design-agent-plan-review";
import type { DesignBriefFidelity } from "./design-brief-fidelity";
import { DESIGN_FIRST_SLICE_MAX_ELEMENTS } from "./design-first-slice-budget";
import { compileValidatedDesignFirstSliceToolInput } from "./design-first-slice-compiler";
import {
  DESIGN_FIRST_SLICE_CANONICAL_INPUT_SCHEMA,
  DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
  type DesignFirstSliceCanonicalInput,
  type DesignFirstSliceElementInput,
  type DesignFirstSliceModelInput,
} from "./design-first-slice-tool-schema";
import {
  isActiveVisualReferenceDecision,
  MAX_ACTIVE_VISUAL_REFERENCES,
  type DesignReferenceStrategy,
} from "./design-reference-strategy";

export { DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA } from "./design-first-slice-tool-schema";
export {
  DESIGN_FIRST_SLICE_MAX_ELEMENTS,
  DESIGN_FIRST_SLICE_MAX_STAGES,
} from "./design-first-slice-budget";

type CompactPaint = {
  color: string;
  opacity?: number;
};

type CompactStroke = CompactPaint & { width: number };

type CompactElementBase = {
  id: string;
  name: string;
  parentId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
};

export type DesignFirstSliceElement =
  | (CompactElementBase & { kind: "group" })
  | (CompactElementBase & {
      kind: "frame";
      fill?: CompactPaint;
      stroke?: CompactStroke;
      cornerRadius?: number;
      clipsContent?: boolean;
    })
  | (CompactElementBase & {
      kind: "rectangle";
      fill: CompactPaint;
      stroke?: CompactStroke;
      cornerRadius?: number;
    })
  | (CompactElementBase & {
      kind: "ellipse";
      fill: CompactPaint;
      stroke?: CompactStroke;
    })
  | (CompactElementBase & {
      kind: "path";
      path: string;
      fill: CompactPaint;
    })
  | (CompactElementBase & {
      kind: "text";
      text: {
        content: string;
        fontFamily: string;
        fontStyleName: string;
        fontWeight: number;
        fontSlant: "normal" | "italic";
        fontSize: number;
        lineHeight: number;
        letterSpacing?: number;
        color: string;
        textResize: "auto-width" | "auto-height" | "fixed";
        align?: "left" | "center" | "right" | "justify";
      };
    });

export type DesignFirstSliceQualityProfile =
  | { kind: "graphic" }
  | {
      kind: "ui";
      platform:
        "web" | "macos" | "windows" | "ios" | "ipados" | "android" | "other";
      input: "pointer" | "touch" | "mixed";
      insets: [number, number, number, number];
      safeNodeIds: string[];
      hitNodeIds: string[];
    };

export type DesignFirstSliceToolInput = {
  version: 1;
  deliverable:
    | "ui"
    | "poster"
    | "logo"
    | "brand-asset"
    | "illustration"
    | "presentation-visual"
    | "other";
  objective: string;
  designIntent: DesignIntent;
  referenceStrategy?: DesignReferenceStrategy;
  skillRefs: BuiltinDesignSkillRef[];
  briefFidelity: DesignBriefFidelity;
  targets: Array<{
    targetId: string;
    label: string;
    pageId: string;
    objective: string;
    frame: {
      frameId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
    layout: string;
    spacing: string;
    qualityProfile: DesignFirstSliceQualityProfile;
    regions: Array<{
      nodeId: string;
      name: string;
      role:
        | "structure"
        | "content"
        | "typography"
        | "media"
        | "graphic"
        | "decoration"
        | "interaction"
        | "other";
      parentId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }>;
  visualSystem: {
    formLanguage: string;
    palette: string[];
    surfaceAndDepth: string;
    typography: string[];
    effects?: string[];
  };
  rasterAssetRoles: RasterAssetRole[];
  logoOutputs?: DesignLogoOutput[];
  logoExploration?: {
    targetId: string;
    directions: Array<{
      conceptId: string;
      principle: (typeof LOGO_CONCEPT_PRINCIPLES)[number];
      thesis: string;
      constructionLogic: string;
      rootNodeId: string;
      evidenceNodeIds: [string, string, string, string];
    }>;
  };
  semanticObjects?: Array<
    | {
        decisionId: string;
        label: string;
        decision: "ordinary";
        occurrences: Array<{ targetId: string; nodeId: string }>;
      }
    | {
        decisionId: string;
        label: string;
        decision: "component";
        componentId: string;
        main: { targetId: string; nodeId: string };
        instances: Array<{ targetId: string; nodeId: string }>;
      }
    | {
        decisionId: string;
        label: string;
        decision: "reuse-component";
        componentId: string;
        instances: Array<{ targetId: string; nodeId: string }>;
      }
  >;
  firstSlice: {
    targetId: string;
    label: string;
    stages: Array<{
      stageId: string;
      label: string;
      elements: DesignFirstSliceElement[];
    }>;
  };
};

export type FirstSliceContractContext = {
  authoritativePrompt?: string;
};

function parseFirstSlice(
  input: unknown,
  context: FirstSliceContractContext = {},
): ValidationResult<DesignFirstSliceToolInput> {
  const modelIssues = schemaIssues(
    DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
    input,
    "first_slice.schema_invalid",
  );
  if (modelIssues.length > 0) return { ok: false, issues: modelIssues };

  const canonical = bindFirstSliceHostContext(
    structuredClone(input) as DesignFirstSliceModelInput,
    context,
  );
  const canonicalIssues = schemaIssues(
    DESIGN_FIRST_SLICE_CANONICAL_INPUT_SCHEMA,
    canonical,
    "first_slice.host_binding_invalid",
  );
  if (canonicalIssues.length > 0) {
    return { ok: false, issues: canonicalIssues };
  }
  const value = canonical as DesignFirstSliceCanonicalInput;
  const domainIssues = refineFirstSlice(value);
  return domainIssues.length > 0
    ? { ok: false, issues: domainIssues }
    : {
        ok: true,
        value: structuredClone(value) as DesignFirstSliceToolInput,
      };
}

export const FirstSliceContract = {
  schema: DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
  parse: parseFirstSlice,
  issues: (input: unknown): ValidationIssue[] => {
    const result = parseFirstSlice(input);
    return result.ok ? [] : result.issues;
  },
} as const;

export function logoBriefRequiresExploration(prompt: string): boolean {
  return (
    /(?:3|三)\s*(?:个|套|种|条)?\s*(?:真正|明显|完全)?\s*(?:不同|独立|差异化)?\s*(?:的)?\s*(?:logo\s*)?(?:设计)?(?:方向|方案|概念)/iu.test(
      prompt,
    ) ||
    /\b(?:three|3)\s+(?:(?:genuinely|truly|visibly|materially|distinct|different)\s+)*(?:logo\s+)?(?:directions?|concepts?|options?)\b/iu.test(
      prompt,
    )
  );
}

function bindFirstSliceHostContext(
  input: DesignFirstSliceModelInput,
  context: FirstSliceContractContext,
): unknown {
  const objective = input.objective.trim();
  return {
    ...input,
    designIntent: structuredClone(input.designIntent),
    skillRefs: builtinDesignSkillRefsForDeliverable(input.deliverable),
    briefFidelity: defaultBriefFidelity(
      context.authoritativePrompt ?? objective,
    ),
    targets: input.targets.map((target) =>
      bindFirstSliceTarget(target, input.deliverable),
    ),
    visualSystem: structuredClone(input.visualSystem),
    rasterAssetRoles: [...input.rasterAssetRoles],
    ...(input.semanticObjects === undefined
      ? {}
      : { semanticObjects: structuredClone(input.semanticObjects) }),
  };
}

function bindFirstSliceTarget(
  target: DesignFirstSliceModelInput["targets"][number],
  deliverable: DesignFirstSliceToolInput["deliverable"],
): unknown {
  const safeNodeId = target.regions[0]?.nodeId ?? "";
  return {
    ...target,
    qualityProfile:
      deliverable === "ui"
        ? {
            kind: "ui",
            platform: "other",
            input: "mixed",
            insets: [0, 0, 0, 0],
            safeNodeIds: safeNodeId ? [safeNodeId] : [],
            hitNodeIds: [],
          }
        : { kind: "graphic" },
  };
}

function defaultBriefFidelity(objective: string): DesignBriefFidelity {
  return {
    requiredContent: chunkRequiredContent(
      objective || "The requested visual deliverable",
    ),
    preservedSemantics: [],
    prohibitedAdditions: [
      "Do not invent unrequested content, features, or delivery targets",
    ],
    assumptions: [],
  };
}

function chunkRequiredContent(value: string): string[] {
  const normalized = value.replaceAll(/\r\n?/g, "\n").trim();
  if (!normalized) return ["The requested visual deliverable"];
  const chunks: string[] = [];
  let current = "";
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.length > 500) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let offset = 0; offset < line.length; offset += 500) {
        chunks.push(line.slice(offset, offset + 500));
      }
      continue;
    }
    const combined = current ? `${current}\n${line}` : line;
    if (combined.length > 500) {
      chunks.push(current);
      current = line;
    } else {
      current = combined;
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 24);
}

function schemaIssues(
  schema: TSchema,
  value: unknown,
  code: string,
): ValidationIssue[] {
  return schemaValidationIssues(schema, value)
    .slice(0, 32)
    .map((issue) => ({
      code,
      path: issue.path || "/",
      message: issue.message,
      recovery:
        "Correct the reported field and submit one revised call; do not repeat unchanged arguments.",
    }));
}

function refineFirstSlice(
  input: DesignFirstSliceCanonicalInput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (
    !isBuiltinDesignSkillRefsForDeliverable(input.deliverable, input.skillRefs)
  ) {
    issues.push(
      issue(
        "first_slice.host_skill_binding_invalid",
        "/skillRefs",
        "Host-bound design skills do not match the deliverable",
      ),
    );
  }
  if (
    input.deliverable === "ui" &&
    input.designIntent.calibration.surfaceMode === "graphic"
  ) {
    issues.push(
      issue(
        "first_slice.ui_surface_mode_invalid",
        "/designIntent/calibration/surfaceMode",
        "UI delivery must classify the surface as persuade, operate, read, or experience",
      ),
    );
  }
  if (
    input.deliverable !== "ui" &&
    input.designIntent.calibration.surfaceMode !== "graphic"
  ) {
    issues.push(
      issue(
        "first_slice.graphic_surface_mode_invalid",
        "/designIntent/calibration/surfaceMode",
        "Non-UI delivery must use the graphic surface mode",
      ),
    );
  }
  if (input.logoOutputs && input.deliverable !== "logo") {
    issues.push(
      issue(
        "first_slice.logo_outputs_wrong_deliverable",
        "/logoOutputs",
        "Logo outputs are only valid for a logo deliverable",
        "logo",
        input.deliverable,
      ),
    );
  }

  const targetIds = new Map<string, string>();
  const frameIds = new Map<string, string>();
  const regionIds = new Map<string, string>();
  for (const [targetIndex, target] of input.targets.entries()) {
    registerUniqueId(
      targetIds,
      target.targetId,
      `/targets/${targetIndex}/targetId`,
      "first_slice.duplicate_target_id",
      "Target ID",
      issues,
    );
    registerUniqueId(
      frameIds,
      target.frame.frameId,
      `/targets/${targetIndex}/frame/frameId`,
      "first_slice.duplicate_frame_id",
      "Delivery Frame ID",
      issues,
    );
  }
  const declaredFrameIds = new Set(frameIds.keys());
  for (const [targetIndex, target] of input.targets.entries()) {
    refineQualityProfile(target, targetIndex, input.deliverable, issues);
    refineRegionHierarchy(
      target,
      targetIndex,
      declaredFrameIds,
      regionIds,
      issues,
    );
  }

  const firstTarget = input.targets[0];
  if (!firstTarget) return issues;
  if (input.firstSlice.targetId !== firstTarget.targetId) {
    issues.push(
      issue(
        "first_slice.target_mismatch",
        "/firstSlice/targetId",
        "The first slice must materialize targets[0]",
        firstTarget.targetId,
        input.firstSlice.targetId,
      ),
    );
  }

  const stageIds = new Map<string, string>();
  const flattened: Array<{
    element: DesignFirstSliceElementInput;
    path: string;
  }> = [];
  for (const [stageIndex, stage] of input.firstSlice.stages.entries()) {
    registerUniqueId(
      stageIds,
      stage.stageId,
      `/firstSlice/stages/${stageIndex}/stageId`,
      "first_slice.duplicate_stage_id",
      "Stage ID",
      issues,
    );
    for (const [elementIndex, element] of stage.elements.entries()) {
      flattened.push({
        element,
        path: `/firstSlice/stages/${stageIndex}/elements/${elementIndex}`,
      });
    }
  }
  if (flattened.length > DESIGN_FIRST_SLICE_MAX_ELEMENTS) {
    issues.push(
      issue(
        "first_slice.element_limit_exceeded",
        "/firstSlice/stages",
        `${flattened.length} model-authored content elements exceed the combined first-slice budget`,
        DESIGN_FIRST_SLICE_MAX_ELEMENTS,
        flattened.length,
        `Defer ${flattened.length - DESIGN_FIRST_SLICE_MAX_ELEMENTS} secondary elements to continuation.`,
      ),
    );
  }

  const firstTargetRegionIds = new Set(
    firstTarget.regions.map((region) => region.nodeId),
  );
  const allFrameIds = new Set(frameIds.keys());
  const allRegionIds = new Set(regionIds.keys());
  const elementIds = new Map<string, string>();
  const parentById = new Map(
    firstTarget.regions.map((region) => [region.nodeId, region.parentId]),
  );
  for (const { element, path } of flattened) {
    registerUniqueId(
      elementIds,
      element.id,
      `${path}/id`,
      "first_slice.duplicate_element_id",
      "Element ID",
      issues,
    );
    if (allFrameIds.has(element.id)) {
      issues.push(
        issue(
          "first_slice.element_frame_id_conflict",
          `${path}/id`,
          "Element ID collides with a declared delivery Frame ID",
          "a globally unique content node ID",
          element.id,
        ),
      );
    }
    if (allRegionIds.has(element.id)) {
      issues.push(
        issue(
          "first_slice.planned_region_id_reserved",
          `${path}/id`,
          "Planned region IDs are host-owned Frame identities",
          "a unique content node ID parented to the region",
          element.id,
        ),
      );
    }
    if (
      !firstTargetRegionIds.has(element.parentId) &&
      !elementIds.has(element.parentId)
    ) {
      issues.push(
        issue(
          "first_slice.parent_not_available",
          `${path}/parentId`,
          "Element parent must be a first-target region or an earlier element",
          "declared region ID or earlier element ID",
          element.parentId,
        ),
      );
    }
    if (!parentById.has(element.id)) {
      parentById.set(element.id, element.parentId);
    }
  }

  const referencedRegions = new Set<string>();
  const materializedRegions = new Set<string>();
  for (const region of firstTarget.regions) {
    for (const { element } of flattened) {
      if (!parentChainReaches(element.parentId, region.nodeId, parentById)) {
        continue;
      }
      referencedRegions.add(region.nodeId);
      if (isMaterialElement(element)) materializedRegions.add(region.nodeId);
    }
  }
  if (referencedRegions.size === 0) {
    issues.push(
      issue(
        "first_slice.material_region_required",
        "/firstSlice/stages",
        "At least one first-target planned region must contain editable material",
      ),
    );
  }
  for (const regionId of referencedRegions) {
    if (!materializedRegions.has(regionId)) {
      const regionIndex = firstTarget.regions.findIndex(
        (region) => region.nodeId === regionId,
      );
      issues.push(
        issue(
          "first_slice.empty_referenced_region",
          `/targets/0/regions/${regionIndex}`,
          "Referenced planned region contains only empty containers",
          "at least one visible editable material descendant",
          regionId,
        ),
      );
    }
  }

  refineLogoExploration(
    input,
    firstTargetRegionIds,
    materializedRegions,
    issues,
  );
  refineSemanticObjects(input, new Set(targetIds.keys()), issues);
  refineReferenceStrategy(input.referenceStrategy, issues);
  return issues.slice(0, 64);
}

function refineQualityProfile(
  target: DesignFirstSliceCanonicalInput["targets"][number],
  targetIndex: number,
  deliverable: DesignFirstSliceToolInput["deliverable"],
  issues: ValidationIssue[],
): void {
  const expectedKind = deliverable === "ui" ? "ui" : "graphic";
  if (target.qualityProfile.kind !== expectedKind) {
    issues.push(
      issue(
        "first_slice.quality_profile_mismatch",
        `/targets/${targetIndex}/qualityProfile/kind`,
        "Quality profile does not match the deliverable",
        expectedKind,
        target.qualityProfile.kind,
      ),
    );
    return;
  }
  if (target.qualityProfile.kind !== "ui") return;
  const [top, right, bottom, left] = target.qualityProfile.insets;
  if (
    left + right >= target.frame.width ||
    top + bottom >= target.frame.height
  ) {
    issues.push(
      issue(
        "first_slice.safe_area_exceeds_frame",
        `/targets/${targetIndex}/qualityProfile/insets`,
        "Safe-area insets leave no positive content area",
        {
          horizontalLessThan: target.frame.width,
          verticalLessThan: target.frame.height,
        },
        { horizontal: left + right, vertical: top + bottom },
      ),
    );
  }
}

function refineRegionHierarchy(
  target: DesignFirstSliceCanonicalInput["targets"][number],
  targetIndex: number,
  declaredFrameIds: ReadonlySet<string>,
  globalRegionIds: Map<string, string>,
  issues: ValidationIssue[],
): void {
  const seen = new Map<string, { width: number; height: number }>([
    [target.frame.frameId, target.frame],
  ]);
  for (const [regionIndex, region] of target.regions.entries()) {
    const path = `/targets/${targetIndex}/regions/${regionIndex}`;
    registerUniqueId(
      globalRegionIds,
      region.nodeId,
      `${path}/nodeId`,
      "first_slice.duplicate_region_id",
      "Planned region ID",
      issues,
    );
    if (declaredFrameIds.has(region.nodeId)) {
      issues.push(
        issue(
          "first_slice.region_frame_id_conflict",
          `${path}/nodeId`,
          "Region ID must not reuse any declared delivery Frame ID",
          "a unique region ID",
          region.nodeId,
        ),
      );
    }
    const parent = seen.get(region.parentId);
    if (!parent) {
      issues.push(
        issue(
          "first_slice.region_parent_not_available",
          `${path}/parentId`,
          "Region parent must be the target Frame or an earlier region",
          "target frameId or earlier region nodeId",
          region.parentId,
        ),
      );
    } else if (
      region.x + region.width > parent.width ||
      region.y + region.height > parent.height
    ) {
      issues.push(
        issue(
          "first_slice.region_bounds_exceeded",
          path,
          "Parent-local region bounds exceed the declared parent",
          { width: parent.width, height: parent.height },
          {
            right: region.x + region.width,
            bottom: region.y + region.height,
          },
        ),
      );
    }
    if (!seen.has(region.nodeId)) seen.set(region.nodeId, region);
  }
}

function refineLogoExploration(
  input: DesignFirstSliceCanonicalInput,
  firstTargetRegionIds: ReadonlySet<string>,
  materializedRegions: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  const exploration = input.logoExploration;
  if (!exploration) return;
  if (input.deliverable !== "logo") {
    issues.push(
      issue(
        "first_slice.logo_exploration_wrong_deliverable",
        "/logoExploration",
        "Logo exploration is only valid for a logo deliverable",
        "logo",
        input.deliverable,
      ),
    );
  }
  const expectedTargetId = input.targets[0]?.targetId;
  if (exploration.targetId !== expectedTargetId) {
    issues.push(
      issue(
        "first_slice.logo_exploration_target_mismatch",
        "/logoExploration/targetId",
        "Logo exploration must target targets[0]",
        expectedTargetId,
        exploration.targetId,
      ),
    );
  }
  const principles = new Map<string, string>();
  const identities = new Map<string, string>();
  for (const [directionIndex, direction] of exploration.directions.entries()) {
    const path = `/logoExploration/directions/${directionIndex}`;
    registerUniqueId(
      principles,
      String(direction.principle),
      `${path}/principle`,
      "first_slice.duplicate_logo_principle",
      "Logo generative principle",
      issues,
    );
    if (!firstTargetRegionIds.has(direction.rootNodeId)) {
      issues.push(
        issue(
          "first_slice.logo_root_not_planned",
          `${path}/rootNodeId`,
          "Logo concept root must be a declared first-target region",
          "first-target region nodeId",
          direction.rootNodeId,
        ),
      );
    }
    for (const [id, idPath] of [
      [direction.conceptId, `${path}/conceptId`],
      [direction.rootNodeId, `${path}/rootNodeId`],
      ...direction.evidenceNodeIds.map(
        (nodeId, evidenceIndex) =>
          [nodeId, `${path}/evidenceNodeIds/${evidenceIndex}`] as const,
      ),
    ] as const) {
      registerUniqueId(
        identities,
        id,
        idPath,
        "first_slice.duplicate_logo_identity",
        "Logo concept/evidence ID",
        issues,
      );
    }
  }
  if (
    !exploration.directions.some((direction) =>
      materializedRegions.has(direction.rootNodeId),
    )
  ) {
    issues.push(
      issue(
        "first_slice.logo_direction_material_required",
        "/firstSlice/stages",
        "At least one declared Logo direction must contain editable material",
      ),
    );
  }
}

function refineSemanticObjects(
  input: DesignFirstSliceCanonicalInput,
  targetIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (!input.semanticObjects) return;
  const decisions = new Map<string, string>();
  const components = new Map<string, string>();
  const nodes = new Map<string, string>();
  for (const [objectIndex, object] of input.semanticObjects.entries()) {
    const path = `/semanticObjects/${objectIndex}`;
    registerUniqueId(
      decisions,
      object.decisionId,
      `${path}/decisionId`,
      "first_slice.duplicate_semantic_decision",
      "Semantic decision ID",
      issues,
    );
    if (object.decision !== "ordinary") {
      registerUniqueId(
        components,
        object.componentId,
        `${path}/componentId`,
        "first_slice.duplicate_component_id",
        "Component ID",
        issues,
      );
    }
    const occurrences =
      object.decision === "ordinary"
        ? object.occurrences
        : object.decision === "component"
          ? [object.main, ...object.instances]
          : object.instances;
    for (const [occurrenceIndex, occurrence] of occurrences.entries()) {
      const occurrencePath = `${path}/occurrences/${occurrenceIndex}`;
      if (!targetIds.has(occurrence.targetId)) {
        issues.push(
          issue(
            "first_slice.semantic_target_not_declared",
            `${occurrencePath}/targetId`,
            "Semantic occurrence references an undeclared target",
            [...targetIds],
            occurrence.targetId,
          ),
        );
      }
      registerUniqueId(
        nodes,
        occurrence.nodeId,
        `${occurrencePath}/nodeId`,
        "first_slice.duplicate_semantic_node",
        "Semantic occurrence node ID",
        issues,
      );
    }
  }
}

function refineReferenceStrategy(
  strategy: DesignReferenceStrategy | undefined,
  issues: ValidationIssue[],
): void {
  if (!strategy) return;
  const attachments = new Map<string, string>();
  let activeCount = 0;
  for (const [index, reference] of strategy.references.entries()) {
    registerUniqueId(
      attachments,
      reference.attachmentId,
      `/referenceStrategy/references/${index}/attachmentId`,
      "first_slice.duplicate_reference_attachment",
      "Reference attachment ID",
      issues,
    );
    if (isActiveVisualReferenceDecision(reference.decision)) activeCount += 1;
  }
  if (activeCount > MAX_ACTIVE_VISUAL_REFERENCES) {
    issues.push(
      issue(
        "first_slice.active_reference_limit_exceeded",
        "/referenceStrategy/references",
        "Too many active visual references",
        MAX_ACTIVE_VISUAL_REFERENCES,
        activeCount,
      ),
    );
  }
}

function registerUniqueId(
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
      issue(
        code,
        path,
        `${label} is already declared at ${firstPath}`,
        "globally unique ID",
        id,
      ),
    );
    return;
  }
  seen.set(id, path);
}

function issue(
  code: string,
  path: string,
  message: string,
  expected?: ValidationIssueValue,
  actual?: ValidationIssueValue,
  recovery = "Correct the reported relationship and submit one revised call; do not repeat unchanged arguments.",
): ValidationIssue {
  return {
    code,
    path,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
    recovery,
  };
}

/** Input must come from FirstSliceContract.parse. */
export function compileDesignFirstSliceToolInput(
  input: DesignFirstSliceToolInput,
): ReturnType<typeof compileValidatedDesignFirstSliceToolInput> {
  return compileValidatedDesignFirstSliceToolInput(input);
}

function isMaterialElement(element: DesignFirstSliceElementInput): boolean {
  return (
    element.kind === "text" ||
    element.kind === "rectangle" ||
    element.kind === "ellipse" ||
    element.kind === "path" ||
    (element.kind === "frame" && element.fill !== undefined)
  );
}

function parentChainReaches(
  parentId: string,
  ancestorId: string,
  parentById: ReadonlyMap<string, string>,
): boolean {
  let current: string | undefined = parentId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = parentById.get(current);
  }
  return false;
}
