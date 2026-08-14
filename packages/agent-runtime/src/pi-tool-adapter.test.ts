import type { AgentEvent } from "@opendesign/agent-contracts";
import {
  MockModelGateway,
  type ModelGateway,
  type ModelRequest,
} from "@opendesign/model-gateway";
import {
  projectTimeline,
  type JournalEvent,
  type SessionProjection,
  type SessionStore,
} from "@opendesign/session-store";
import { describe, expect, it } from "vitest";
import type {
  AgentRunRequest,
  AgentToolDefinition,
  ToolExecutionEvent,
  TrustedToolContext,
} from "./index.js";
import { createOpenDesignPiAgent } from "./pi-core-adapter.js";
import { createPiModelGatewayStreamFn } from "./pi-model-gateway-adapter.js";
import { PiRunEventAdapter } from "./pi-run-event-adapter.js";

const request: AgentRunRequest = {
  runId: "run_pi_tool",
  sessionId: "conversation_pi_tool",
  prompt: "Move the layer",
  documentId: "document_tool",
  revision: 12,
  scope: {
    kind: "page",
    selectedNodeIds: ["node_tool"],
    primaryNodeId: "node_tool",
    pageId: "page_tool",
  },
  mutationTarget: { kind: "page", pageId: "page_tool" },
  modelSelection: {
    providerId: "configured-provider",
    modelId: "design-model",
    reasoningEffort: "medium",
  },
};

const moveTool: AgentToolDefinition = {
  name: "opendesign_apply_transaction",
  description: "Apply a validated move transaction.",
  inputSchema: {
    type: "object",
    properties: { dx: { type: "number" } },
    required: ["dx"],
    additionalProperties: false,
  },
  risk: "design_write",
  approval: "never",
  validateInput: (input) =>
    !!input &&
    typeof input === "object" &&
    typeof (input as { dx?: unknown }).dx === "number",
};

const inspectTool: AgentToolDefinition = {
  name: "opendesign_inspect_document",
  description: "Inspect the current document.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  risk: "read",
  approval: "never",
  validateInput: (input) =>
    !!input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).length === 0,
};

class MemorySessionStore implements SessionStore {
  readonly events: JournalEvent[] = [];

  append<T>(event: JournalEvent<T>): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  read(sessionId: string): Promise<JournalEvent[]> {
    return Promise.resolve(
      this.events.filter((event) => event.sessionId === sessionId),
    );
  }

  async readTimeline(sessionId: string) {
    return projectTimeline(sessionId, await this.read(sessionId));
  }

  appendNext<T>(
    sessionId: string,
    createEvent: (sequence: number) => JournalEvent<T>,
  ): Promise<JournalEvent<T>> {
    const sequence =
      this.events.filter((event) => event.sessionId === sessionId).length + 1;
    const event = createEvent(sequence);
    this.events.push(event);
    return Promise.resolve(event);
  }

  async project(sessionId: string): Promise<SessionProjection> {
    const events = await this.read(sessionId);
    return {
      sessionId,
      lastSequence: events.at(-1)?.sequence ?? 0,
      messageCount: events.filter((event) => event.type.startsWith("message."))
        .length,
      toolCallCount: events.filter((event) => event.type === "tool.requested")
        .length,
      compactedRanges: [],
    };
  }
}

class RecordingGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly delegate: ModelGateway) {}

  stream(modelRequest: ModelRequest) {
    this.requests.push(structuredClone(modelRequest));
    return this.delegate.stream(modelRequest);
  }
}

describe("OpenDesign Pi tool adapter", () => {
  it("preserves progress, revision, attachments, journal and the next model turn", async () => {
    const attachment = {
      attachmentId: `image_${"a".repeat(64)}`,
      name: "render.png",
      mimeType: "image/png" as const,
      byteSize: 1_024,
    };
    const executions: TrustedToolContext[] = [];
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "move_call",
              type: "tool_call",
              toolCallId: "move_call_1",
              name: moveTool.name,
              input: { dx: 24 },
            },
          ],
          stopReason: "tool_use",
        },
        { blocks: [{ id: "done", type: "text", text: "Move completed" }] },
      ]),
    );
    const result = await runPiToolLoop({
      gateway,
      definitions: [moveTool],
      toolExecutor: {
        async *execute(_call, context): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          executions.push(context);
          yield { type: "progress", message: "Applying move", progress: 0.4 };
          yield {
            type: "completed",
            result: {
              content: { ok: true, attachments: [attachment] },
              observedRevision: 13,
              designRevision: {
                previousRevision: 12,
                revision: 13,
                transactionId: "transaction_move_1",
              },
            },
          };
        },
      },
    });

    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      runId: request.runId,
      documentId: request.documentId,
      revision: 12,
      mutationTarget: request.mutationTarget,
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "message.completed",
      "tool.requested",
      "tool.progress",
      "tool.completed",
      "message.delta",
      "message.completed",
      "run.completed",
    ]);
    expect(result.events).toContainEqual({
      type: "tool.completed",
      runId: request.runId,
      toolCallId: "move_call_1",
      result: { ok: true, attachments: [attachment] },
      revision: 13,
      transactionId: "transaction_move_1",
    });
    expect(result.adapter.toolCallRecords).toEqual([
      {
        toolCallId: "move_call_1",
        toolName: moveTool.name,
        input: { dx: 24 },
        status: "completed",
        result: { ok: true, attachments: [attachment] },
        revision: 13,
      },
    ]);
    expect(result.store.events.map((event) => event.type)).toEqual([
      "message.user",
      "run.state",
      "message.assistant",
      "tool.requested",
      "tool.progress",
      "tool.completed",
      "design.revision",
      "message.assistant",
      "run.state",
    ]);
    expect(JSON.stringify(gateway.requests[1]?.messages)).toContain(
      attachment.attachmentId,
    );
    expect(JSON.stringify(gateway.requests[1]?.messages)).not.toContain(
      "data:image",
    );
  });

  it("returns custom validation failures to the model without executing", async () => {
    let executions = 0;
    const result = await runPiToolLoop({
      gateway: new RecordingGateway(
        new MockModelGateway([
          {
            blocks: [
              {
                id: "invalid_move",
                type: "tool_call",
                toolCallId: "invalid_move_1",
                name: moveTool.name,
                input: { dx: "far" },
              },
            ],
            stopReason: "tool_use",
          },
          { blocks: [{ id: "retry", type: "text", text: "Input rejected" }] },
        ]),
      ),
      definitions: [moveTool],
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          executions += 1;
          await Promise.resolve();
          yield {
            type: "completed",
            result: { content: { unexpected: true } },
          };
        },
      },
    });

    expect(executions).toBe(0);
    const failure = result.events.find((event) => event.type === "tool.failed");
    expect(failure).toMatchObject({
      type: "tool.failed",
      runId: request.runId,
      toolCallId: "invalid_move_1",
      code: "invalid_tool_input",
    });
    expect(typeof failure?.message).toBe("string");
    expect(result.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });
  });

  it("rejects an invalid revision transition without advancing trusted state", async () => {
    const result = await runPiToolLoop({
      gateway: new RecordingGateway(
        new MockModelGateway([
          {
            blocks: [
              {
                id: "stale_move",
                type: "tool_call",
                toolCallId: "stale_move_1",
                name: moveTool.name,
                input: { dx: 8 },
              },
            ],
            stopReason: "tool_use",
          },
          { blocks: [{ id: "stale", type: "text", text: "Move failed" }] },
        ]),
      ),
      definitions: [moveTool],
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield {
            type: "completed",
            result: {
              content: { ok: false },
              designRevision: {
                previousRevision: 9,
                revision: 13,
                transactionId: "invalid_transition",
              },
            },
          };
        },
      },
    });

    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        toolCallId: "stale_move_1",
        code: "invalid_revision",
      }),
    );
    expect(result.adapter.toolCallRecords).toEqual([]);
    expect(
      result.store.events.some((event) => event.type === "design.revision"),
    ).toBe(false);
  });

  it("advances over a Main-authorized external revision rebase", async () => {
    const revisions: number[] = [];
    let execution = 0;
    const result = await runPiToolLoop({
      gateway: new RecordingGateway(
        new MockModelGateway([
          {
            blocks: [
              {
                id: "rebased_insert",
                type: "tool_call",
                toolCallId: "rebased_insert_1",
                name: moveTool.name,
                input: { dx: 8 },
              },
            ],
            stopReason: "tool_use",
          },
          {
            blocks: [
              {
                id: "after_rebase",
                type: "tool_call",
                toolCallId: "after_rebase_1",
                name: moveTool.name,
                input: { dx: 4 },
              },
            ],
            stopReason: "tool_use",
          },
          { blocks: [{ id: "done", type: "text", text: "Done" }] },
        ]),
      ),
      definitions: [moveTool],
      toolExecutor: {
        async *execute(_call, context): AsyncIterable<ToolExecutionEvent> {
          revisions.push(context.revision);
          execution += 1;
          await Promise.resolve();
          yield execution === 1
            ? {
                type: "completed",
                result: {
                  content: { ok: true },
                  designRevision: {
                    previousRevision: 13,
                    rebasedFromRevision: 12,
                    revision: 14,
                    transactionId: "transaction_rebased_insert",
                  },
                },
              }
            : { type: "completed", result: { content: { ok: true } } };
        },
      },
    });

    expect(revisions).toEqual([12, 14]);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        toolCallId: "rebased_insert_1",
        revision: 14,
      }),
    );
    expect(
      result.store.events.some(
        (event) =>
          event.type === "design.revision" &&
          (event.payload as { revision?: unknown }).revision === 14,
      ),
    ).toBe(true);
  });

  it("requires inspection after a structured failure and keeps repeated failures bounded", async () => {
    let moveExecutions = 0;
    let inspectExecutions = 0;
    const gateway = new RecordingGateway(
      new MockModelGateway([
        toolTurn("invalid_design_1", "invalid_design_call_1", 18),
        toolTurn("invalid_design_2", "invalid_design_call_2", 18),
        {
          blocks: [
            {
              id: "inspect_after_failure",
              type: "tool_call",
              toolCallId: "inspect_after_failure_call",
              name: inspectTool.name,
              input: {},
            },
          ],
          stopReason: "tool_use",
        },
        toolTurn("invalid_design_3", "invalid_design_call_3", 18),
        { blocks: [{ id: "stopped", type: "text", text: "Will inspect" }] },
      ]),
    );
    const result = await runPiToolLoop({
      gateway,
      definitions: [moveTool, inspectTool],
      toolExecutor: {
        async *execute(call): AsyncIterable<ToolExecutionEvent> {
          if (call.toolName === inspectTool.name) {
            inspectExecutions += 1;
            yield {
              type: "completed",
              result: {
                content: { documentId: request.documentId, revision: 12 },
                observedRevision: 12,
              },
            };
            return;
          }
          moveExecutions += 1;
          await Promise.resolve();
          yield {
            type: "failed",
            error: {
              code: "design.invalid",
              message:
                "Transaction would violate document invariants: /nodesById/node_tool/size: width must be positive",
              retryable: false,
              recoverable: true,
              details: {
                kind: "design-transaction",
                fingerprint: "design_deadbeef",
                issues: [
                  {
                    commandId: "resize_node_tool",
                    nodeId: "node_tool",
                    path: "/nodesById/node_tool/size",
                    message: "width must be positive",
                  },
                ],
                recovery: {
                  action: "inspect-and-revise",
                  toolName: "opendesign_inspect_document",
                  required: true,
                },
              },
            },
          };
        },
      },
    });

    expect(moveExecutions).toBe(2);
    expect(inspectExecutions).toBe(1);
    const failures = result.events.filter(
      (event) => event.type === "tool.failed",
    );
    expect(failures).toHaveLength(3);
    expect(failures[0]).toMatchObject({
      code: "design.invalid",
      recoverable: true,
      details: { attempt: 1, maxAttempts: 2 },
    });
    expect(failures[1]).toMatchObject({
      code: "design_inspection_required",
      recoverable: true,
      details: { retrySuppressed: true },
    });
    expect(failures[2]).toMatchObject({
      code: "design.invalid",
      recoverable: true,
      details: { attempt: 2, maxAttempts: 2, retrySuppressed: true },
    });
    expect(result.adapter.unresolvedDesignWriteFailure).toMatchObject({
      toolCallId: "invalid_design_call_3",
      toolName: moveTool.name,
      code: "design.invalid",
      inspectionCompleted: false,
      details: { attempt: 2, maxAttempts: 2, retrySuppressed: true },
    });
    expect(JSON.stringify(gateway.requests[1]?.messages)).toContain(
      "node_tool",
    );
    expect(JSON.stringify(gateway.requests[1]?.messages)).toContain(
      "inspect-and-revise",
    );
  });

  it("clears an inspected design failure only after a corrected design write succeeds", async () => {
    let moveExecutions = 0;
    const result = await runPiToolLoop({
      gateway: new RecordingGateway(
        new MockModelGateway([
          toolTurn("invalid_design", "invalid_design_call", 18),
          {
            blocks: [
              {
                id: "inspect_after_failure",
                type: "tool_call",
                toolCallId: "inspect_after_failure_call",
                name: inspectTool.name,
                input: {},
              },
            ],
            stopReason: "tool_use",
          },
          toolTurn("corrected_design", "corrected_design_call", 24),
          { blocks: [{ id: "done", type: "text", text: "Done" }] },
        ]),
      ),
      definitions: [moveTool, inspectTool],
      toolExecutor: {
        async *execute(call): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          if (call.toolName === inspectTool.name) {
            yield {
              type: "completed",
              result: {
                content: { documentId: request.documentId, revision: 12 },
                observedRevision: 12,
              },
            };
            return;
          }
          moveExecutions += 1;
          if (moveExecutions === 1) {
            yield {
              type: "failed",
              error: {
                code: "design.duplicate",
                message: "Node node_tool already exists",
                retryable: false,
                recoverable: true,
                details: {
                  kind: "design-transaction",
                  fingerprint: "design_duplicate_node_tool",
                  issues: [
                    {
                      commandId: "insert_node_tool",
                      nodeId: "node_tool",
                      path: "",
                      message: "Node node_tool already exists",
                    },
                  ],
                  recovery: {
                    action: "inspect-and-revise",
                    toolName: "opendesign_inspect_document",
                    required: true,
                  },
                },
              },
            };
            return;
          }
          yield {
            type: "completed",
            result: {
              content: { ok: true },
              designRevision: {
                previousRevision: 12,
                revision: 13,
                transactionId: "transaction_corrected_design",
              },
            },
          };
        },
      },
    });

    expect(moveExecutions).toBe(2);
    expect(result.adapter.unresolvedDesignWriteFailure).toBeUndefined();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        toolCallId: "corrected_design_call",
        revision: 13,
      }),
    );
  });

  it("preserves approval denial and a forced tool budget terminal state", async () => {
    const approvalTool = {
      ...moveTool,
      approval: "required" as const,
      approvalPrompt: {
        title: "Modify Page structure",
        summary: "Allow this task to update Pages in the current design file.",
      },
    };
    const denied = await runPiToolLoop({
      gateway: new RecordingGateway(
        new MockModelGateway([
          {
            blocks: [
              {
                id: "approval_move",
                type: "tool_call",
                toolCallId: "approval_move_1",
                name: approvalTool.name,
                input: { dx: 4 },
              },
            ],
            stopReason: "tool_use",
          },
          { blocks: [{ id: "denied", type: "text", text: "Move denied" }] },
        ]),
      ),
      definitions: [approvalTool],
      toolExecutor: neverToolExecutor(),
      approvalPort: {
        requestApproval: () => Promise.resolve("deny"),
      },
    });
    expect(denied.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "approval.requested",
        "approval.resolved",
        "tool.failed",
      ]),
    );
    expect(denied.events).toContainEqual(
      expect.objectContaining({
        type: "approval.requested",
        title: approvalTool.approvalPrompt.title,
        summary: approvalTool.approvalPrompt.summary,
      }),
    );
    expect(denied.events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        code: "approval_denied",
      }),
    );

    const budget = await runPiToolLoop({
      gateway: new RecordingGateway(
        new MockModelGateway({
          blocks: [
            {
              id: "budget_move",
              type: "tool_call",
              toolCallId: "budget_move_1",
              name: moveTool.name,
              input: { dx: 4 },
            },
          ],
          stopReason: "tool_use",
        }),
      ),
      definitions: [moveTool],
      toolExecutor: neverToolExecutor(),
      maxToolCalls: 0,
    });
    expect(budget.events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        code: "tool_budget_exceeded",
      }),
    );
    expect(budget.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "budget",
    });
  });

  it("terminates the run after a host-marked Renderer circuit failure", async () => {
    const gateway = new RecordingGateway(
      new MockModelGateway([
        toolTurn("capture_stalled", "capture_stalled_1", 4),
        { blocks: [{ id: "false_done", type: "text", text: "Completed" }] },
      ]),
    );
    const result = await runPiToolLoop({
      gateway,
      definitions: [moveTool],
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield {
            type: "failed",
            error: {
              code: "renderer_circuit_open",
              message:
                "Canvas rendering repeatedly stalled; committed revisions were preserved",
              retryable: false,
              recoverable: false,
              runTerminal: true,
            },
          };
        },
      },
    });

    expect(gateway.requests).toHaveLength(1);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        toolCallId: "capture_stalled_1",
        code: "renderer_circuit_open",
        retryable: false,
        recoverable: false,
      }),
    );
    expect(result.events).toContainEqual({
      type: "agent.error",
      code: "renderer_circuit_open",
      runId: request.runId,
      message:
        "Canvas rendering repeatedly stalled; committed revisions were preserved",
      failure: {
        code: "renderer_circuit_open",
        message:
          "Canvas rendering repeatedly stalled; committed revisions were preserved",
        retryable: false,
      },
    });
    expect(result.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "error",
    });
    const terminalState = [...result.store.events]
      .reverse()
      .find((event) => event.type === "run.state")?.payload as
      | {
          status?: unknown;
          failure?: { code?: unknown; retryable?: unknown };
        }
      | undefined;
    expect(terminalState).toMatchObject({
      status: "error",
      failure: { code: "renderer_circuit_open", retryable: false },
    });
  });

  it("reuses one allowed Run-scoped approval for later calls in the same Run", async () => {
    const approvalTool: AgentToolDefinition = {
      ...moveTool,
      approval: "required",
      approvalScope: "run",
      approvalPrompt: {
        title: "Modify Page structure",
        summary: "Allow this task to update Pages in the current design file.",
      },
    };
    let approvalRequests = 0;
    let executions = 0;
    const result = await runPiToolLoop({
      gateway: new RecordingGateway(
        new MockModelGateway([
          toolTurn("page_call_1", "page_call_1", 1),
          toolTurn("page_call_2", "page_call_2", 2),
          { blocks: [{ id: "done", type: "text", text: "Done" }] },
        ]),
      ),
      definitions: [approvalTool],
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          executions += 1;
          await Promise.resolve();
          yield { type: "completed", result: { content: { ok: true } } };
        },
      },
      approvalPort: {
        requestApproval: () => {
          approvalRequests += 1;
          return Promise.resolve("allow_once");
        },
      },
    });

    expect(approvalRequests).toBe(1);
    expect(executions).toBe(2);
    expect(
      result.events.filter((event) => event.type === "approval.requested"),
    ).toHaveLength(1);
    expect(
      result.events.filter((event) => event.type === "tool.completed"),
    ).toHaveLength(2);
  });

  it("returns a recoverable schema failure instead of a generic pre-execution rejection", async () => {
    const result = await runPiToolLoop({
      gateway: new RecordingGateway(
        new MockModelGateway([
          {
            blocks: [
              {
                id: "invalid_move",
                type: "tool_call",
                toolCallId: "invalid_move_1",
                name: moveTool.name,
                input: { dx: "wrong" },
              },
            ],
            stopReason: "tool_use",
          },
          { blocks: [{ id: "recovered", type: "text", text: "Recovered" }] },
        ]),
      ),
      definitions: [moveTool],
      toolExecutor: neverToolExecutor(),
    });

    const failure = result.events.find(
      (event): event is Extract<AgentEvent, { type: "tool.failed" }> =>
        event.type === "tool.failed" && event.toolCallId === "invalid_move_1",
    );
    expect(failure).toMatchObject({
      type: "tool.failed",
      code: "invalid_tool_input",
      recoverable: true,
    });
    expect(failure?.message).toContain("dx: must be number");
    expect(JSON.stringify(result.events)).not.toContain(
      "Tool call was rejected before execution",
    );
  });

  it("uses a tool-owned action diagnostic when structural schema validation is too broad", async () => {
    const actionAwareTool: AgentToolDefinition = {
      ...moveTool,
      inputSchema: {
        type: "object",
        properties: { dx: {} },
        required: ["dx"],
        additionalProperties: false,
      },
      explainInvalidInput: () =>
        'Invalid move action. Expected exact shape: {"dx":<number>}.',
    };
    const result = await runPiToolLoop({
      gateway: new RecordingGateway(
        new MockModelGateway([
          {
            blocks: [
              {
                id: "invalid_move",
                type: "tool_call",
                toolCallId: "invalid_move_explained",
                name: actionAwareTool.name,
                input: { dx: "wrong" },
              },
            ],
            stopReason: "tool_use",
          },
          { blocks: [{ id: "recovered", type: "text", text: "Recovered" }] },
        ]),
      ),
      definitions: [actionAwareTool],
      toolExecutor: neverToolExecutor(),
    });

    const failure = result.events.find(
      (event): event is Extract<AgentEvent, { type: "tool.failed" }> =>
        event.type === "tool.failed" &&
        event.toolCallId === "invalid_move_explained",
    );
    expect(failure).toMatchObject({
      code: "invalid_tool_input",
      message: 'Invalid move action. Expected exact shape: {"dx":<number>}.',
      recoverable: true,
    });
  });

  it("finalizes a tool requested at cancellation without calling the executor", async () => {
    const cancelled = await runPiToolLoop({
      gateway: new RecordingGateway(
        new MockModelGateway({
          blocks: [
            {
              id: "cancel_move",
              type: "tool_call",
              toolCallId: "cancel_move_1",
              name: moveTool.name,
              input: { dx: 4 },
            },
          ],
          stopReason: "tool_use",
        }),
      ),
      definitions: [moveTool],
      toolExecutor: neverToolExecutor(),
      abortOnToolRequested: true,
    });

    expect(cancelled.events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        toolCallId: "cancel_move_1",
        code: "run_cancelled",
      }),
    );
    expect(cancelled.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "cancelled",
    });
  });
});

function toolTurn(id: string, toolCallId: string, dx: number) {
  return {
    blocks: [
      {
        id,
        type: "tool_call" as const,
        toolCallId,
        name: moveTool.name,
        input: { dx },
      },
    ],
    stopReason: "tool_use" as const,
  };
}

async function runPiToolLoop(options: {
  gateway: RecordingGateway;
  definitions: readonly AgentToolDefinition[];
  toolExecutor: {
    execute(
      call: { toolCallId: string; toolName: string; input: unknown },
      context: TrustedToolContext,
      signal: AbortSignal,
    ): AsyncIterable<ToolExecutionEvent>;
  };
  approvalPort?: {
    requestApproval: (
      request: unknown,
      context: TrustedToolContext,
      signal: AbortSignal,
    ) => Promise<"allow_once" | "allow_session" | "deny">;
  };
  maxToolCalls?: number;
  abortOnToolRequested?: boolean;
}) {
  const store = new MemorySessionStore();
  const events: AgentEvent[] = [];
  const agentRef: {
    current?: ReturnType<typeof createOpenDesignPiAgent>;
  } = {};
  const adapter = new PiRunEventAdapter({
    request,
    sessionStore: store,
    emit: (event) => {
      events.push(event);
      if (
        options.abortOnToolRequested === true &&
        event.type === "tool.requested"
      ) {
        queueMicrotask(() => agentRef.current?.abort());
      }
    },
    toolDefinitions: options.definitions,
    toolExecutor: options.toolExecutor,
    ...(options.approvalPort === undefined
      ? {}
      : { approvalPort: options.approvalPort }),
    ...(options.maxToolCalls === undefined
      ? {}
      : { maxToolCalls: options.maxToolCalls }),
    now: () => new Date("2026-08-11T02:03:04.000Z"),
  });
  const agent = createOpenDesignPiAgent({
    initialState: {
      messages: [],
      model: {
        id: request.modelSelection.modelId,
        name: "Design model",
        api: "openai-responses",
        provider: request.modelSelection.providerId,
        baseUrl: "https://provider.invalid/v1",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 16_384,
      },
      systemPrompt: "OpenDesign tool parity",
      thinkingLevel: request.modelSelection.reasoningEffort ?? "off",
      tools: [...adapter.tools],
    },
    sessionId: request.sessionId,
    streamFn: createPiModelGatewayStreamFn({
      modelGateway: options.gateway,
      nextAttemptId: (() => {
        let sequence = 0;
        return () => `${request.runId}_attempt_${++sequence}`;
      })(),
    }),
    beforeToolCall: adapter.beforeToolCall,
    shouldStopAfterTurn: adapter.shouldStopAfterTurn,
  });
  agentRef.current = agent;
  const unsubscribe = agent.subscribe((event) => adapter.accept(event));
  try {
    await agent.prompt(request.prompt);
  } finally {
    unsubscribe();
    agent.abort();
    await agent.waitForIdle();
  }
  return { adapter, events, store };
}

function neverToolExecutor() {
  return {
    async *execute(): AsyncIterable<ToolExecutionEvent> {
      await Promise.resolve();
      yield { type: "progress", message: "Unexpected", progress: 0 };
      throw new Error("Tool executor should not run");
    },
  };
}
