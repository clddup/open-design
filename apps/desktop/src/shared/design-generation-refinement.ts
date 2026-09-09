import {
  compileDesignGenerationElement,
  compileQualityProfile,
} from "./design-generation-compiler";
import { DesignTargetQualityProfileContract } from "@opendesign/design-contracts";
import { isVisibleDesignMaterial } from "./design-material";
import { isBuiltinDesignSkillRefsForDeliverable } from "@opendesign/design-skills";
import type {
  ValidationIssue,
  ValidationIssueValue,
} from "./contract-validation";
import type {
  DesignGenerationCanonicalInput,
  DesignGenerationElementInput,
} from "./design-generation-tool-schema";
import type { DesignGenerationToolInput } from "./design-generation-tool";
import type { DesignReferenceStrategy } from "./design-reference-strategy";
import { logoColorDomainIssues } from "./design-logo-color";

export function refineDesignGeneration(
  input: DesignGenerationToolInput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (
    !isBuiltinDesignSkillRefsForDeliverable(input.deliverable, input.skillRefs)
  ) {
    issues.push(
      issue(
        "design_generation.host_skill_binding_invalid",
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
        "design_generation.ui_surface_mode_invalid",
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
        "design_generation.graphic_surface_mode_invalid",
        "/designIntent/calibration/surfaceMode",
        "Non-UI delivery must use the graphic surface mode",
      ),
    );
  }
  if (input.logoOutputs && input.deliverable !== "logo") {
    issues.push(
      issue(
        "design_generation.logo_outputs_wrong_deliverable",
        "/logoOutputs",
        "Logo outputs are only valid for a logo deliverable",
        "logo",
        input.deliverable,
      ),
    );
  }
  issues.push(
    ...logoColorDomainIssues({
      codePrefix: "design_generation",
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

  const target = input.targets[0];
  const elementsById = new Map<string, DesignGenerationElementInput>();
  const parentById = new Map<string, string>();
  const elementIds = new Map<string, string>();
  for (const [index, element] of input.designGeneration.elements.entries()) {
    const path = `/designGeneration/elements/${index}`;
    refineElementAppearance(element, path, issues);
    refineElementParent(
      element,
      path,
      target.frame.frameId,
      elementsById,
      issues,
    );
    registerUniqueId(
      elementIds,
      element.id,
      `${path}/id`,
      "design_generation.duplicate_element_id",
      "Element ID",
      issues,
    );
    if (!elementsById.has(element.id)) {
      elementsById.set(element.id, element);
      parentById.set(element.id, element.parentId);
    }
  }
  if (!input.designGeneration.elements.some(isMaterialElement)) {
    issues.push(
      issue(
        "design_generation.material_required",
        "/designGeneration/elements",
        "The batch must contain visible editable material, not only empty containers",
      ),
    );
  }

  refineQualityProfile(input, elementsById, issues);
  refineLogoExploration(input, elementsById, parentById, issues);
  refineReferenceStrategy(input.referenceStrategy, issues);
  return issues.slice(0, 64);
}

function refineQualityProfile(
  input: DesignGenerationToolInput,
  elementsById: ReadonlyMap<string, DesignGenerationElementInput>,
  issues: ValidationIssue[],
): void {
  const target = input.targets[0];
  const profile = compileQualityProfile(target.qualityProfile);
  const path = "/targets/0/qualityProfile";
  const expectedKind = input.deliverable === "ui" ? "ui" : "graphic";
  if (profile.kind !== expectedKind) {
    issues.push(
      issue(
        "design_generation.quality_profile_kind_mismatch",
        `${path}/kind`,
        "Quality profile must match the declared deliverable",
        expectedKind,
        profile.kind,
      ),
    );
  }
  const parsed = DesignTargetQualityProfileContract.parse(
    profile,
    target.frame,
  );
  if (!parsed.ok) {
    issues.push(
      ...parsed.issues.map((failure) => ({
        ...failure,
        path: `${path}${failure.path}`,
      })),
    );
  }
  if (profile.kind !== "ui") return;
  for (const field of ["safeAreaNodeIds", "interactiveNodeIds"] as const) {
    for (const [index, nodeId] of profile[field].entries()) {
      if (!elementsById.has(nodeId)) {
        issues.push(
          issue(
            "design_generation.quality_node_missing",
            `${path}/${field}/${index}`,
            "Quality checks must reference an authored element in this batch",
            "authored element ID",
            nodeId,
          ),
        );
      }
    }
  }
}

function refineElementAppearance(
  element: DesignGenerationElementInput,
  path: string,
  issues: ValidationIssue[],
): void {
  if (element.kind !== "group") return;
  if (element.fills.length > 0) {
    issues.push(
      issue(
        "design_generation.group_fills_unsupported",
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
        "design_generation.group_strokes_unsupported",
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
        "design_generation.group_stroke_width_unsupported",
        `${path}/strokeWidth`,
        "Group strokeWidth must remain zero because Group has no shape stroke",
        0,
        element.strokeWidth,
      ),
    );
  }
}

function refineElementParent(
  element: DesignGenerationElementInput,
  path: string,
  frameId: string,
  earlierElements: ReadonlyMap<string, DesignGenerationElementInput>,
  issues: ValidationIssue[],
): void {
  if (element.id === frameId) {
    issues.push(
      issue(
        "design_generation.element_frame_id_conflict",
        `${path}/id`,
        "Element ID collides with the host-owned artboard",
        "a unique content ID",
        element.id,
      ),
    );
  }
  if (element.parentId === frameId) return;
  const parent = earlierElements.get(element.parentId);
  if (!parent) {
    issues.push(
      issue(
        "design_generation.parent_not_available",
        `${path}/parentId`,
        "Element parent must be an earlier container; omit parentId for an artboard child",
        "earlier Frame/Group ID or omitted parentId",
        element.parentId,
      ),
    );
  } else if (parent.kind !== "frame" && parent.kind !== "group") {
    issues.push(
      issue(
        "design_generation.parent_not_container",
        `${path}/parentId`,
        "Only Frames and Groups can contain generated elements",
        "earlier Frame/Group ID or omitted parentId",
        element.parentId,
      ),
    );
  }
}

function refineLogoExploration(
  input: DesignGenerationCanonicalInput,
  elementsById: ReadonlyMap<string, DesignGenerationElementInput>,
  parentById: ReadonlyMap<string, string>,
  issues: ValidationIssue[],
): void {
  const exploration = input.logoExploration;
  if (!exploration) return;
  if (input.deliverable !== "logo") {
    issues.push(
      issue(
        "design_generation.logo_exploration_wrong_deliverable",
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
        "design_generation.logo_exploration_target_mismatch",
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
          "design_generation.logo_root_not_materialized",
          `${path}/rootNodeId`,
          "Logo concept root must be an actual design-generation Frame or Group",
          "designGeneration Frame/Group element ID",
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
        "design_generation.duplicate_logo_identity",
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
          "design_generation.logo_master_not_materialized",
          `${path}/masterNodeId`,
          "Logo master must be an actual descendant of the concept root",
          `designGeneration descendant of ${direction.rootNodeId}`,
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
          "design_generation.logo_direction_material_required",
          `${path}/masterNodeId`,
          "Logo master must contain editable material in this design generation",
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
      "design_generation.duplicate_reference_attachment",
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

function isMaterialElement(element: DesignGenerationElementInput): boolean {
  return isVisibleDesignMaterial(compileDesignGenerationElement(element));
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
