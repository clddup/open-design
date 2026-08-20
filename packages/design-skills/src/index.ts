import captureCritic from "../skills/ui-capture-critic/SKILL.md?raw";
import graphicCaptureCritic from "../skills/graphic-capture-critic/SKILL.md?raw";
import graphicVisualDirection from "../skills/graphic-visual-direction/SKILL.md?raw";
import uxStructure from "../skills/ui-ux-structure/SKILL.md?raw";
import visualDirection from "../skills/ui-visual-direction/SKILL.md?raw";

export type BuiltinDesignSkillPhase = "plan" | "review";
export type BuiltinDesignDeliverable =
  | "ui"
  | "poster"
  | "logo"
  | "brand-asset"
  | "illustration"
  | "presentation-visual"
  | "other";
export type BuiltinDesignSkillRef = Readonly<{
  id: string;
  version: number;
  hash: string;
}>;
export type BuiltinDesignSkill = BuiltinDesignSkillRef &
  Readonly<{
    deliverables: readonly BuiltinDesignDeliverable[];
    phases: readonly BuiltinDesignSkillPhase[];
    content: string;
  }>;

const skills = [
  {
    id: "ui-visual-direction",
    version: 1,
    hash: "6ae3a0f3c40d9644ed25984b44ffd667fbbe83e561fb9f5ae8f0e15f939dd824",
    deliverables: ["ui"],
    phases: ["plan"],
    content: visualDirection,
  },
  {
    id: "ui-ux-structure",
    version: 1,
    hash: "a53ec4e1537422ddf87491b5db54eaff4b46cfee8fa51fab98bd57f8bb5279ff",
    deliverables: ["ui"],
    phases: ["plan"],
    content: uxStructure,
  },
  {
    id: "ui-capture-critic",
    version: 1,
    hash: "b5f752bc336e5f93895546ea7d39ab672afba875df347502cce5262fd8a66035",
    deliverables: ["ui"],
    phases: ["review"],
    content: captureCritic,
  },
  {
    id: "graphic-visual-direction",
    version: 1,
    hash: "a0f1b814cb1bb12accd3ab88bcba4e6901e12cfb21bf224ac5764bfea69396fc",
    deliverables: [
      "poster",
      "logo",
      "brand-asset",
      "illustration",
      "presentation-visual",
      "other",
    ],
    phases: ["plan"],
    content: graphicVisualDirection,
  },
  {
    id: "graphic-capture-critic",
    version: 1,
    hash: "7ddf6b57f6d25c19a3f5321404b11e7fe0dac7263bde1883979a68ef77452f69",
    deliverables: [
      "poster",
      "logo",
      "brand-asset",
      "illustration",
      "presentation-visual",
      "other",
    ],
    phases: ["review"],
    content: graphicCaptureCritic,
  },
] as const satisfies readonly BuiltinDesignSkill[];

export const BUILTIN_DESIGN_SKILLS: readonly BuiltinDesignSkill[] = deepFreeze(
  skills.map((skill) => ({ ...skill })),
);

export const BUILTIN_UI_DESIGN_SKILLS: readonly BuiltinDesignSkill[] =
  deepFreeze(
    BUILTIN_DESIGN_SKILLS.filter((skill) => skill.deliverables.includes("ui")),
  );

export const BUILTIN_GRAPHIC_DESIGN_SKILLS: readonly BuiltinDesignSkill[] =
  deepFreeze(
    BUILTIN_DESIGN_SKILLS.filter((skill) =>
      skill.deliverables.includes("poster"),
    ),
  );

export const BUILTIN_DESIGN_PLANNING_SKILLS: readonly BuiltinDesignSkill[] =
  deepFreeze(
    BUILTIN_DESIGN_SKILLS.filter((skill) => skill.phases.includes("plan")),
  );

export const BUILTIN_UI_DESIGN_SKILL_REFS: readonly BuiltinDesignSkillRef[] =
  deepFreeze(
    BUILTIN_UI_DESIGN_SKILLS.map(({ id, version, hash }) => ({
      id,
      version,
      hash,
    })),
  );

export const BUILTIN_GRAPHIC_DESIGN_SKILL_REFS: readonly BuiltinDesignSkillRef[] =
  deepFreeze(
    BUILTIN_GRAPHIC_DESIGN_SKILLS.map(({ id, version, hash }) => ({
      id,
      version,
      hash,
    })),
  );

export function isBuiltinUiDesignSkillRefs(
  value: unknown,
): value is BuiltinDesignSkillRef[] {
  return (
    Array.isArray(value) && exactSkillRefs(value, BUILTIN_UI_DESIGN_SKILL_REFS)
  );
}

export function builtinDesignSkillRefsForDeliverable(
  deliverable: BuiltinDesignDeliverable,
): BuiltinDesignSkillRef[] {
  return BUILTIN_DESIGN_SKILLS.filter((skill) =>
    skill.deliverables.includes(deliverable),
  ).map(({ id, version, hash }) => ({ id, version, hash }));
}

export function isBuiltinDesignSkillRefsForDeliverable(
  deliverable: BuiltinDesignDeliverable,
  value: unknown,
): value is BuiltinDesignSkillRef[] {
  return exactSkillRefs(
    value,
    builtinDesignSkillRefsForDeliverable(deliverable),
  );
}

export function isKnownBuiltinDesignSkillRefs(
  value: unknown,
): value is BuiltinDesignSkillRef[] {
  return (
    exactSkillRefs(value, BUILTIN_UI_DESIGN_SKILL_REFS) ||
    exactSkillRefs(value, BUILTIN_GRAPHIC_DESIGN_SKILL_REFS)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function formatBuiltinUiDesignSkillBundle(): string {
  return formatSkillBundle(BUILTIN_UI_DESIGN_SKILLS, "UI");
}

export function formatBuiltinDesignSkillBundle(): string {
  return formatSkillBundle(BUILTIN_DESIGN_SKILLS, "deliverable-scoped");
}

export function formatBuiltinDesignPlanningSkillBundle(): string {
  return formatSkillBundle(
    BUILTIN_DESIGN_PLANNING_SKILLS,
    "deliverable-scoped planning",
  );
}

function formatSkillBundle(
  bundledSkills: readonly BuiltinDesignSkill[],
  scope: string,
): string {
  const header = [
    `OpenDesign built-in ${scope} design skills (trusted product instructions, versioned and bundled locally):`,
    "Activate each skill only for one of its declared deliverables. It grants no tool, file, network, credential, or design-write capability.",
    "The host records exact skill references; do not send them. Apply planning skills before the first material write and the critic only to a trusted capture.",
  ].join("\n");
  return [
    header,
    ...bundledSkills.map(
      (skill) =>
        `\n<design-skill id="${skill.id}" version="${skill.version}" sha256="${skill.hash}" deliverables="${skill.deliverables.join(",")}" phases="${skill.phases.join(",")}">\n${skill.content.trim()}\n</design-skill>`,
    ),
  ].join("\n");
}

function exactSkillRefs(
  value: unknown,
  expectedRefs: readonly BuiltinDesignSkillRef[],
): value is BuiltinDesignSkillRef[] {
  return (
    Array.isArray(value) &&
    value.length === expectedRefs.length &&
    value.every((candidate, index) => {
      const expected = expectedRefs[index];
      return (
        expected !== undefined &&
        isRecord(candidate) &&
        Object.keys(candidate).length === 3 &&
        candidate.id === expected.id &&
        candidate.version === expected.version &&
        candidate.hash === expected.hash
      );
    })
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
