import { describe, expect, it } from "vitest";
import { terminalRunFailure } from "./pi-terminal-failure.js";

describe("terminalRunFailure", () => {
  it("projects a run-terminal tool failure without its internal control bit", () => {
    expect(
      terminalRunFailure(undefined, {
        code: "renderer_circuit_open",
        message: "Canvas renderer repeatedly stalled",
        retryable: false,
        recoverable: false,
        runTerminal: true,
      }),
    ).toEqual({
      code: "renderer_circuit_open",
      message: "Canvas renderer repeatedly stalled",
      retryable: false,
    });
  });

  it("prefers a terminal tool failure and ignores model cancellation", () => {
    expect(
      terminalRunFailure(
        { code: "cancelled", message: "Cancelled", retryable: false },
        {
          code: "renderer_circuit_open",
          message: "Canvas renderer repeatedly stalled",
          retryable: false,
          recoverable: false,
          runTerminal: true,
        },
      ),
    ).toMatchObject({ code: "renderer_circuit_open" });
    expect(
      terminalRunFailure(
        { code: "cancelled", message: "Cancelled", retryable: false },
        undefined,
      ),
    ).toBeUndefined();
  });
});
