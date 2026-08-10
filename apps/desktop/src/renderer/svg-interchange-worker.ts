import { isDesignDocument } from "@opendesign/design-contracts";
import { createBooleanGeometryResolver } from "@opendesign/geometry-service/boolean-resolver";
import { loadBrowserVectorGeometryProvider } from "@opendesign/geometry-service/browser-vector-path";
import {
  MAX_SVG_EXPORT_PADDING,
  planSvgExportRequest,
} from "@opendesign/editor-runtime";
import {
  exportSvg,
  importSvg,
  SVG_MAX_CHARACTERS,
  type SvgInterchangeIssue,
} from "@opendesign/import-export-service";
import {
  SVG_WORKER_PROTOCOL_VERSION,
  type SvgWorkerRequest,
  type SvgWorkerResponse,
} from "./svg-interchange-contract.js";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: SvgWorkerResponse): void;
};

scope.onmessage = (event) => {
  const request = event.data;
  if (!isSvgWorkerRequest(request)) return;
  void execute(request);
};

async function execute(request: SvgWorkerRequest): Promise<void> {
  try {
    const provider = await loadBrowserVectorGeometryProvider();
    if (request.operation === "import") {
      const result = importSvg(
        {
          svg: request.svg,
          idPrefix: request.idPrefix,
          name: request.name,
        },
        provider,
      );
      if (!result.ok) {
        fail(
          request,
          result.issues[0]?.code ?? "invalid-svg",
          result.issues[0]?.message ?? "SVG import failed",
          result.issues,
        );
        return;
      }
      scope.postMessage({
        protocolVersion: SVG_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        operation: "import",
        type: "completed",
        result,
      });
      return;
    }

    const resolution = createBooleanGeometryResolver(provider).resolve(
      request.document,
      request.pageId,
    );
    const plan = planSvgExportRequest(request.document, {
      pageId: request.pageId,
      rootNodeIds: request.rootNodeIds,
      baseRevision: request.document.revision,
      settings: request.settings,
      booleanSnapshot: {
        documentId: request.document.documentId,
        revision: request.document.revision,
        resolution,
      },
    });
    if (!plan.ok) {
      fail(request, plan.code, plan.message);
      return;
    }
    const result = exportSvg(plan.request);
    if (!result.ok) {
      fail(
        request,
        result.issues[0]?.code ?? "svg-export-failed",
        result.issues[0]?.message ?? "SVG export failed",
        result.issues,
      );
      return;
    }
    scope.postMessage({
      protocolVersion: SVG_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      operation: "export",
      type: "completed",
      result: {
        svg: result.svg,
        issues: result.issues,
        exportedNodeIds: result.exportedNodeIds,
        revision: plan.revision,
        sourceBounds: plan.sourceBounds,
      },
    });
  } catch (error) {
    fail(
      request,
      "worker-failed",
      error instanceof Error ? error.message : "SVG worker failed",
    );
  }
}

function fail(
  request: SvgWorkerRequest,
  code: string,
  message: string,
  issues?: readonly SvgInterchangeIssue[],
): void {
  scope.postMessage({
    protocolVersion: SVG_WORKER_PROTOCOL_VERSION,
    requestId: request.requestId,
    operation: request.operation,
    type: "failed",
    code,
    message,
    ...(issues === undefined ? {} : { issues }),
  });
}

function isSvgWorkerRequest(value: unknown): value is SvgWorkerRequest {
  if (!isRecord(value)) return false;
  if (
    value.protocolVersion !== SVG_WORKER_PROTOCOL_VERSION ||
    !isRequestId(value.requestId)
  ) {
    return false;
  }
  if (value.operation === "import") {
    return (
      typeof value.svg === "string" &&
      value.svg.length > 0 &&
      value.svg.length <= SVG_MAX_CHARACTERS &&
      typeof value.idPrefix === "string" &&
      /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value.idPrefix) &&
      typeof value.name === "string" &&
      value.name.length > 0 &&
      value.name.length <= 255 &&
      hasExactKeys(value, [
        "protocolVersion",
        "requestId",
        "operation",
        "svg",
        "idPrefix",
        "name",
      ])
    );
  }
  if (value.operation !== "export") return false;
  return (
    isDesignDocument(value.document) &&
    typeof value.pageId === "string" &&
    value.pageId.length > 0 &&
    Array.isArray(value.rootNodeIds) &&
    value.rootNodeIds.length > 0 &&
    value.rootNodeIds.every(
      (nodeId) => typeof nodeId === "string" && nodeId.length > 0,
    ) &&
    isExportSettings(value.settings) &&
    hasExactKeys(value, [
      "protocolVersion",
      "requestId",
      "operation",
      "document",
      "pageId",
      "rootNodeIds",
      "settings",
    ])
  );
}

function isExportSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.includeLayerIds === "boolean" &&
    typeof value.padding === "number" &&
    Number.isFinite(value.padding) &&
    value.padding >= 0 &&
    value.padding <= MAX_SVG_EXPORT_PADDING &&
    hasExactKeys(value, ["includeLayerIds", "padding"])
  );
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
