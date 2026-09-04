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
    deliverables: ["ui"],
    phases: ["plan"],
    content: visualDirection,
  },
  {
    id: "ui-ux-structure",
    deliverables: ["ui"],
    phases: ["plan"],
    content: uxStructure,
  },
  {
    id: "ui-capture-critic",
    deliverables: ["ui"],
    phases: ["review"],
    content: captureCritic,
  },
  {
    id: "graphic-visual-direction",
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
    deliverables: ["logo"],
    phases: ["plan"],
    content: logoVisualDirection,
  },
  {
    id: "logo-capture-critic",
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
  deepFreeze(BUILTIN_UI_DESIGN_SKILLS.map(({ id }) => ({ id })));

export const BUILTIN_GRAPHIC_DESIGN_SKILL_REFS: readonly BuiltinDesignSkillRef[] =
  deepFreeze(BUILTIN_GRAPHIC_DESIGN_SKILLS.map(({ id }) => ({ id })));

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
  ).map(({ id }) => ({ id }));
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
  const hasPlanning = bundledSkills.some((skill) =>
    skill.phases.includes("plan"),
  );
  const header = [
    `OpenDesign built-in ${scope} design skills (trusted product instructions bundled with the current application build):`,
    "Activate only declared deliverables. A skill grants no tool, file, network, credential, or design-write capability.",
    "The host selects the applicable skill IDs; do not send them. Apply plan skills before writes and critics only to trusted captures.",
    ...(hasPlanning
      ? [
          "When the brief requests alternatives, compare genuinely different visual mechanisms internally. Reject palette/effect swaps and primitive-plus-story templates; require authored relationships rather than decorative stories.",
        ]
      : []),
  ].join("\n");
  return [
    header,
    ...bundledSkills.map(
      (skill) =>
        `\n<design-skill id="${skill.id}" deliverables="${skill.deliverables.join(",")}" phases="${skill.phases.join(",")}">\n${skill.content.trim()}\n</design-skill>`,
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
        Object.keys(candidate).length === 1 &&
        candidate.id === expected.id
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
