import { SVG_MAX_FILE_BYTES } from "@opendesign/import-export-service/limits";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveSvgSavePath,
  suggestSvgFileName,
  SvgFileService,
  svgFileName,
} from "./svg-file-service.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-svg-file-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("SvgFileService", () => {
  it("preserves native-dialog cancellation without returning a path", async () => {
    const service = new SvgFileService({
      selectOpenFile: () => Promise.resolve(null),
      selectSaveFile: () => Promise.resolve(null),
    });

    await expect(service.openSvgFile()).resolves.toBeNull();
    await expect(
      service.saveSvgFile({ suggestedName: "Brand", contents: "<svg />" }),
    ).resolves.toBeNull();
  });

  it("does not write after an Agent run is cancelled while the dialog is open", async () => {
    const directory = await temporaryDirectory();
    const selectedPath = join(directory, "Cancelled.svg");
    let finishSelection!: (path: string | null) => void;
    const selection = new Promise<string | null>((resolve) => {
      finishSelection = resolve;
    });
    const service = new SvgFileService({
      selectOpenFile: () => Promise.resolve(null),
      selectSaveFile: () => selection,
    });
    const controller = new AbortController();
    const saving = service.saveSvgFile(
      { suggestedName: "Cancelled", contents: "<svg />" },
      controller.signal,
    );

    controller.abort();
    finishSelection(selectedPath);

    await expect(saving).rejects.toMatchObject({ name: "AbortError" });
    await expect(readFile(selectedPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("opens one regular SVG as fatal UTF-8 and exposes only name and text", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "企鹅.SVG");
    const contents = '<svg xmlns="http://www.w3.org/2000/svg">企鹅</svg>';
    await writeFile(filePath, contents, "utf8");
    const service = new SvgFileService({
      selectOpenFile: () => Promise.resolve(filePath),
      selectSaveFile: () => Promise.resolve(null),
    });

    const opened = await service.openSvgFile();
    expect(opened).toEqual({ name: "企鹅.SVG", contents });
    expect(opened).not.toHaveProperty("path");
  });

  it("rejects wrong extensions, directories, invalid UTF-8, and oversized files", async () => {
    const directory = await temporaryDirectory();
    const wrongExtension = join(directory, "brand.txt");
    await writeFile(wrongExtension, "<svg />", "utf8");
    const svgDirectory = join(directory, "folder.svg");
    await mkdir(svgDirectory);
    const invalidUtf8 = join(directory, "invalid.svg");
    await writeFile(invalidUtf8, new Uint8Array([0xc3, 0x28]));
    const oversized = join(directory, "oversized.svg");
    await writeFile(oversized, "x", "utf8");
    await truncate(oversized, SVG_MAX_FILE_BYTES + 1);

    const open = vi.fn<() => Promise<string | null>>();
    const service = new SvgFileService({
      selectOpenFile: open,
      selectSaveFile: () => Promise.resolve(null),
    });

    open.mockResolvedValueOnce(wrongExtension);
    await expect(service.openSvgFile()).rejects.toThrow(
      "SVG files must use the .svg extension",
    );
    open.mockResolvedValueOnce(svgDirectory);
    await expect(service.openSvgFile()).rejects.toThrow(
      "Selected SVG must be a regular file",
    );
    open.mockResolvedValueOnce(invalidUtf8);
    await expect(service.openSvgFile()).rejects.toThrow(
      "SVG file must contain valid UTF-8",
    );
    open.mockResolvedValueOnce(oversized);
    await expect(service.openSvgFile()).rejects.toThrow(
      `${SVG_MAX_FILE_BYTES} bytes`,
    );
  });

  it("appends .svg after selection and replaces the target atomically", async () => {
    const directory = await temporaryDirectory();
    const selectedPath = join(directory, "Brand mark");
    const finalPath = `${selectedPath}.svg`;
    await writeFile(finalPath, "old", "utf8");
    const selectSaveFile = vi.fn(() => Promise.resolve(selectedPath));
    const service = new SvgFileService({
      selectOpenFile: () => Promise.resolve(null),
      selectSaveFile,
    });
    const contents = '<svg xmlns="http://www.w3.org/2000/svg" />';

    await expect(
      service.saveSvgFile({ suggestedName: "Brand mark", contents }),
    ).resolves.toEqual({ name: "Brand mark.svg" });
    expect(selectSaveFile).toHaveBeenCalledWith("Brand mark.svg");
    await expect(readFile(finalPath, "utf8")).resolves.toBe(contents);
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith(".opendesign-svg-"),
      ),
    ).toEqual([]);
  });

  it("rejects forged requests and a selected foreign extension before writing", async () => {
    const directory = await temporaryDirectory();
    const foreignPath = join(directory, "Brand.png");
    const selectSaveFile = vi.fn(() => Promise.resolve(foreignPath));
    const service = new SvgFileService({
      selectOpenFile: () => Promise.resolve(null),
      selectSaveFile,
    });

    await expect(
      service.saveSvgFile({
        suggestedName: "Brand",
        contents: "<svg />",
        filePath: foreignPath,
      }),
    ).rejects.toThrow("Invalid SVG save request");
    expect(selectSaveFile).not.toHaveBeenCalled();

    await expect(
      service.saveSvgFile({ suggestedName: "Brand", contents: "<svg />" }),
    ).rejects.toThrow("SVG files must use the .svg extension");
    await expect(readFile(foreignPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("SVG path normalization", () => {
  it("uses Windows path semantics without leaking directory components", () => {
    expect(resolveSvgSavePath("C:\\Users\\designer\\Brand mark", win32)).toBe(
      "C:\\Users\\designer\\Brand mark.svg",
    );
    expect(
      resolveSvgSavePath("C:\\Users\\designer\\Brand mark.SVG", win32),
    ).toBe("C:\\Users\\designer\\Brand mark.SVG");
    expect(svgFileName("C:\\Users\\designer\\Brand mark.SVG", win32)).toBe(
      "Brand mark.SVG",
    );
    expect(() =>
      resolveSvgSavePath("C:\\Users\\designer\\Brand mark.ai", win32),
    ).toThrow("SVG files must use the .svg extension");
    expect(() => resolveSvgSavePath("Brand mark.svg", win32)).toThrow(
      "Native SVG selection must be an absolute path",
    );
  });

  it("preserves an existing SVG suffix and appends one to other suggestions", () => {
    expect(suggestSvgFileName("logo.SVG")).toBe("logo.SVG");
    expect(suggestSvgFileName("logo.final")).toBe("logo.final.svg");
  });
});
