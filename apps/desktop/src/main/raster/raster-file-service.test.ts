import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RasterFileService,
  resolveRasterSavePath,
  suggestRasterFileName,
} from "./raster-file-service.js";

const temporaryDirectories: string[] = [];
const pngRequest = {
  suggestedName: "Poster",
  format: "png",
  mimeType: "image/png",
  bytes: new Uint8Array([1, 2, 3, 4]),
  width: 1200,
  height: 800,
} as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("RasterFileService", () => {
  it("preserves cancellation without returning or writing a path", async () => {
    const service = new RasterFileService({
      selectSaveFile: () => Promise.resolve(null),
    });
    await expect(service.saveRasterFile(pngRequest)).resolves.toBeNull();
  });

  it("atomically saves encoded bytes and returns only portable metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-raster-"));
    temporaryDirectories.push(directory);
    const selectedPath = join(directory, "Poster");
    const selectSaveFile = vi.fn(() => Promise.resolve(selectedPath));
    const service = new RasterFileService({ selectSaveFile });

    await expect(service.saveRasterFile(pngRequest)).resolves.toEqual({
      name: "Poster.png",
      byteSize: 4,
    });
    expect(selectSaveFile).toHaveBeenCalledWith("Poster.png", "png");
    await expect(readFile(`${selectedPath}.png`)).resolves.toEqual(
      Buffer.from(pngRequest.bytes),
    );
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith(".opendesign-raster-"),
      ),
    ).toEqual([]);
  });

  it("rejects forged fields, MIME mismatches, and foreign extensions", async () => {
    const selectSaveFile = vi.fn(() => Promise.resolve("/tmp/Poster.svg"));
    const service = new RasterFileService({ selectSaveFile });
    await expect(
      service.saveRasterFile({ ...pngRequest, filePath: "/tmp/Poster.png" }),
    ).rejects.toThrow("Invalid raster save request");
    await expect(
      service.saveRasterFile({ ...pngRequest, mimeType: "image/jpeg" }),
    ).rejects.toThrow("Invalid raster save request");
    await expect(service.saveRasterFile(pngRequest)).rejects.toThrow(
      "does not match png",
    );
  });
});

describe("raster path normalization", () => {
  it("uses Windows path semantics and accepts both JPEG suffixes", () => {
    expect(resolveRasterSavePath("C:\\Design\\Poster", "webp", win32)).toBe(
      "C:\\Design\\Poster.webp",
    );
    expect(
      resolveRasterSavePath("C:\\Design\\Poster.JPEG", "jpeg", win32),
    ).toBe("C:\\Design\\Poster.JPEG");
    expect(() =>
      resolveRasterSavePath("C:\\Design\\Poster.png", "jpeg", win32),
    ).toThrow("does not match jpeg");
  });

  it("adds the canonical extension to portable suggestions", () => {
    expect(suggestRasterFileName("Poster", "jpeg")).toBe("Poster.jpg");
    expect(suggestRasterFileName("Poster.JPEG", "jpeg")).toBe("Poster.JPEG");
    expect(suggestRasterFileName("Poster.final", "webp")).toBe(
      "Poster.final.webp",
    );
  });
});
