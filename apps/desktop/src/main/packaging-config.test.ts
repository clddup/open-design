import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop packaging configuration", () => {
  it("distributes one macOS DMG without a duplicate app ZIP", async () => {
    const config = await readFile(
      resolve(import.meta.dirname, "../../electron-builder.yml"),
      "utf8",
    );
    const macConfiguration = config.match(
      /(?:^|\n)mac:\n(?<body>(?:[ \t].*\n)+)/,
    )?.groups?.body;
    expect(macConfiguration).toContain("- dmg");
    expect(macConfiguration).not.toContain("- zip");
  });

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

  it("allows the isolated PathKit WASM without enabling general script eval", async () => {
    const html = await readFile(
      resolve(import.meta.dirname, "../renderer/index.html"),
      "utf8",
    );
    expect(html).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(html).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(html).toContain("worker-src 'self'");
    expect(html).toContain("object-src 'none'");
  });
});
