import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_UI_DESIGN_SKILLS,
  BUILTIN_UI_DESIGN_SKILL_REFS,
  formatBuiltinUiDesignSkillBundle,
  isBuiltinUiDesignSkillRefs,
} from "./index.js";

describe("built-in design skills", () => {
  it("pins immutable, unique content hashes", () => {
    expect(Object.isFrozen(BUILTIN_UI_DESIGN_SKILLS)).toBe(true);
    expect(new Set(BUILTIN_UI_DESIGN_SKILLS.map(({ id }) => id)).size).toBe(3);
    for (const skill of BUILTIN_UI_DESIGN_SKILLS) {
      expect(skill.deliverables).toEqual(["ui"]);
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
  });
});
