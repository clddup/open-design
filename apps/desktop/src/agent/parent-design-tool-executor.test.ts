import { describe, expect, it } from "vitest";
import { ParentDesignToolExecutor } from "./parent-design-tool-executor";

describe("ParentDesignToolExecutor", () => {
  it("forwards a structured tool call and yields the trusted Renderer result", async () => {
    const messages: unknown[] = [];
    const executor = new ParentDesignToolExecutor({
      postMessage: (message) => messages.push(message),
    });
    const stream = executor.execute(
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
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "progress", progress: 0.15 },
    });
    const request = messages[0] as { requestId: string };
    expect(request).toMatchObject({
      type: "design-tool.request",
      call: { toolName: "opendesign_inspect_document", input: {} },
      context: { documentId: "document_1", revision: 0 },
    });

    expect(
      executor.handleMessage({
        type: "design-tool.response",
        requestId: request.requestId,
        ok: true,
        result: { content: { documentId: "document_1", revision: 0 } },
      }),
    ).toBe(true);
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: "completed",
        result: { content: { documentId: "document_1", revision: 0 } },
      },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("terminates a tool call when Main returns an invalid correlated response", async () => {
    const messages: unknown[] = [];
    const executor = new ParentDesignToolExecutor({
      postMessage: (message) => messages.push(message),
    });
    const stream = executor.execute(
      {
        toolCallId: "tool_call_invalid",
        toolName: "opendesign_inspect_document",
        input: {},
      },
      {
        runId: "run_invalid",
        sessionId: "conversation_invalid",
        documentId: "document_invalid",
        revision: 0,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
      },
      new AbortController().signal,
    );
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "progress" },
    });
    const request = messages[0] as { requestId: string };
    expect(
      executor.handleMessage({
        type: "design-tool.response",
        requestId: request.requestId,
        ok: "yes",
      }),
    ).toBe(true);
    await expect(iterator.next()).rejects.toThrow(
      "Design tool host returned an invalid response",
    );
  });
});
