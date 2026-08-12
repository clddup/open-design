import { describe, expect, it, vi } from "vitest";
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
      );
      const request = send.mock.calls[0]?.[0] as { requestId: string };

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
        }),
      ).toBe(true);
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
});
