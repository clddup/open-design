import { describe, expect, it } from "vitest";
import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import {
  compileDesignFirstSliceToolInput,
  DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
  isDesignFirstSliceToolInput,
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
    expect(
      properties.firstSlice.properties.stages.items.properties.elements
        .maxItems,
    ).toBe(24);
  });

  it("compiles all targets into the current Plan with pinned skills and a canonical first slice", () => {
    const input = fixture();
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

  it("bounds the first visible write to one planned region, three stages and 24 elements", () => {
    const tooManyElements = fixture();
    const stage = tooManyElements.firstSlice.stages[0];
    for (let index = 0; index < 22; index += 1) {
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
