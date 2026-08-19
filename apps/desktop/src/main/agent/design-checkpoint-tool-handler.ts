import type {
  ToolCallRequest,
  TrustedToolFailure,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  normalizeDesignCheckpointToolInput,
  type DesignApplyToolInput,
  type DesignCheckpointToolInput,
  type DesignVisualReviewToolInput,
} from "../../shared/design-agent-tools.js";
import { isTrustedToolFailure } from "../../shared/design-tool-bridge.js";

type ReportProgress = (message: string, progress: number) => void;

export type DesignCheckpointDependencies = {
  apply: (
    call: ToolCallRequest,
    input: DesignApplyToolInput,
    reportProgress?: ReportProgress,
  ) => Promise<TrustedToolResult>;
  capture: (
    call: ToolCallRequest,
    reportProgress?: ReportProgress,
  ) => Promise<TrustedToolResult>;
  getDelivery: () => unknown;
  review: (review: DesignVisualReviewToolInput) => TrustedToolResult;
};

export type FirstSliceCheckpointDependencies = {
  firstSlice: (reportProgress?: ReportProgress) => Promise<TrustedToolResult>;
  capture: (reportProgress?: ReportProgress) => Promise<TrustedToolResult>;
  getDelivery: () => unknown;
};

export async function handleFirstSliceCheckpoint(
  dependencies: FirstSliceCheckpointDependencies,
  reportProgress?: ReportProgress,
): Promise<TrustedToolResult> {
  const applied = await dependencies.firstSlice(
    scaleProgress(reportProgress, 0, 0.62),
  );
  return await captureCommittedDesignCheckpoint({
    action: "first-slice-and-capture",
    applied,
    capture: () => dependencies.capture(scaleProgress(reportProgress, 0.62, 1)),
    getDelivery: dependencies.getDelivery,
    preserveAppliedContent: true,
  });
}

export async function handleDesignCheckpointTool(
  call: ToolCallRequest,
  dependencies: DesignCheckpointDependencies,
  reportProgress?: ReportProgress,
): Promise<TrustedToolResult> {
  const input = normalizeDesignCheckpointToolInput(call.input);
  if (!input) {
    throw new TypeError("Invalid design checkpoint tool input");
  }
  if (input.action === "apply-and-capture") {
    const applied = await dependencies.apply(
      subcall(call, "apply", DESIGN_APPLY_TOOL_NAME, input.apply),
      input.apply,
      scaleProgress(reportProgress, 0, 0.58),
    );
    return await captureCommittedDesignCheckpoint({
      action: input.action,
      applied,
      capture: () =>
        dependencies.capture(
          subcall(call, "capture", DESIGN_CAPTURE_TOOL_NAME, {}),
          scaleProgress(reportProgress, 0.58, 1),
        ),
      getDelivery: dependencies.getDelivery,
    });
  }

  dependencies.review(input.review);
  reportProgress?.("Visual review accepted", 0.08);
  const applied = await dependencies.apply(
    subcall(call, "refine", DESIGN_APPLY_TOOL_NAME, input.refinement),
    input.refinement,
    scaleProgress(reportProgress, 0.08, 0.62),
  );
  return await captureCommittedDesignCheckpoint({
    action: input.action,
    applied,
    capture: () =>
      dependencies.capture(
        subcall(call, "capture", DESIGN_CAPTURE_TOOL_NAME, {}),
        scaleProgress(reportProgress, 0.62, 1),
      ),
    getDelivery: dependencies.getDelivery,
    reviewAccepted: true,
  });
}

export async function captureCommittedDesignCheckpoint(options: {
  action: DesignCheckpointToolInput["action"] | "first-slice-and-capture";
  applied: TrustedToolResult;
  capture: () => Promise<TrustedToolResult>;
  getDelivery: () => unknown;
  preserveAppliedContent?: boolean;
  reviewAccepted?: boolean;
}): Promise<TrustedToolResult> {
  const revision = options.applied.designRevision;
  if (!revision) {
    throw new Error(
      "design_checkpoint.material_revision_required: The material checkpoint did not commit a new design revision, so capture was not started",
    );
  }
  const appliedContent = record(options.applied.content);
  const checkpointBase = {
    version: 1,
    action: options.action,
    materialRevision: revision.revision,
    transactionId: revision.transactionId,
    ...(options.reviewAccepted ? { reviewAccepted: true } : {}),
    ...(Array.isArray(appliedContent.committedSteps)
      ? { committedSteps: appliedContent.committedSteps }
      : {}),
  };

  try {
    const captured = await options.capture();
    if (captured.observedRevision !== revision.revision) {
      throw new Error(
        "design_checkpoint.capture_revision_invalid: Checkpoint capture did not observe the committed material revision",
      );
    }
    return {
      ...captured,
      designRevision: revision,
      content: {
        ...(options.preserveAppliedContent ? appliedContent : {}),
        ...record(captured.content),
        checkpoint: { ...checkpointBase, status: "completed" },
      },
    };
  } catch (error) {
    return {
      designRevision: revision,
      content: {
        ...(options.preserveAppliedContent ? appliedContent : {}),
        ok: false,
        checkpoint: {
          ...checkpointBase,
          status: "capture-failed",
          failure: trustedFailure(error),
        },
        delivery: options.getDelivery(),
      },
    };
  }
}

function subcall(
  call: ToolCallRequest,
  suffix: string,
  toolName: string,
  input: unknown,
): ToolCallRequest {
  const suffixWithSeparator = `_${suffix}`;
  return {
    toolCallId: `${call.toolCallId.slice(0, 256 - suffixWithSeparator.length)}${suffixWithSeparator}`,
    toolName,
    input,
  };
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
    code: "checkpoint_capture_failed",
    message:
      error instanceof Error ? error.message : "Checkpoint capture failed",
    retryable: true,
    recoverable: true,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
