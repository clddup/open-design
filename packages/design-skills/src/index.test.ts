import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  builtinDesignSkillRefsForDeliverable,
  BUILTIN_DESIGN_PLANNING_SKILLS,
  BUILTIN_DESIGN_SKILLS,
  BUILTIN_GRAPHIC_DESIGN_SKILL_REFS,
  BUILTIN_GRAPHIC_DESIGN_SKILLS,
  BUILTIN_UI_DESIGN_SKILLS,
  BUILTIN_UI_DESIGN_SKILL_REFS,
  formatBuiltinDesignSkillBundle,
  formatBuiltinDesignPlanningSkillBundle,
  formatBuiltinDesignPlanningSkillBundleForDeliverable,
  formatBuiltinDesignReviewSkillBundleForDeliverable,
  formatBuiltinUiDesignSkillBundle,
  isBuiltinDesignSkillRefsForDeliverable,
  isBuiltinUiDesignSkillRefs,
} from "./index.js";

describe("built-in design skills", () => {
  it("pins immutable, unique content hashes", () => {
    expect(Object.isFrozen(BUILTIN_DESIGN_SKILLS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_DESIGN_PLANNING_SKILLS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_UI_DESIGN_SKILLS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_GRAPHIC_DESIGN_SKILLS)).toBe(true);
    expect(new Set(BUILTIN_DESIGN_SKILLS.map(({ id }) => id)).size).toBe(7);
    for (const skill of BUILTIN_DESIGN_SKILLS) {
      expect(skill.hash).toBe(
        createHash("sha256").update(skill.content).digest("hex"),
      );
    }
  });

  it("formats a bounded automatic bundle without executable capabilities", () => {
    const bundle = formatBuiltinUiDesignSkillBundle();
    for (const reference of BUILTIN_UI_DESIGN_SKILL_REFS) {
      expect(bundle).toContain(`id="${reference.id}"`);
      expect(bundle).toContain(`sha256="${reference.hash}"`);
    }
    expect(bundle).toContain("grants no tool");
    expect(bundle).toContain("The host records exact skill references");
    expect(bundle).toContain("do not send them");
    expect(bundle.length).toBeLessThan(12_000);

    const allDeliverables = formatBuiltinDesignSkillBundle();
    for (const reference of BUILTIN_GRAPHIC_DESIGN_SKILL_REFS) {
      expect(allDeliverables).toContain(`id="${reference.id}"`);
    }
    expect(allDeliverables).toContain(
      "credibility depends on real people, activities, places, products",
    );
    expect(allDeliverables.length).toBeLessThan(24_000);

    const planning = formatBuiltinDesignPlanningSkillBundle();
    expect(planning).toContain('id="graphic-visual-direction"');
    expect(planning).not.toContain('id="graphic-capture-critic"');
    expect(planning).not.toContain('id="ui-capture-critic"');
    expect(planning.length).toBeLessThan(12_000);

    const logoPlanning =
      formatBuiltinDesignPlanningSkillBundleForDeliverable("logo");
    expect(logoPlanning).toContain('id="graphic-visual-direction"');
    expect(logoPlanning).toContain('id="logo-visual-direction"');
    expect(logoPlanning).not.toContain('id="ui-visual-direction"');
    expect(logoPlanning).not.toContain('id="logo-capture-critic"');

    const uiPlanning =
      formatBuiltinDesignPlanningSkillBundleForDeliverable("ui");
    expect(uiPlanning).toContain('id="ui-visual-direction"');
    expect(uiPlanning).toContain('id="ui-ux-structure"');
    expect(uiPlanning).not.toContain('id="graphic-visual-direction"');

    const logoReview =
      formatBuiltinDesignReviewSkillBundleForDeliverable("logo");
    expect(logoReview).toContain('id="graphic-capture-critic"');
    expect(logoReview).toContain('id="logo-capture-critic"');
    expect(logoReview).not.toContain('id="logo-visual-direction"');
  });

  it("accepts only the exact ordered built-in references", () => {
    expect(isBuiltinUiDesignSkillRefs(BUILTIN_UI_DESIGN_SKILL_REFS)).toBe(true);
    expect(
      isBuiltinUiDesignSkillRefs(BUILTIN_UI_DESIGN_SKILL_REFS.slice(1)),
    ).toBe(false);
    expect(
      isBuiltinUiDesignSkillRefs([
        { ...BUILTIN_UI_DESIGN_SKILL_REFS[0], hash: "stale" },
        ...BUILTIN_UI_DESIGN_SKILL_REFS.slice(1),
      ]),
    ).toBe(false);
    expect(builtinDesignSkillRefsForDeliverable("poster")).toEqual(
      BUILTIN_GRAPHIC_DESIGN_SKILL_REFS,
    );
    expect(
      isBuiltinDesignSkillRefsForDeliverable(
        "poster",
        BUILTIN_GRAPHIC_DESIGN_SKILL_REFS,
      ),
    ).toBe(true);
    expect(
      isBuiltinDesignSkillRefsForDeliverable(
        "poster",
        BUILTIN_UI_DESIGN_SKILL_REFS,
      ),
    ).toBe(false);
  });
});
