import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import type { RasterExportRequest } from "@opendesign/import-export-service/raster";
import {
  createLeaferEngineAdapter,
  resolveDesignTextRuns,
  type LeaferEngineAdapter,
  type LeaferEngineCallbacks,
  type LeaferRasterExportResult,
  type LeaferTextRunProjectionResolution,
  type LeaferTextRunStyle,
} from "@opendesign/leafer-engine";
import type { TextRunLayoutProvider } from "@opendesign/text-service";
import { composeTextRunLayoutProviders } from "./text-run-provider-fallback";

const EXPORT_SURFACE_WIDTH = 1_280;
const EXPORT_SURFACE_HEIGHT = 960;

/**
 * Renders one frozen document target on an isolated Leafer surface. This is a
 * delivery export, not the bounded JPEG used by Agent visual review.
 */
export async function exportDesignRaster(
  designDocument: DesignDocument,
  request: RasterExportRequest,
  signal?: AbortSignal,
  options: {
    createAdapter?: (
      host: HTMLElement,
      callbacks: LeaferEngineCallbacks,
    ) => Promise<LeaferEngineAdapter>;
    textRunProjection?: LeaferTextRunProjectionResolution;
    textRunLayoutProvider?: TextRunLayoutProvider<LeaferTextRunStyle>;
  } = {},
): Promise<LeaferRasterExportResult> {
  const createAdapter = options.createAdapter ?? createLeaferEngineAdapter;
  throwIfAborted(signal);
  if (!designDocument.pagesById[request.pageId]) {
    throw new Error(`Raster export Page is unavailable: ${request.pageId}`);
  }
  if (!nodeBelongsToPage(designDocument, request.pageId, request.rootNodeId)) {
    throw new Error(
      `Raster export layer ${request.rootNodeId} is outside Page ${request.pageId}`,
    );
  }
  const host = document.createElement("div");
  host.ariaHidden = "true";
  host.dataset.exportSurface = "raster-delivery";
  Object.assign(host.style, {
    contain: "strict",
    height: `${EXPORT_SURFACE_HEIGHT}px`,
    left: `-${EXPORT_SURFACE_WIDTH * 2}px`,
    opacity: "0",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    width: `${EXPORT_SURFACE_WIDTH}px`,
  });
  document.body.append(host);
  let renderError: Error | null = null;
  let adapter: LeaferEngineAdapter | null = null;
  try {
    adapter = await abortable(
      createAdapter(
        host,
        createExportCallbacks((error) => (renderError = error)),
      ),
      signal,
    );
    throwIfAborted(signal);
    const textRunProjection =
      options.textRunProjection ??
      resolveDesignTextRuns(
        designDocument,
        request.pageId,
        composeTextRunLayoutProviders(
          adapter.textRunLayoutProvider,
          options.textRunLayoutProvider,
        ),
      ).projection;
    adapter.sync({
      document: designDocument,
      pageId: request.pageId,
      reducedMotion: true,
      selection: { nodeIds: [] },
      textRunProjection,
      tool: "select",
      viewport: {
        panX: 0,
        panY: 0,
        zoom: 1,
        width: EXPORT_SURFACE_WIDTH,
        height: EXPORT_SURFACE_HEIGHT,
      },
    });
    if (renderError) {
      throw new Error("Raster export rendering failed", { cause: renderError });
    }
    return await abortable(adapter.exportRaster(request), signal);
  } finally {
    adapter?.dispose();
    host.remove();
  }
}

export function suggestRasterExportName(name: string | undefined): string {
  const withoutControls = [...(name ?? "Export").normalize("NFC")]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
        ? " "
        : character;
    })
    .join("");
  const normalized = withoutControls
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (normalized || "Export").slice(0, 240);
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const page = document.pagesById[pageId];
  if (!page || !document.nodesById[nodeId]) return false;
  let currentId: string | null = nodeId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const node: DesignNode | undefined = document.nodesById[currentId];
    if (!node) return false;
    if (node.parentId === null) return page.rootNodeIds.includes(node.id);
    currentId = node.parentId;
  }
  return false;
}

function createExportCallbacks(
  onError: (error: Error) => void,
): LeaferEngineCallbacks {
  return {
    onCreate: () => false,
    onCreateVector: () => false,
    onError,
    onOperations: () => false,
    onSelectionChange: () => undefined,
    onViewportChange: () => undefined,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}

function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    operation.catch(() => undefined);
    return Promise.reject(
      new DOMException("The operation was aborted", "AbortError"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      operation.catch(() => undefined);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(
          error instanceof Error ? error : new Error("Raster export failed"),
        );
      },
    );
  });
}
