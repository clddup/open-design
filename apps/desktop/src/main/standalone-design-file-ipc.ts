import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  basename as nodeBasename,
  dirname as nodeDirname,
  extname as nodeExtname,
  isAbsolute as nodeIsAbsolute,
  join as nodeJoin,
} from "node:path";
import type {
  BrowserWindow,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from "electron";
import {
  channels,
  isSaveDesignFileRequest,
  type OpenDesignFile,
  type SaveDesignFileResult,
} from "../shared/desktop-api.js";
import type { AppLocale } from "../shared/i18n/locale.js";
import { translate } from "../shared/i18n/messages.js";

const DESIGN_FILE_EXTENSION = ".opendesign";
const MAX_DESIGN_FILE_BYTES = 64 * 1024 * 1024;

export interface DesignFilePathOperations {
  basename(path: string): string;
  dirname(path: string): string;
  extname(path: string): string;
  isAbsolute(path: string): boolean;
  join(...paths: string[]): string;
}

const nodePathOperations: DesignFilePathOperations = {
  basename: nodeBasename,
  dirname: nodeDirname,
  extname: nodeExtname,
  isAbsolute: nodeIsAbsolute,
  join: nodeJoin,
};

type StandaloneDesignFileIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface StandaloneDesignFileIpcRegistrar {
  handle(channel: string, listener: StandaloneDesignFileIpcHandler): void;
}

export interface StandaloneDesignFileIpcHostOptions {
  getLocale(): AppLocale;
  getWindow(): BrowserWindow | null;
  openDialog(
    window: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<OpenDialogReturnValue>;
  pathOperations?: DesignFilePathOperations;
  saveDialog(
    window: BrowserWindow,
    options: SaveDialogOptions,
  ): Promise<SaveDialogReturnValue>;
}

/**
 * Owns the path-free Renderer bridge for standalone `.opendesign` documents.
 * Project Design Files remain owned by ProjectHost and never share this path
 * lease.
 */
export class StandaloneDesignFileIpcHost {
  readonly #options: StandaloneDesignFileIpcHostOptions;
  readonly #path: DesignFilePathOperations;
  #activePath: string | null = null;

  constructor(options: StandaloneDesignFileIpcHostOptions) {
    this.#options = options;
    this.#path = options.pathOperations ?? nodePathOperations;
  }

  registerIpc(options: {
    assertRenderer(event: IpcMainInvokeEvent): void;
    ipc: StandaloneDesignFileIpcRegistrar;
  }): void {
    options.ipc.handle(channels.openDesignFile, (event, ...args) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 0);
      return this.open();
    });
    options.ipc.handle(channels.saveDesignFile, (event, ...args) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      return this.save(args[0]);
    });
  }

  clear(): void {
    this.#activePath = null;
  }

  private async open(): Promise<OpenDesignFile | null> {
    const window = this.#options.getWindow();
    if (!window) return null;
    const result = await this.#options.openDialog(
      window,
      openDialogOptions(this.#options.getLocale()),
    );
    if (result.canceled || result.filePaths.length !== 1) return null;
    const filePath = result.filePaths[0];
    if (!filePath) return null;
    assertDesignFilePath(filePath, this.#path);

    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      throw new TypeError(
        "Selected OpenDesign document must be a regular file",
      );
    }
    assertDesignFileByteSize(metadata.size);
    const bytes = await readFile(filePath);
    assertDesignFileByteSize(bytes.byteLength);
    const contents = decodeDesignFileUtf8(bytes);
    const name = designFileName(filePath, this.#path);
    this.#activePath = filePath;
    return { name, contents };
  }

  private async save(request: unknown): Promise<SaveDesignFileResult | null> {
    if (!isSaveDesignFileRequest(request)) {
      throw new TypeError("Invalid OpenDesign save request");
    }
    assertDesignFileByteSize(Buffer.byteLength(request.contents, "utf8"));

    let filePath = request.saveAs ? null : this.#activePath;
    if (!filePath) {
      const window = this.#options.getWindow();
      if (!window) return null;
      const suggestedName = suggestDesignFileName(request.suggestedName);
      const result = await this.#options.saveDialog(
        window,
        saveDialogOptions(this.#options.getLocale(), suggestedName),
      );
      if (result.canceled || !result.filePath) return null;
      filePath = resolveDesignFileSavePath(result.filePath, this.#path);
    }

    assertDesignFilePath(filePath, this.#path);
    await writeDesignFileAtomically(filePath, request.contents, this.#path);
    const name = designFileName(filePath, this.#path);
    this.#activePath = filePath;
    return { name };
  }
}

export function suggestDesignFileName(suggestedName: string): string {
  return suggestedName.toLowerCase().endsWith(DESIGN_FILE_EXTENSION)
    ? suggestedName
    : `${suggestedName}${DESIGN_FILE_EXTENSION}`;
}

export function resolveDesignFileSavePath(
  selectedPath: string,
  path: DesignFilePathOperations = nodePathOperations,
): string {
  assertNativeSelectedPath(selectedPath, path);
  const extension = path.extname(selectedPath);
  if (extension === "") return `${selectedPath}${DESIGN_FILE_EXTENSION}`;
  if (extension.toLowerCase() !== DESIGN_FILE_EXTENSION) {
    throw new TypeError("OpenDesign files must use the .opendesign extension");
  }
  return selectedPath;
}

function designFileName(
  filePath: string,
  path: DesignFilePathOperations,
): string {
  assertDesignFilePath(filePath, path);
  const name = path.basename(filePath);
  if (
    name.length === 0 ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    hasControlCharacter(name)
  ) {
    throw new TypeError("Invalid OpenDesign file name");
  }
  return name;
}

function assertDesignFilePath(
  filePath: string,
  path: DesignFilePathOperations,
): void {
  assertNativeSelectedPath(filePath, path);
  if (path.extname(filePath).toLowerCase() !== DESIGN_FILE_EXTENSION) {
    throw new TypeError("OpenDesign files must use the .opendesign extension");
  }
}

function assertNativeSelectedPath(
  filePath: string,
  path: DesignFilePathOperations,
): void {
  if (
    filePath.length === 0 ||
    !path.isAbsolute(filePath) ||
    hasControlCharacter(filePath)
  ) {
    throw new TypeError("Native OpenDesign selection must be an absolute path");
  }
}

function assertDesignFileByteSize(byteSize: number): void {
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize < 1 ||
    byteSize > MAX_DESIGN_FILE_BYTES
  ) {
    throw new RangeError("OpenDesign document exceeds the 64 MB limit");
  }
}

function decodeDesignFileUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new TypeError("OpenDesign document must contain valid UTF-8", {
      cause: error,
    });
  }
}

async function writeDesignFileAtomically(
  filePath: string,
  contents: string,
  path: DesignFilePathOperations,
): Promise<void> {
  assertDesignFilePath(filePath, path);
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.opendesign-document-${randomUUID()}.tmp`,
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

function openDialogOptions(locale: AppLocale): OpenDialogOptions {
  return {
    title: translate(locale, "main.openDocumentTitle"),
    buttonLabel: translate(locale, "main.openDocumentButton"),
    properties: ["openFile"],
    filters: [documentFilter(locale)],
  };
}

function saveDialogOptions(
  locale: AppLocale,
  suggestedName: string,
): SaveDialogOptions {
  return {
    title: translate(locale, "main.saveDocumentTitle"),
    buttonLabel: translate(locale, "main.saveDocumentButton"),
    defaultPath: suggestedName,
    filters: [documentFilter(locale)],
  };
}

function documentFilter(locale: AppLocale) {
  return {
    name: translate(locale, "main.documentFilter"),
    extensions: ["opendesign"],
  };
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}
