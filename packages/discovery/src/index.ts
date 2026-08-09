import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";

export type DiscoverySource = "project" | "user" | "builtin";
export type TrustLevel = "trusted" | "workspace" | "untrusted";

export interface SkillManifest {
  name: string;
  description: string;
  license?: string;
}

export interface DiscoveredSkill {
  manifest: SkillManifest;
  source: DiscoverySource;
  trust: TrustLevel;
  location: string;
  contentHash: string;
  loadedAt: string;
  diagnostics: string[];
}

export interface InstructionDocument {
  location: string;
  scope: string;
  source: "project" | "user";
  trust: TrustLevel;
  contentHash: string;
  content: string;
}

export interface DiscoveryOptions {
  projectRoot: string;
  targetPath?: string;
  userAgentsRoot?: string;
  builtinSkillsRoot?: string;
  workspaceTrusted: boolean;
}

const precedence: Record<DiscoverySource, number> = {
  project: 3,
  user: 2,
  builtin: 1,
};

export async function discoverSkills(
  options: DiscoveryOptions,
): Promise<{ skills: DiscoveredSkill[]; diagnostics: string[] }> {
  const roots: Array<{
    source: DiscoverySource;
    path: string;
    trust: TrustLevel;
  }> = [
    {
      source: "project",
      path: join(options.projectRoot, ".agents", "skills"),
      trust: options.workspaceTrusted ? "workspace" : "untrusted",
    },
    {
      source: "user",
      path: join(
        options.userAgentsRoot ?? join(homedir(), ".agents"),
        "skills",
      ),
      trust: "trusted",
    },
  ];

  if (options.builtinSkillsRoot) {
    roots.push({
      source: "builtin",
      path: options.builtinSkillsRoot,
      trust: "trusted",
    });
  }

  const candidates = (
    await Promise.all(
      roots.map((root) => discoverSkillRoot(root, options.projectRoot)),
    )
  ).flat();
  const selected = new Map<string, DiscoveredSkill>();
  const diagnostics: string[] = [];

  for (const candidate of candidates.sort(
    (left, right) => precedence[right.source] - precedence[left.source],
  )) {
    const existing = selected.get(candidate.manifest.name);
    if (existing) {
      diagnostics.push(
        `Skill ${candidate.manifest.name} from ${candidate.location} is shadowed by ${existing.location}`,
      );
      continue;
    }
    selected.set(candidate.manifest.name, candidate);
  }

  return { skills: [...selected.values()], diagnostics };
}

async function discoverSkillRoot(
  root: { source: DiscoverySource; path: string; trust: TrustLevel },
  projectRoot: string,
): Promise<DiscoveredSkill[]> {
  let entries;
  try {
    entries = await readdir(root.path, { withFileTypes: true });
  } catch {
    return [];
  }

  return (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map(async (entry): Promise<DiscoveredSkill | null> => {
          const skillDirectory = join(root.path, entry.name);
          const skillFile = join(skillDirectory, "SKILL.md");
          try {
            const safeLocation = await canonicalizeWithin(skillFile, root.path);
            const content = await readFile(safeLocation, "utf8");
            const manifest = parseSkillManifest(content);
            const diagnostics: string[] = [];
            if (manifest.name !== entry.name) {
              diagnostics.push(
                `Manifest name ${manifest.name} differs from directory ${entry.name}`,
              );
            }
            if (root.source === "project") {
              await canonicalizeWithin(skillDirectory, projectRoot);
            }
            return {
              manifest,
              source: root.source,
              trust: root.trust,
              location: safeLocation,
              contentHash: hash(content),
              loadedAt: new Date().toISOString(),
              diagnostics,
            };
          } catch {
            return null;
          }
        }),
    )
  ).filter((skill): skill is DiscoveredSkill => skill !== null);
}

export async function discoverInstructions(
  options: DiscoveryOptions,
): Promise<InstructionDocument[]> {
  const projectRoot = await realpath(options.projectRoot);
  const target = await canonicalizeWithin(
    options.targetPath ?? projectRoot,
    projectRoot,
  );
  const targetDirectory = (await stat(target)).isDirectory()
    ? target
    : dirname(target);
  const directories: string[] = [];
  let current = targetDirectory;

  while (isWithin(current, projectRoot)) {
    directories.unshift(current);
    if (current === projectRoot) break;
    current = dirname(current);
  }

  const documents: InstructionDocument[] = [];
  const userFile = join(
    options.userAgentsRoot ?? join(homedir(), ".agents"),
    "AGENTS.md",
  );
  const userInstruction = await readInstruction(userFile, "user", "trusted");
  if (userInstruction) documents.push(userInstruction);

  for (const directory of directories) {
    const instruction = await readInstruction(
      join(directory, "AGENTS.md"),
      "project",
      options.workspaceTrusted ? "workspace" : "untrusted",
    );
    if (instruction) documents.push(instruction);
  }

  return documents;
}

function parseSkillManifest(content: string): SkillManifest {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match?.[1]) throw new Error("SKILL.md requires YAML front matter");
  const value = parseYaml(match[1]) as Record<string, unknown>;
  if (typeof value.name !== "string" || typeof value.description !== "string") {
    throw new Error("SKILL.md requires name and description");
  }
  return {
    name: value.name,
    description: value.description,
    ...(typeof value.license === "string" ? { license: value.license } : {}),
  };
}

async function readInstruction(
  path: string,
  source: InstructionDocument["source"],
  trust: TrustLevel,
): Promise<InstructionDocument | null> {
  try {
    const location = await realpath(path);
    const content = await readFile(location, "utf8");
    return {
      location,
      scope: dirname(location),
      source,
      trust,
      contentHash: hash(content),
      content,
    };
  } catch {
    return null;
  }
}

async function canonicalizeWithin(path: string, root: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const canonicalPath = await realpath(path);
  if (!isWithin(canonicalPath, canonicalRoot)) {
    throw new Error(`Path escapes allowed root: ${path}`);
  }
  return canonicalPath;
}

function isWithin(path: string, root: string): boolean {
  const pathRelative = relative(resolve(root), resolve(path));
  return (
    pathRelative === "" ||
    (!pathRelative.startsWith(`..${sep}`) &&
      pathRelative !== ".." &&
      !isAbsolute(pathRelative))
  );
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
