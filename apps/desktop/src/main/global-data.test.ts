import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareGlobalWorkspaceDatabase } from "./global-data";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function root() {
  const value = await mkdtemp(join(tmpdir(), "opendesign-global-data-"));
  roots.push(value);
  return value;
}

describe("global OpenDesign data", () => {
  it("migrates the legacy workspace database without deleting the source", async () => {
    const directory = await root();
    const home = join(directory, "home");
    const userData = join(directory, "legacy");
    const legacy = join(userData, "workspace.sqlite");
    await mkdir(dirname(legacy), { recursive: true });
    await writeFile(legacy, "legacy database", { flag: "wx" });

    const target = await prepareGlobalWorkspaceDatabase(home, userData);

    expect(target).toBe(join(home, ".opendesign", "workspace.sqlite"));
    await expect(readFile(target, "utf8")).resolves.toBe("legacy database");
    await expect(readFile(legacy, "utf8")).resolves.toBe("legacy database");
  });

  it("does not overwrite an existing global workspace", async () => {
    const directory = await root();
    const home = join(directory, "home");
    const userData = join(directory, "legacy");
    const target = join(home, ".opendesign", "workspace.sqlite");
    const legacy = join(userData, "workspace.sqlite");
    await mkdir(dirname(target), { recursive: true });
    await mkdir(dirname(legacy), { recursive: true });
    await writeFile(target, "current");
    await writeFile(legacy, "legacy");

    await expect(prepareGlobalWorkspaceDatabase(home, userData)).resolves.toBe(
      target,
    );
    await expect(readFile(target, "utf8")).resolves.toBe("current");
  });
});
