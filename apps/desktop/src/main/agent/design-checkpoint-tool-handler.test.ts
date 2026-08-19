import type {
  ToolCallRequest,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import { describe, expect, it, vi } from "vitest";
import type { DesignVisualReviewToolInput } from "../../shared/design-agent-tools";
import {
  captureCommittedDesignCheckpoint,
  handleDesignCheckpointTool,
  handleFirstSliceCheckpoint,
  type DesignCheckpointDependencies,
} from "./design-checkpoint-tool-handler";

const applyInput = {
  label: "Refine hero spacing",
  commands: [
    {
      commandId: "remove_obsolete_badge",
      type: "delete_element" as const,
      nodeId: "obsolete_badge",
    },
  ],
};

const review = {
  version: 1,
  skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
    ...reference,
  })),
  briefFidelity:
    "The rendered target preserves every requested product function and label",
  distinctiveness:
    "The asymmetric hero and signal rail create a recognizable product identity",
  signatureMotif:
    "The signal rail connects the primary form to the supporting content rhythm",
  composition: "The hero needs more negative space around its primary form",
  hierarchy: "The secondary content currently competes with the main action",
  typography: "Supporting typography needs lower contrast and tighter rhythm",
  assetIntegration: "The image edge needs a clearer relationship to the title",
  formAndSurface: "The foreground surface is visually heavier than intended",
  effects: "The current glow needs a smaller radius and lower opacity",
  antiTemplate:
    "The composition avoids an equal card grid and ornamental gradient identity",
  criteria: {
    "visual-thesis":
      "The directional product thesis is visible in the dominant hero plane",
    "signature-motif":
      "The signal rail is present but needs stronger integration with the title",
    "composition-tension":
      "The offset hero establishes one focal path despite tight surrounding space",
    "typography-character":
      "Display and supporting text have distinct roles and a deliberate contrast",
    "material-coherence":
      "The image edge, surfaces, and glow belong to one restrained material system",
    "template-avoidance":
      "The rendered design does not rely on repeated cards or decorative gradients",
  },
  failedCriteria: ["signature-motif", "composition-tension"],
  refinements: [
    "Increase negative space around the primary form",
    "Reduce the secondary surface contrast",
  ],
} satisfies DesignVisualReviewToolInput;

const applied: TrustedToolResult = {
  content: {
    committedSteps: [{ stepIds: ["hero"], revision: 5 }],
    delivery: { activeTargetId: "target_home" },
  },
  designRevision: {
    previousRevision: 4,
    revision: 5,
    transactionId: "transaction_refine",
  },
};

const captured: TrustedToolResult = {
  observedRevision: 5,
  content: {
    ok: true,
    attachments: [{ attachmentId: "image_capture" }],
    delivery: { activeTargetId: "target_home", status: "captured" },
  },
};

function call(input: unknown): ToolCallRequest {
  return {
    toolCallId: "checkpoint_1",
    toolName: "opendesign_design_checkpoint",
    input,
  };
}

function dependencies(
  overrides: Partial<DesignCheckpointDependencies> = {},
): DesignCheckpointDependencies {
  return {
    apply: vi.fn().mockResolvedValue(applied),
    capture: vi.fn().mockResolvedValue(captured),
    getDelivery: vi.fn(() => ({ activeTargetId: "target_home" })),
    review: vi.fn(() => ({ content: { ok: true, status: "accepted" } })),
    ...overrides,
  };
}

describe("design checkpoint tool handler", () => {
  it("commits material before capturing the exact new revision", async () => {
    const order: string[] = [];
    const deps = dependencies({
      apply: vi.fn(() => {
        order.push("apply");
        return Promise.resolve(applied);
      }),
      capture: vi.fn(() => {
        order.push("capture");
        return Promise.resolve(captured);
      }),
    });

    const result = await handleDesignCheckpointTool(
      call({ version: 1, action: "apply-and-capture", apply: applyInput }),
      deps,
    );

    expect(order).toEqual(["apply", "capture"]);
    expect(deps.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "checkpoint_1_apply",
        toolName: "opendesign_apply_transaction",
      }),
      applyInput,
      undefined,
    );
    expect(result).toMatchObject({
      observedRevision: 5,
      designRevision: { revision: 5, transactionId: "transaction_refine" },
      content: {
        checkpoint: {
          version: 1,
          action: "apply-and-capture",
          status: "completed",
          materialRevision: 5,
        },
      },
    });
  });

  it("never starts capture when material apply fails", async () => {
    const capture = vi.fn();
    const deps = dependencies({
      apply: vi.fn().mockRejectedValue(new Error("apply rejected")),
      capture,
    });

    await expect(
      handleDesignCheckpointTool(
        call({ version: 1, action: "apply-and-capture", apply: applyInput }),
        deps,
      ),
    ).rejects.toThrow("apply rejected");
    expect(capture).not.toHaveBeenCalled();
  });

  it("preserves the committed revision when capture alone fails", async () => {
    const captureError = new Error("capture stalled", {
      cause: {
        code: "renderer_capture_timeout",
        message: "capture stalled",
        retryable: true,
        recoverable: true,
      },
    });
    const deps = dependencies({
      capture: vi.fn().mockRejectedValue(captureError),
    });

    const result = await handleDesignCheckpointTool(
      call({ version: 1, action: "apply-and-capture", apply: applyInput }),
      deps,
    );

    expect(result).toMatchObject({
      designRevision: { revision: 5 },
      content: {
        ok: false,
        checkpoint: {
          status: "capture-failed",
          failure: { code: "renderer_capture_timeout" },
        },
        delivery: { activeTargetId: "target_home" },
      },
    });
    expect(result.observedRevision).toBeUndefined();
  });

  it("accepts review before refinement and captures only after refinement", async () => {
    const order: string[] = [];
    const deps = dependencies({
      review: vi.fn(() => {
        order.push("review");
        return { content: { ok: true } };
      }),
      apply: vi.fn(() => {
        order.push("refine");
        return Promise.resolve(applied);
      }),
      capture: vi.fn(() => {
        order.push("capture");
        return Promise.resolve(captured);
      }),
    });

    const result = await handleDesignCheckpointTool(
      call({
        version: 1,
        action: "review-refine-and-capture",
        review,
        refinement: applyInput,
      }),
      deps,
    );

    expect(order).toEqual(["review", "refine", "capture"]);
    expect(result.content).toMatchObject({
      checkpoint: {
        action: "review-refine-and-capture",
        reviewAccepted: true,
        status: "completed",
      },
    });
  });

  it("short-circuits refinement and capture when review is rejected", async () => {
    const apply = vi.fn();
    const capture = vi.fn();
    const deps = dependencies({
      review: vi.fn(() => {
        throw new Error("capture required");
      }),
      apply,
      capture,
    });

    await expect(
      handleDesignCheckpointTool(
        call({
          version: 1,
          action: "review-refine-and-capture",
          review,
          refinement: applyInput,
        }),
        deps,
      ),
    ).rejects.toThrow("capture required");
    expect(apply).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not capture a no-op material checkpoint", async () => {
    const capture = vi.fn();
    await expect(
      captureCommittedDesignCheckpoint({
        action: "apply-and-capture",
        applied: { content: { ok: true } },
        capture,
        getDelivery: () => undefined,
      }),
    ).rejects.toThrow("material_revision_required");
    expect(capture).not.toHaveBeenCalled();
  });

  it("preserves first-slice material metadata and returns the captured attachment", async () => {
    const progress: number[] = [];
    const firstSlice = {
      ...applied,
      content: {
        committedSteps: [{ stepIds: ["hero"], revision: 5 }],
        delivery: { activeTargetId: "target_home" },
        plan: { version: 5, objective: "Create the first real screen" },
      },
    };
    const result = await handleFirstSliceCheckpoint(
      {
        firstSlice: (report) => {
          report?.("material start", 0);
          report?.("material complete", 1);
          return Promise.resolve(firstSlice);
        },
        capture: (report) => {
          report?.("capture start", 0);
          report?.("capture complete", 1);
          return Promise.resolve(captured);
        },
        getDelivery: () => undefined,
      },
      (_message, value) => progress.push(value),
    );

    expect(result).toMatchObject({
      observedRevision: 5,
      designRevision: { revision: 5 },
      content: {
        plan: { version: 5, objective: "Create the first real screen" },
        attachments: [{ attachmentId: "image_capture" }],
        checkpoint: {
          action: "first-slice-and-capture",
          status: "completed",
        },
      },
    });
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
  });

  it("projects nested progress monotonically across apply and capture", async () => {
    const progress: number[] = [];
    const deps = dependencies({
      apply: vi.fn((_call, _input, report: ReportProgress | undefined) => {
        report?.("apply late", 0.9);
        report?.("apply stale", 0.2);
        return Promise.resolve(applied);
      }),
      capture: vi.fn((_call, report: ReportProgress | undefined) => {
        report?.("capture start", 0);
        report?.("capture done", 1);
        return Promise.resolve(captured);
      }),
    });

    await handleDesignCheckpointTool(
      call({ version: 1, action: "apply-and-capture", apply: applyInput }),
      deps,
      (_message, value) => progress.push(value),
    );

    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
  });
});

type ReportProgress = (message: string, progress: number) => void;
