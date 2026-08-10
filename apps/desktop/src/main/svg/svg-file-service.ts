import {
  SVG_MAX_CHARACTERS,
  SVG_MAX_FILE_BYTES,
} from "@opendesign/import-export-service/limits";
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  basename as nodeBasename,
  dirname as nodeDirname,
  extname as nodeExtname,
  isAbsolute as nodeIsAbsolute,
  join as nodeJoin,
} from "node:path";
import {
  isSaveSvgFileRequest,
  type OpenSvgFile,
  type SaveSvgFileResult,
} from "../../shared/desktop-api.js";

const SVG_FILE_EXTENSION = ".svg";

export interface SvgPathOperations {
  basename(path: string): string;
  dirname(path: string): string;
  extname(path: string): string;
  isAbsolute(path: string): boolean;
  join(...paths: string[]): string;
}

const nodePathOperations: SvgPathOperations = {
  basename: nodeBasename,
  dirname: nodeDirname,
  extname: nodeExtname,
  isAbsolute: nodeIsAbsolute,
  join: nodeJoin,
};

export type SelectSvgOpenFile = () => Promise<string | null>;
export type SelectSvgSaveFile = (
  suggestedName: string,
) => Promise<string | null>;

export interface SvgFileServiceOptions {
  selectOpenFile: SelectSvgOpenFile;
  selectSaveFile: SelectSvgSaveFile;
  pathOperations?: SvgPathOperations;
}

/**
 * Main-owned bridge between native file selection and bounded SVG text.
 * Renderer callers can suggest a file name and receive contents, but never
 * provide or observe an absolute path.
 */
export class SvgFileService {
  readonly #path: SvgPathOperations;

  constructor(private readonly options: SvgFileServiceOptions) {
    this.#path = options.pathOperations ?? nodePathOperations;
  }

  async openSvgFile(): Promise<OpenSvgFile | null> {
    const filePath = await this.options.selectOpenFile();
    if (filePath === null) return null;
    assertNativeSelectedPath(filePath, this.#path);
    assertSvgFilePath(filePath, this.#path);

    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      throw new TypeError("Selected SVG must be a regular file");
    }
    assertSvgByteSize(metadata.size);

    const bytes = await readFile(filePath);
    assertSvgByteSize(bytes.byteLength);
    const contents = decodeSvgUtf8(bytes);
    assertSvgCharacterSize(contents);
    const name = this.#path.basename(filePath);
    assertSvgFileName(name);
    return { name, contents };
  }

  async saveSvgFile(request: unknown): Promise<SaveSvgFileResult | null> {
    if (!isSaveSvgFileRequest(request)) {
      throw new TypeError("Invalid SVG save request");
    }
    assertSvgCharacterSize(request.contents);
    assertSvgByteSize(Buffer.byteLength(request.contents, "utf8"));

    const suggestedName = suggestSvgFileName(request.suggestedName);
    const selectedPath = await this.options.selectSaveFile(suggestedName);
    if (selectedPath === null) return null;
    const filePath = resolveSvgSavePath(selectedPath, this.#path);
    const name = svgFileName(filePath, this.#path);
    await writeSvgFileAtomically(filePath, request.contents, this.#path);
    return { name };
  }
}

export function suggestSvgFileName(suggestedName: string): string {
  return suggestedName.toLowerCase().endsWith(SVG_FILE_EXTENSION)
    ? suggestedName
    : `${suggestedName}${SVG_FILE_EXTENSION}`;
}

export function resolveSvgSavePath(
  selectedPath: string,
  pathOperations: SvgPathOperations = nodePathOperations,
): string {
  assertNativeSelectedPath(selectedPath, pathOperations);
  const extension = pathOperations.extname(selectedPath);
  if (extension === "") return `${selectedPath}${SVG_FILE_EXTENSION}`;
  if (extension.toLowerCase() !== SVG_FILE_EXTENSION) {
    throw new TypeError("SVG files must use the .svg extension");
  }
  return selectedPath;
}

export function svgFileName(
  filePath: string,
  pathOperations: SvgPathOperations = nodePathOperations,
): string {
  assertSvgFilePath(filePath, pathOperations);
  const name = pathOperations.basename(filePath);
  assertSvgFileName(name);
  return name;
}

function assertSvgFilePath(
  filePath: string,
  pathOperations: SvgPathOperations,
): void {
  if (pathOperations.extname(filePath).toLowerCase() !== SVG_FILE_EXTENSION) {
    throw new TypeError("SVG files must use the .svg extension");
  }
}

function assertNativeSelectedPath(
  filePath: string,
  pathOperations: SvgPathOperations,
): void {
  if (
    filePath.length === 0 ||
    !pathOperations.isAbsolute(filePath) ||
    [...filePath].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    throw new TypeError("Native SVG selection must be an absolute path");
  }
}

function assertSvgFileName(name: string): void {
  if (
    name.length === 0 ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    [...name].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    }) ||
    !name.toLowerCase().endsWith(SVG_FILE_EXTENSION)
  ) {
    throw new TypeError("Invalid SVG file name");
  }
}

function assertSvgByteSize(byteSize: number): void {
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize < 1 ||
    byteSize > SVG_MAX_FILE_BYTES
  ) {
    throw new RangeError(
      `SVG file must contain between 1 and ${SVG_MAX_FILE_BYTES} bytes`,
    );
  }
}

function assertSvgCharacterSize(contents: string): void {
  if (contents.length < 1 || contents.length > SVG_MAX_CHARACTERS) {
    throw new RangeError(
      `SVG file must contain between 1 and ${SVG_MAX_CHARACTERS} characters`,
    );
  }
}

function decodeSvgUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new TypeError("SVG file must contain valid UTF-8", { cause: error });
  }
}

async function writeSvgFileAtomically(
  filePath: string,
  contents: string,
  pathOperations: SvgPathOperations,
): Promise<void> {
  assertSvgFilePath(filePath, pathOperations);
  const temporaryPath = pathOperations.join(
    pathOperations.dirname(filePath),
    `.opendesign-svg-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
