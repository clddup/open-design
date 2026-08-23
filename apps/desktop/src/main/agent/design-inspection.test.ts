import { describe, expect, it } from "vitest";
import {
  BUILTIN_LOGO_DESIGN_SKILL_REFS,
  BUILTIN_UI_DESIGN_SKILL_REFS,
} from "@opendesign/design-skills";
import type {
  DesignPlanTarget,
  DesignPlanToolInput,
} from "@/shared/design-agent-tools.js";
import {
  assertDeliveryTargetStructure,
  parseInspectedHierarchy,
} from "./design-inspection.js";
import { createAgentDesignIdAllocation } from "@/shared/design-id-allocation.js";
import type {
  DesignDeliveryTargetState,
  InspectedHierarchy,
} from "./design-plan-registration.js";

const homeTarget = target("target_home", "frame_home", "region_home", "Home");
const profileTarget = target(
  "target_profile",
  "frame_profile",
  "region_profile",
  "Profile",
);

const plan: DesignPlanToolInput = {
  version: 1,
  deliverable: "ui",
  objective: "Design Home and Profile with a reusable navigation identity",
  outputMode: "editable-composition",
  targets: [homeTarget, profileTarget],
  visualSystem: {
    avoidances: ["No copied navigation primitives", "No empty semantic groups"],
    formLanguage: "Compact product surfaces with explicit semantic hierarchy",
    palette: ["#101828", "#FFFFFF", "#2563EB"],
    surfaceAndDepth: "One restrained elevation tier",
    typography: ["Inter 28/34", "Inter 14/20"],
    effects: ["Subtle navigation separator"],
  },
  rasterAssetRoles: [],
  componentStrategy: {
    summary:
      "Use one linked navigation component across both screens and preserve the unique hero as an ordinary semantic group.",
    candidates: [
      {
        decisionId: "shared-navigation",
        label: "Shared navigation",
        decision: "component",
        rationale:
          "The navigation has one stable identity and should receive centralized structural and visual updates.",
        componentId: "component_navigation",
        main: {
          mode: "create",
          targetId: "target_home",
          nodeId: "navigation_main",
        },
        instances: [
          {
            targetId: "target_profile",
            nodeId: "navigation_profile_instance",
          },
        ],
      },
      {
        decisionId: "home-hero",
        label: "Home hero",
        decision: "ordinary",
        rationale:
          "The hero is unique to Home and has no shared semantic identity or centralized update value.",
        occurrences: [{ targetId: "target_home", nodeId: "home_hero_group" }],
      },
    ],
  },
  briefFidelity: {
    requiredContent: ["Home and Profile screens"],
    preservedSemantics: [],
    prohibitedAdditions: ["No unrequested product capability"],
    assumptions: ["Use an iOS mobile viewport"],
  },
  designIntent: {
    subject: "A mobile product for focused creative work",
    audience: "Independent designers continuing time-sensitive work",
    primaryJob: "Recognize the next task and continue it immediately",
    visualThesis:
      "A directional editorial field expresses momentum instead of a generic card stack.",
    signatureMotif:
      "One cropped signal rail connects identity, next action, and progress.",
    typographyLanguage:
      "Editorial display type sets pace while compact neutral text preserves clarity.",
    colorMaterialLanguage:
      "Tinted ink planes and one electric signal color create controlled hierarchy.",
    compositionTension:
      "Offset alignment and decisive scale contrast pull attention toward action.",
    antiPatterns: [
      "No centered card floating on a decorative background",
      "No equal grid of same-radius feature tiles",
      "No generic purple gradient used as the only identity",
    ],
  },
  skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
    ...reference,
  })),
};

describe("Agent design inspection component strategy", () => {
  it("reads scoped component and instance identity from authoritative inspection", () => {
    const inspection = parseInspectedHierarchy(
      {
        runId: "run_1",
        sessionId: "conversation_1",
        documentId: "document_1",
        revision: 9,
        scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
        mutationTarget: { kind: "page", pageId: "page_1" },
      },
      {
        observedRevision: 9,
        content: {
          idAllocation: createAgentDesignIdAllocation("run_1"),
          document: {
            documentId: "document_1",
            revision: 9,
            pagesById: {
              page_1: {
                id: "page_1",
                rootNodeIds: ["component_main", "instance_1"],
              },
            },
            nodesById: {
              component_main: inspectedNode("component_main", "group", null),
              instance_1: {
                ...inspectedNode("instance_1", "instance", null),
                properties: {
                  componentId: "component_navigation",
                  overrides: [],
                },
              },
            },
            componentsById: {
              component_navigation: {
                id: "component_navigation",
                name: "Navigation",
                rootNodeId: "component_main",
              },
            },
            componentCatalog: {
              totalCount: 1,
              truncated: false,
              components: [
                {
                  componentId: "component_navigation",
                  name: "Navigation",
                  availability: "current-scope",
                  usageCount: 1,
                  scopeUsageCount: 1,
                  variantProperties: {},
                  properties: [],
                  propertiesTruncated: false,
                },
              ],
            },
          },
        },
      },
    );
    expect(inspection.newNodeIdPrefix).toBe("odr_run_1_");

    expect(
      inspection.componentsById.get("component_navigation")?.rootNodeId,
    ).toBe("component_main");
    expect(inspection.nodesById.get("instance_1")?.componentId).toBe(
      "component_navigation",
    );
    expect(
      inspection.catalogComponentsById.get("component_navigation")?.name,
    ).toBe("Navigation");
  });

  it("reports no component-strategy issues for declared Main, Instance, and ordinary semantic roots", () => {
    const inspection = completeInspection();

    expect(
      assertDeliveryTargetStructure(inspection, targetState(homeTarget), plan),
    ).toMatchObject({ issueCount: 0, blocking: false });
    expect(
      assertDeliveryTargetStructure(
        inspection,
        targetState(profileTarget),
        plan,
      ),
    ).toMatchObject({ issueCount: 0, blocking: false });
  });

  it("reports every copied layer and unbound group in one non-blocking quality result", () => {
    const copiedInstance = completeInspection();
    copiedInstance.nodesById.set("navigation_profile_instance", {
      ...requiredNode(copiedInstance, "navigation_profile_instance"),
      kind: "group",
      componentId: null,
    });
    expect(
      assertDeliveryTargetStructure(
        copiedInstance,
        targetState(profileTarget),
        plan,
      ),
    ).toMatchObject({
      issueCount: 1,
      issues: [
        {
          code: "component-instance-unlinked",
          nodeId: "navigation_profile_instance",
        },
      ],
      blocking: false,
    });

    const unboundMain = completeInspection();
    unboundMain.componentsById.clear();
    unboundMain.nodesById.set("home_hero_group", {
      ...requiredNode(unboundMain, "home_hero_group"),
      kind: "rectangle",
    });
    expect(
      assertDeliveryTargetStructure(unboundMain, targetState(homeTarget), plan),
    ).toMatchObject({
      checkedOccurrenceCount: 2,
      issueCount: 2,
      issues: [
        { code: "component-main-unbound", nodeId: "navigation_main" },
        { code: "ordinary-root-invalid", nodeId: "home_hero_group" },
      ],
      blocking: false,
    });
  });

  it("blocks final logo verification when a declared concept lacks real optical evidence", () => {
    const inspection = completeInspection();
    const logoPlan: DesignPlanToolInput = {
      ...plan,
      deliverable: "logo",
      logoOutputs: ["symbol"],
      targets: plan.targets.map((target) => ({
        ...target,
        qualityProfile: { kind: "graphic" },
      })),
      logoExploration: {
        targetId: "target_home",
        directions: [
          logoDirection("negative", "negative-space"),
          logoDirection("modular", "modular-system"),
          logoDirection("type", "typographic-relationship"),
        ],
      },
      skillRefs: BUILTIN_LOGO_DESIGN_SKILL_REFS.map((reference) => ({
        ...reference,
      })),
    };
    const exploration = logoPlan.logoExploration;
    if (!exploration) throw new Error("Logo exploration fixture is missing");
    const region = requiredNode(inspection, "region_home");
    for (const direction of exploration.directions) {
      region.childIds.push(direction.rootNodeId);
      inspection.nodesById.set(direction.rootNodeId, {
        ...requiredNode(inspection, "home_hero_group"),
        id: direction.rootNodeId,
        parentId: "region_home",
        childIds: [direction.monochromeNodeId, ...direction.smallSizeNodeIds],
      });
      for (const nodeId of [
        direction.monochromeNodeId,
        ...direction.smallSizeNodeIds,
      ]) {
        inspection.nodesById.set(nodeId, {
          ...requiredNode(inspection, "hero_shape"),
          id: nodeId,
          parentId: direction.rootNodeId,
        });
      }
    }

    expect(() =>
      assertDeliveryTargetStructure(
        inspection,
        targetState(logoPlan.targets[0]),
        logoPlan,
      ),
    ).not.toThrow();

    inspection.nodesById.delete("type_16");
    expect(() =>
      assertDeliveryTargetStructure(
        inspection,
        targetState(logoPlan.targets[0]),
        logoPlan,
      ),
    ).toThrow("design_workflow.logo_exploration_incomplete");
  });
});

function logoDirection(
  prefix: string,
  principle: "negative-space" | "modular-system" | "typographic-relationship",
) {
  return {
    conceptId: `concept_${prefix}`,
    label: `${prefix} concept`,
    principle,
    thesis: `${prefix} establishes a visibly distinct identity construction.`,
    constructionLogic: `${prefix} uses a separate editable contour and counterform relationship.`,
    rootNodeId: `${prefix}_root`,
    monochromeNodeId: `${prefix}_mono`,
    smallSizeNodeIds: [`${prefix}_32`, `${prefix}_24`, `${prefix}_16`] as [
      string,
      string,
      string,
    ],
  };
}

function completeInspection(): InspectedHierarchy {
  const nodesById: InspectedHierarchy["nodesById"] = new Map();
  const add = (
    id: string,
    kind: string,
    parentId: string | null,
    childIds: string[] = [],
    componentId: string | null = null,
  ) =>
    nodesById.set(id, {
      childIds,
      componentId,
      id,
      kind,
      locked: false,
      parentId,
      size: { width: 100, height: 40 },
      transform: [1, 0, 0, 1, 0, 0],
    });
  add("frame_home", "frame", null, ["region_home"]);
  add("region_home", "frame", "frame_home", [
    "home_copy",
    "navigation_main",
    "home_hero_group",
  ]);
  add("home_copy", "text", "region_home");
  add("navigation_main", "group", "region_home", ["navigation_label"]);
  add("navigation_label", "text", "navigation_main");
  add("home_hero_group", "group", "region_home", ["hero_shape"]);
  add("hero_shape", "rectangle", "home_hero_group");
  add("frame_profile", "frame", null, ["region_profile"]);
  add("region_profile", "frame", "frame_profile", [
    "profile_copy",
    "navigation_profile_instance",
  ]);
  add("profile_copy", "text", "region_profile");
  add(
    "navigation_profile_instance",
    "instance",
    "region_profile",
    [],
    "component_navigation",
  );
  return {
    catalogComponentsById: new Map(),
    componentsById: new Map([
      [
        "component_navigation",
        { id: "component_navigation", rootNodeId: "navigation_main" },
      ],
    ]),
    documentId: "document_1",
    nodesById,
    pageRootsById: new Map([
      ["page_1", new Set(["frame_home", "frame_profile"])],
    ]),
    revision: 9,
  };
}

function target(
  targetId: string,
  frameId: string,
  regionId: string,
  label: string,
): DesignPlanTarget {
  return {
    targetId,
    label,
    pageId: "page_1",
    objective: `Design the ${label} screen`,
    artboard: {
      mode: "create",
      frameId,
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    },
    composition: {
      direction: "Clear product hierarchy",
      hierarchy: ["Navigation", "Primary content"],
      regions: [
        {
          nodeId: regionId,
          name: `${label} content`,
          role: "content",
          x: 0,
          y: 0,
          width: 390,
          height: 844,
        },
      ],
      assetIntegration: "Use native editable layers without raster imagery",
      spacingRhythm: "4/8/16/24 px rhythm",
    },
    editableLayers: ["Navigation", "Content"],
    implementationSteps: ["Build hierarchy", "Add content"],
    validationChecks: ["Check hierarchy", "Check component identity"],
    qualityProfile: {
      kind: "ui",
      platform: "ios",
      interactionMode: "touch",
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      safeAreaNodeIds: [regionId],
      interactiveNodeIds: [],
    },
  };
}

function targetState(planned: DesignPlanTarget): DesignDeliveryTargetState {
  return {
    artboardDescendantIds: new Set(),
    artboardEstablished: true,
    captureCount: 1,
    delivery: {
      targetId: planned.targetId,
      label: planned.label,
      pageId: planned.pageId,
      rootNodeId: planned.artboard.frameId,
      reservedNodeIds: [
        planned.artboard.frameId,
        ...planned.composition.regions.map((region) => region.nodeId),
      ],
      status: "refined",
      allocatedRevision: 1,
      draftRevision: 2,
      captureRevision: 2,
      reviewRevision: 2,
      refinementRevision: 3,
    },
    lastCaptureRevision: 2,
    lastMaterialWriteRevision: 3,
    lastReview: null,
    planned,
    reviewedCaptureCount: 1,
    reviewedCaptureRevision: 2,
  };
}

function inspectedNode(id: string, kind: string, parentId: string | null) {
  return {
    id,
    kind,
    name: id,
    parentId,
    childIds: [],
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 100, height: 40 },
    properties: {},
  };
}

function requiredNode(inspection: InspectedHierarchy, nodeId: string) {
  const node = inspection.nodesById.get(nodeId);
  if (!node) throw new Error(`Missing test node ${nodeId}`);
  return node;
}
