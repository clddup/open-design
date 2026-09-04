import { describe, expect, it } from "vitest";
import { inferPiToolFailure } from "./pi-tool-protocol.js";

describe("Pi tool failure inference", () => {
  it("does not misclassify an unknown execution failure as invalid model input", () => {
    expect(
      inferPiToolFailure(
        { budgetExceeded: false, toolName: "opendesign_edit_design" },
        {
          content: [
            {
              type: "text",
              text: "Renderer connection not found after execution started",
            },
          ],
        },
      ),
    ).toEqual({
      code: "tool_execution_failed",
      message: "Renderer connection not found after execution started",
      retryable: true,
      recoverable: false,
      runTerminal: true,
    });
  });
});
