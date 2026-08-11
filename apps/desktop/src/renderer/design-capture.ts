import type { DesignDocument } from "@opendesign/design-contracts";
import {
  createLeaferEngineAdapter,
  type LeaferCaptureResult,
  type LeaferCaptureTarget,
  type LeaferEngineAdapter,
  type LeaferEngineCallbacks,
} from "@opendesign/leafer-engine";

const CAPTURE_WIDTH = 1_280;
const CAPTURE_HEIGHT = 960;

export async function captureDesignTarget(
  designDocument: DesignDocument,
  target: LeaferCaptureTarget,
  signal?: AbortSignal,
  createAdapter: (
    host: HTMLElement,
    callbacks: LeaferEngineCallbacks,
  ) => Promise<LeaferEngineAdapter> = createLeaferEngineAdapter,
): Promise<LeaferCaptureResult> {
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
    throwIfAborted(signal);
    adapter.sync({
      document: designDocument,
      pageId: target.pageId,
      reducedMotion: true,
      selection: { nodeIds: [] },
      tool: "select",
      viewport: {
        panX: 0,
        panY: 0,
        zoom: 1,
        width: CAPTURE_WIDTH,
        height: CAPTURE_HEIGHT,
      },
    });
    if (renderError) {
      throw new Error("Leafer target rendering failed", { cause: renderError });
    }
    return await abortable(adapter.capture(target), signal);
  } finally {
    adapter?.dispose();
    host.remove();
  }
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
