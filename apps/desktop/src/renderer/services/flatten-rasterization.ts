import type { DesignDocument } from "@opendesign/design-contracts";
import { RASTER_EXPORT_MAX_ENCODED_BYTES } from "@opendesign/import-export-service/raster";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import type {
  LeaferFlattenRasterRequest,
  LeaferFlattenRasterResult,
  LeaferTextRunStyle,
} from "@opendesign/leafer-engine";
import type { TextRunLayoutProvider } from "@opendesign/text-service";
import {
  planFlattenNodes,
  planRasterizedFlattenNodes,
  prepareRasterFlattenNodes,
  type FlattenOperationPlan,
} from "@opendesign/editor-runtime";
import { exportDesignFlattenRaster } from "../features/import-export/raster-export";

export type FlattenRasterizer = (
  document: DesignDocument,
  request: LeaferFlattenRasterRequest,
  signal?: AbortSignal,
  options?: {
    textRunLayoutProvider?: TextRunLayoutProvider<LeaferTextRunStyle>;
  },
) => Promise<LeaferFlattenRasterResult>;

export async function planFlattenWithRasterFallback({
  document,
  geometryIdPrefix,
  nodeIds,
  pageId,
  provider,
  rasterize = exportDesignFlattenRaster,
  resultNodeId,
  signal,
  textRunLayoutProvider,
}: {
  document: DesignDocument;
  geometryIdPrefix: string;
  nodeIds: readonly string[];
  pageId: string;
  provider: VectorGeometryProvider;
  rasterize?: FlattenRasterizer;
  resultNodeId: string;
  signal?: AbortSignal;
  textRunLayoutProvider?: TextRunLayoutProvider<LeaferTextRunStyle>;
}): Promise<FlattenOperationPlan> {
  const vectorPlan = planFlattenNodes(
    document,
    pageId,
    nodeIds,
    resultNodeId,
    geometryIdPrefix,
    provider,
    textRunLayoutProvider,
  );
  if (vectorPlan.ok) return vectorPlan;
  if (vectorPlan.code !== "requires-raster-compositing") return vectorPlan;
  const preparation = prepareRasterFlattenNodes(document, pageId, nodeIds);
  if (preparation.kind === "not-required") return vectorPlan;
  if (preparation.kind === "failed") return preparation.failure;
  throwIfAborted(signal);
  const rendered = await rasterize(
    document,
    {
      pageId: preparation.request.pageId,
      nodeIds: preparation.request.nodeIds,
      ...(preparation.request.neutralizeRootNodeId
        ? { neutralizeRootNodeId: preparation.request.neutralizeRootNodeId }
        : {}),
    },
    signal,
    textRunLayoutProvider ? { textRunLayoutProvider } : undefined,
  );
  throwIfAborted(signal);
  if (rendered.bytes.byteLength > RASTER_EXPORT_MAX_ENCODED_BYTES) {
    throw new RangeError(
      `Flatten raster exceeds the ${RASTER_EXPORT_MAX_ENCODED_BYTES}-byte encoded asset boundary`,
    );
  }
  return planRasterizedFlattenNodes(
    document,
    preparation.request,
    resultNodeId,
    geometryIdPrefix,
    {
      bounds: rendered.bounds,
      asset: {
        id: `${resultNodeId}_raster`,
        kind: "image",
        name: `${resultNodeId} Flatten Raster`,
        mimeType: "image/png",
        source: { type: "data", value: bytesToBase64(rendered.bytes) },
        size: { width: rendered.width, height: rendered.height },
        extensions: {},
      },
    },
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    parts.push(String.fromCharCode(...chunk));
  }
  return btoa(parts.join(""));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}
