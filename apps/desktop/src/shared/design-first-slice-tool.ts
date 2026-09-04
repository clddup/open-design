import {
  builtinDesignSkillRefsForDeliverable,
  isBuiltinDesignSkillRefsForDeliverable,
} from "@opendesign/design-skills";
import {
  defineContract,
  type ValidationIssue,
  type ValidationIssueValue,
} from "./contract-validation";
import { MAX_TRANSACTION_COMMANDS } from "@opendesign/design-contracts";
import type {
  LOGO_CONCEPT_PRINCIPLES,
  DesignLogoOutput,
} from "./design-agent-plan-review";
import type { DesignBriefFidelity } from "./design-brief-fidelity";
import { compileValidatedDesignFirstSliceToolInput } from "./design-first-slice-compiler";
import {
  DESIGN_FIRST_SLICE_CANONICAL_INPUT_SCHEMA,
  DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
  type DesignFirstSliceCanonicalInput,
  type DesignFirstSliceElementInput,
  type DesignFirstSliceModelInput,
} from "./design-first-slice-tool-schema";
import { type DesignReferenceStrategy } from "./design-reference-strategy";
import {
  logoColorDomainIssues,
  type DesignLogoColorStrategy,
} from "./design-logo-color";

export { DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA } from "./design-first-slice-tool-schema";

export type DesignFirstSliceElement = DesignFirstSliceElementInput;
export type DesignFirstSliceToolInput = Omit<
  DesignFirstSliceCanonicalInput,
  "logoColorStrategy" | "logoOutputs" | "logoExploration"
> & {
  logoColorStrategy?: DesignLogoColorStrategy;
  logoOutputs?: DesignLogoOutput[];
  logoExploration?: {
    targetId: string;
    directions: Array<{
      conceptId: string;
      principle: (typeof LOGO_CONCEPT_PRINCIPLES)[number];
      thesis: string;
      constructionLogic: string;
      colorSystem: {
        palette: string[];
        rationale: string;
      };
      rootNodeId: string;
      masterNodeId: string;
    }>;
  };
};

export type FirstSliceContractContext = {
  authoritativePrompt?: string;
  newNodeIdPrefix?: string;
  target?: FirstSliceTargetBinding;
};

export type FirstSliceTargetBinding = {
  targetId: string;
  pageId: string;
  frame: {
    frameId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
  };
  label?: string;
  objective?: string;
};

export const FirstSliceContract = defineContract<
  DesignFirstSliceModelInput,
  DesignFirstSliceToolInput,
  FirstSliceContractContext
>(
  {
    schema: DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
    code: "first_slice.schema_invalid",
    subject: "First Slice",
    maximum: 32,
    canonical: {
      schema: DESIGN_FIRST_SLICE_CANONICAL_INPUT_SCHEMA,
      code: "first_slice.host_binding_invalid",
      subject: "host-bound First Slice",
      maximum: 32,
    },
    bind: bindFirstSliceHostContext,
    refine: refineFirstSlice,
  },
  () => ({}),
);

function bindFirstSliceHostContext(
  input: DesignFirstSliceModelInput,
  context: FirstSliceContractContext,
): DesignFirstSliceToolInput {
  const objective = (
    context.authoritativePrompt ?? "Create the requested visual deliverable"
  ).trim();
  const target = bindFirstSliceTarget(input.targets[0], context, objective);
  const targetId = target.targetId;
  const stableId = (localId: string) =>
    context.newNodeIdPrefix && !localId.startsWith("odr_")
      ? `${context.newNodeIdPrefix}${targetId.length}_${targetId}_${localId}`
      : localId;
  const frameId = target.frame.frameId;
  const regions =
    input.targets[0]?.regions.map((region) => ({
      ...region,
      nodeId: stableId(region.nodeId),
      parentId:
        region.parentId === undefined || region.parentId === frameId
          ? frameId
          : stableId(region.parentId),
    })) ?? [];
  return {
    ...input,
    version: 1,
    objective,
    designIntent:
      input.designIntent ?? defaultDesignIntent(input.deliverable, objective),
    visualSystem:
      input.visualSystem ?? defaultVisualSystem(input, input.deliverable),
    skillRefs: builtinDesignSkillRefsForDeliverable(input.deliverable),
    briefFidelity: defaultBriefFidelity(
      context.authoritativePrompt ?? objective,
    ),
    targets: [
      {
        ...target,
        regions,
        qualityProfile: defaultQualityProfile(input.deliverable, regions),
      },
    ],
    firstSlice: {
      ...input.firstSlice,
      targetId,
      stages: input.firstSlice.stages.map((stage) => ({
        ...stage,
        elements: stage.elements.map((element) => ({
          ...element,
          id: stableId(element.id),
          parentId: stableId(element.parentId),
          strokes: element.strokes ?? [],
          strokeWidth: element.strokeWidth ?? 0,
        })),
      })),
    },
    ...(input.logoExploration === undefined
      ? {}
      : {
          logoExploration: {
            ...input.logoExploration,
            targetId,
            directions: input.logoExploration.directions.map((direction) => ({
              ...direction,
              rootNodeId: stableId(direction.rootNodeId),
              masterNodeId: stableId(direction.masterNodeId),
            })),
          },
        }),
    rasterAssetRoles: [...input.rasterAssetRoles],
  } as DesignFirstSliceToolInput;
}

function bindFirstSliceTarget(
  submitted: DesignFirstSliceModelInput["targets"][number] | undefined,
  context: FirstSliceContractContext,
  fallbackObjective: string,
): Omit<
  DesignFirstSliceToolInput["targets"][number],
  "regions" | "qualityProfile"
> {
  const host = context.target;
  return {
    targetId: host?.targetId ?? "",
    label: host?.label ?? "Design",
    pageId: host?.pageId ?? "",
    objective: host?.objective ?? fallbackObjective,
    frame: {
      frameId: host?.frame.frameId ?? "",
      x: host?.frame.x ?? Number.NaN,
      y: host?.frame.y ?? Number.NaN,
      width: host?.frame.width ?? submitted?.frame.width ?? Number.NaN,
      height: host?.frame.height ?? submitted?.frame.height ?? Number.NaN,
    },
    layout: "Authored from the submitted region geometry",
    spacing: "Defined by authored coordinates and Auto Layout",
  };
}

function defaultDesignIntent(
  deliverable: DesignFirstSliceToolInput["deliverable"],
  objective: string,
): DesignFirstSliceToolInput["designIntent"] {
  const subject = objective.slice(0, 500);
  return {
    subject,
    audience: "The audience described by the user brief",
    primaryJob: subject,
    calibration: {
      surfaceMode: deliverable === "ui" ? "operate" : "graphic",
      expressiveness: "balanced",
      density: "balanced",
    },
    visualThesis: "Judge the authored visual result against the user brief",
    signatureDecision:
      "Use the submitted composition itself; do not invent a decorative motif",
    typographyLanguage: "Derived from the submitted editable text layers",
    colorMaterialLanguage: "Derived from the submitted paints and effects",
    compositionTension: "Derived from the submitted spatial relationships",
    antiPatterns: ["Do not replace design meaning with generic decoration"],
  };
}

function defaultVisualSystem(
  input: DesignFirstSliceModelInput,
  deliverable: DesignFirstSliceToolInput["deliverable"],
): DesignFirstSliceToolInput["visualSystem"] {
  const textStyles = input.firstSlice.stages
    .flatMap((stage) => stage.elements)
    .filter((element) => element.kind === "text")
    .map(
      (element) =>
        `${element.text.fontFamily} ${element.text.fontStyleName} ${element.text.fontSize}/${element.text.lineHeight}`,
    );
  return {
    formLanguage: "Derived from the submitted editable geometry",
    palette: ["Authored node paints"],
    surfaceAndDepth: "Derived from the submitted layers and effects",
    typography:
      textStyles.length > 0
        ? [...new Set(textStyles)].slice(0, 4)
        : [
            deliverable === "ui"
              ? "Interface typography"
              : "Graphic typography",
          ],
    effects: [],
  };
}

function defaultQualityProfile(
  deliverable: DesignFirstSliceToolInput["deliverable"],
  regions: DesignFirstSliceToolInput["targets"][number]["regions"],
): DesignFirstSliceToolInput["targets"][number]["qualityProfile"] {
  if (deliverable !== "ui") return { kind: "graphic" };
  const safeNodeId = regions[0]?.nodeId;
  return {
    kind: "ui",
    platform: "other",
    input: "mixed",
    insets: [0, 0, 0, 0],
    safeNodeIds: safeNodeId ? [safeNodeId] : [],
    hitNodeIds: [],
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

function refineFirstSlice(input: DesignFirstSliceToolInput): ValidationIssue[] {
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
  issues.push(
    ...logoColorDomainIssues({
      codePrefix: "first_slice",
      deliverable: input.deliverable,
      ...(input.logoExploration === undefined
        ? {}
        : {
            directionColors: input.logoExploration.directions.map(
              (direction) => direction.colorSystem,
            ),
          }),
      palette: input.visualSystem.palette,
      ...(input.logoColorStrategy === undefined
        ? {}
        : {
            strategy: input.logoColorStrategy,
          }),
    }),
  );

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
  const firstTargetRegionIds = new Set(
    firstTarget.regions.map((region) => region.nodeId),
  );
  const allFrameIds = new Set(frameIds.keys());
  const allRegionIds = new Set(regionIds.keys());
  const elementIds = new Map<string, string>();
  const elementsById = new Map<string, DesignFirstSliceElementInput>();
  const parentById = new Map(
    firstTarget.regions.map((region) => [region.nodeId, region.parentId]),
  );
  for (const { element, path } of flattened) {
    refineElementAppearance(element, path, issues);
    registerUniqueId(
      elementIds,
      element.id,
      `${path}/id`,
      "first_slice.duplicate_element_id",
      "Element ID",
      issues,
    );
    if (!elementsById.has(element.id)) elementsById.set(element.id, element);
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

  refineLogoExploration(input, elementsById, parentById, issues);
  refineReferenceStrategy(input.referenceStrategy, issues);
  if (issues.length === 0) {
    const commandCount =
      compileValidatedDesignFirstSliceToolInput(input).apply.commands.length;
    if (commandCount > MAX_TRANSACTION_COMMANDS) {
      issues.push(
        issue(
          "first_slice.transaction_limit_exceeded",
          "/firstSlice/stages",
          `${commandCount} compiled operations exceed the shared DesignTransaction safety limit`,
          MAX_TRANSACTION_COMMANDS,
          commandCount,
          "Split the target at a coherent visual boundary and continue with the remaining detail after the committed revision.",
        ),
      );
    }
  }
  return issues.slice(0, 64);
}

function refineElementAppearance(
  element: DesignFirstSliceElementInput,
  path: string,
  issues: ValidationIssue[],
): void {
  if (element.kind !== "group") return;
  if (element.fills.length > 0) {
    issues.push(
      issue(
        "first_slice.group_fills_unsupported",
        `${path}/fills`,
        "Group does not own shape fills; apply appearance to a child shape or use a Frame",
        0,
        element.fills.length,
      ),
    );
  }
  if (element.strokes.length > 0) {
    issues.push(
      issue(
        "first_slice.group_strokes_unsupported",
        `${path}/strokes`,
        "Group does not own shape strokes; apply appearance to a child shape or use a Frame",
        0,
        element.strokes.length,
      ),
    );
  }
  if (element.strokeWidth !== 0) {
    issues.push(
      issue(
        "first_slice.group_stroke_width_unsupported",
        `${path}/strokeWidth`,
        "Group strokeWidth must remain zero because Group has no shape stroke",
        0,
        element.strokeWidth,
      ),
    );
  }
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
  elementsById: ReadonlyMap<string, DesignFirstSliceElementInput>,
  parentById: ReadonlyMap<string, string>,
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
  const identities = new Map<string, string>();
  for (const [directionIndex, direction] of exploration.directions.entries()) {
    const path = `/logoExploration/directions/${directionIndex}`;
    const root = elementsById.get(direction.rootNodeId);
    if (!root || (root.kind !== "frame" && root.kind !== "group")) {
      issues.push(
        issue(
          "first_slice.logo_root_not_materialized",
          `${path}/rootNodeId`,
          "Logo concept root must be an actual first-slice Frame or Group",
          "firstSlice Frame/Group element ID",
          direction.rootNodeId,
        ),
      );
    }
    for (const [id, idPath] of [
      [direction.conceptId, `${path}/conceptId`],
      [direction.rootNodeId, `${path}/rootNodeId`],
      [direction.masterNodeId, `${path}/masterNodeId`],
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
    const master = elementsById.get(direction.masterNodeId);
    if (
      !master ||
      !parentChainReaches(master.id, direction.rootNodeId, parentById)
    ) {
      issues.push(
        issue(
          "first_slice.logo_master_not_materialized",
          `${path}/masterNodeId`,
          "Logo master must be an actual descendant of the concept root",
          `firstSlice descendant of ${direction.rootNodeId}`,
          direction.masterNodeId,
        ),
      );
    }
    const hasMaterial =
      (master ? isMaterialElement(master) : false) ||
      [...elementsById.values()].some(
        (element) =>
          element.id !== direction.masterNodeId &&
          isMaterialElement(element) &&
          parentChainReaches(
            element.parentId,
            direction.masterNodeId,
            parentById,
          ),
      );
    if (!hasMaterial) {
      issues.push(
        issue(
          "first_slice.logo_direction_material_required",
          `${path}/masterNodeId`,
          "Logo master must contain editable material in this first slice",
          "visible editable master geometry",
          direction.masterNodeId,
        ),
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
  for (const [index, reference] of strategy.references.entries()) {
    registerUniqueId(
      attachments,
      reference.attachmentId,
      `/referenceStrategy/references/${index}/attachmentId`,
      "first_slice.duplicate_reference_attachment",
      "Reference attachment ID",
      issues,
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
  if (element.kind === "group") return false;
  if (element.kind === "image") return true;
  return element.fills.length > 0 || element.strokes.length > 0;
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
