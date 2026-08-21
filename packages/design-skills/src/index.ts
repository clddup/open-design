import captureCritic from "../skills/ui-capture-critic/SKILL.md?raw";
import graphicCaptureCritic from "../skills/graphic-capture-critic/SKILL.md?raw";
import graphicVisualDirection from "../skills/graphic-visual-direction/SKILL.md?raw";
import logoCaptureCritic from "../skills/logo-capture-critic/SKILL.md?raw";
import logoVisualDirection from "../skills/logo-visual-direction/SKILL.md?raw";
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
    hash: "2d7d09f1095de84031b7880ae0958aa9a98ac3b1752f07d07cc2902396bc30da",
    deliverables: ["ui"],
    phases: ["plan"],
    content: visualDirection,
  },
  {
    id: "ui-ux-structure",
    version: 1,
    hash: "699e62caa2100fc8e2c7845bb34358561304997c6c028d3d8516c049f2d04a0f",
    deliverables: ["ui"],
    phases: ["plan"],
    content: uxStructure,
  },
  {
    id: "ui-capture-critic",
    version: 1,
    hash: "dcacdb7788d4271575565b7e30a36cbeb0e1e11e57a6517cedc8290dddd399c2",
    deliverables: ["ui"],
    phases: ["review"],
    content: captureCritic,
  },
  {
    id: "graphic-visual-direction",
    version: 1,
    hash: "30847b87e4004bf8e646a65bf02aca8726aa69abf875215aa02dd3c41589528d",
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
    hash: "91e0949bb7c1245b5bda0e1b242f1315bbbf614800473c193870f7096327476e",
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
  {
    id: "logo-visual-direction",
    version: 1,
    hash: "c78f74f3e398d0a272c03432e710ef1a98ac11dccd6847fcdc0698b2c51a5997",
    deliverables: ["logo"],
    phases: ["plan"],
    content: logoVisualDirection,
  },
  {
    id: "logo-capture-critic",
    version: 1,
    hash: "eef9407c63a7e0d1c4ef63881ede45644d6cd372d2ee4581bbc2ca4587c05b56",
    deliverables: ["logo"],
    phases: ["review"],
    content: logoCaptureCritic,
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

export const BUILTIN_LOGO_DESIGN_SKILL_REFS: readonly BuiltinDesignSkillRef[] =
  deepFreeze(builtinDesignSkillRefsForDeliverable("logo"));

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
    [
      "ui",
      "poster",
      "logo",
      "brand-asset",
      "illustration",
      "presentation-visual",
      "other",
    ] as const
  ).some((deliverable) =>
    exactSkillRefs(value, builtinDesignSkillRefsForDeliverable(deliverable)),
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

export function formatBuiltinDesignPlanningSkillBundleForDeliverable(
  deliverable: BuiltinDesignDeliverable,
): string {
  return formatSkillBundle(
    BUILTIN_DESIGN_SKILLS.filter(
      (skill) =>
        skill.phases.includes("plan") &&
        skill.deliverables.includes(deliverable),
    ),
    `${deliverable} planning`,
  );
}

export function formatBuiltinDesignReviewSkillBundleForDeliverable(
  deliverable: BuiltinDesignDeliverable,
): string {
  return formatSkillBundle(
    BUILTIN_DESIGN_SKILLS.filter(
      (skill) =>
        skill.phases.includes("review") &&
        skill.deliverables.includes(deliverable),
    ),
    `${deliverable} review`,
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
