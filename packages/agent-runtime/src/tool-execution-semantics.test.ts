import { describe, expect, it } from "vitest";
import { projectToolResultForModel } from "./tool-execution-semantics.js";

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
