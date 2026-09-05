import { DesignToolBridgeRequestContract } from "@opendesign/agent-contracts";
import { MainDesignToolRuntime } from "@/main/agent/main-design-tool-runtime";
import { parseDesignToolInput } from "@/main/agent/design-tool-input-parser";
import { handleDesignCapabilityTool } from "@/main/agent/design-capability-tool-handler";
import { describe, expect, it } from "vitest";
import { DESIGN_CAPABILITIES_TOOL_NAME } from "@/shared/design-agent-tools";
import { ParentDesignToolExecutor } from "./parent-design-tool-executor";

describe("ParentDesignToolExecutor", () => {
  it("does not send a capability request after cancellation", async () => {
    const messages: unknown[] = [];
    const executor = new ParentDesignToolExecutor({
      postMessage: (message) => messages.push(message),
    });
    const controller = new AbortController();
    controller.abort();
    const stream = executor.execute(
      {
        toolCallId: "cancelled_query",
        toolName: DESIGN_CAPABILITIES_TOOL_NAME,
        input: {},
      },
      {
        runId: "run",
        sessionId: "session",
        documentId: "document",
        revision: 0,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
      },
      controller.signal,
    );
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toHaveProperty("name", "AbortError");
    expect(messages).toEqual([]);
  });

  it("routes capability selection through the authoritative Main parser and response", async () => {
    const messages: unknown[] = [];
    const main = new MainDesignToolRuntime({
      parseInput: (call, context) =>
        parseDesignToolInput(
          { assertDesignToolContext: () => undefined } as never,
          call,
          context,
        ),
      dispatch: (call) => {
        const result = handleDesignCapabilityTool(call);
        if (!result) throw new Error("Expected capability query");
        return Promise.resolve(result);
      },
      isPreauthorized: () => true,
      recordAudit: () => undefined,
    });
    const executor = new ParentDesignToolExecutor({
      postMessage: (message) => {
        messages.push(message);
        const parsed = DesignToolBridgeRequestContract.parse(message);
        if (!parsed.ok) throw new Error("Expected bridge request");
        const request = parsed.value;
        void main
          .execute(
            request.call,
            request.context,
            new AbortController().signal,
            () => undefined,
          )
          .then((result) => {
            executor.handleMessage({
              type: "design-tool.response",
              requestId: request.requestId,
              ok: true,
              result,
            });
          })
          .catch((error: unknown) => {
            executor.handleMessage({
              type: "design-tool.response",
              requestId: request.requestId,
              ok: false,
              error: {
                code: "test_main_failure",
                message:
                  error instanceof Error ? error.message : "Main query failed",
                retryable: false,
                recoverable: false,
              },
            });
          });
      },
    });
    const results = [];
    for await (const event of executor.execute(
      {
        toolCallId: "capabilities",
        toolName: DESIGN_CAPABILITIES_TOOL_NAME,
        input: { tools: ["opendesign_edit_vector"] },
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
    ))
      results.push(event);
    expect(messages).toHaveLength(1);
    expect(results.at(-1)).toMatchObject({
      type: "completed",
      result: {
        modelToolSelection: ["opendesign_edit_vector"],
        content: { selectedTools: ["opendesign_edit_vector"] },
      },
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
