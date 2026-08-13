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

  it("keeps user cancellation authoritative over an aborted terminal tool", () => {
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
    ).toBeUndefined();
    expect(
      terminalRunFailure(
        { code: "cancelled", message: "Cancelled", retryable: false },
        undefined,
      ),
    ).toBeUndefined();
  });

  it("still projects a terminal tool failure for a non-cancelled model error", () => {
    expect(
      terminalRunFailure(
        { code: "provider_error", message: "Disconnected", retryable: true },
        {
          code: "renderer_circuit_open",
          message: "Canvas renderer repeatedly stalled",
          retryable: false,
          recoverable: false,
          runTerminal: true,
        },
      ),
    ).toMatchObject({ code: "renderer_circuit_open" });
  });
});
