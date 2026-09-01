import { createBooleanGeometryResolver } from "@opendesign/geometry-service/boolean-resolver";
import { loadBrowserVectorGeometryProvider } from "@opendesign/geometry-service/browser-vector-path";
import { planSvgExportRequest } from "@opendesign/editor-runtime";
import {
  exportSvg,
  importSvg,
  type SvgInterchangeIssue,
} from "@opendesign/import-export-service";
import {
  SVG_WORKER_PROTOCOL_VERSION,
  SvgWorkerRequestContract,
  type SvgWorkerRequest,
  type SvgWorkerResponse,
} from "./svg-interchange-contract.js";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: SvgWorkerResponse): void;
};

scope.onmessage = (event) => {
  const parsed = SvgWorkerRequestContract.parse(event.data);
  if (!parsed.ok) return;
  void execute(parsed.value);
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
    ...(issues === undefined ? {} : { issues: [...issues] }),
  });
}
