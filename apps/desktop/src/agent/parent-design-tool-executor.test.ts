import { describe, expect, it } from "vitest";
import { DESIGN_CAPABILITIES_TOOL_NAME } from "../shared/design-agent-tools";
import { ParentDesignToolExecutor } from "./parent-design-tool-executor";

describe("ParentDesignToolExecutor", () => {
  it("answers capability queries locally from the trusted manifest", async () => {
    const messages: unknown[] = [];
    const executor = new ParentDesignToolExecutor({
      postMessage: (message) => messages.push(message),
    });
    const results = [];
    for await (const event of executor.execute(
      {
        toolCallId: "tool_capabilities",
        toolName: DESIGN_CAPABILITIES_TOOL_NAME,
        input: {},
      },
      {
        runId: "run_capabilities",
        sessionId: "conversation_capabilities",
        documentId: "document_capabilities",
        revision: 0,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
      },
      new AbortController().signal,
    )) {
      results.push(event);
    }

    expect(messages).toEqual([]);
    expect(results).toHaveLength(1);
    const completed = results[0];
    expect(completed?.type).toBe("completed");
    if (completed?.type !== "completed") throw new Error("Expected result");
    const content = completed.result.content as {
      version?: unknown;
      capabilities?: unknown;
    };
    expect(content.version).toBe(1);
    expect(Array.isArray(content.capabilities)).toBe(true);
    if (!Array.isArray(content.capabilities)) {
      throw new Error("Expected capability array");
    }
    const capabilityValues: unknown[] = content.capabilities;
    const autoLayout: unknown = capabilityValues.find(
      (value: unknown) =>
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        value.id === "layout.auto-layout",
    );
    expect(autoLayout).toMatchObject({
      id: "layout.auto-layout",
      status: "unavailable",
      name: "Auto layout",
      provider: "Not implemented",
      evidence: { automated: 0, manual: 0 },
    });
  });

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
        type: "design-tool.progress",
        requestId: request.requestId,
        message: "设计步骤：导航 · r1",
        progress: 0.5,
      }),
    ).toBe(true);
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: "progress",
        message: "设计步骤：导航 · r1",
        progress: 0.5,
      },
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
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: "failed",
        error: {
          code: "invalid_tool_response",
          message: "Design tool host returned an invalid response",
          recoverable: false,
        },
      },
    });
  });
});
