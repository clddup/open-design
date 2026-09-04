import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import {
  requireDesignVisualCriticAttachment,
  runIndependentDesignVisualCritic,
} from "./design-visual-critic.js";
import { requireCanvasCaptureLayoutQuality } from "./canvas-capture-quality.js";
import {
  createDesignCaptureReviewSession,
  type DesignCaptureReviewExecute,
} from "./design-capture-review-tool-handler.js";

vi.mock("./canvas-capture-quality.js", () => ({
  requireCanvasCaptureLayoutQuality: vi.fn(),
}));

vi.mock("./design-visual-critic.js", () => ({
  requireDesignVisualCriticAttachment: vi.fn(),
  runIndependentDesignVisualCritic: vi.fn(),
}));

const context: TrustedToolContext = {
  runId: "run_capture_review",
  sessionId: "conversation_capture_review",
  documentId: "document_capture_review",
  revision: 6,
  scope: { kind: "page", pageId: "page_main", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_main" },
};

const captureTarget = {
  kind: "frame" as const,
  pageId: "page_main",
  nodeId: "frame_delivery",
};

const captureCall: ToolCallRequest = {
  toolCallId: "capture_delivery",
  toolName: DESIGN_CAPTURE_TOOL_NAME,
  input: {},
};

function setup(options: { inspectionRevision?: number } = {}) {
  const delivery = { version: 1, targets: [] };
  const deliveryStage = {
    totalTargets: 1,
    plannedTargets: 1,
    verifiedTargets: 0,
    currentPlan: {
      stage: 1,
      status: "active" as const,
      targets: [
        {
          targetId: "target_main",
          label: "Main",
          objective: "Design the main target",
          requiredContent: ["Main target content"],
        },
      ],
    },
  };
  const layoutQuality = { errorCount: 0 };
  const reviewWorkflow = {
    capturedRevision: 7,
    nextAction: "retry-independent-review",
    reviewEligible: false,
  };
  const captureResult: TrustedToolResult = {
    observedRevision: 7,
    content: { ok: true, attachmentId: "capture_attachment" },
  };
  const inspection: TrustedToolResult = {
    observedRevision: options.inspectionRevision ?? 7,
    content: { ok: true, pageId: "page_main", nodes: [] },
  };
  const execute = vi
    .fn<DesignCaptureReviewExecute>()
    .mockImplementation((call) =>
      Promise.resolve(
        call.toolName === DESIGN_CAPTURE_TOOL_NAME ? captureResult : inspection,
      ),
    );
  const coordinator = {
    resolveCanvasCaptureTarget: vi.fn(() => captureTarget),
    recordDocumentInspection: vi.fn(),
    resolveVisualCriticContext: vi.fn(),
    recordCanvasCapture: vi.fn(() => reviewWorkflow),
    getDeliveryLedger: vi.fn(() => delivery),
    getDeliveryStageContext: vi.fn(() => deliveryStage),
  };
  const criticSelection = {
    providerId: "critic_provider",
    modelId: "vision-critic",
  };
  const modelProviderHost = {
    complete: vi.fn(),
    resolveVisualCriticSelection: vi.fn(() => criticSelection),
  };
  const getModelProviderHost = vi.fn(() => modelProviderHost as never);
  const session = createDesignCaptureReviewSession({
    context,
    signal: new AbortController().signal,
    coordinator: coordinator as never,
    execute,
    getModelProviderHost,
  });

  vi.mocked(requireCanvasCaptureLayoutQuality).mockReturnValue(
    layoutQuality as never,
  );

  return {
    captureResult,
    coordinator,
    criticSelection,
    delivery,
    deliveryStage,
    execute,
    getModelProviderHost,
    inspection,
    layoutQuality,
    modelProviderHost,
    reviewWorkflow,
    session,
  };
}

describe("Design capture/review Main session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for another tool family without touching Run services", async () => {
    const state = setup();

    await expect(
      state.session.handle({
        toolCallId: "inspect",
        toolName: DESIGN_INSPECT_TOOL_NAME,
        input: {},
      }),
    ).resolves.toBeNull();

    expect(state.coordinator.resolveCanvasCaptureTarget).not.toHaveBeenCalled();
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.getModelProviderHost).not.toHaveBeenCalled();
  });

  it("captures and inspects one exact revision before advancing the ledger", async () => {
    const state = setup();

    await expect(state.session.capture(captureCall)).resolves.toEqual({
      ...state.captureResult,
      content: {
        ok: true,
        attachmentId: "capture_attachment",
        captureTarget,
        reviewWorkflow: state.reviewWorkflow,
        delivery: state.delivery,
        deliveryStage: state.deliveryStage,
      },
    });

    expect(state.execute).toHaveBeenNthCalledWith(1, captureCall, {
      captureTarget,
    });
    expect(state.execute).toHaveBeenNthCalledWith(2, {
      toolCallId: "capture_delivery_delivery_inspection",
      toolName: DESIGN_INSPECT_TOOL_NAME,
      input: {},
    });
    expect(requireCanvasCaptureLayoutQuality).toHaveBeenCalledWith(
      state.captureResult,
      context.documentId,
      captureTarget,
    );
    expect(state.coordinator.recordDocumentInspection).toHaveBeenCalledWith(
      context,
      state.inspection,
    );
    expect(state.coordinator.recordCanvasCapture).toHaveBeenCalledWith(
      context,
      7,
      state.layoutQuality,
      undefined,
      undefined,
    );
    expect(
      state.coordinator.recordDocumentInspection.mock.invocationCallOrder[0],
    ).toBeLessThan(
      state.coordinator.recordCanvasCapture.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does not advance the ledger when capture and inspection revisions differ", async () => {
    const state = setup({ inspectionRevision: 8 });

    await expect(state.session.capture(captureCall)).rejects.toThrow(
      "design_workflow.capture_revision_invalid",
    );

    expect(state.coordinator.recordCanvasCapture).not.toHaveBeenCalled();
    expect(runIndependentDesignVisualCritic).not.toHaveBeenCalled();
  });

  it("skips the independent critic when deterministic layout has errors", async () => {
    const state = setup();
    const layoutQuality = { errorCount: 2 };
    vi.mocked(requireCanvasCaptureLayoutQuality).mockReturnValue(
      layoutQuality as never,
    );

    await state.session.capture(captureCall);

    expect(requireDesignVisualCriticAttachment).not.toHaveBeenCalled();
    expect(state.coordinator.resolveVisualCriticContext).not.toHaveBeenCalled();
    expect(state.getModelProviderHost).not.toHaveBeenCalled();
    expect(runIndependentDesignVisualCritic).not.toHaveBeenCalled();
    expect(state.coordinator.recordCanvasCapture).toHaveBeenCalledWith(
      context,
      7,
      layoutQuality,
      undefined,
      undefined,
    );
  });

  it("skips the independent critic while the target still needs planned raster assets", async () => {
    const state = setup();
    const attachment = {
      attachmentId: "capture_attachment",
      byteSize: 128,
      mimeType: "image/jpeg" as const,
      name: "capture.jpg",
    };
    vi.mocked(requireDesignVisualCriticAttachment).mockReturnValue(attachment);
    state.coordinator.resolveVisualCriticContext.mockReturnValue(null);

    await state.session.capture(captureCall);

    expect(state.coordinator.resolveVisualCriticContext).toHaveBeenCalledWith(
      context,
      7,
      attachment,
    );
    expect(state.getModelProviderHost).not.toHaveBeenCalled();
    expect(runIndependentDesignVisualCritic).not.toHaveBeenCalled();
    expect(state.coordinator.recordCanvasCapture).toHaveBeenCalledWith(
      context,
      7,
      state.layoutQuality,
      undefined,
      undefined,
    );
  });

  it("runs the independent critic only for a clean eligible capture", async () => {
    const state = setup();
    const attachment = {
      attachmentId: "capture_attachment",
      byteSize: 128,
      mimeType: "image/jpeg" as const,
      name: "capture.jpg",
    };
    const criticContext = {
      runId: context.runId,
      observedRevision: 7,
      modelSelection: {
        providerId: "author_provider",
        modelId: "author-model",
      },
    };
    const criticResult = { passed: true, observedRevision: 7 };
    const reportProgress = vi.fn();
    vi.mocked(requireDesignVisualCriticAttachment).mockReturnValue(attachment);
    state.coordinator.resolveVisualCriticContext.mockReturnValue(criticContext);
    vi.mocked(runIndependentDesignVisualCritic).mockResolvedValue(
      criticResult as never,
    );

    await state.session.capture(captureCall, reportProgress);

    expect(reportProgress).toHaveBeenCalledWith(
      "Running independent visual critic",
      0.94,
    );
    expect(state.coordinator.resolveVisualCriticContext).toHaveBeenCalledWith(
      context,
      7,
      attachment,
    );
    expect(state.getModelProviderHost).toHaveBeenCalledTimes(1);
    expect(
      state.modelProviderHost.resolveVisualCriticSelection,
    ).toHaveBeenCalledWith(criticContext.modelSelection);
    expect(runIndependentDesignVisualCritic).toHaveBeenCalledWith(
      state.modelProviderHost,
      {
        ...criticContext,
        modelSelection: state.criticSelection,
      },
      expect.any(AbortSignal),
    );
    expect(state.coordinator.recordCanvasCapture).toHaveBeenCalledWith(
      context,
      7,
      state.layoutQuality,
      criticResult,
      undefined,
    );
  });

  it("keeps the captured revision when the independent critic is unavailable", async () => {
    const state = setup();
    const attachment = {
      attachmentId: "capture_attachment",
      byteSize: 128,
      mimeType: "image/jpeg" as const,
      name: "capture.jpg",
    };
    const criticContext = {
      runId: context.runId,
      observedRevision: 7,
      modelSelection: {
        providerId: "author_provider",
        modelId: "author-model",
      },
    };
    vi.mocked(requireDesignVisualCriticAttachment).mockReturnValue(attachment);
    state.coordinator.resolveVisualCriticContext.mockReturnValue(criticContext);
    vi.mocked(runIndependentDesignVisualCritic).mockRejectedValue(
      new Error("critic provider timed out"),
    );

    await expect(state.session.capture(captureCall)).resolves.toBeDefined();

    expect(state.coordinator.recordCanvasCapture).toHaveBeenCalledWith(
      context,
      7,
      state.layoutQuality,
      undefined,
      { message: "critic provider timed out" },
    );
  });
});
