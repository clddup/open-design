import { describe, expect, it, vi } from "vitest";
import { isRendererDesignToolRequest } from "../../shared/design-tool-bridge";
import { RendererDesignToolHost } from "./renderer-design-tool-host";

describe("RendererDesignToolHost", () => {
  it("correlates a Renderer transaction result with its Agent tool call", async () => {
    const send = vi.fn();
    const host = new RendererDesignToolHost(send);
    const result = host.execute(
      {
        toolCallId: "tool_call_1",
        toolName: "opendesign_inspect_document",
        input: {},
      },
      {
        runId: "run_1",
        sessionId: "conversation_1",
        documentId: "document_1",
        revision: 0,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
      },
      new AbortController().signal,
    );
    const request = send.mock.calls[0]?.[0] as { requestId: string };

    expect(
      host.resolve({
        requestId: request.requestId,
        ok: true,
        result: { content: { documentId: "document_1", revision: 0 } },
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual({
      content: { documentId: "document_1", revision: 0 },
    });
  });

  it("forwards only the Main-selected deterministic capture target", async () => {
    const send = vi.fn();
    const host = new RendererDesignToolHost(send);
    const result = host.execute(
      {
        toolCallId: "capture_1",
        toolName: "opendesign_capture_canvas",
        input: {},
      },
      {
        runId: "run_1",
        sessionId: "conversation_1",
        documentId: "document_1",
        revision: 0,
        scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
        mutationTarget: { kind: "page", pageId: "page_1" },
      },
      new AbortController().signal,
      {
        captureTarget: {
          kind: "frame",
          pageId: "page_1",
          nodeId: "frame_1",
        },
      },
    );
    const request = send.mock.calls[0]?.[0] as { requestId: string };
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        captureTarget: {
          kind: "frame",
          pageId: "page_1",
          nodeId: "frame_1",
        },
      }),
    );
    host.resolve({
      requestId: request.requestId,
      ok: true,
      result: { content: { ok: true }, observedRevision: 0 },
    });
    await expect(result).resolves.toMatchObject({ observedRevision: 0 });
  });

  it("renews an idle lease from Renderer progress without extending the total limit", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const sendCancel = vi.fn();
      const host = new RendererDesignToolHost(send, sendCancel, {
        firstResponseTimeoutMs: 20,
        idleTimeoutMs: 30,
        totalTimeoutMs: 100,
      });
      const reportProgress = vi.fn();
      const result = host.execute(
        {
          toolCallId: "tool_progress_1",
          toolName: "opendesign_inspect_document",
          input: {},
        },
        {
          runId: "run_1",
          sessionId: "conversation_1",
          documentId: "document_1",
          revision: 0,
          scope: { kind: "document", selectedNodeIds: [] },
          mutationTarget: { kind: "document" },
        },
        new AbortController().signal,
        { reportProgress },
      );
      const request = send.mock.calls[0]?.[0] as { requestId: string };

      expect(isRendererDesignToolRequest(send.mock.calls[0]?.[0])).toBe(true);
      expect(send.mock.calls[0]?.[0]).not.toHaveProperty("reportProgress");

      await vi.advanceTimersByTimeAsync(10);
      expect(
        host.progress({
          requestId: request.requestId,
          phase: "accepted",
          progress: 0.02,
        }),
      ).toBe(true);
      await vi.advanceTimersByTimeAsync(25);
      expect(
        host.progress({
          requestId: request.requestId,
          phase: "applying",
          progress: 0.5,
          message: "设计步骤：导航 · r1",
        }),
      ).toBe(true);
      expect(reportProgress).toHaveBeenCalledWith("设计步骤：导航 · r1", 0.5);
      await vi.advanceTimersByTimeAsync(25);
      expect(sendCancel).not.toHaveBeenCalled();
      host.resolve({
        requestId: request.requestId,
        ok: true,
        result: { content: { ok: true } },
      });
      await expect(result).resolves.toMatchObject({ content: { ok: true } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("measures real Renderer phase transitions without changing execution", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const performance = vi.fn();
      const host = new RendererDesignToolHost(send);
      host.setPerformanceObserver(performance);
      const result = host.execute(
        {
          toolCallId: "tool_timing_1",
          toolName: "opendesign_apply_design",
          input: {},
        },
        {
          runId: "run_timing_1",
          sessionId: "conversation_1",
          documentId: "document_1",
          revision: 0,
          scope: { kind: "document", selectedNodeIds: [] },
          mutationTarget: { kind: "document" },
        },
        new AbortController().signal,
      );
      const request = send.mock.calls[0]?.[0] as { requestId: string };

      await vi.advanceTimersByTimeAsync(5);
      host.progress({
        requestId: request.requestId,
        phase: "accepted",
        progress: 0.02,
      });
      await vi.advanceTimersByTimeAsync(10);
      host.progress({
        requestId: request.requestId,
        phase: "applying",
        progress: 0.3,
      });
      await vi.advanceTimersByTimeAsync(20);
      host.progress({
        requestId: request.requestId,
        phase: "applying",
        progress: 0.8,
      });
      await vi.advanceTimersByTimeAsync(10);
      host.progress({
        requestId: request.requestId,
        phase: "persisting",
        progress: 0.95,
      });
      await vi.advanceTimersByTimeAsync(5);
      host.resolve({
        requestId: request.requestId,
        ok: true,
        result: { content: { ok: true } },
        performance: {
          canvasWaitCount: 2,
          canvasWaitMs: 25,
          configuredStageDelayMs: 20,
        },
      });
      await expect(result).resolves.toMatchObject({ content: { ok: true } });

      expect(performance).toHaveBeenCalledWith({
        runId: "run_timing_1",
        toolCallId: "tool_timing_1",
        toolName: "opendesign_apply_design",
        status: "completed",
        canvasWaitCount: 2,
        canvasWaitMs: 25,
        configuredStageDelayMs: 20,
        totalMs: 50,
        firstResponseMs: 5,
        phaseDurationMs: {
          accepted: 10,
          applying: 30,
          capturing: 0,
          persisting: 5,
        },
        phaseProgressEvents: {
          accepted: 1,
          applying: 2,
          capturing: 0,
          persisting: 1,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a structured Renderer idle timeout instead of a model timeout", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const sendCancel = vi.fn();
      const host = new RendererDesignToolHost(send, sendCancel, {
        firstResponseTimeoutMs: 20,
        idleTimeoutMs: 30,
        totalTimeoutMs: 100,
      });
      const result = host.execute(
        {
          toolCallId: "tool_idle_1",
          toolName: "opendesign_inspect_document",
          input: {},
        },
        {
          runId: "run_1",
          sessionId: "conversation_1",
          documentId: "document_1",
          revision: 0,
          scope: { kind: "document", selectedNodeIds: [] },
          mutationTarget: { kind: "document" },
        },
        new AbortController().signal,
      );
      const request = send.mock.calls[0]?.[0] as { requestId: string };
      host.progress({
        requestId: request.requestId,
        phase: "capturing",
        progress: 0.3,
      });
      const rejection = expect(result).rejects.toMatchObject({
        cause: {
          code: "renderer_idle_timeout",
          retryable: true,
          recoverable: true,
        },
      });
      await vi.advanceTimersByTimeAsync(31);
      await rejection;
      expect(sendCancel).toHaveBeenCalledWith({ requestId: request.requestId });
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a run-scoped circuit after two consecutive canvas stalls", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const sendCancel = vi.fn();
      const host = new RendererDesignToolHost(send, sendCancel, {
        firstResponseTimeoutMs: 20,
        idleTimeoutMs: 30,
        totalTimeoutMs: 100,
      });

      const first = startRequest(host, send, "run_stalled", "capture_1");
      host.progress({
        requestId: first.requestId,
        phase: "capturing",
        progress: 0.3,
      });
      const firstRejection = expect(first.result).rejects.toMatchObject({
        cause: {
          code: "renderer_idle_timeout",
          retryable: true,
          recoverable: true,
        },
      });
      await vi.advanceTimersByTimeAsync(31);
      await firstRejection;

      const second = startRequest(host, send, "run_stalled", "capture_2");
      host.progress({
        requestId: second.requestId,
        phase: "capturing",
        progress: 0.4,
      });
      const secondRejection = expect(second.result).rejects.toMatchObject({
        cause: {
          code: "renderer_circuit_open",
          retryable: false,
          recoverable: false,
          runTerminal: true,
        },
      });
      await vi.advanceTimersByTimeAsync(31);
      await secondRejection;

      await expect(
        host.execute(
          rendererCall("capture_3"),
          rendererContext("run_stalled"),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        cause: { code: "renderer_circuit_open", runTerminal: true },
      });
      expect(send).toHaveBeenCalledTimes(2);

      const otherRun = startRequest(host, send, "run_other", "capture_4");
      host.resolve({
        requestId: otherRun.requestId,
        ok: true,
        result: { content: { ok: true } },
      });
      await expect(otherRun.result).resolves.toMatchObject({
        content: { ok: true },
      });

      host.forgetRun("run_stalled");
      const retried = startRequest(host, send, "run_stalled", "capture_5");
      host.resolve({
        requestId: retried.requestId,
        ok: true,
        result: { content: { ok: true } },
      });
      await expect(retried.result).resolves.toMatchObject({
        content: { ok: true },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates the run after two consecutive first-response timeouts", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const host = new RendererDesignToolHost(send, vi.fn(), {
        firstResponseTimeoutMs: 20,
        idleTimeoutMs: 30,
        totalTimeoutMs: 100,
      });
      const first = startRequest(
        host,
        send,
        "run_unacknowledged",
        "inspect_1",
        "opendesign_inspect_document",
      );
      const firstRejection = expect(first.result).rejects.toMatchObject({
        cause: { code: "renderer_first_response_timeout", retryable: true },
      });
      await vi.advanceTimersByTimeAsync(21);
      await firstRejection;

      const second = startRequest(
        host,
        send,
        "run_unacknowledged",
        "inspect_2",
        "opendesign_inspect_document",
      );
      const secondRejection = expect(second.result).rejects.toMatchObject({
        cause: {
          code: "renderer_circuit_open",
          retryable: false,
          recoverable: false,
          runTerminal: true,
        },
      });
      await vi.advanceTimersByTimeAsync(21);
      await secondRejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a successful inspection hide repeated capture stalls", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const host = new RendererDesignToolHost(send, vi.fn(), {
        firstResponseTimeoutMs: 20,
        idleTimeoutMs: 30,
        totalTimeoutMs: 100,
      });

      const first = startRequest(host, send, "run_reset", "capture_1");
      host.progress({
        requestId: first.requestId,
        phase: "capturing",
        progress: 0.3,
      });
      const firstRejection = expect(first.result).rejects.toMatchObject({
        cause: { code: "renderer_idle_timeout" },
      });
      await vi.advanceTimersByTimeAsync(31);
      await firstRejection;

      const inspect = startRequest(
        host,
        send,
        "run_reset",
        "inspect_1",
        "opendesign_inspect_document",
      );
      host.resolve({
        requestId: inspect.requestId,
        ok: true,
        result: { content: { revision: 4 }, observedRevision: 4 },
      });
      await expect(inspect.result).resolves.toMatchObject({
        observedRevision: 4,
      });

      const second = startRequest(host, send, "run_reset", "capture_2");
      host.progress({
        requestId: second.requestId,
        phase: "capturing",
        progress: 0.4,
      });
      const secondRejection = expect(second.result).rejects.toMatchObject({
        cause: {
          code: "renderer_circuit_open",
          retryable: false,
          runTerminal: true,
        },
      });
      await vi.advanceTimersByTimeAsync(31);
      await secondRejection;

      host.forgetRun("run_reset");
      const third = startRequest(host, send, "run_reset", "apply_1");
      host.progress({
        requestId: third.requestId,
        phase: "applying",
        progress: 0.5,
      });
      host.resolve({
        requestId: third.requestId,
        ok: true,
        result: { content: { ok: true } },
      });
      await expect(third.result).resolves.toMatchObject({
        content: { ok: true },
      });

      const afterSuccess = startRequest(host, send, "run_reset", "capture_3");
      host.progress({
        requestId: afterSuccess.requestId,
        phase: "capturing",
        progress: 0.2,
      });
      const afterSuccessRejection = expect(
        afterSuccess.result,
      ).rejects.toMatchObject({
        cause: { code: "renderer_idle_timeout" },
      });
      await vi.advanceTimersByTimeAsync(31);
      await afterSuccessRejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the circuit after two bounded capture export timeouts", async () => {
    const send = vi.fn();
    const host = new RendererDesignToolHost(send);

    const first = startRequest(host, send, "run_capture_timeout", "capture_1");
    host.resolve({
      requestId: first.requestId,
      ok: false,
      error: {
        code: "renderer_capture_timeout",
        message: "design_capture.export_timeout",
        retryable: false,
        recoverable: true,
      },
    });
    await expect(first.result).rejects.toMatchObject({
      cause: { code: "renderer_capture_timeout" },
    });

    const inspect = startRequest(
      host,
      send,
      "run_capture_timeout",
      "inspect_1",
      "opendesign_inspect_document",
    );
    host.resolve({
      requestId: inspect.requestId,
      ok: true,
      result: { content: { revision: 425 }, observedRevision: 425 },
    });
    await expect(inspect.result).resolves.toMatchObject({
      observedRevision: 425,
    });

    const second = startRequest(host, send, "run_capture_timeout", "capture_2");
    host.resolve({
      requestId: second.requestId,
      ok: false,
      error: {
        code: "renderer_capture_timeout",
        message: "design_capture.export_timeout",
        retryable: false,
        recoverable: true,
      },
    });
    await expect(second.result).rejects.toMatchObject({
      cause: {
        code: "renderer_circuit_open",
        retryable: false,
        runTerminal: true,
      },
    });
  });

  it("clears a previous stall after a successful material canvas tool", async () => {
    const send = vi.fn();
    const host = new RendererDesignToolHost(send);

    const first = startRequest(host, send, "run_recovered", "capture_1");
    host.resolve({
      requestId: first.requestId,
      ok: false,
      error: {
        code: "renderer_capture_timeout",
        message: "design_capture.export_timeout",
        retryable: false,
        recoverable: true,
      },
    });
    await expect(first.result).rejects.toMatchObject({
      cause: { code: "renderer_capture_timeout" },
    });

    const apply = startRequest(
      host,
      send,
      "run_recovered",
      "apply_1",
      "opendesign_apply_transaction",
    );
    host.resolve({
      requestId: apply.requestId,
      ok: true,
      result: {
        content: { revision: 426 },
        designRevision: {
          previousRevision: 425,
          revision: 426,
          transactionId: "transaction_apply_1",
        },
      },
    });
    await expect(apply.result).resolves.toMatchObject({
      designRevision: { revision: 426 },
    });

    const afterRecovery = startRequest(
      host,
      send,
      "run_recovered",
      "capture_2",
    );
    host.resolve({
      requestId: afterRecovery.requestId,
      ok: false,
      error: {
        code: "renderer_capture_timeout",
        message: "design_capture.export_timeout",
        retryable: false,
        recoverable: true,
      },
    });
    await expect(afterRecovery.result).rejects.toMatchObject({
      cause: { code: "renderer_capture_timeout" },
    });
  });
});

function rendererCall(
  toolCallId: string,
  toolName = "opendesign_capture_canvas",
) {
  return { toolCallId, toolName, input: {} };
}

function rendererContext(runId: string) {
  return {
    runId,
    sessionId: "conversation_1",
    documentId: "document_1",
    revision: 4,
    scope: {
      kind: "page" as const,
      pageId: "page_1",
      selectedNodeIds: [],
    },
    mutationTarget: { kind: "page" as const, pageId: "page_1" },
  };
}

function startRequest(
  host: RendererDesignToolHost,
  send: ReturnType<typeof vi.fn>,
  runId: string,
  toolCallId: string,
  toolName = "opendesign_capture_canvas",
) {
  const callIndex = send.mock.calls.length;
  const result = host.execute(
    rendererCall(toolCallId, toolName),
    rendererContext(runId),
    new AbortController().signal,
  );
  const request = send.mock.calls[callIndex]?.[0] as { requestId: string };
  return { requestId: request.requestId, result };
}
