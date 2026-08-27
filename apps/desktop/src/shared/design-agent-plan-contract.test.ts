import { schemaValidationIssues } from "@opendesign/design-contracts";
import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import { describe, expect, it } from "vitest";
import {
  DESIGN_PLAN_CANONICAL_INPUT_SCHEMA,
  DESIGN_PLAN_TOOL_INPUT_SCHEMA,
  DesignPlanContract,
  type DesignPlanToolInput,
} from "./design-agent-tools";

describe("DesignPlanContract", () => {
  it("uses one Provider schema and binds the canonical skill set once", () => {
    const modelPlan = planInput();
    expect(
      schemaValidationIssues(DESIGN_PLAN_TOOL_INPUT_SCHEMA, modelPlan),
    ).toHaveLength(0);
    expect(JSON.stringify(DesignPlanContract.schema)).toBe(
      JSON.stringify(DESIGN_PLAN_TOOL_INPUT_SCHEMA),
    );
    expect(JSON.stringify(DESIGN_PLAN_TOOL_INPUT_SCHEMA)).not.toContain(
      '"skillRefs"',
    );

    const parsed = DesignPlanContract.parse(modelPlan);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.value.skillRefs).toEqual(BUILTIN_UI_DESIGN_SKILL_REFS);
    expect(parsed.value.designIntent.calibration).toEqual({
      surfaceMode: "operate",
      expressiveness: "restrained",
      density: "balanced",
    });
    expect(
      schemaValidationIssues(DESIGN_PLAN_CANONICAL_INPUT_SCHEMA, parsed.value),
    ).toHaveLength(0);
  });

  it("reports the concrete nested field when a UI profile is malformed", () => {
    const input = planInput() as Record<string, unknown> & {
      targets: Array<Record<string, unknown>>;
    };
    input.targets[0].qualityProfile = {
      kind: "ui",
      interactionMode: "pointer",
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      safeAreaNodeIds: ["auth_region"],
      interactiveNodeIds: [],
    };
    const result = DesignPlanContract.parse(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected schema failure");
    expect(
      result.issues.some(
        (issue) =>
          issue.code === "design_plan.schema_invalid" &&
          issue.path.includes("/targets/0/qualityProfile"),
      ),
    ).toBe(true);
  });

  it("rejects a graphic surface mode for UI at the calibrated domain boundary", () => {
    const input = planInput();
    input.designIntent.calibration.surfaceMode = "graphic";
    const result = DesignPlanContract.parse(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected UI surface mode failure");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "design_plan.ui_surface_mode_invalid",
        path: "/designIntent/calibration/surfaceMode",
      }),
    );
  });

  it("rejects a UI surface mode for a non-UI delivery", () => {
    const input = planInput();
    input.deliverable = "poster";
    input.targets[0].qualityProfile = { kind: "graphic" };
    const result = DesignPlanContract.parse(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected graphic surface mode failure");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "design_plan.graphic_surface_mode_invalid",
        path: "/designIntent/calibration/surfaceMode",
      }),
    );
  });

  it("keeps monochrome as a Logo variant unless the authoritative brief makes it primary", () => {
    const input = planInput();
    input.deliverable = "logo";
    input.designIntent.calibration.surfaceMode = "graphic";
    input.targets[0].qualityProfile = { kind: "graphic" };
    input.visualSystem.palette = ["#111111", "#FFFFFF"];

    const missing = DesignPlanContract.parse(input);
    expect(missing).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design_plan.logo_color_strategy_required",
          path: "/logoColorStrategy",
        }),
      ],
    });

    input.logoColorStrategy = {
      mode: "brand-color",
      rationale:
        "A primary electric blue should identify the product before any caption is read.",
      lightDarkAdaptation:
        "Use deep blue on light surfaces and a brighter blue with white counters on dark surfaces.",
    };
    const neutral = DesignPlanContract.parse(input);
    expect(neutral).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design_plan.logo_brand_color_required",
          path: "/visualSystem/palette",
        }),
      ],
    });

    input.logoColorStrategy.mode = "monochrome-by-brief";
    expect(
      DesignPlanContract.parse(input, {
        authoritativePrompt:
          "Include monochrome tests alongside a full-color primary Logo.",
      }),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design_plan.logo_monochrome_not_requested",
          path: "/logoColorStrategy/mode",
        }),
      ],
    });
    expect(
      DesignPlanContract.parse(input, {
        authoritativePrompt: "The primary Logo must be monochrome only.",
      }).ok,
    ).toBe(true);
  });

  it("reports parent-local region overflow with a stable path", () => {
    const input = planInput();
    input.targets[0].composition.regions[1].x = 300;
    const result = DesignPlanContract.parse(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected region overflow");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "design_plan.region_out_of_parent_bounds",
        path: "/targets/0/composition/regions/1",
      }),
    );
  });

  it("rejects a region that reuses its delivery Frame ID", () => {
    const input = planInput();
    input.targets[0].composition.regions[0].nodeId = "login_artboard";
    const result = DesignPlanContract.parse(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected duplicate node ID");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "design_plan.duplicate_document_node_id",
        path: "/targets/0/composition/regions/0/nodeId",
      }),
    );
  });

  it("reports an unknown Component occurrence target at the exact field", () => {
    const input = planInput();
    input.componentStrategy = {
      summary:
        "Promote the repeated authentication form when another target reuses it.",
      candidates: [
        {
          decisionId: "auth-form",
          label: "Authentication form",
          decision: "ordinary",
          rationale:
            "This single target does not yet justify a linked Component Main.",
          occurrences: [{ targetId: "missing_target", nodeId: "auth_form" }],
        },
      ],
    };
    const result = DesignPlanContract.parse(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected Component target failure");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "design_plan.component_target_unknown",
        path: "/componentStrategy/candidates/0/occurrences/0/targetId",
      }),
    );
  });

  it("limits only active visual references in the domain refinement", () => {
    const input = planInput();
    input.referenceStrategy = {
      synthesis:
        "Use a bounded set of transferable decisions without literal copying.",
      references: ["a", "b", "c"].map((hex) => ({
        attachmentId: `image_${hex.repeat(64)}`,
        decision: "style-reference" as const,
        application:
          "Transfer hierarchy and material restraint into this authentication screen.",
        preserve: ["tonal hierarchy"],
        avoid: ["literal layout copy"],
      })),
    };
    const result = DesignPlanContract.parse(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected active-reference failure");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "design_plan.active_reference_limit_exceeded",
        path: "/referenceStrategy/references",
        expected: 2,
        actual: 3,
      }),
    );
  });

  it("does not repair an invalid trusted canonical skill binding", () => {
    const modelPlan = planInput();
    const parsed = DesignPlanContract.parse(modelPlan);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const canonical: DesignPlanToolInput = {
      ...parsed.value,
      skillRefs: parsed.value.skillRefs.slice(1),
    };
    const result = DesignPlanContract.parse(canonical, { canonical: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected canonical skill failure");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "design_plan.host_skill_binding_invalid",
        path: "/skillRefs",
      }),
    );
  });

  it("keeps single-raster requirements in one output-mode refinement", () => {
    const input = planInput();
    input.outputMode = "single-raster";
    const result = DesignPlanContract.parse(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected single-raster failure");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "design_plan.single_raster_evidence_required",
        "design_plan.single_raster_role_required",
      ]),
    );
  });
});

function planInput(): Omit<DesignPlanToolInput, "skillRefs"> {
  return {
    version: 1,
    deliverable: "ui",
    objective: "Design a focused authentication screen",
    outputMode: "editable-composition",
    targets: [
      {
        targetId: "login",
        label: "Login",
        pageId: "page_auth",
        objective: "Create a polished and trustworthy login experience",
        artboard: {
          mode: "create",
          frameId: "login_artboard",
          x: 120,
          y: 80,
          width: 390,
          height: 844,
        },
        composition: {
          direction:
            "A calm editorial authentication surface with a decisive form hierarchy",
          hierarchy: ["Brand context", "Authentication form"],
          regions: [
            {
              nodeId: "auth_region",
              name: "Authentication",
              role: "structure",
              x: 0,
              y: 0,
              width: 390,
              height: 844,
            },
            {
              nodeId: "form_region",
              name: "Login form",
              role: "interaction",
              parentId: "auth_region",
              x: 24,
              y: 160,
              width: 342,
              height: 520,
            },
          ],
          assetIntegration:
            "Use editable typography and geometry; no raster evidence is needed.",
          spacingRhythm: "8/12/20/32 px progression",
        },
        editableLayers: ["Brand context", "Authentication form"],
        implementationSteps: ["Build hierarchy", "Author form controls"],
        validationChecks: ["Check safe area", "Check form target sizes"],
        qualityProfile: {
          kind: "ui",
          platform: "web",
          interactionMode: "pointer",
          safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          safeAreaNodeIds: ["auth_region"],
          interactiveNodeIds: [],
        },
      },
    ],
    visualSystem: {
      avoidances: [
        "No generic floating card",
        "No decorative gradient without structural purpose",
      ],
      formLanguage: "Precise fields with restrained radii and clear states",
      palette: ["#0F172A", "#FFFFFF", "#2563EB"],
      surfaceAndDepth: "One quiet tonal surface and a focused action tier",
      typography: ["Inter display hierarchy", "Inter compact form copy"],
      effects: ["Subtle focus halo"],
    },
    rasterAssetRoles: [],
    componentStrategy: {
      summary: "No reusable semantic object is justified for one login target.",
      candidates: [],
    },
    briefFidelity: {
      requiredContent: ["Login form"],
      preservedSemantics: [],
      prohibitedAdditions: ["No unrequested product capability"],
      assumptions: ["Use a desktop Web interaction model"],
    },
    designIntent: {
      subject: "A focused authentication gateway for OpenDesign",
      audience: "Design professionals returning to active project work",
      primaryJob: "Authenticate quickly and continue the current workspace",
      calibration: {
        surfaceMode: "operate",
        expressiveness: "restrained",
        density: "balanced",
      },
      visualThesis:
        "A calm editorial gateway makes security feel precise rather than bureaucratic.",
      signatureMotif:
        "One vertical signal rail connects identity, credentials, and the primary action.",
      typographyLanguage:
        "Editorial display type creates character while compact neutral copy preserves speed.",
      colorMaterialLanguage:
        "Ink and paper neutrals use one electric blue signal for action and focus.",
      compositionTension:
        "An offset identity block balances a tightly aligned authentication column.",
      antiPatterns: [
        "No centered card floating on a decorative background",
        "No equal-radius boxes around every text group",
        "No generic purple gradient as the only identity",
      ],
    },
  };
}
