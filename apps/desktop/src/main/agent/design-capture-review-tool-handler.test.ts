import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  type DesignVisualReviewModelInput,
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
    nextAction: "record-visual-review",
    reviewEligible: true,
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
    resolveVisualReviewSkillRefs: vi.fn(() => BUILTIN_UI_DESIGN_SKILL_REFS),
    registerVisualReview: vi.fn(),
  };
  const getModelProviderHost = vi.fn(() => ({ complete: vi.fn() }) as never);
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
    delivery,
    deliveryStage,
    execute,
    getModelProviderHost,
    inspection,
    layoutQuality,
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
    expect(
      state.coordinator.resolveVisualReviewSkillRefs,
    ).not.toHaveBeenCalled();
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.getModelProviderHost).not.toHaveBeenCalled();
  });

  it("rejects malformed visual review with its field path before registration", async () => {
    const state = setup();
    const { composition: _composition, ...input } = visualReview();

    await expect(
      state.session.handle({
        toolCallId: "review_invalid",
        toolName: DESIGN_REVIEW_TOOL_NAME,
        input,
      }),
    ).rejects.toThrow(/Visual Review.*\/composition/);

    expect(_composition).toContain("dominant");
    expect(state.coordinator.registerVisualReview).not.toHaveBeenCalled();
  });

  it("binds active skill refs and records a valid visual review", async () => {
    const state = setup();
    const input = visualReview();

    await expect(
      state.session.handle({
        toolCallId: "review_valid",
        toolName: DESIGN_REVIEW_TOOL_NAME,
        input,
      }),
    ).resolves.toEqual({
      content: {
        ok: true,
        status: "accepted",
        refinements: input.refinements,
        delivery: state.delivery,
      },
    });

    expect(state.coordinator.resolveVisualReviewSkillRefs).toHaveBeenCalledWith(
      context,
    );
    expect(state.coordinator.registerVisualReview).toHaveBeenCalledWith(
      context,
      { ...input, skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS },
    );
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
    const criticContext = { runId: context.runId, observedRevision: 7 };
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
    expect(runIndependentDesignVisualCritic).toHaveBeenCalledWith(
      state.getModelProviderHost.mock.results[0]?.value,
      criticContext,
      expect.any(AbortSignal),
    );
    expect(state.coordinator.recordCanvasCapture).toHaveBeenCalledWith(
      context,
      7,
      state.layoutQuality,
      criticResult,
    );
  });
});

function visualReview(): DesignVisualReviewModelInput {
  return {
    version: 1,
    briefFidelity:
      "The capture preserves the requested product structure without invented capability.",
    distinctiveness:
      "The asymmetric signal workspace is recognizable beyond a generic dashboard.",
    signatureMotif:
      "A continuous signal rail visibly connects navigation and primary work.",
    composition:
      "One dominant work plane and a narrow inspector establish deliberate tension.",
    hierarchy:
      "The primary task and action remain legible before secondary controls.",
    typography:
      "Editorial headings and compact labels have distinct, readable roles.",
    assetIntegration:
      "Icons and imagery align with the control grid and support the subject.",
    formAndSurface:
      "Neutral planes and restrained borders create a coherent depth system.",
    effects:
      "Selection and focus effects are visible without obscuring the content.",
    antiTemplate:
      "The capture avoids equal card grids, ornamental gradients, and generic rings.",
    criteria: {
      "visual-thesis":
        "The operational signal thesis is visible in the dominant work plane.",
      "signature-motif":
        "The signal rail remains visible across navigation and content.",
      "composition-tension":
        "The asymmetric split establishes one dominant region and one support edge.",
      "typography-character":
        "Type roles are distinct and preserve the requested professional character.",
      "material-coherence":
        "Neutral planes and one accent form a consistent material system.",
      "template-avoidance":
        "The capture avoids repeated cards and unrelated decorative primitives.",
      "glance-legibility":
        "The primary task and action remain clear at thumbnail scale.",
      "subject-specificity":
        "The composition remains tied to the requested design workspace subject.",
      "craft-precision":
        "Spacing and control proportions still need deliberate refinement.",
    },
    failedCriteria: ["composition-tension", "craft-precision"],
    refinements: [
      "Increase the primary work plane width and reduce inspector contrast.",
      "Remove secondary borders and normalize control spacing.",
    ],
  };
}
