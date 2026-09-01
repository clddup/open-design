import {
  isFrameLikeNode,
  type DesignDocument,
  type ViewportState,
} from "@opendesign/design-contracts";
import {
  planSvgImport,
  screenToDocument,
  type SvgImportOperationPlan,
} from "@opendesign/editor-runtime";
import { type SvgInterchangeIssue } from "@opendesign/import-export-service";
import {
  SVG_WORKER_PROTOCOL_VERSION,
  SvgWorkerResponseContract,
  type SuccessfulSvgImportResult,
  type SvgWorkerExportSettings,
  type SvgWorkerRequest,
  type SvgWorkerResponse,
} from "./svg-interchange-contract.js";

export interface SvgWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: SvgWorkerRequest): void;
  terminate(): void;
}

export type SvgWorkerFactory = () => SvgWorkerLike;

export interface RunSvgWorkerOptions {
  requestId?: string;
  workerFactory?: SvgWorkerFactory;
}

export class SvgInterchangeWorkerError extends Error {
  readonly code: string;
  readonly issues: readonly SvgInterchangeIssue[];

  constructor(
    code: string,
    message: string,
    issues: readonly SvgInterchangeIssue[] = [],
  ) {
    super(message);
    this.name = "SvgInterchangeWorkerError";
    this.code = code;
    this.issues = issues.map((issue) => ({ ...issue }));
  }
}

export interface SvgImportTargetSnapshot {
  documentId: string;
  revision: number;
  pageId: string;
  parentId: string | null;
  index: number;
  center: { x: number; y: number };
}

export function runSvgImportInWorker(
  input: { svg: string; idPrefix: string; name: string },
  signal?: AbortSignal,
  options: RunSvgWorkerOptions = {},
): Promise<SuccessfulSvgImportResult> {
  const request: SvgWorkerRequest = {
    protocolVersion: SVG_WORKER_PROTOCOL_VERSION,
    requestId: options.requestId ?? createRequestId("svg_import"),
    operation: "import",
    ...input,
  };
  return runSvgWorker(request, signal, options).then((response) => {
    if (response.operation !== "import") {
      throw new SvgInterchangeWorkerError(
        "protocol-error",
        "SVG worker returned the wrong operation",
      );
    }
    return response.result;
  });
}

export function runSvgExportInWorker(
  input: {
    document: DesignDocument;
    pageId: string;
    rootNodeIds: string[];
    settings: SvgWorkerExportSettings;
  },
  signal?: AbortSignal,
  options: RunSvgWorkerOptions = {},
): Promise<
  Extract<
    SvgWorkerResponse,
    { operation: "export"; type: "completed" }
  >["result"]
> {
  const request: SvgWorkerRequest = {
    protocolVersion: SVG_WORKER_PROTOCOL_VERSION,
    requestId: options.requestId ?? createRequestId("svg_export"),
    operation: "export",
    ...input,
  };
  return runSvgWorker(request, signal, options).then((response) => {
    if (response.operation !== "export") {
      throw new SvgInterchangeWorkerError(
        "protocol-error",
        "SVG worker returned the wrong operation",
      );
    }
    return response.result;
  });
}

export function captureSvgImportTarget(
  document: DesignDocument,
  pageId: string,
  selectedNodeIds: readonly string[],
  viewport: ViewportState,
): SvgImportTargetSnapshot {
  const page = document.pagesById[pageId];
  if (!page) throw new Error(`Page ${pageId} does not exist`);
  const selected =
    selectedNodeIds.length === 1
      ? document.nodesById[selectedNodeIds[0] ?? ""]
      : undefined;
  const parent =
    isFrameLikeNode(selected) || selected?.kind === "group"
      ? selected
      : undefined;
  if (parent && !nodeBelongsToPage(document, pageId, parent.id)) {
    throw new Error(`SVG import target ${parent.id} is outside Page ${pageId}`);
  }
  const center = parent
    ? { x: parent.size.width / 2, y: parent.size.height / 2 }
    : screenToDocument(
        { x: viewport.width / 2, y: viewport.height / 2 },
        viewport,
      );
  return {
    documentId: document.documentId,
    revision: document.revision,
    pageId,
    parentId: parent?.id ?? null,
    index: parent ? parent.childIds.length : page.rootNodeIds.length,
    center,
  };
}

export function planHumanSvgImport(
  document: DesignDocument,
  imported: SuccessfulSvgImportResult,
  target: SvgImportTargetSnapshot,
  commandPrefix: string,
): SvgImportOperationPlan {
  if (
    document.documentId !== target.documentId ||
    document.revision !== target.revision
  ) {
    return {
      ok: false,
      code: "invalid-target",
      message: `SVG import target revision ${target.revision} is stale; current revision is ${document.revision}`,
    };
  }
  return planSvgImport(document, imported, {
    pageId: target.pageId,
    parentId: target.parentId,
    index: target.index,
    transform: [
      1,
      0,
      0,
      1,
      target.center.x - imported.sourceViewport.width / 2,
      target.center.y - imported.sourceViewport.height / 2,
    ],
    commandPrefix,
  });
}

export function normalizeSvgExportRoots(
  document: DesignDocument,
  selectedNodeIds: readonly string[],
): string[] {
  const selected = new Set(selectedNodeIds);
  return selectedNodeIds.filter((nodeId) => {
    let node = document.nodesById[nodeId];
    if (!node) throw new Error(`Selected SVG export node ${nodeId} is missing`);
    const visited = new Set<string>();
    while (node.parentId && !visited.has(node.id)) {
      visited.add(node.id);
      if (selected.has(node.parentId)) return false;
      const parent = document.nodesById[node.parentId];
      if (!parent) break;
      node = parent;
    }
    return true;
  });
}

export function suggestSvgExportName(
  document: DesignDocument,
  pageId: string,
  rootNodeIds: readonly string[],
): string {
  const raw =
    rootNodeIds.length === 1
      ? document.nodesById[rootNodeIds[0] ?? ""]?.name
      : `${document.pagesById[pageId]?.name ?? "Page"} selection`;
  const portable = portableFileStem(raw ?? "Export");
  return `${portable.slice(0, 240)}.svg`;
}

function runSvgWorker(
  request: SvgWorkerRequest,
  signal: AbortSignal | undefined,
  options: RunSvgWorkerOptions,
): Promise<Extract<SvgWorkerResponse, { type: "completed" }>> {
  if (signal?.aborted) return Promise.reject(abortError());
  const worker = (options.workerFactory ?? createSvgWorker)();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onerror = (event) => {
      const message =
        event.error instanceof Error
          ? event.error.message
          : event.message || "SVG worker crashed";
      finish(() =>
        reject(new SvgInterchangeWorkerError("worker-crashed", message)),
      );
    };
    worker.onmessage = (event) => {
      const response = event.data;
      if (
        !isSvgWorkerResponse(response) ||
        response.requestId !== request.requestId
      ) {
        finish(() =>
          reject(
            new SvgInterchangeWorkerError(
              "protocol-error",
              "SVG worker returned an invalid response",
            ),
          ),
        );
        return;
      }
      if (response.type === "failed") {
        finish(() =>
          reject(
            new SvgInterchangeWorkerError(
              response.code,
              response.message,
              response.issues,
            ),
          ),
        );
        return;
      }
      finish(() => resolve(response));
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(() =>
        reject(
          error instanceof Error
            ? error
            : new Error("SVG worker request failed", { cause: error }),
        ),
      );
    }
  });
}

function createSvgWorker(): SvgWorkerLike {
  return new Worker(new URL("./svg-interchange-worker.ts", import.meta.url), {
    name: "opendesign-svg-interchange",
    type: "module",
  });
}

function isSvgWorkerResponse(value: unknown): value is SvgWorkerResponse {
  return SvgWorkerResponseContract.parse(value).ok;
}

function portableFileStem(value: string): string {
  const cleaned = replaceControlCharacters(value)
    .replaceAll(/[<>:"/\\|?*]/g, "-")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  const candidate = cleaned || "Export";
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(candidate)
    ? `_${candidate}`
    : candidate;
}

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? "-" : character;
    })
    .join("");
}

function createRequestId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function abortError(): DOMException {
  return new DOMException("SVG operation was cancelled", "AbortError");
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  targetId: string,
): boolean {
  const pending = [...(document.pagesById[pageId]?.rootNodeIds ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    if (nodeId === targetId) return true;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (node) pending.push(...node.childIds);
  }
  return false;
}
