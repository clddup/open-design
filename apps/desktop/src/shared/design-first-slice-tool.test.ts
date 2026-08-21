import { describe, expect, it } from "vitest";
import {
  BUILTIN_GRAPHIC_DESIGN_SKILL_REFS,
  BUILTIN_LOGO_DESIGN_SKILL_REFS,
  BUILTIN_UI_DESIGN_SKILL_REFS,
} from "@opendesign/design-skills";
import {
  compileDesignFirstSliceToolInput,
  DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
  explainInvalidDesignFirstSliceToolInput,
  isDesignFirstSliceToolInput,
  normalizeDesignFirstSliceToolInput,
  type DesignFirstSliceToolInput,
} from "./design-first-slice-tool";
import {
  isDesignApplyToolInput,
  isDesignPlanToolInput,
} from "./design-agent-tools";

describe("compact first-slice tool", () => {
  it("keeps Provider schema budgets aligned with runtime validation", () => {
    const properties = DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA.properties;
    expect(properties.visualSystem.properties.typography.maxItems).toBe(8);
    expect(properties.firstSlice.properties.stages.maxItems).toBe(3);
    expect(JSON.stringify(properties.targets)).toContain('"safeNodeIds"');
    expect(JSON.stringify(properties.targets)).toContain('"hitNodeIds"');
    expect(properties.referenceStrategy.type).toBe("object");
    expect(JSON.stringify(properties)).not.toContain('"skillRefs"');
    expect(
      properties.firstSlice.properties.stages.items.properties.elements
        .maxItems,
    ).toBe(32);
    expect(properties.firstSlice.properties.stages.description).toContain(
      "total across all stages",
    );
  });

  it("accepts distinct safe-area foreground and interactive hit-area IDs", () => {
    const input = fixture();
    const profile = input.targets[0].qualityProfile;
    if (profile.kind !== "ui") throw new Error("Expected UI fixture");
    profile.hitNodeIds = ["hero_panel"];

    expect(profile.safeNodeIds).not.toContain("hero_panel");
    expect(isDesignFirstSliceToolInput(input)).toBe(true);
    expect(
      compileDesignFirstSliceToolInput(input).plan.targets[0]?.qualityProfile,
    ).toMatchObject({
      safeAreaNodeIds: ["hero_title"],
      interactiveNodeIds: ["hero_panel"],
    });
  });

  it("compiles all targets into the current Plan with pinned skills and a canonical first slice", () => {
    const input = fixture();
    input.semanticObjects = [
      {
        decisionId: "catalog-navigation",
        label: "Product navigation",
        decision: "reuse-component",
        componentId: "component_catalog_navigation",
        instances: [
          { targetId: "profile", nodeId: "profile_navigation_instance" },
        ],
      },
    ];
    input.referenceStrategy = {
      synthesis:
        "Transfer the attached reference's tonal hierarchy without changing the requested product semantics.",
      references: [
        {
          attachmentId: `image_${"d".repeat(64)}`,
          decision: "composition-reference",
          application:
            "Use its asymmetrical balance and negative-space ratio as directional guidance.",
          preserve: ["asymmetrical balance"],
          avoid: ["literal layout copy"],
        },
      ],
    };
    expect(isDesignFirstSliceToolInput(input)).toBe(true);

    const compiled = compileDesignFirstSliceToolInput(input);
    expect(isDesignPlanToolInput(compiled.plan)).toBe(true);
    expect(isDesignApplyToolInput(compiled.apply)).toBe(true);
    expect(compiled.plan).toMatchObject({
      version: 1,
      skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS,
      designIntent: {
        visualThesis:
          "Momentum is expressed as a directional editorial system rather than a generic mobile card stack.",
        signatureMotif:
          "A cropped directional panel and offset type axis create a recognizable motion cue.",
      },
      briefFidelity: {
        requiredContent: ["Home and Profile product screens"],
        prohibitedAdditions: ["No unrequested workflow or run features"],
      },
      referenceStrategy: input.referenceStrategy,
      componentStrategy: {
        candidates: [
          {
            decision: "reuse-component",
            componentId: "component_catalog_navigation",
            instances: [
              {
                targetId: "profile",
                nodeId: "profile_navigation_instance",
              },
            ],
          },
        ],
      },
    });
    expect(
      compiled.plan.targets.map((target) => target.artboard.frameId),
    ).toEqual(["frame_home", "frame_profile"]);
    expect(compiled.plan.targets[0]?.qualityProfile).toMatchObject({
      kind: "ui",
      platform: "ios",
      safeAreaNodeIds: ["hero_title"],
    });
    expect(compiled.apply.steps).toEqual([
      {
        stepId: "hero_stage",
        label: "Build real hero",
        commandIds: ["first_slice_1", "first_slice_2", "first_slice_3"],
      },
    ]);
    expect(compiled.apply.commands).toMatchObject([
      {
        parentId: "frame_home",
        node: { id: "home_hero", kind: "frame", childIds: [] },
      },
      {
        parentId: "home_hero",
        node: { id: "hero_panel", kind: "rectangle", childIds: [] },
      },
      {
        parentId: "home_hero",
        node: {
          id: "hero_title",
          kind: "text",
          properties: {
            fontFamily: "Inter",
            fontStyleName: "Bold",
            fontWeight: 700,
            textResize: "auto-height",
          },
        },
      },
    ]);
  });

  it("lets Main bind skill revisions instead of requiring model hash echoing", () => {
    const input = fixture();
    const { skillRefs: _skillRefs, ...modelInput } = input;
    expect(_skillRefs).toEqual(BUILTIN_UI_DESIGN_SKILL_REFS);

    const normalized = normalizeDesignFirstSliceToolInput(modelInput);
    expect(normalized?.skillRefs).toEqual(BUILTIN_UI_DESIGN_SKILL_REFS);
    expect(normalized && isDesignFirstSliceToolInput(normalized)).toBe(true);

    const staleHostEcho = {
      ...modelInput,
      skillRefs: [{ id: "stale", version: 99, hash: "model-controlled" }],
    };
    expect(
      normalizeDesignFirstSliceToolInput(staleHostEcho)?.skillRefs,
    ).toEqual(BUILTIN_UI_DESIGN_SKILL_REFS);
  });

  it("binds graphic judgment skills and raster evidence roles for a poster", () => {
    const input = fixture();
    input.deliverable = "poster";
    input.rasterAssetRoles = ["hero"];
    input.targets = input.targets.map((target) => ({
      ...target,
      qualityProfile: { kind: "graphic" },
    }));
    const { skillRefs: modelSkillRefs, ...modelInput } = input;
    expect(modelSkillRefs).toEqual(BUILTIN_UI_DESIGN_SKILL_REFS);

    const normalized = normalizeDesignFirstSliceToolInput(modelInput);
    expect(normalized?.skillRefs).toEqual(BUILTIN_GRAPHIC_DESIGN_SKILL_REFS);
    expect(normalized?.rasterAssetRoles).toEqual(["hero"]);
    expect(normalized && isDesignFirstSliceToolInput(normalized)).toBe(true);
    expect(
      normalized && compileDesignFirstSliceToolInput(normalized).plan,
    ).toMatchObject({
      deliverable: "poster",
      rasterAssetRoles: ["hero"],
      skillRefs: BUILTIN_GRAPHIC_DESIGN_SKILL_REFS,
    });
  });

  it("requires three structurally different logo directions and compiles editable Path evidence", () => {
    const input = fixture();
    input.deliverable = "logo";
    input.targets = input.targets.map((target) => ({
      ...target,
      qualityProfile: { kind: "graphic" },
    }));
    input.logoExploration = {
      targetId: "home",
      directions: [
        logoDirection("concept_negative", "negative-space", "negative"),
        logoDirection("concept_modular", "modular-system", "modular"),
        logoDirection(
          "concept_typographic",
          "typographic-relationship",
          "typographic",
        ),
      ],
    };
    input.firstSlice.stages[0].elements[1] = {
      id: "hero_panel",
      kind: "path",
      name: "Editable Identity Contour",
      parentId: "home_hero",
      x: 24,
      y: 24,
      width: 160,
      height: 160,
      path: "M 0 0 H 160 V 48 H 48 V 160 H 0 Z",
      fill: { color: "#0F172A" },
    };

    const modelInput = structuredClone(input);
    Reflect.deleteProperty(modelInput, "skillRefs");
    const normalized = normalizeDesignFirstSliceToolInput(modelInput);
    expect(normalized?.skillRefs).toEqual(BUILTIN_LOGO_DESIGN_SKILL_REFS);
    expect(normalized && isDesignFirstSliceToolInput(normalized)).toBe(true);
    expect(
      normalized &&
        compileDesignFirstSliceToolInput(normalized).apply.commands[1],
    ).toMatchObject({
      node: {
        kind: "path",
        properties: {
          path: "M 0 0 H 160 V 48 H 48 V 160 H 0 Z",
          fillRule: "nonzero",
        },
      },
    });

    const duplicatePrinciple = structuredClone(modelInput);
    if (!duplicatePrinciple.logoExploration) {
      throw new Error("Expected Logo exploration fixture");
    }
    duplicatePrinciple.logoExploration.directions[1].principle =
      "negative-space";
    expect(
      normalizeDesignFirstSliceToolInput(duplicatePrinciple),
    ).toBeUndefined();

    const missingExploration = structuredClone(modelInput);
    delete missingExploration.logoExploration;
    expect(
      normalizeDesignFirstSliceToolInput(missingExploration),
    ).toBeUndefined();
  });

  it("rejects duplicate IDs, forward parents, empty regions and a slice for a later target", () => {
    const duplicate = fixture();
    duplicate.firstSlice.stages[0].elements[1].id = "home_hero";
    expect(isDesignFirstSliceToolInput(duplicate)).toBe(false);

    const forwardParent = fixture();
    forwardParent.firstSlice.stages[0].elements[0].parentId = "hero_panel";
    expect(isDesignFirstSliceToolInput(forwardParent)).toBe(false);

    const emptyRegion = fixture();
    emptyRegion.firstSlice.stages[0].elements.splice(1);
    expect(isDesignFirstSliceToolInput(emptyRegion)).toBe(false);

    const wrongTarget = fixture();
    wrongTarget.firstSlice.targetId = "profile";
    expect(isDesignFirstSliceToolInput(wrongTarget)).toBe(false);
  });

  it("accepts the 25-element two-stage production login slice that previously failed before any revision", () => {
    const input = fixture();
    input.firstSlice.stages.push({
      stageId: "auth_stage",
      label: "Build editable authentication controls",
      elements: Array.from({ length: 22 }, (_, index) => ({
        id: `auth_control_${index}`,
        kind: "rectangle" as const,
        name: `Auth Control ${index}`,
        parentId: "home_hero",
        x: 8 + (index % 11) * 20,
        y: 160 + Math.floor(index / 11) * 24,
        width: 16,
        height: 16,
        fill: { color: "#7C3AED" },
      })),
    });

    expect(
      input.firstSlice.stages.reduce(
        (total, stage) => total + stage.elements.length,
        0,
      ),
    ).toBe(25);
    expect(normalizeDesignFirstSliceToolInput(input)).toBeDefined();
    expect(explainInvalidDesignFirstSliceToolInput(input)).toBeUndefined();
  });

  it("bounds the first visible write to one planned region, three stages and 32 elements with a field-level recovery", () => {
    const tooManyElements = fixture();
    const stage = tooManyElements.firstSlice.stages[0];
    for (let index = 0; index < 30; index += 1) {
      stage.elements.push({
        id: `support_${index}`,
        kind: "rectangle",
        name: `Support ${index}`,
        parentId: "home_hero",
        x: 8 + index,
        y: 160,
        width: 8,
        height: 8,
        fill: { color: "#7C3AED" },
      });
    }
    expect(isDesignFirstSliceToolInput(tooManyElements)).toBe(false);
    expect(explainInvalidDesignFirstSliceToolInput(tooManyElements)).toContain(
      "/firstSlice/stages: contains 33 elements",
    );
    expect(explainInvalidDesignFirstSliceToolInput(tooManyElements)).toContain(
      "combined maximum is 32",
    );

    const tooManyStages = fixture();
    for (let index = 0; index < 3; index += 1) {
      tooManyStages.firstSlice.stages.push({
        stageId: `extra_stage_${index}`,
        label: `Extra stage ${index}`,
        elements: [
          {
            id: `extra_${index}`,
            kind: "rectangle",
            name: `Extra ${index}`,
            parentId: "home_hero",
            x: 12 + index * 12,
            y: 180,
            width: 8,
            height: 8,
            fill: { color: "#7C3AED" },
          },
        ],
      });
    }
    expect(isDesignFirstSliceToolInput(tooManyStages)).toBe(false);

    const multipleRegions = fixture();
    multipleRegions.targets[0].regions.push({
      nodeId: "home_navigation",
      name: "Navigation",
      role: "interaction",
      x: 24,
      y: 24,
      width: 342,
      height: 40,
    });
    multipleRegions.firstSlice.stages.push({
      stageId: "navigation_stage",
      label: "Build navigation",
      elements: [
        {
          id: "home_navigation",
          kind: "group",
          name: "Navigation",
          parentId: "frame_home",
          x: 24,
          y: 24,
          width: 342,
          height: 40,
        },
        {
          id: "navigation_mark",
          kind: "rectangle",
          name: "Navigation Mark",
          parentId: "home_navigation",
          x: 0,
          y: 0,
          width: 40,
          height: 40,
          fill: { color: "#7C3AED" },
        },
      ],
    });
    expect(isDesignFirstSliceToolInput(multipleRegions)).toBe(false);
  });
});

export function fixture(): DesignFirstSliceToolInput {
  return {
    version: 1,
    deliverable: "ui",
    objective: "Create Home and Profile screens",
    designIntent: {
      subject: "A mobile product for maintaining creative momentum",
      audience: "Independent designers managing focused daily work",
      primaryJob: "See the next meaningful task and continue it immediately",
      visualThesis:
        "Momentum is expressed as a directional editorial system rather than a generic mobile card stack.",
      signatureMotif:
        "A cropped directional panel and offset type axis create a recognizable motion cue.",
      typographyLanguage:
        "Editorial display type creates pace while compact neutral body type preserves clarity.",
      colorMaterialLanguage:
        "Deep ink surfaces and one electric violet signal use paper-like tonal separation.",
      compositionTension:
        "Offset alignment, decisive scale contrast, and cropped edges pull attention forward.",
      antiPatterns: [
        "No centered card floating on a decorative background",
        "No repeated same-radius feature tiles",
        "No generic purple gradient used as the only identity",
      ],
    },
    skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
      ...reference,
    })),
    briefFidelity: {
      requiredContent: ["Home and Profile product screens"],
      preservedSemantics: [
        "Home remains a product overview and Profile remains an account overview",
      ],
      prohibitedAdditions: ["No unrequested workflow or run features"],
      assumptions: ["Use a mobile viewport for both requested screens"],
    },
    targets: [
      {
        targetId: "home",
        label: "Home",
        pageId: "page_1",
        objective: "A focused product overview",
        frame: {
          frameId: "frame_home",
          x: 80,
          y: 40,
          width: 390,
          height: 844,
        },
        layout: "Vertical mobile composition",
        spacing: "8px base with 24px section rhythm",
        qualityProfile: {
          kind: "ui",
          platform: "ios",
          input: "touch",
          insets: [59, 0, 34, 0],
          safeNodeIds: ["hero_title"],
          hitNodeIds: [],
        },
        regions: [
          {
            nodeId: "home_hero",
            name: "Hero",
            role: "content",
            x: 24,
            y: 80,
            width: 342,
            height: 260,
          },
        ],
      },
      {
        targetId: "profile",
        label: "Profile",
        pageId: "page_1",
        objective: "A clear account overview",
        frame: {
          frameId: "frame_profile",
          x: 510,
          y: 40,
          width: 390,
          height: 844,
        },
        layout: "Vertical mobile composition",
        spacing: "8px base with 24px section rhythm",
        qualityProfile: {
          kind: "ui",
          platform: "ios",
          input: "touch",
          insets: [59, 0, 34, 0],
          safeNodeIds: ["profile_header"],
          hitNodeIds: [],
        },
        regions: [
          {
            nodeId: "profile_header",
            name: "Profile Header",
            role: "content",
            x: 24,
            y: 80,
            width: 342,
            height: 220,
          },
        ],
      },
    ],
    visualSystem: {
      formLanguage: "Calm editorial geometry",
      palette: ["#0F172A", "#F8FAFC", "#7C3AED"],
      surfaceAndDepth: "Flat hierarchy with one elevated focal surface",
      typography: ["Inter Bold 32/38", "Inter Regular 16/24"],
    },
    rasterAssetRoles: [],
    firstSlice: {
      targetId: "home",
      label: "Create Home hero",
      stages: [
        {
          stageId: "hero_stage",
          label: "Build real hero",
          elements: [
            {
              id: "home_hero",
              kind: "frame",
              name: "Hero",
              parentId: "frame_home",
              x: 24,
              y: 80,
              width: 342,
              height: 260,
              fill: { color: "#F8FAFC" },
              cornerRadius: 24,
            },
            {
              id: "hero_panel",
              kind: "rectangle",
              name: "Hero Panel",
              parentId: "home_hero",
              x: 0,
              y: 0,
              width: 342,
              height: 260,
              fill: { color: "#EDE9FE" },
              cornerRadius: 24,
            },
            {
              id: "hero_title",
              kind: "text",
              name: "Hero Title",
              parentId: "home_hero",
              x: 24,
              y: 28,
              width: 294,
              height: 92,
              text: {
                content: "Design with momentum",
                fontFamily: "Inter",
                fontStyleName: "Bold",
                fontWeight: 700,
                fontSlant: "normal",
                fontSize: 32,
                lineHeight: 38,
                color: "#0F172A",
                textResize: "auto-height",
              },
            },
          ],
        },
      ],
    },
  };
}

function logoDirection(
  conceptId: string,
  principle: "negative-space" | "modular-system" | "typographic-relationship",
  prefix: string,
) {
  return {
    conceptId,
    principle,
    thesis: `${prefix} construction creates a materially different brand silhouette.`,
    rootNodeId: `${prefix}_root`,
    evidenceNodeIds: [
      `${prefix}_mono`,
      `${prefix}_32`,
      `${prefix}_24`,
      `${prefix}_16`,
    ] as [string, string, string, string],
  };
}
