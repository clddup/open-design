import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import type { DesignLayoutQualityReport } from "@opendesign/editor-runtime";
import type { CaptureCanvasInput } from "@/shared/design-capture-tool.js";
import type { RendererDesignCaptureTarget } from "@/shared/design-tool-bridge.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import { CanvasCaptureStructuredContentContract } from "@/shared/design-visual-critic-contract.js";
import type { ModelProviderHost } from "../model/model-provider-host.js";
import { requireCanvasCaptureLayoutQuality } from "./canvas-capture-quality.js";
import {
  requireDesignVisualCriticAttachment,
  runIndependentDesignVisualCritic,
  type DesignVisualCriticContext,
  type DesignVisualCriticResult,
} from "./design-visual-critic.js";
import type { ExplicitCanvasReview } from "./explicit-canvas-review.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

type ReportProgress = (message: string, progress: number) => void;

export type DesignCaptureReviewExecute = (
  call: ToolCallRequest,
  options?: {
    captureTarget?: RendererDesignCaptureTarget;
    reportProgress?: ReportProgress;
  },
) => Promise<TrustedToolResult>;

export type DesignCaptureReviewSessionInput = {
  context: TrustedToolContext;
  signal: AbortSignal;
  coordinator: GlobalTaskCoordinator;
  execute: DesignCaptureReviewExecute;
  getModelProviderHost(): ModelProviderHost;
};

export type DesignCaptureReviewSession = {
  capture(
    call: ToolCallRequest,
    reportProgress?: ReportProgress,
  ): Promise<TrustedToolResult>;
  handle(call: ToolCallRequest): Promise<TrustedToolResult | null>;
};

type CapturedDesign = {
  result: TrustedToolResult;
  content: Record<string, unknown>;
  target: RendererDesignCaptureTarget;
  revision: number;
  layoutQuality: DesignLayoutQualityReport | undefined;
};

type VisualReview = {
  critic?: DesignVisualCriticResult;
  unavailable?: { message: string };
};

export function createDesignCaptureReviewSession(
  input: DesignCaptureReviewSessionInput,
): DesignCaptureReviewSession {
  const capture = (call: ToolCallRequest, reportProgress?: ReportProgress) =>
    captureDesign(input, call, reportProgress);
  const handle = async (
    call: ToolCallRequest,
  ): Promise<TrustedToolResult | null> =>
    call.toolName === DESIGN_CAPTURE_TOOL_NAME ? capture(call) : null;
  return { capture, handle };
}

async function captureDesign(
  input: DesignCaptureReviewSessionInput,
  call: ToolCallRequest,
  reportProgress?: ReportProgress,
): Promise<TrustedToolResult> {
  const explicitTarget = (call.input as CaptureCanvasInput).target;
  const explicitReview = explicitTarget
    ? input.coordinator.resolveExplicitCanvasReview(
        input.context,
        explicitTarget,
      )
    : undefined;
  const captureTarget =
    explicitReview?.captureTarget ??
    input.coordinator.resolveCanvasCaptureTarget(input.context);
  const result = await input.execute(call, {
    captureTarget,
    ...(reportProgress ? { reportProgress } : {}),
  });
  const captured = await validateCapture(input, call, result, captureTarget);
  const context = resolveCriticContext(
    input,
    captured,
    explicitReview,
    explicitTarget,
  );
  const review = context
    ? await runVisualReview(input, captured, context, reportProgress)
    : {};
  if (context) {
    const changed = await reviewRevisionChanged(input, call, captured, review);
    if (changed) return changed;
  }
  return completeCapture(input, captured, review, explicitTarget);
}

async function validateCapture(
  input: DesignCaptureReviewSessionInput,
  call: ToolCallRequest,
  result: TrustedToolResult,
  target: RendererDesignCaptureTarget,
): Promise<CapturedDesign> {
  const parsed = CanvasCaptureStructuredContentContract.parse(result.content);
  if (!parsed.ok) {
    throw designWorkflowError(
      "layout_quality_unavailable",
      formatValidationFailure("Canvas capture", parsed.issues),
      { path: parsed.issues[0]?.path ?? "/content" },
    );
  }
  const revision = result.observedRevision;
  if (!Number.isSafeInteger(revision) || revision == null) {
    throw designWorkflowError(
      "capture_revision_invalid",
      "Canvas capture did not return a valid document revision",
    );
  }
  const layoutQuality = requireCanvasCaptureLayoutQuality(
    result,
    input.context.documentId,
    target,
  );
  const inspection = await input.execute({
    toolCallId: `${call.toolCallId}_delivery_inspection`.slice(0, 256),
    toolName: DESIGN_INSPECT_TOOL_NAME,
    input: {},
  });
  input.coordinator.recordDocumentInspection(input.context, inspection);
  if (inspection.observedRevision !== revision) {
    throw designWorkflowError(
      "capture_revision_invalid",
      "The document changed between the rendered capture and its authoritative verification; capture the current target again",
    );
  }
  return {
    result,
    content: result.content as Record<string, unknown>,
    target,
    revision,
    layoutQuality,
  };
}

function resolveCriticContext(
  input: DesignCaptureReviewSessionInput,
  captured: CapturedDesign,
  explicitReview: ExplicitCanvasReview | undefined,
  explicitTarget: CaptureCanvasInput["target"],
): DesignVisualCriticContext | null {
  if (
    captured.layoutQuality !== undefined &&
    captured.layoutQuality.errorCount !== 0
  )
    return null;
  const attachment = requireDesignVisualCriticAttachment(
    captured.result.content,
  );
  const planned = explicitTarget
    ? input.coordinator.resolveVisualCriticContext(
        input.context,
        captured.revision,
        attachment,
        explicitTarget.frameId,
      )
    : input.coordinator.resolveVisualCriticContext(
        input.context,
        captured.revision,
        attachment,
      );
  if (!explicitReview) return planned;
  const context: DesignVisualCriticContext = {
    ...explicitReview.criticContext,
    plan: { ...planned?.plan, ...explicitReview.criticContext.plan },
    attachment,
    observedRevision: captured.revision,
    phase: planned?.phase ?? "draft",
  };
  delete context.plan.referenceStrategy;
  return context;
}

async function runVisualReview(
  input: DesignCaptureReviewSessionInput,
  captured: CapturedDesign,
  context: DesignVisualCriticContext,
  reportProgress?: ReportProgress,
): Promise<VisualReview> {
  reportProgress?.("Running independent visual critic", 0.94);
  const host = input.getModelProviderHost();
  try {
    const critic = await runIndependentDesignVisualCritic(
      host,
      {
        ...context,
        ...(captured.layoutQuality?.checkedQualityNodeCount !== undefined
          ? {
              checkedQualityNodeCount:
                captured.layoutQuality.checkedQualityNodeCount,
            }
          : {}),
        modelSelection: host.resolveVisualCriticSelection(
          context.modelSelection,
        ),
      },
      input.signal,
    );
    return { critic };
  } catch (error) {
    if (input.signal.aborted) throw error;
    return { unavailable: { message: errorMessage(error) } };
  }
}

async function reviewRevisionChanged(
  input: DesignCaptureReviewSessionInput,
  call: ToolCallRequest,
  captured: CapturedDesign,
  review: VisualReview,
): Promise<TrustedToolResult | undefined> {
  const current = await input.execute({
    toolCallId: `${call.toolCallId}_review_revision`.slice(0, 256),
    toolName: DESIGN_INSPECT_TOOL_NAME,
    input: {},
  });
  input.coordinator.recordDocumentInspection(input.context, current);
  if (current.observedRevision === captured.revision) return undefined;
  if (
    captured.target.kind === "frame" &&
    current.observedRevision !== undefined
  ) {
    input.coordinator.invalidateCanvasReview(
      input.context,
      captured.target.nodeId,
      current.observedRevision,
    );
  }
  return {
    ...captured.result,
    content: {
      ...captured.content,
      captureTarget: captured.target,
      delivery: input.coordinator.getDeliveryLedger(input.context.runId),
      reviewWorkflow: {
        code: "design_capture_revision_invalid",
        capturedRevision: captured.revision,
        currentRevision: current.observedRevision,
        verified: false,
        nextAction: "inspect-and-recapture",
        message:
          "The design changed during review. This review only describes the captured revision; inspect and capture the current design before claiming verification.",
        ...(review.critic ? { critic: review.critic } : {}),
      },
    },
  };
}

function completeCapture(
  input: DesignCaptureReviewSessionInput,
  captured: CapturedDesign,
  review: VisualReview,
  explicitTarget: CaptureCanvasInput["target"],
): TrustedToolResult {
  const reviewWorkflow = explicitTarget
    ? input.coordinator.recordExplicitCanvasReview(
        input.context,
        explicitTarget.frameId,
        captured.revision,
        captured.layoutQuality,
        review.critic,
        review.unavailable,
      )
    : input.coordinator.recordCanvasCapture(
        input.context,
        captured.revision,
        captured.layoutQuality,
        review.critic,
        review.unavailable,
      );
  return {
    ...captured.result,
    content: {
      ...captured.content,
      captureTarget: captured.target,
      reviewWorkflow,
      delivery: input.coordinator.getDeliveryLedger(input.context.runId),
      deliveryStage: input.coordinator.getDeliveryStageContext(
        input.context.runId,
      ),
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 1_000)
    : "Independent visual critic is unavailable";
}
