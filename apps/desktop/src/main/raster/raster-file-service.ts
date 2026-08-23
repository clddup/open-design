import {
  rasterExportExtension,
  type RasterExportFormat,
} from "@opendesign/import-export-service/raster";
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import {
  basename as nodeBasename,
  dirname as nodeDirname,
  extname as nodeExtname,
  isAbsolute as nodeIsAbsolute,
  join as nodeJoin,
} from "node:path";
import {
  isSaveRasterFileRequest,
  type SaveRasterFileResult,
} from "@/shared/desktop-api.js";

export interface RasterPathOperations {
  basename(path: string): string;
  dirname(path: string): string;
  extname(path: string): string;
  isAbsolute(path: string): boolean;
  join(...paths: string[]): string;
}

const nodePathOperations: RasterPathOperations = {
  basename: nodeBasename,
  dirname: nodeDirname,
  extname: nodeExtname,
  isAbsolute: nodeIsAbsolute,
  join: nodeJoin,
};

export type SelectRasterSaveFile = (
  suggestedName: string,
  format: RasterExportFormat,
) => Promise<string | null>;

export interface RasterFileServiceOptions {
  selectSaveFile: SelectRasterSaveFile;
  pathOperations?: RasterPathOperations;
}

/** Main-owned path-free, atomic delivery bridge for encoded raster bytes. */
export class RasterFileService {
  readonly #path: RasterPathOperations;

  constructor(private readonly options: RasterFileServiceOptions) {
    this.#path = options.pathOperations ?? nodePathOperations;
  }

  async saveRasterFile(
    request: unknown,
    signal?: AbortSignal,
  ): Promise<SaveRasterFileResult | null> {
    if (!isSaveRasterFileRequest(request)) {
      throw new TypeError("Invalid raster save request");
    }
    throwIfAborted(signal);
    const suggestedName = suggestRasterFileName(
      request.suggestedName,
      request.format,
    );
    const selectedPath = await this.options.selectSaveFile(
      suggestedName,
      request.format,
    );
    throwIfAborted(signal);
    if (selectedPath === null) return null;
    const filePath = resolveRasterSavePath(
      selectedPath,
      request.format,
      this.#path,
    );
    const name = this.#path.basename(filePath);
    await writeRasterFileAtomically(
      filePath,
      request.bytes,
      this.#path,
      signal,
    );
    return { name, byteSize: request.bytes.byteLength };
  }
}

export function suggestRasterFileName(
  suggestedName: string,
  format: RasterExportFormat,
): string {
  const extension = rasterExportExtension(format);
  const lower = suggestedName.toLowerCase();
  if (
    lower.endsWith(extension) ||
    (format === "jpeg" && lower.endsWith(".jpeg"))
  ) {
    return suggestedName;
  }
  return `${suggestedName}${extension}`;
}

export function resolveRasterSavePath(
  selectedPath: string,
  format: RasterExportFormat,
  path: RasterPathOperations = nodePathOperations,
): string {
  if (!path.isAbsolute(selectedPath)) {
    throw new TypeError("Native raster selection must be an absolute path");
  }
  const extension = path.extname(selectedPath).toLowerCase();
  if (!extension) return `${selectedPath}${rasterExportExtension(format)}`;
  const accepted =
    format === "jpeg"
      ? extension === ".jpg" || extension === ".jpeg"
      : extension === rasterExportExtension(format);
  if (!accepted) {
    throw new TypeError(`Selected file extension does not match ${format}`);
  }
  return selectedPath;
}

async function writeRasterFileAtomically(
  filePath: string,
  bytes: Uint8Array,
  path: RasterPathOperations,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.opendesign-raster-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    throwIfAborted(signal);
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Raster export cancelled", "AbortError");
}
