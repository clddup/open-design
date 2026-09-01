import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import { projectComponentInstances } from "@opendesign/component-service";
import { materializeSharedStyles } from "@opendesign/style-service";
import type { HarfBuzzFontFaceDescriptor } from "@opendesign/text-service/harfbuzz";

const MAX_FONT_BYTES = 32 * 1024 * 1024;

export interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

export type LocalFontQuery = () => Promise<readonly LocalFontData[]>;

export interface LocalFontHydrationResult {
  failures: readonly { font: string; message: string }[];
  loadedFaceCount: number;
}

export interface LocalFontAccessRuntime {
  hydrateFamilies(
    families: readonly string[],
    signal?: AbortSignal,
  ): Promise<LocalFontHydrationResult>;
}

export function collectDocumentFontFamilies(
  document: DesignDocument,
): readonly string[] {
  const components = projectComponentInstances(document).document;
  const projection = materializeSharedStyles(components).document;
  const families = new Map<string, string>();
  const add = (value: string) => {
    const family = value.normalize("NFC").trim();
    if (!family) return;
    families.set(normalizedFamily(family), family);
  };
  const inspectNodes = (nodes: Readonly<Record<string, DesignNode>>) => {
    for (const node of Object.values(nodes)) {
      if (node.kind !== "text") continue;
      add(node.properties.fontFamily);
      for (const run of node.properties.runs ?? []) add(run.style.fontFamily);
    }
  };

  inspectNodes(projection.nodesById);
  return [...families.values()].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function localFontQueryFromWindow(
  target: Window,
): LocalFontQuery | null {
  const query = (
    target as Window & {
      queryLocalFonts?: () => Promise<readonly LocalFontData[]>;
    }
  ).queryLocalFonts;
  return typeof query === "function" ? query.bind(target) : null;
}

export function createLocalFontAccessRuntime(options: {
  digest?: (bytes: Uint8Array) => Promise<`font_${string}`>;
  query: LocalFontQuery;
  registerFont: (
    fontId: `font_${string}`,
    bytes: Uint8Array,
  ) =>
    | Promise<readonly HarfBuzzFontFaceDescriptor[]>
    | readonly HarfBuzzFontFaceDescriptor[];
}): LocalFontAccessRuntime {
  let catalogPromise: Promise<readonly LocalFontData[]> | null = null;
  let queue: Promise<void> = Promise.resolve();
  const loadedFontIds = new Set<string>();
  const loadedPostScriptNames = new Set<string>();
  const digest = options.digest ?? contentAddressedFontId;

  const catalog = () => {
    catalogPromise ??= options
      .query()
      .then(validateCatalog)
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
    return catalogPromise;
  };
  const hydrate = async (
    families: readonly string[],
    signal?: AbortSignal,
  ): Promise<LocalFontHydrationResult> => {
    signal?.throwIfAborted();
    const requested = new Set(families.map(normalizedFamily));
    if (requested.size === 0) return { failures: [], loadedFaceCount: 0 };
    const fonts = await catalog();
    signal?.throwIfAborted();
    const candidates = fonts.filter(
      (font) =>
        requested.has(normalizedFamily(font.family)) &&
        !loadedPostScriptNames.has(font.postscriptName),
    );
    const failures: { font: string; message: string }[] = [];
    let loadedFaceCount = 0;
    for (const font of candidates) {
      try {
        signal?.throwIfAborted();
        const blob = await font.blob();
        signal?.throwIfAborted();
        assertFontBlob(blob);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        signal?.throwIfAborted();
        const fontId = await digest(bytes);
        signal?.throwIfAborted();
        if (!loadedFontIds.has(fontId)) {
          const faces = await options.registerFont(fontId, bytes);
          signal?.throwIfAborted();
          if (faces.length === 0) throw new Error("Font has no usable faces");
          loadedFontIds.add(fontId);
          loadedFaceCount += faces.length;
        }
        loadedPostScriptNames.add(font.postscriptName);
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push({
          font: font.postscriptName,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { failures, loadedFaceCount };
  };

  return {
    hydrateFamilies(families, signal) {
      const result = queue.then(() => hydrate(families, signal));
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

async function contentAddressedFontId(
  bytes: Uint8Array,
): Promise<`font_${string}`> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure font hashing is unavailable");
  }
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer),
  );
  return `font_${[...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function validateCatalog(value: unknown): readonly LocalFontData[] {
  if (!Array.isArray(value))
    throw new TypeError("Local font catalog is invalid");
  if (!value.every(isLocalFontData)) {
    throw new TypeError("Local font catalog contains an invalid entry");
  }
  return value;
}

function isLocalFontData(value: unknown): value is LocalFontData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const font = value as Partial<LocalFontData>;
  return (
    validName(font.family) &&
    validName(font.fullName) &&
    validName(font.postscriptName) &&
    validName(font.style) &&
    typeof font.blob === "function"
  );
}

function validName(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 512
  );
}

function assertFontBlob(blob: Blob): void {
  if (!(blob instanceof Blob) || blob.size < 12 || blob.size > MAX_FONT_BYTES) {
    throw new RangeError("Local font must be between 12 bytes and 32 MB");
  }
}

function normalizedFamily(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}
