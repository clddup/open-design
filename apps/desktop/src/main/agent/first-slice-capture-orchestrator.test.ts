import type { TrustedToolResult } from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  applyFirstSliceAndCapture,
  captureCommittedFirstSlice,
} from "./first-slice-capture-orchestrator";

const applied: TrustedToolResult = {
  content: {
    committedSteps: [{ stepIds: ["hero"], revision: 5 }],
    delivery: { activeTargetId: "target_home" },
  },
  designRevision: {
    previousRevision: 4,
    revision: 5,
    transactionId: "transaction_first_slice",
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

describe("first-slice capture orchestration", () => {
  it("does not capture when the first slice committed no revision", async () => {
    const capture = vi.fn();
    await expect(
      captureCommittedFirstSlice({
        applied: { content: { ok: true } },
        capture,
        getDelivery: () => undefined,
      }),
    ).rejects.toThrow("material_write_required");
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
    const result = await captureCommittedFirstSlice({
      applied,
      capture: vi.fn().mockRejectedValue(captureError),
      getDelivery: () => ({ activeTargetId: "target_home" }),
    });

    expect(result).toMatchObject({
      designRevision: { revision: 5 },
      content: {
        ok: false,
        materialRevisionPreserved: 5,
        captureFailure: { code: "renderer_capture_timeout" },
        delivery: { activeTargetId: "target_home" },
      },
    });
  });

  it("preserves material metadata and returns the captured attachment", async () => {
    const result = await applyFirstSliceAndCapture({
      firstSlice: () => Promise.resolve(applied),
      capture: () => Promise.resolve(captured),
      getDelivery: () => undefined,
    });

    expect(result).toMatchObject({
      observedRevision: 5,
      designRevision: { revision: 5 },
      content: {
        committedSteps: [{ stepIds: ["hero"], revision: 5 }],
        attachments: [{ attachmentId: "image_capture" }],
      },
    });
  });

  it("projects first-slice and capture progress monotonically", async () => {
    const progress: number[] = [];
    await applyFirstSliceAndCapture(
      {
        firstSlice: (report) => {
          report?.("material late", 0.9);
          report?.("material stale", 0.2);
          return Promise.resolve(applied);
        },
        capture: (report) => {
          report?.("capture start", 0);
          report?.("capture done", 1);
          return Promise.resolve(captured);
        },
        getDelivery: () => undefined,
      },
      (_message, value) => progress.push(value),
    );

    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
  });
});
