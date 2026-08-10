import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop packaging configuration", () => {
  it("builds an assisted Windows installer with a selectable install directory", async () => {
    const config = await readFile(
      resolve(import.meta.dirname, "../../electron-builder.yml"),
      "utf8",
    );
    expect(config).toMatch(/(?:^|\n)win:\n(?:[ \t].*\n)+/);
    expect(config).toMatch(
      /(?:^|\n)nsis:\n(?:[ \t].*\n)*[ \t]+oneClick:[ \t]+false(?:\n|$)/,
    );
    expect(config).toMatch(
      /(?:^|\n)nsis:\n(?:[ \t].*\n)*[ \t]+allowToChangeInstallationDirectory:[ \t]+true(?:\n|$)/,
    );
  });
});
