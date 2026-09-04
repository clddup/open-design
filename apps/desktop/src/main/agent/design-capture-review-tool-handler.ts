import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  DesignVisualReviewContract,
} from "@/shared/design-agent-tools.js";
import type { RendererDesignCaptureTarget } from "@/shared/design-tool-bridge.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import { CanvasCaptureStructuredContentContract } from "@/shared/design-visual-critic-contract.js";
import type { ModelProviderHost } from "../model/model-provider-host.js";
import { requireCanvasCaptureLayoutQuality } from "./canvas-capture-quality.js";
import {
  requireDesignVisualCriticAttachment,
  runIndependentDesignVisualCritic,
} from "./design-visual-critic.js";
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

export function createDesignCaptureReviewSession(
  input: DesignCaptureReviewSessionInput,
): DesignCaptureReviewSession {
  const capture = async (
    call: ToolCallRequest,
    reportProgress?: ReportProgress,
  ): Promise<TrustedToolResult> => {
    const captureTarget = input.coordinator.resolveCanvasCaptureTarget(
      input.context,
    );
    const result = await input.execute(call, {
      captureTarget,
      ...(reportProgress ? { reportProgress } : {}),
    });
    const parsedContent = CanvasCaptureStructuredContentContract.parse(
      result.content,
    );
    if (!parsedContent.ok) {
      throw designWorkflowError(
        "layout_quality_unavailable",
        formatValidationFailure("Canvas capture", parsedContent.issues),
        { path: parsedContent.issues[0]?.path ?? "/content" },
      );
    }
    const resultContent = result.content as Record<string, unknown>;
    const observedRevision = result.observedRevision;
    if (!Number.isSafeInteger(observedRevision) || observedRevision == null) {
      throw designWorkflowError(
        "capture_revision_invalid",
        "Canvas capture did not return a valid document revision",
      );
    }
    const layoutQuality = requireCanvasCaptureLayoutQuality(
      result,
      input.context.documentId,
      captureTarget,
    );
    const inspection = await input.execute({
      toolCallId: `${call.toolCallId}_delivery_inspection`.slice(0, 256),
      toolName: DESIGN_INSPECT_TOOL_NAME,
      input: {},
    });
    input.coordinator.recordDocumentInspection(input.context, inspection);
    if (inspection.observedRevision !== observedRevision) {
      throw designWorkflowError(
        "capture_revision_invalid",
        "The document changed between the rendered capture and its authoritative verification; capture the current target again",
      );
    }

    let visualCritic:
      Awaited<ReturnType<typeof runIndependentDesignVisualCritic>> | undefined;
    if (layoutQuality === undefined || layoutQuality.errorCount === 0) {
      const attachment = requireDesignVisualCriticAttachment(result.content);
      const criticContext = input.coordinator.resolveVisualCriticContext(
        input.context,
        observedRevision,
        attachment,
      );
      if (criticContext) {
        reportProgress?.("Running independent visual critic", 0.94);
        const modelProviderHost = input.getModelProviderHost();
        visualCritic = await runIndependentDesignVisualCritic(
          modelProviderHost,
          {
            ...criticContext,
            modelSelection: modelProviderHost.resolveVisualCriticSelection(
              criticContext.modelSelection,
            ),
          },
          input.signal,
        );
      }
    }
    const reviewWorkflow = input.coordinator.recordCanvasCapture(
      input.context,
      observedRevision,
      layoutQuality,
      visualCritic,
    );
    return {
      ...result,
      content: {
        ...resultContent,
        captureTarget,
        reviewWorkflow,
        delivery: input.coordinator.getDeliveryLedger(input.context.runId),
        deliveryStage: input.coordinator.getDeliveryStageContext(
          input.context.runId,
        ),
      },
    };
  };

  const handle = async (
    call: ToolCallRequest,
  ): Promise<TrustedToolResult | null> => {
    if (call.toolName === DESIGN_CAPTURE_TOOL_NAME) return await capture(call);
    if (call.toolName !== DESIGN_REVIEW_TOOL_NAME) return null;

    const parsed = DesignVisualReviewContract.parse(call.input, {
      skillRefs: input.coordinator.resolveVisualReviewSkillRefs(input.context),
    });
    if (!parsed.ok) {
      throw new TypeError(
        formatValidationFailure("Visual Review", parsed.issues),
      );
    }
    input.coordinator.registerVisualReview(input.context, parsed.value);
    return {
      content: {
        ok: true,
        status: "accepted",
        refinements: parsed.value.refinements,
        delivery: input.coordinator.getDeliveryLedger(input.context.runId),
      },
    };
  };

  return { capture, handle };
}
