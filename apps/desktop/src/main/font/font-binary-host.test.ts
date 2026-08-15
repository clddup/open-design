import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FontBinaryHost } from "./font-binary-host";

const roots: string[] = [];
const fixture = join(
  process.cwd(),
  "../../packages/text-service/node_modules/@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf",
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "opendesign-font-host-"));
  roots.push(root);
  const source = join(root, "Noto Sans Arabic.ttf");
  await writeFile(source, await readFile(fixture));
  return { host: new FontBinaryHost(join(root, "store")), root, source };
}

describe("FontBinaryHost", () => {
  it("imports, lists, and reads content-addressed SFNT bytes", async () => {
    const { host, source } = await setup();
    const imported = await host.importFiles([source, source]);
    expect(imported).toHaveLength(1);
    const descriptor = imported[0];
    if (!descriptor) throw new Error("Expected imported font descriptor");
    expect(descriptor.byteSize).toBeGreaterThan(12);
    expect(descriptor.fontId).toMatch(/^font_[a-f0-9]{64}$/);
    expect(descriptor.format).toBe("ttf");
    expect(descriptor.name).toBe("Noto Sans Arabic.ttf");
    await expect(host.list()).resolves.toEqual(imported);
    const payload = await host.read(descriptor.fontId);
    expect(payload.bytes.byteLength).toBe(descriptor.byteSize);
    expect(payload).toMatchObject(descriptor);
  });

  it("rejects extension spoofing before persistence", async () => {
    const { host, root } = await setup();
    const source = join(root, "spoof.otf");
    await writeFile(source, await readFile(fixture));
    await expect(host.importFiles([source])).rejects.toThrow(
      "valid TTF, OTF, or TTC",
    );
    await expect(host.list()).resolves.toEqual([]);
  });
});
