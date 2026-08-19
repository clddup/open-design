import { describe, expect, it } from "vitest";
import type {
  DesignBriefFidelity,
  DesignPlanToolInputV4,
  DesignPlanToolInputV5,
  DesignPlanToolInputV6,
} from "../../shared/design-agent-tools.js";
import {
  registerDesignWorkflowPlan,
  type InspectedHierarchy,
} from "./design-plan-registration.js";

describe("DesignPlan v4 component decision amendments", () => {
  it("resets affected material targets and preserves declared semantic identity", () => {
    const inspection = inspectedExistingDesign();
    const ordinary = existingPlan({
      summary:
        "Keep the unique navigation composition as an ordinary semantic group until reuse is justified.",
      candidates: [
        {
          decisionId: "navigation-candidate",
          label: "Navigation",
          decision: "ordinary",
          rationale:
            "Only one occurrence is currently required and no centralized update relationship is established.",
          occurrences: [
            { targetId: "target_home", nodeId: "navigation_group" },
          ],
        },
      ],
    });
    const initial = registerDesignWorkflowPlan({ inspection, plan: ordinary });
    expect(initial.state.targetsById.get("target_home")?.delivery.status).toBe(
      "drafted",
    );

    const component = existingPlan({
      summary:
        "Promote the stable navigation identity to a reusable component before adding linked screen instances.",
      candidates: [
        {
          decisionId: "navigation-candidate",
          label: "Navigation",
          decision: "component",
          rationale:
            "The navigation now has a stable identity and centralized updates are required for later screens.",
          componentId: "component_navigation",
          main: {
            mode: "create",
            targetId: "target_home",
            nodeId: "navigation_group",
          },
          instances: [],
        },
      ],
    });
    const amended = registerDesignWorkflowPlan({
      existing: initial.state,
      inspection,
      plan: component,
    });
    expect(amended.status).toBe("amended");
    expect(amended.changedTargetIds).toEqual(["target_home"]);
    expect(amended.state.targetsById.get("target_home")?.delivery.status).toBe(
      "drafted",
    );

    expect(() =>
      registerDesignWorkflowPlan({
        existing: initial.state,
        inspection,
        plan: existingPlan({
          summary:
            "No reusable semantic candidates remain after revising the current design direction.",
          candidates: [],
        }),
      }),
    ).toThrow(/plan_amendment_invalid.*navigation_group/i);

    expect(() =>
      registerDesignWorkflowPlan({
        existing: amended.state,
        inspection,
        plan: {
          ...component,
          componentStrategy: {
            ...component.componentStrategy,
            candidates: [
              {
                ...component.componentStrategy.candidates[0],
                componentId: "component_navigation_replacement",
              },
            ],
          },
        } as DesignPlanToolInputV4,
      }),
    ).toThrow(/preserve its Main\/Instance role and component ID/i);
  });
});

describe("DesignPlan v5 brief fidelity amendments", () => {
  it("reopens material targets without changing stable target geometry", () => {
    const inspection = inspectedExistingDesign();
    const initialPlan = existingPlanV5({
      requiredContent: ["Existing Home navigation and primary content"],
      preservedSemantics: ["Navigation labels and destinations"],
      prohibitedAdditions: ["No unrequested workflow controls"],
      assumptions: [],
    });
    const initial = registerDesignWorkflowPlan({
      inspection,
      plan: initialPlan,
    });
    const target = initial.state.targetsById.get("target_home");
    expect(target).toBeDefined();
    if (!target) return;
    target.delivery = {
      ...target.delivery,
      status: "verified",
      captureRevision: 7,
      reviewRevision: 7,
      refinementRevision: 7,
      verifiedRevision: 7,
    };
    target.captureCount = 2;
    target.lastCaptureRevision = 7;
    target.lastReview = {
      briefFidelity:
        "The rendered Home preserves its navigation meaning and adds no workflow controls",
      composition:
        "The main content remains balanced within the existing frame",
      hierarchy:
        "Navigation and primary content retain distinct visual priority",
      typography:
        "Existing product labels remain legible and semantically unchanged",
      assetIntegration: "No new assets alter the requested product meaning",
      formAndSurface:
        "The visual refresh preserves the product surface hierarchy",
      effects:
        "Effects remain restrained and do not imply new interaction states",
      refinements: [
        "Increase primary content spacing",
        "Reduce secondary separator contrast",
      ],
    };
    target.reviewedCaptureCount = 1;
    target.reviewedCaptureRevision = 7;

    const amendedPlan = existingPlanV5({
      ...initialPlan.briefFidelity,
      requiredContent: [
        "Existing Home navigation, primary content, and account status",
      ],
    });
    const amended = registerDesignWorkflowPlan({
      existing: initial.state,
      inspection,
      plan: amendedPlan,
    });
    const amendedTarget = amended.state.targetsById.get("target_home");

    expect(amended.changedTargetIds).toEqual(["target_home"]);
    expect(amendedTarget?.delivery.status).toBe("drafted");
    expect(amendedTarget?.planned.artboard.frameId).toBe("frame_home");
    expect(amendedTarget?.planned.composition.regions[0]?.nodeId).toBe(
      "logical_content",
    );
    expect(amendedTarget?.captureCount).toBe(0);
    expect(amendedTarget?.lastCaptureRevision).toBeNull();
    expect(amendedTarget?.lastReview).toBeNull();
    expect(amendedTarget?.reviewedCaptureCount).toBe(0);
  });
});

describe("DesignPlan v6 quality profile amendments", () => {
  it("reopens changed policy while preserving material quality node identities", () => {
    const inspection = inspectedExistingDesign();
    const qualityProfile: NonNullable<
      DesignPlanToolInputV6["targets"][number]["qualityProfile"]
    > = {
      kind: "ui",
      platform: "ios",
      interactionMode: "touch",
      safeAreaInsets: { top: 0, right: 0, bottom: 34, left: 0 },
      safeAreaNodeIds: ["navigation_group"],
      interactiveNodeIds: ["navigation_group"],
    };
    const initialPlan = existingPlanV6(qualityProfile);
    const initial = registerDesignWorkflowPlan({
      inspection,
      plan: initialPlan,
    });

    const amended = registerDesignWorkflowPlan({
      existing: initial.state,
      inspection,
      plan: existingPlanV6({
        ...qualityProfile,
        safeAreaInsets: { top: 44, right: 0, bottom: 34, left: 0 },
      }),
    });
    expect(amended.changedTargetIds).toEqual(["target_home"]);
    expect(amended.state.targetsById.get("target_home")?.delivery.status).toBe(
      "drafted",
    );

    expect(() =>
      registerDesignWorkflowPlan({
        existing: initial.state,
        inspection,
        plan: existingPlanV6({
          kind: "ui",
          platform: "ios",
          interactionMode: "touch",
          safeAreaInsets: { top: 0, right: 0, bottom: 34, left: 0 },
          safeAreaNodeIds: ["navigation_label"],
          interactiveNodeIds: [],
        }),
      }),
    ).toThrow(/safe-area node navigation_group cannot be removed/i);
  });
});

function existingPlan(
  componentStrategy: DesignPlanToolInputV4["componentStrategy"],
): DesignPlanToolInputV4 {
  return {
    version: 4,
    deliverable: "ui",
    objective: "Refine the existing Home screen",
    outputMode: "editable-composition",
    targets: [
      {
        targetId: "target_home",
        label: "Home",
        pageId: "page_1",
        objective: "Refine the existing Home screen",
        artboard: {
          mode: "existing",
          frameId: "frame_home",
          x: 0,
          y: 0,
          width: 390,
          height: 844,
        },
        composition: {
          direction: "Preserve the current product hierarchy",
          hierarchy: ["Navigation", "Primary content"],
          regions: [
            {
              nodeId: "logical_content",
              name: "Main content",
              role: "content",
              x: 0,
              y: 80,
              width: 390,
              height: 764,
            },
          ],
          assetIntegration: "Use existing editable native layers",
          spacingRhythm: "4/8/16/24 px rhythm",
        },
        editableLayers: ["Navigation", "Content"],
        implementationSteps: ["Refine hierarchy", "Verify component intent"],
        validationChecks: ["Check hierarchy", "Check component identity"],
      },
    ],
    visualSystem: {
      avoidances: ["No copied primitives", "No empty semantic groups"],
      formLanguage: "Compact product surfaces",
      palette: ["#101828", "#FFFFFF", "#2563EB"],
      surfaceAndDepth: "One restrained elevation tier",
      typography: ["Inter 28/34", "Inter 14/20"],
      effects: ["Subtle navigation separator"],
    },
    rasterAssetRoles: [],
    componentStrategy,
  };
}

function existingPlanV5(
  briefFidelity: DesignBriefFidelity,
): DesignPlanToolInputV5 {
  return {
    ...existingPlan({
      summary:
        "No reusable semantic object is justified by this single existing screen refinement.",
      candidates: [],
    }),
    version: 5,
    briefFidelity,
  };
}

function existingPlanV6(
  qualityProfile: NonNullable<
    DesignPlanToolInputV6["targets"][number]["qualityProfile"]
  >,
): DesignPlanToolInputV6 {
  const plan = existingPlanV5({
    requiredContent: ["Existing Home navigation and primary content"],
    preservedSemantics: ["Navigation labels and destinations"],
    prohibitedAdditions: ["No unrequested workflow controls"],
    assumptions: [],
  });
  return {
    ...plan,
    version: 6,
    targets: plan.targets.map((target) => ({ ...target, qualityProfile })),
  };
}

function inspectedExistingDesign(): InspectedHierarchy {
  return {
    componentsById: new Map(),
    documentId: "document_1",
    nodesById: new Map([
      [
        "frame_home",
        {
          childIds: ["navigation_group"],
          componentId: null,
          id: "frame_home",
          kind: "frame",
          locked: false,
          parentId: null,
          size: { width: 390, height: 844 },
          transform: [1, 0, 0, 1, 0, 0],
        },
      ],
      [
        "navigation_group",
        {
          childIds: ["navigation_label"],
          componentId: null,
          id: "navigation_group",
          kind: "group",
          locked: false,
          parentId: "frame_home",
          size: { width: 390, height: 64 },
          transform: [1, 0, 0, 1, 0, 0],
        },
      ],
      [
        "navigation_label",
        {
          childIds: [],
          componentId: null,
          id: "navigation_label",
          kind: "text",
          locked: false,
          parentId: "navigation_group",
          size: { width: 120, height: 24 },
          transform: [1, 0, 0, 1, 16, 20],
        },
      ],
    ]),
    pageRootsById: new Map([["page_1", new Set(["frame_home"])]]),
    revision: 7,
  };
}
