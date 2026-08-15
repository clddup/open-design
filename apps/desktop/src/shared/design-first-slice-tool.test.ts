import { describe, expect, it } from "vitest";
import {
  compileDesignFirstSliceToolInput,
  isDesignFirstSliceToolInput,
  type DesignFirstSliceToolInput,
} from "./design-first-slice-tool";
import {
  isDesignApplyToolInput,
  isDesignPlanToolInput,
} from "./design-agent-tools";

describe("compact first-slice tool", () => {
  it("compiles all targets into Plan v4 and the first semantic slice into canonical nodes", () => {
    const input = fixture();
    expect(isDesignFirstSliceToolInput(input)).toBe(true);

    const compiled = compileDesignFirstSliceToolInput(input);
    expect(isDesignPlanToolInput(compiled.plan)).toBe(true);
    expect(isDesignApplyToolInput(compiled.apply)).toBe(true);
    expect(
      compiled.plan.targets.map((target) => target.artboard.frameId),
    ).toEqual(["frame_home", "frame_profile"]);
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
});

export function fixture(): DesignFirstSliceToolInput {
  return {
    version: 1,
    deliverable: "ui",
    objective: "Create Home and Profile screens",
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
