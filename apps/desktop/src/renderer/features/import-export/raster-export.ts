import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import type { RasterExportRequest } from "@opendesign/import-export-service/raster";
import {
  createLeaferEngineAdapter,
  resolveDesignTextRuns,
  type LeaferEngineAdapter,
  type LeaferEngineCallbacks,
  type LeaferFidelityWarning,
  type LeaferFlattenRasterRequest,
  type LeaferFlattenRasterResult,
  type LeaferRasterExportResult,
  type LeaferTextRunProjectionResolution,
  type LeaferTextRunStyle,
} from "@opendesign/leafer-engine";
import type { TextRunLayoutProvider } from "@opendesign/text-service";
import { composeTextRunLayoutProviders } from "../../services/text/text-run-provider-fallback";

const EXPORT_SURFACE_WIDTH = 1_280;
const EXPORT_SURFACE_HEIGHT = 960;

type RasterAdapterOptions = {
  createAdapter?: (
    host: HTMLElement,
    callbacks: LeaferEngineCallbacks,
  ) => Promise<LeaferEngineAdapter>;
  textRunProjection?: LeaferTextRunProjectionResolution;
  textRunLayoutProvider?: TextRunLayoutProvider<LeaferTextRunStyle>;
};

/**
 * Renders one frozen document target on an isolated Leafer surface. This is a
 * delivery export, not the bounded JPEG used by Agent visual review.
 */
export async function exportDesignRaster(
  designDocument: DesignDocument,
  request: RasterExportRequest,
  signal?: AbortSignal,
  options: RasterAdapterOptions = {},
): Promise<LeaferRasterExportResult> {
  throwIfAborted(signal);
  if (!designDocument.pagesById[request.pageId]) {
    throw new Error(`Raster export Page is unavailable: ${request.pageId}`);
  }
  if (!nodeBelongsToPage(designDocument, request.pageId, request.rootNodeId)) {
    throw new Error(
      `Raster export layer ${request.rootNodeId} is outside Page ${request.pageId}`,
    );
  }
  return withIsolatedRasterAdapter(
    designDocument,
    request.pageId,
    collectSubtreeNodeIds(designDocument, [request.rootNodeId]),
    signal,
    options,
    (adapter) => adapter.exportRaster(request),
  );
}

export async function exportDesignFlattenRaster(
  designDocument: DesignDocument,
  request: LeaferFlattenRasterRequest,
  signal?: AbortSignal,
  options: RasterAdapterOptions = {},
): Promise<LeaferFlattenRasterResult> {
  throwIfAborted(signal);
  if (!designDocument.pagesById[request.pageId]) {
    throw new Error(`Flatten raster Page is unavailable: ${request.pageId}`);
  }
  if (
    request.nodeIds.length === 0 ||
    request.nodeIds.some(
      (nodeId) => !nodeBelongsToPage(designDocument, request.pageId, nodeId),
    )
  ) {
    throw new Error("Flatten raster selection is outside the target Page");
  }
  return withIsolatedRasterAdapter(
    designDocument,
    request.pageId,
    collectSubtreeNodeIds(designDocument, request.nodeIds),
    signal,
    options,
    (adapter) => adapter.exportFlattenRaster(request),
  );
}

async function withIsolatedRasterAdapter<T>(
  designDocument: DesignDocument,
  pageId: string,
  targetNodeIds: ReadonlySet<string>,
  signal: AbortSignal | undefined,
  options: RasterAdapterOptions,
  exportTarget: (adapter: LeaferEngineAdapter) => Promise<T>,
): Promise<T> {
  const createAdapter = options.createAdapter ?? createLeaferEngineAdapter;
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
  let fidelityWarnings: readonly LeaferFidelityWarning[] = [];
  let adapter: LeaferEngineAdapter | null = null;
  try {
    adapter = await abortable(
      createAdapter(
        host,
        createExportCallbacks(
          (error) => (renderError = error),
          (warnings) => (fidelityWarnings = warnings),
        ),
      ),
      signal,
    );
    throwIfAborted(signal);
    const textRunProjection =
      options.textRunProjection ??
      resolveDesignTextRuns(
        designDocument,
        pageId,
        composeTextRunLayoutProviders(
          adapter.textRunLayoutProvider,
          options.textRunLayoutProvider,
        ),
      ).projection;
    adapter.sync({
      document: designDocument,
      pageId,
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
    throwForBlockingExportWarning(fidelityWarnings, targetNodeIds);
    const result = await abortable(exportTarget(adapter), signal);
    if (renderError) {
      throw new Error("Raster export rendering failed", { cause: renderError });
    }
    throwForBlockingExportWarning(fidelityWarnings, targetNodeIds);
    return result;
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
  onWarningsChange: (warnings: readonly LeaferFidelityWarning[]) => void,
): LeaferEngineCallbacks {
  return {
    onCreate: () => false,
    onCreateVector: () => false,
    onError,
    onOperations: () => false,
    onSelectionChange: () => undefined,
    onViewportChange: () => undefined,
    onWarningsChange,
  };
}

const BLOCKING_EXPORT_WARNING_CODES = new Set<LeaferFidelityWarning["code"]>([
  "boolean-geometry-failed",
  "boolean-geometry-pending",
  "boolean-geometry-provider-failed",
  "boolean-geometry-unsupported",
  "component-resolution-failed",
  "invalid-path",
  "missing-image",
  "rich-text-layout-failed",
  "style-resolution-failed",
  "unsupported-node",
  "variable-resolution-failed",
]);

function throwForBlockingExportWarning(
  warnings: readonly LeaferFidelityWarning[],
  targetNodeIds: ReadonlySet<string>,
): void {
  const blocking = warnings.find(
    (warning) =>
      targetNodeIds.has(warning.nodeId) &&
      BLOCKING_EXPORT_WARNING_CODES.has(warning.code),
  );
  if (blocking) {
    throw new Error(
      `Raster export projection is incomplete: ${blocking.code} (${blocking.nodeId})`,
    );
  }
}

function collectSubtreeNodeIds(
  document: DesignDocument,
  roots: readonly string[],
): Set<string> {
  const result = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || result.has(nodeId)) continue;
    result.add(nodeId);
    pending.push(...(document.nodesById[nodeId]?.childIds ?? []));
  }
  return result;
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
