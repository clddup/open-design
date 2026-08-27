import type { AgentEvent } from "@opendesign/agent-contracts";
import { isTrustedToolFailure } from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import type { DiagnosticInput } from "@/shared/diagnostics.js";
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

  it("records structured tool validation without showing an intermediate toast", () => {
    const publish = vi.fn();
    reportAgentDiagnostic(
      {
        type: "tool.failed",
        runId: "run_validation",
        toolCallId: "first_slice_invalid",
        code: "invalid_tool_input",
        message: "Correct the first-slice element budget",
        retryable: false,
        recoverable: true,
        details: {
          kind: "tool-validation",
          fingerprint: "validation_first_slice",
          issues: [
            {
              code: "first_slice.element_limit_exceeded",
              path: "/firstSlice/stages",
              message: "49 elements exceed the first-slice budget",
              expected: 48,
              actual: 49,
            },
          ],
          recovery: { action: "correct-and-retry", required: false },
        },
      },
      publish,
      () => ({ runId: "run_validation" }),
    );

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: "silent",
      }),
    );
    const diagnostic = publish.mock.calls[0]?.[0] as
      { details?: { kind?: string } } | undefined;
    expect(diagnostic?.details?.kind).toBe("tool-validation");
  });

  it("reports a structured workflow failure without parsing its message", () => {
    const publish = vi.fn();
    const failure = designWorkflowError(
      "capture_required",
      "Capture the current canvas",
    ).cause;
    if (!isTrustedToolFailure(failure)) throw new Error("Invalid test failure");

    reportAgentDiagnostic(
      {
        type: "tool.failed",
        runId: "run_workflow",
        toolCallId: "review_before_capture",
        ...failure,
      },
      publish,
      () => ({ runId: "run_workflow" }),
    );

    const diagnostic = publish.mock.calls[0]?.[0] as
      DiagnosticInput | undefined;
    expect(diagnostic).toMatchObject({
      code: "design_capture_required",
      presentation: "toast",
      details: { kind: "design-workflow", workflowCode: "capture_required" },
    });
  });
});
