import type { DesignDocument } from "@opendesign/design-contracts";
import {
  createLeaferEngineAdapter,
  inspectDesignTextLayoutQuality,
  resolveDesignTextRuns,
  type LeaferCaptureResult,
  type LeaferCaptureTarget,
  type LeaferEngineAdapter,
  type LeaferEngineCallbacks,
  type LeaferTextRunProjectionResolution,
  type LeaferTextRunStyle,
} from "@opendesign/leafer-engine";
import type {
  TextLayoutQualityEvidence,
  TextRunLayoutProvider,
} from "@opendesign/text-service";
import { composeTextRunLayoutProviders } from "../../text-run-provider-fallback";

const CAPTURE_WIDTH = 1_280;
const CAPTURE_HEIGHT = 960;
const CAPTURE_EXPORT_TIMEOUT_MS = 30_000;

export type DesignCaptureStage =
  | "surface-created"
  | "adapter-created"
  | "scene-synced"
  | "export-started"
  | "export-completed";

export class DesignCaptureTimeoutError extends Error {
  constructor(readonly thresholdMs: number) {
    super(
      `design_capture.export_timeout: Offscreen canvas export did not complete within ${thresholdMs} ms`,
    );
    this.name = "DesignCaptureTimeoutError";
  }
}

type CaptureDesignTargetOptions = {
  createAdapter?: (
    host: HTMLElement,
    callbacks: LeaferEngineCallbacks,
  ) => Promise<LeaferEngineAdapter>;
  onStage?: (stage: DesignCaptureStage) => void;
  textRunProjection?: LeaferTextRunProjectionResolution;
  textRunLayoutProvider?: TextRunLayoutProvider<LeaferTextRunStyle>;
  timeoutMs?: number;
};

export type DesignCaptureResult = LeaferCaptureResult & {
  textLayoutQuality?: TextLayoutQualityEvidence;
};

export async function captureDesignTarget(
  designDocument: DesignDocument,
  target: LeaferCaptureTarget,
  signal?: AbortSignal,
  options: CaptureDesignTargetOptions = {},
): Promise<DesignCaptureResult> {
  const createAdapter = options.createAdapter ?? createLeaferEngineAdapter;
  const timeoutMs = options.timeoutMs ?? CAPTURE_EXPORT_TIMEOUT_MS;
  throwIfAborted(signal);
  if (designDocument.pagesById[target.pageId] === undefined) {
    throw new Error(`Capture Page is unavailable: ${target.pageId}`);
  }
  const host = document.createElement("div");
  host.ariaHidden = "true";
  host.dataset.captureSurface = "design-target";
  Object.assign(host.style, {
    contain: "strict",
    height: `${CAPTURE_HEIGHT}px`,
    left: `-${CAPTURE_WIDTH * 2}px`,
    opacity: "0",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    width: `${CAPTURE_WIDTH}px`,
  });
  document.body.append(host);
  options.onStage?.("surface-created");
  let renderError: Error | null = null;
  let adapter: LeaferEngineAdapter | null = null;
  try {
    adapter = await abortable(
      createAdapter(
        host,
        createCaptureCallbacks((error) => (renderError = error)),
      ),
      signal,
    );
    options.onStage?.("adapter-created");
    throwIfAborted(signal);
    const textRunLayoutProvider = composeTextRunLayoutProviders(
      adapter.textRunLayoutProvider,
      options.textRunLayoutProvider,
    );
    const textRunProjection =
      options.textRunProjection ??
      resolveDesignTextRuns(
        designDocument,
        target.pageId,
        textRunLayoutProvider,
      ).projection;
    adapter.sync({
      document: designDocument,
      pageId: target.pageId,
      reducedMotion: true,
      selection: { nodeIds: [] },
      textRunProjection,
      tool: "select",
      viewport: {
        panX: 0,
        panY: 0,
        zoom: 1,
        width: CAPTURE_WIDTH,
        height: CAPTURE_HEIGHT,
      },
    });
    options.onStage?.("scene-synced");
    if (renderError) {
      throw new Error("Leafer target rendering failed", { cause: renderError });
    }
    options.onStage?.("export-started");
    const result = await boundedCapture(
      adapter.capture(target),
      signal,
      timeoutMs,
    );
    options.onStage?.("export-completed");
    return {
      ...result,
      ...(target.kind === "frame"
        ? {
            textLayoutQuality: inspectDesignTextLayoutQuality(
              designDocument,
              target.pageId,
              target.nodeId,
              adapter.textLayoutProvider,
              textRunLayoutProvider,
            ),
          }
        : {}),
    };
  } finally {
    adapter?.dispose();
    host.remove();
  }
}

function boundedCapture<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  thresholdMs: number,
): Promise<T> {
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    operation.catch(() => undefined);
    return Promise.reject(new DesignCaptureTimeoutError(thresholdMs));
  }
  if (signal?.aborted) {
    operation.catch(() => undefined);
    return Promise.reject(
      new DOMException("The operation was aborted", "AbortError"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timeout);
      operation.catch(() => undefined);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      operation.catch(() => undefined);
      reject(new DesignCaptureTimeoutError(thresholdMs));
    }, thresholdMs);
    signal?.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        reject(
          error instanceof Error
            ? error
            : new Error("Design target capture failed"),
        );
      },
    );
  });
}

function createCaptureCallbacks(
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
  if (signal?.aborted)
    throw new DOMException("The operation was aborted", "AbortError");
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
          error instanceof Error
            ? error
            : new Error("Design target capture failed"),
        );
      },
    );
  });
}
