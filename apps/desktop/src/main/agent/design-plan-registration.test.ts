import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import { describe, expect, it } from "vitest";
import type {
  DesignPlanToolInput,
  DesignVisualReviewToolInput,
} from "../../shared/design-agent-tools.js";
import {
  registerDesignWorkflowPlan,
  type DesignDeliveryTargetState,
  type InspectedHierarchy,
} from "./design-plan-registration.js";

describe("current Design Plan amendments", () => {
  it("rejects new allocation roots that cover existing Page artwork", () => {
    const input = plan();
    input.targets[0] = {
      ...input.targets[0],
      artboard: {
        ...input.targets[0].artboard,
        mode: "create",
        frameId: "frame_new",
        x: 0,
        y: 0,
      },
    };
    expect(() =>
      registerDesignWorkflowPlan({
        inspection: inspectedExistingDesign(),
        plan: input,
      }),
    ).toThrow("design_workflow.artboard_overlap");
  });

  it("reopens a material target when visual intent changes and keeps stable geometry", () => {
    const initialPlan = plan();
    const initial = registerDesignWorkflowPlan({
      inspection: inspectedExistingDesign(),
      plan: initialPlan,
    });
    markVerified(initial.state.targetsById.get("target_home"));
    const amended = registerDesignWorkflowPlan({
      existing: initial.state,
      inspection: inspectedExistingDesign(),
      plan: {
        ...initialPlan,
        designIntent: {
          ...initialPlan.designIntent,
          visualThesis:
            "A sharper editorial signal system makes the next action immediate and unmistakable.",
        },
      },
    });
    const target = amended.state.targetsById.get("target_home");
    expect(amended.changedTargetIds).toEqual(["target_home"]);
    expect(target?.delivery.status).toBe("drafted");
    expect(target?.planned.artboard.frameId).toBe("frame_home");
    expect(target?.planned.composition.regions[0]?.nodeId).toBe(
      "logical_content",
    );
    expect(target?.lastReview).toBeNull();
  });

  it("reports material identity violations before replacement placement errors", () => {
    const initialPlan = plan();
    const initial = registerDesignWorkflowPlan({
      inspection: inspectedExistingDesign(),
      plan: initialPlan,
    });
    markVerified(initial.state.targetsById.get("target_home"));
    const home = initialPlan.targets[0];
    if (!home) throw new Error("Home target is missing");

    expect(() =>
      registerDesignWorkflowPlan({
        existing: initial.state,
        inspection: inspectedExistingDesign(),
        plan: {
          ...initialPlan,
          targets: [
            {
              ...home,
              artboard: {
                ...home.artboard,
                mode: "create",
                frameId: "frame_home_replacement",
              },
            },
          ],
        },
      }),
    ).toThrow(
      "design_workflow.plan_amendment_invalid: Material target target_home must preserve its Page and artboard Frame ID",
    );
  });

  it("reopens a material target when the brief, quality policy, or skill refs change", () => {
    const initialPlan = plan();
    const initial = registerDesignWorkflowPlan({
      inspection: inspectedExistingDesign(),
      plan: initialPlan,
    });
    markVerified(initial.state.targetsById.get("target_home"));
    const qualityTarget = initialPlan.targets[0];
    if (qualityTarget.qualityProfile.kind !== "ui") {
      throw new Error("UI quality profile required");
    }
    const amendments: DesignPlanToolInput[] = [
      {
        ...initialPlan,
        briefFidelity: {
          ...initialPlan.briefFidelity,
          requiredContent: [
            "Existing Home navigation, primary content, and account status",
          ],
        },
      },
      {
        ...initialPlan,
        targets: [
          {
            ...qualityTarget,
            qualityProfile: {
              ...qualityTarget.qualityProfile,
              safeAreaInsets: {
                ...qualityTarget.qualityProfile.safeAreaInsets,
                top: 44,
              },
            },
          },
        ],
      },
      {
        ...initialPlan,
        skillRefs: initialPlan.skillRefs.map((reference, index) =>
          index === 0 ? { id: "unknown-skill" } : reference,
        ),
      },
      {
        ...initialPlan,
        referenceStrategy: {
          synthesis:
            "Apply the supplied composition direction while preserving product semantics.",
          references: [
            {
              attachmentId: `image_${"e".repeat(64)}`,
              decision: "composition-reference",
              application:
                "Transfer the asymmetrical hierarchy and negative-space relationship.",
              preserve: ["asymmetrical hierarchy"],
              avoid: ["literal layout copy"],
            },
          ],
        },
      },
    ];
    for (const amendedPlan of amendments) {
      const amended = registerDesignWorkflowPlan({
        existing: initial.state,
        inspection: inspectedExistingDesign(),
        plan: amendedPlan,
      });
      expect(amended.changedTargetIds).toEqual(["target_home"]);
      expect(
        amended.state.targetsById.get("target_home")?.delivery.status,
      ).toBe("drafted");
    }
  });

  it("drops artboard self references and lets quality sets follow current descendants", () => {
    const initialPlan = plan();
    const initialTarget = initialPlan.targets[0];
    if (initialTarget.qualityProfile.kind !== "ui") {
      throw new Error("UI quality profile required");
    }
    initialTarget.qualityProfile.safeAreaNodeIds = [
      "frame_home",
      "navigation_group",
    ];
    initialTarget.qualityProfile.interactiveNodeIds = [
      "frame_home",
      "navigation_group",
    ];
    const initial = registerDesignWorkflowPlan({
      inspection: inspectedExistingDesign(),
      plan: initialPlan,
    });
    expect(initial.plan.targets[0]?.qualityProfile).toMatchObject({
      safeAreaNodeIds: ["navigation_group"],
      interactiveNodeIds: ["navigation_group"],
    });

    markVerified(initial.state.targetsById.get("target_home"));
    const acceptedTarget = initial.plan.targets[0];
    if (!acceptedTarget || acceptedTarget.qualityProfile.kind !== "ui") {
      throw new Error("Accepted UI quality profile required");
    }
    const amended = registerDesignWorkflowPlan({
      existing: initial.state,
      inspection: inspectedExistingDesign(),
      plan: {
        ...initial.plan,
        targets: [
          {
            ...acceptedTarget,
            qualityProfile: {
              ...acceptedTarget.qualityProfile,
              safeAreaNodeIds: ["navigation_label"],
              interactiveNodeIds: [],
            },
          },
        ],
      },
    });

    expect(amended.status).toBe("amended");
    expect(amended.plan.targets[0]?.qualityProfile).toMatchObject({
      safeAreaNodeIds: ["navigation_label"],
      interactiveNodeIds: [],
    });
    expect(amended.state.targetsById.get("target_home")?.delivery.status).toBe(
      "drafted",
    );
  });

  it("preserves material Component identity across amendments", () => {
    const initialPlan = plan();
    initialPlan.componentStrategy = {
      summary: "Use one stable linked navigation identity.",
      candidates: [
        {
          decisionId: "navigation-candidate",
          label: "Navigation",
          decision: "component",
          rationale:
            "The navigation has one durable identity and centralized update value.",
          componentId: "component_navigation",
          main: {
            mode: "existing",
            targetId: "target_home",
            nodeId: "navigation_group",
          },
          instances: [],
        },
      ],
    };
    const initial = registerDesignWorkflowPlan({
      inspection: inspectedExistingDesign(),
      plan: initialPlan,
    });
    markVerified(initial.state.targetsById.get("target_home"));
    const candidate = initialPlan.componentStrategy.candidates[0];
    if (candidate.decision !== "component") {
      throw new Error("Navigation candidate must be a component");
    }
    expect(() =>
      registerDesignWorkflowPlan({
        existing: initial.state,
        inspection: inspectedExistingDesign(),
        plan: {
          ...initialPlan,
          componentStrategy: {
            ...initialPlan.componentStrategy,
            candidates: [
              { ...candidate, componentId: "component_navigation_replacement" },
            ],
          },
        },
      }),
    ).toThrow(/preserve its Main\/Instance role and component ID/i);
  });

  it("accepts only reusable Components present in the current inspection catalog", () => {
    const reusePlan = plan();
    reusePlan.componentStrategy = {
      summary: "Reuse the current product navigation Component.",
      candidates: [
        {
          decisionId: "catalog-navigation",
          label: "Product navigation",
          decision: "reuse-component",
          rationale:
            "The catalog Component has the same semantic navigation job.",
          componentId: "component_catalog_navigation",
          instances: [
            {
              targetId: "target_home",
              nodeId: "catalog_navigation_instance",
            },
          ],
        },
      ],
    };
    expect(() =>
      registerDesignWorkflowPlan({
        inspection: inspectedExistingDesign(),
        plan: reusePlan,
      }),
    ).toThrow("design_workflow.component_catalog_stale");

    const inspection = inspectedExistingDesign();
    inspection.catalogComponentsById.set("component_catalog_navigation", {
      componentId: "component_catalog_navigation",
      name: "Product Navigation",
      availability: "design-file",
      usageCount: 4,
      scopeUsageCount: 0,
      variantProperties: {},
      properties: [],
      propertiesTruncated: false,
    });
    expect(
      registerDesignWorkflowPlan({ inspection, plan: reusePlan }).status,
    ).toBe("accepted");
  });

  it("rejects quality and component reservations shared across targets", () => {
    const duplicateQualityPlan = plan();
    const home = duplicateQualityPlan.targets[0];
    duplicateQualityPlan.targets.push({
      ...structuredClone(home),
      targetId: "target_profile",
      label: "Profile",
      artboard: {
        ...structuredClone(home.artboard),
        mode: "create",
        frameId: "frame_profile",
        x: 430,
      },
      composition: {
        ...structuredClone(home.composition),
        regions: home.composition.regions.map((region) => ({
          ...region,
          nodeId: "logical_profile_content",
        })),
      },
    });
    expect(() =>
      registerDesignWorkflowPlan({
        inspection: inspectedExistingDesign(),
        plan: duplicateQualityPlan,
      }),
    ).toThrow(/navigation_group.*target_home.*target_profile/i);
  });
});

function plan(): DesignPlanToolInput {
  return {
    version: 1,
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
        qualityProfile: {
          kind: "ui",
          platform: "ios",
          interactionMode: "touch",
          safeAreaInsets: { top: 0, right: 0, bottom: 34, left: 0 },
          safeAreaNodeIds: ["navigation_group"],
          interactiveNodeIds: ["navigation_group"],
        },
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
    componentStrategy: {
      summary: "No reusable semantic object is justified in this fixture.",
      candidates: [],
    },
    briefFidelity: {
      requiredContent: ["Existing Home navigation and primary content"],
      preservedSemantics: ["Navigation labels and destinations"],
      prohibitedAdditions: ["No unrequested workflow controls"],
      assumptions: [],
    },
    designIntent: {
      subject: "An existing mobile product home for focused creative work",
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
}

function markVerified(target: DesignDeliveryTargetState | undefined): void {
  if (!target) throw new Error("Home target is missing");
  target.delivery = {
    ...target.delivery,
    status: "verified",
    captureRevision: 7,
    reviewRevision: 7,
    refinementRevision: 7,
    verifiedRevision: 7,
  };
  target.lastReview = review();
  target.lastCaptureRevision = 7;
  target.captureCount = 2;
  target.reviewedCaptureCount = 1;
  target.reviewedCaptureRevision = 7;
}

function review(): DesignVisualReviewToolInput {
  return {
    version: 1,
    skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
      ...reference,
    })),
    briefFidelity: "The capture preserves the requested product semantics.",
    distinctiveness: "The signal field is recognizable beyond a generic UI.",
    signatureMotif:
      "The signal rail remains visible across the main hierarchy.",
    composition: "The primary content has deliberate visual priority.",
    hierarchy: "Navigation and content retain distinct visual roles.",
    typography: "Display and body roles are legible and differentiated.",
    assetIntegration: "Native layers form one coherent editable composition.",
    formAndSurface: "Surface hierarchy is restrained and intentional.",
    effects: "Effects support selection without decorative noise.",
    antiTemplate: "The design avoids repeated cards and ornamental gradients.",
    criteria: {
      "visual-thesis": "The directional editorial thesis is visible.",
      "signature-motif": "The signal rail is visibly integrated.",
      "composition-tension": "Offset alignment creates one focal path.",
      "typography-character": "Type roles add character while staying clear.",
      "material-coherence": "Color and surface decisions form one system.",
      "template-avoidance":
        "No default card grid or gradient identity appears.",
      "glance-legibility":
        "The primary task and action remain clear at thumbnail scale.",
      "subject-specificity":
        "The composition remains tied to the requested product subject.",
      "craft-precision":
        "Spacing and control proportions still need deliberate refinement.",
    },
    failedCriteria: ["composition-tension", "craft-precision"],
    refinements: ["Increase primary spacing", "Reduce separator contrast"],
  };
}

function inspectedExistingDesign(): InspectedHierarchy {
  return {
    catalogComponentsById: new Map(),
    componentsById: new Map([
      [
        "component_navigation",
        { id: "component_navigation", rootNodeId: "navigation_group" },
      ],
    ]),
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
          componentId: "component_navigation",
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
