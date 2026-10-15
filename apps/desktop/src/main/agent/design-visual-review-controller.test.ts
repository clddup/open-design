import { describe, expect, it, vi } from "vitest";
import type {
  DesignVisualCriticContext,
  DesignVisualCriticResult,
} from "./design-visual-critic";
import { DesignVisualReviewController } from "./design-visual-review-controller";

function evidence(revision = 7): DesignVisualCriticContext {
  return {
    runId: "run_review",
    modelSelection: { providerId: "provider", modelId: "critic" },
    userRequest: "Create an editable poster; preserve the exact brand name.",
    plan: { deliverable: "poster", objective: "A poster", skillRefs: [] },
    target: {
      targetId: "frame_poster",
      label: "Poster",
      objective: "A poster",
    },
    observedRevision: revision,
    phase: "draft",
    attachment: {
      attachmentId: "image_" + String(revision).padStart(64, "0"),
      name: "capture.jpg",
      mimeType: "image/jpeg",
      byteSize: 128,
    },
    referenceAttachments: [],
    checkedQualityNodeCount: 4,
  };
}

function verdict(revision = 7, score = 6): DesignVisualCriticResult {
  return {
    version: 1,
    observedRevision: revision,
    passed: score >= 8,
    averageScore: score,
    summary: "Typography needs refinement",
    criteria: { "craft-precision": { score, evidence: "Inspect the title" } },
    failedCriteria: score >= 8 ? [] : ["craft-precision"],
    refinements: score >= 8 ? [] : ["Increase title contrast"],
    review: null,
  };
}

function setup() {
  const controller = new DesignVisualReviewController();
  const signal = new AbortController().signal;
  const execute = vi.fn(() => Promise.resolve(verdict()));
  const review = (context = evidence()) =>
    controller.review("document", context, signal, execute);
  return { controller, execute, review, signal };
}

describe("Main visual review recovery", () => {
  it("reuses exact evidence once, then stops repeated capture without a critic call", async () => {
    const state = setup();
    expect(await state.review()).toEqual(verdict());
    expect(await state.review()).toEqual(verdict());
    await expect(state.review()).rejects.toMatchObject({
      cause: {
        code: "design_visual_review_no_progress",
        recoverable: true,
        details: {
          requiresInspection: false,
          issues: [expect.objectContaining({ path: "/capture/revision" })],
        },
      },
    });
    expect(state.execute).toHaveBeenCalledOnce();
  });

  it("hashes facts canonically and returns copies instead of mutable cached verdicts", async () => {
    const state = setup();
    const first = await state.review();
    first.refinements.push("An accidental caller mutation");
    const reordered = {
      ...evidence(),
      target: {
        objective: "A poster",
        label: "Poster",
        targetId: "frame_poster",
      },
    };
    expect(await state.review(reordered)).toEqual(verdict());
    expect(state.execute).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "revision",
      (context: DesignVisualCriticContext) => {
        context.observedRevision++;
      },
    ],
    [
      "pixels",
      (context: DesignVisualCriticContext) => {
        context.attachment.attachmentId += "_changed";
      },
    ],
    [
      "brief",
      (context: DesignVisualCriticContext) => {
        context.userRequest += " Include dates.";
      },
    ],
    [
      "requirements",
      (context: DesignVisualCriticContext) => {
        context.userRequirements = [
          { messageId: "user_1", content: "No gradients", documents: [] },
        ];
      },
    ],
    [
      "reference",
      (context: DesignVisualCriticContext) => {
        context.referenceAttachments = [
          { ...context.attachment, attachmentId: "reference" },
        ];
      },
    ],
    [
      "quality coverage",
      (context: DesignVisualCriticContext) => {
        context.checkedQualityNodeCount = 0;
      },
    ],
    [
      "model",
      (context: DesignVisualCriticContext) => {
        context.modelSelection.modelId = "other";
      },
    ],
    [
      "phase",
      (context: DesignVisualCriticContext) => {
        context.phase = "final";
      },
    ],
  ])("does not reuse a verdict after changing %s", async (_name, change) => {
    const state = setup();
    await state.review();
    const changed = evidence();
    change(changed);
    await state.review(changed);
    expect(state.execute).toHaveBeenCalledTimes(2);
  });

  it("stops after three non-improving verdicts despite changing revision and pixels", async () => {
    const state = setup();
    for (let revision = 7; revision <= 9; revision++) {
      state.execute.mockResolvedValueOnce(verdict(revision));
      await state.review(evidence(revision));
    }
    await expect(state.review(evidence(10))).rejects.toMatchObject({
      cause: {
        code: "design_visual_review_no_progress",
        details: {
          issues: [expect.objectContaining({ path: "/visualReview" })],
        },
      },
    });
    expect(state.execute).toHaveBeenCalledTimes(3);
  });

  it("allows genuine improvement but does not count score oscillation as progress", async () => {
    const state = setup();
    for (const [revision, score] of [
      [7, 6],
      [8, 7],
      [9, 6],
      [10, 7],
    ] as const) {
      state.execute.mockResolvedValueOnce(verdict(revision, score));
      await state.review(evidence(revision));
    }
    await expect(state.review(evidence(11))).rejects.toThrow(
      "design_workflow.visual_review_no_progress",
    );
    expect(state.execute).toHaveBeenCalledTimes(4);
  });

  it("caps continuously improving failed reviews at six for one target", async () => {
    const state = setup();
    for (let index = 0; index < 6; index++) {
      state.execute.mockResolvedValueOnce(verdict(7 + index, 6 + index / 10));
      await state.review(evidence(7 + index));
    }
    await expect(state.review(evidence(13))).rejects.toThrow(
      "design_workflow.visual_review_no_progress",
    );
    expect(state.execute).toHaveBeenCalledTimes(6);
  });

  it("keeps targets, documents and Runs independent", async () => {
    const state = setup();
    await state.review();
    await state.review();
    await expect(state.review()).rejects.toThrow();
    await state.review({
      ...evidence(),
      target: { ...evidence().target, targetId: "other" },
    });
    await state.controller.review(
      "other_document",
      evidence(),
      state.signal,
      state.execute,
    );
    await state.review({ ...evidence(), runId: "next_run" });
    expect(state.execute).toHaveBeenCalledTimes(4);
  });

  it("does not cache Provider faults or mistake them for failed design reviews", async () => {
    const state = setup();
    state.execute.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(state.review()).rejects.toThrow("Provider unavailable");
    await state.review();
    expect(state.execute).toHaveBeenCalledTimes(2);
  });

  it("deduplicates simultaneous requests for identical evidence", async () => {
    const state = setup();
    const results = await Promise.all([state.review(), state.review()]);
    expect(results).toEqual([verdict(), verdict()]);
    expect(state.execute).toHaveBeenCalledOnce();
  });

  it("does not publish a cancelled or disposed Run's late result", async () => {
    const state = setup();
    let resolve!: (result: DesignVisualCriticResult) => void;
    state.execute.mockImplementationOnce(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    const pending = state.review();
    await Promise.resolve();
    state.controller.disposeRun("run_review");
    resolve(verdict());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await state.review();
    expect(state.execute).toHaveBeenCalledTimes(2);
  });

  it("does not call the Provider for an already cancelled request", async () => {
    const state = setup();
    const abort = new AbortController();
    abort.abort();
    await expect(
      state.controller.review(
        "document",
        evidence(),
        abort.signal,
        state.execute,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(state.execute).not.toHaveBeenCalled();
  });

  it("discards a late verdict after cancellation rather than caching it", async () => {
    const state = setup();
    const abort = new AbortController();
    let resolve!: (result: DesignVisualCriticResult) => void;
    state.execute.mockImplementationOnce(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    const pending = state.controller.review(
      "document",
      evidence(),
      abort.signal,
      state.execute,
    );
    await Promise.resolve();
    abort.abort();
    resolve(verdict());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await state.review();
    expect(state.execute).toHaveBeenCalledTimes(2);
  });
});
