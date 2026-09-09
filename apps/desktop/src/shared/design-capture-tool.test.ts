import { describe, expect, it } from "vitest";
import { CaptureCanvasContract } from "./design-capture-tool";
import {
  DESIGN_AGENT_TOOL_SPECS,
  designAgentToolInputIssues,
} from "./design-agent-tool-catalog";

describe("capture input contract", () => {
  it("derives the Provider input from the same contract and preserves empty capture input", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === "opendesign_capture_canvas",
    )!;
    expect(tool.inputSchema).toEqual(CaptureCanvasContract.schema);
    expect(CaptureCanvasContract.parse({}).ok).toBe(true);
    const input = { target: { frameId: "frame", deliverable: "poster" } };
    expect(CaptureCanvasContract.parse(input).ok).toBe(true);
    expect(
      designAgentToolInputIssues("opendesign_capture_canvas", input),
    ).toEqual([]);
  });

  it("returns exact field paths instead of accepting unknown controls", () => {
    for (const [input, path] of [
      [{ target: { frameId: 12, deliverable: "poster" } }, "/target/frameId"],
      [
        { target: { frameId: "frame", deliverable: "poster", force: true } },
        "/target/force",
      ],
      [
        {
          target: {
            frameId: "frame",
            deliverable: "ui",
            qualityProfile: { kind: "graphic" },
          },
        },
        "/target/qualityProfile/kind",
      ],
    ] as const) {
      const result = CaptureCanvasContract.parse(input);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path })]),
        );
    }
  });
});
