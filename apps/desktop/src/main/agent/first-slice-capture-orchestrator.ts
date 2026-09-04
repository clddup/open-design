import type {
  TrustedToolFailure,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { isTrustedToolFailure } from "@opendesign/agent-contracts";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";

type ReportProgress = (message: string, progress: number) => void;

export type FirstSliceCaptureDependencies = {
  firstSlice: (reportProgress?: ReportProgress) => Promise<TrustedToolResult>;
  capture: (reportProgress?: ReportProgress) => Promise<TrustedToolResult>;
  getDelivery: () => unknown;
};

export async function applyFirstSliceAndCapture(
  dependencies: FirstSliceCaptureDependencies,
  reportProgress?: ReportProgress,
): Promise<TrustedToolResult> {
  const applied = await dependencies.firstSlice(
    scaleProgress(reportProgress, 0, 0.62),
  );
  return await captureCommittedFirstSlice({
    applied,
    capture: () => dependencies.capture(scaleProgress(reportProgress, 0.62, 1)),
    getDelivery: dependencies.getDelivery,
    preserveAppliedContent: true,
  });
}

export async function captureCommittedFirstSlice(options: {
  applied: TrustedToolResult;
  capture: () => Promise<TrustedToolResult>;
  getDelivery: () => unknown;
  preserveAppliedContent?: boolean;
}): Promise<TrustedToolResult> {
  const revision = options.applied.designRevision;
  if (!revision) {
    throw designWorkflowError(
      "material_write_required",
      "The first-slice transaction did not commit a new design revision, so capture was not started",
    );
  }
  const appliedContent = record(options.applied.content);

  try {
    const captured = await options.capture();
    if (captured.observedRevision !== revision.revision) {
      throw designWorkflowError(
        "capture_revision_invalid",
        "The rendered capture did not observe the committed first-slice revision",
      );
    }
    return {
      ...captured,
      designRevision: revision,
      content: {
        ...(options.preserveAppliedContent ? appliedContent : {}),
        ...record(captured.content),
      },
    };
  } catch (error) {
    return {
      designRevision: revision,
      content: {
        ...(options.preserveAppliedContent ? appliedContent : {}),
        ok: false,
        materialRevisionPreserved: revision.revision,
        captureFailure: trustedFailure(error),
        delivery: options.getDelivery(),
      },
    };
  }
}

function scaleProgress(
  reportProgress: ReportProgress | undefined,
  start: number,
  end: number,
): ReportProgress | undefined {
  if (!reportProgress) return undefined;
  let lastProgress = start;
  return (message, progress) => {
    const bounded = Math.min(1, Math.max(0, progress));
    lastProgress = Math.max(lastProgress, start + (end - start) * bounded);
    reportProgress(message, lastProgress);
  };
}

function trustedFailure(error: unknown): TrustedToolFailure {
  if (
    error instanceof Error &&
    "cause" in error &&
    isTrustedToolFailure(error.cause)
  ) {
    return error.cause;
  }
  return {
    code: "design_capture_failed",
    message:
      error instanceof Error ? error.message : "First-slice capture failed",
    retryable: true,
    recoverable: true,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
