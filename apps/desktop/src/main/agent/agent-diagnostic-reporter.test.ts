import type { AgentEvent } from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import { reportAgentDiagnostic } from "./agent-diagnostic-reporter";

describe("Agent diagnostic reporter", () => {
  it("does not toast a tool aborted by an explicit Run cancellation", () => {
    const publish = vi.fn();
    const event: AgentEvent = {
      type: "tool.failed",
      runId: "run_cancelled",
      toolCallId: "capture_cancelled",
      code: "run_cancelled",
      message: "Design tool request was cancelled",
      retryable: false,
      recoverable: false,
    };

    reportAgentDiagnostic(event, publish, () => ({ runId: event.runId }));

    expect(publish).not.toHaveBeenCalled();
  });

  it("continues to report genuine design tool failures", () => {
    const publish = vi.fn();
    reportAgentDiagnostic(
      {
        type: "tool.failed",
        runId: "run_failed",
        toolCallId: "capture_failed",
        code: "renderer_capture_timeout",
        message: "Canvas capture timed out",
        retryable: false,
        recoverable: true,
      },
      publish,
      () => ({ runId: "run_failed" }),
    );

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "renderer_capture_timeout",
        source: "design-tool",
      }),
    );
  });
});
