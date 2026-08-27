import { describe, expect, it } from "vitest";
import {
  createDesignVisualCriticVerdictContract,
  DesignVisualCriticCaptureContentContract,
} from "./design-visual-critic-contract";

describe("independent visual critic contracts", () => {
  it("uses the same dynamic schema for Provider disclosure and Runtime parsing", () => {
    const contract = createDesignVisualCriticVerdictContract(
      ["visual-thesis", "craft-precision"] as const,
      "draft",
    );

    expect(JSON.stringify(contract.schema)).toContain(
      '"required":["visual-thesis","craft-precision"]',
    );
    expect(
      contract.issues({
        summary: "The captured direction has a visible visual thesis.",
        criteria: {
          "visual-thesis": {
            score: 6,
            evidence:
              "The primary composition exposes one clear visual argument.",
          },
          "craft-precision": {
            score: 4,
            evidence:
              "Edges and spacing remain controlled at the captured scale.",
          },
        },
        refinements: [
          "Tighten the dominant spacing relationship.",
          "Clarify the signature visual detail.",
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "design_visual_critic.schema_invalid",
        path: "/criteria/visual-thesis/score",
      }),
    );
  });

  it("locates invalid capture attachment fields without accepting extras", () => {
    expect(
      DesignVisualCriticCaptureContentContract.issues({
        attachment: {
          attachmentId: "capture_1",
          name: "capture.jpg",
          mimeType: "image/jpeg",
          byteSize: 1_024,
          filePath: "/tmp/capture.jpg",
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "design_visual_critic.capture_schema_invalid",
        path: "/attachment/filePath",
      }),
    );
  });
});
