import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverInstructions, discoverSkills } from "./index.js";

async function createSkill(root: string, name: string, description: string) {
  const directory = join(root, "skills", name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nInstructions.\n`,
  );
}

describe("discovery", () => {
  it("prefers project skills and reports shadowed user skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-discovery-"));
    const project = join(root, "project");
    const user = join(root, "user");
    await createSkill(
      join(project, ".agents"),
      "ui-design",
      "Project design rules",
    );
    await createSkill(user, "ui-design", "User design rules");

    const result = await discoverSkills({
      projectRoot: project,
      userAgentsRoot: user,
      workspaceTrusted: true,
    });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.source).toBe("project");
    expect(result.diagnostics[0]).toContain("shadowed");
  });

  it("loads instructions from root to the target scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-instructions-"));
    const project = join(root, "project");
    const nested = join(project, "packages", "canvas");
    await mkdir(nested, { recursive: true });
    await writeFile(join(project, "AGENTS.md"), "Root rules");
    await writeFile(join(nested, "AGENTS.md"), "Canvas rules");

    const documents = await discoverInstructions({
      projectRoot: project,
      targetPath: nested,
      userAgentsRoot: join(root, "missing-user"),
      workspaceTrusted: true,
    });

    expect(documents.map((document) => document.content)).toEqual([
      "Root rules",
      "Canvas rules",
    ]);
  });

  it("does not follow a project skill symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-symlink-"));
    const project = join(root, "project");
    const skills = join(project, ".agents", "skills");
    const outside = join(root, "outside");
    await createSkill(outside, "unsafe", "Unsafe");
    await mkdir(skills, { recursive: true });
    await symlink(join(outside, "skills", "unsafe"), join(skills, "unsafe"));

    const result = await discoverSkills({
      projectRoot: project,
      userAgentsRoot: join(root, "missing-user"),
      workspaceTrusted: true,
    });

    expect(result.skills).toHaveLength(0);
  });
});
