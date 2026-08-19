import captureCritic from "../skills/ui-capture-critic/SKILL.md?raw";
import uxStructure from "../skills/ui-ux-structure/SKILL.md?raw";
import visualDirection from "../skills/ui-visual-direction/SKILL.md?raw";

export type BuiltinDesignSkillPhase = "plan" | "review";
export type BuiltinDesignSkillRef = Readonly<{
  id: string;
  version: number;
  hash: string;
}>;
export type BuiltinDesignSkill = BuiltinDesignSkillRef &
  Readonly<{
    deliverables: readonly ["ui"];
    phases: readonly BuiltinDesignSkillPhase[];
    content: string;
  }>;

const skills = [
  {
    id: "ui-visual-direction",
    version: 1,
    hash: "d7113302c59c9bf92c31bb7b19b811b85e0d77b65e05ea4fd2da5b0928460072",
    deliverables: ["ui"],
    phases: ["plan"],
    content: visualDirection,
  },
  {
    id: "ui-ux-structure",
    version: 1,
    hash: "e8632570c6061639aad5af485d91a1b9ea7691f1fc1b1d835777247f2f91aae6",
    deliverables: ["ui"],
    phases: ["plan"],
    content: uxStructure,
  },
  {
    id: "ui-capture-critic",
    version: 1,
    hash: "dacdd1eaa9c0e253168ce67255dd35fad65948b13f2b782b2a4f76f188f5a99f",
    deliverables: ["ui"],
    phases: ["review"],
    content: captureCritic,
  },
] as const satisfies readonly BuiltinDesignSkill[];

export const BUILTIN_UI_DESIGN_SKILLS: readonly BuiltinDesignSkill[] =
  deepFreeze(skills.map((skill) => ({ ...skill })));

export const BUILTIN_UI_DESIGN_SKILL_REFS: readonly BuiltinDesignSkillRef[] =
  deepFreeze(
    BUILTIN_UI_DESIGN_SKILLS.map(({ id, version, hash }) => ({
      id,
      version,
      hash,
    })),
  );

export function isBuiltinUiDesignSkillRefs(
  value: unknown,
): value is BuiltinDesignSkillRef[] {
  return (
    Array.isArray(value) &&
    value.length === BUILTIN_UI_DESIGN_SKILL_REFS.length &&
    value.every((candidate, index) => {
      const expected = BUILTIN_UI_DESIGN_SKILL_REFS[index];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function formatBuiltinUiDesignSkillBundle(): string {
  const header = [
    "OpenDesign built-in UI design skills (trusted product instructions, versioned and bundled locally):",
    "Activate this bundle only when the planned deliverable is UI. It grants no tool, file, network, credential, or design-write capability.",
    "Record the exact skill references in the current Design Plan and typed Visual Review. Apply planning skills before the first material write and the critic only to a trusted capture.",
  ].join("\n");
  return [
    header,
    ...BUILTIN_UI_DESIGN_SKILLS.map(
      (skill) =>
        `\n<design-skill id="${skill.id}" version="${skill.version}" sha256="${skill.hash}" phases="${skill.phases.join(",")}">\n${skill.content.trim()}\n</design-skill>`,
    ),
  ].join("\n");
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
