import { describe, expect, it } from "vitest";
import {
  projectToolResultForModel,
  validateDesignRevision,
} from "./tool-execution-semantics.js";

describe("tool result model projection", () => {
  it("preserves compact delivery recovery state when a document result is oversized", () => {
    const unfinishedDelivery = {
      version: 1,
      targets: [
        {
          targetId: "target_profile",
          label: "Profile",
          pageId: "page_1",
          rootNodeId: "frame_profile",
          status: "pending",
        },
      ],
      activeTargetId: "target_profile",
    };

    expect(
      projectToolResultForModel({
        document: { nodes: "x".repeat(80_000) },
        unfinishedDelivery,
      }),
    ).toMatchObject({ unfinishedDelivery });
  });
});

describe("trusted design revision transitions", () => {
  it("accepts a trusted write rebased over newer external document revisions", () => {
    expect(
      validateDesignRevision(
        {
          previousRevision: 7,
          rebasedFromRevision: 5,
          revision: 8,
          transactionId: "transaction_rebased_insert",
        },
        5,
      ),
    ).toEqual({
      previousRevision: 7,
      rebasedFromRevision: 5,
      revision: 8,
      transactionId: "transaction_rebased_insert",
    });
  });

  it("rejects backward, non-monotonic, and untrusted revision transitions", () => {
    expect(() =>
      validateDesignRevision(
        {
          previousRevision: 7,
          revision: 8,
          transactionId: "transaction_missing_rebase_proof",
        },
        5,
      ),
    ).toThrow("invalid design revision transition");
    expect(() =>
      validateDesignRevision(
        {
          previousRevision: 4,
          revision: 6,
          transactionId: "transaction_backward_base",
        },
        5,
      ),
    ).toThrow("invalid design revision transition");
    expect(() =>
      validateDesignRevision(
        {
          previousRevision: 7,
          revision: 7,
          transactionId: "transaction_non_monotonic",
        },
        5,
      ),
    ).toThrow("invalid design revision transition");
  });
});
