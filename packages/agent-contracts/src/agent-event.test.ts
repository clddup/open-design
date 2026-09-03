import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  AgentEventContract,
  AgentEventSchema,
  DurableTimelineEventContract,
  SessionTimelineItemContract,
  agentEventValidationError,
  isAgentEvent,
  isDurableTimelineEvent,
  isSessionTimelineItem,
} from "./index.js";

const invalidSelectionScope = {
  kind: "selection",
  selectedNodeIds: ["node_1"],
  primaryNodeId: "node_2",
} as const;

const providerFailure = {
  code: "provider_timeout",
  message: "Provider timed out",
  retryable: true,
} as const;

const durableEventBase = {
  eventId: "event_1",
  sessionId: "session_1",
  runId: "run_1",
  sequence: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

const timelineItemBase = {
  itemId: "item_1",
  sessionId: "session_1",
  runId: "run_1",
  sequence: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
} as const;

describe("Agent event and timeline contracts", () => {
  it("applies selection and run failure relationships to durable events", () => {
    const durableUser = {
      ...durableEventBase,
      type: "message.user",
      payload: {
        messageId: "message_1",
        content: "Design a page",
        documentId: "document_1",
        revision: 0,
        scope: invalidSelectionScope,
      },
    } as const;
    expect(DurableTimelineEventContract.parse(durableUser)).toMatchObject({
      ok: false,
      issues: [
        {
          code: "durable_timeline_event.primary_selection_invalid",
          path: "/payload/scope/primaryNodeId",
        },
      ],
    });
    expect(isDurableTimelineEvent(durableUser)).toBe(false);

    const durableRun = {
      ...durableEventBase,
      type: "run.state",
      payload: {
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        stopReason: "complete",
        failure: providerFailure,
      },
    } as const;
    expect(DurableTimelineEventContract.parse(durableRun)).toMatchObject({
      ok: false,
      issues: [
        {
          code: "durable_timeline_event.failure_state_invalid",
          path: "/payload/failure",
        },
      ],
    });
    expect(isDurableTimelineEvent(durableRun)).toBe(false);

    const durableToolFailure = {
      ...durableEventBase,
      type: "tool.failed",
      payload: {
        toolCallId: "tool_1",
        code: "design_recovery_no_progress",
        message: "Recovery made no progress",
        retryable: false,
        recoverable: false,
        details: {
          kind: "design-workflow",
          fingerprint: "workflow_visual_review",
          workflowCode: "visual_review_required",
          phase: "capture",
          requiresInspection: false,
          issues: [
            {
              code: "design_workflow.visual_review_required",
              path: "/designWorkflow",
              message: "Capture and review the current material revision",
            },
          ],
          recovery: { action: "follow-workflow", required: true },
        },
      },
    } as const;
    expect(
      DurableTimelineEventContract.parse(durableToolFailure),
    ).toMatchObject({
      ok: false,
      issues: [
        {
          code: "trusted_tool_failure.workflow_code_mismatch",
          path: "/payload/code",
        },
      ],
    });
  });

  it("preserves the compacted sequence range relationship", () => {
    const compacted = {
      ...durableEventBase,
      type: "context.compacted",
      payload: { fromSequence: 8, toSequence: 3 },
    } as const;

    expect(DurableTimelineEventContract.parse(compacted)).toMatchObject({
      ok: false,
      issues: [
        {
          code: "durable_timeline_event.compacted_range_invalid",
          path: "/payload/toSequence",
          expected: { minimum: 8 },
          actual: 3,
        },
      ],
    });
    expect(isDurableTimelineEvent(compacted)).toBe(false);
    expect(
      DurableTimelineEventContract.parse({
        ...compacted,
        payload: { fromSequence: 8, toSequence: 8 },
      }).ok,
    ).toBe(true);
  });

  it("applies selection and run failure relationships to session items", () => {
    const timelineUser = {
      ...timelineItemBase,
      type: "user.message",
      messageId: "message_1",
      content: "Design a page",
      documentId: "document_1",
      revision: 0,
      scope: invalidSelectionScope,
    } as const;
    expect(SessionTimelineItemContract.parse(timelineUser)).toMatchObject({
      ok: false,
      issues: [
        {
          code: "session_timeline_item.primary_selection_invalid",
          path: "/scope/primaryNodeId",
        },
      ],
    });
    expect(isSessionTimelineItem(timelineUser)).toBe(false);

    const timelineRun = {
      ...timelineItemBase,
      type: "run",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      stopReason: "complete",
      failure: providerFailure,
    } as const;
    expect(SessionTimelineItemContract.parse(timelineRun)).toMatchObject({
      ok: false,
      issues: [
        {
          code: "session_timeline_item.failure_state_invalid",
          path: "/failure",
        },
      ],
    });
    expect(isSessionTimelineItem(timelineRun)).toBe(false);
  });

  it("reports the failing field from the matching Agent event variant", () => {
    expect(
      agentEventValidationError({
        type: "message.completed",
        runId: "run_1",
        messageId: "message_1",
        blocks: "invalid",
      }),
    ).toContain("agent_event.schema_invalid at /blocks");
  });

  it("identifies streamed assistant blocks so text and reasoning cannot mix", () => {
    expect(
      isAgentEvent({
        type: "message.delta",
        runId: "run_1",
        messageId: "message_1",
        blockId: "reasoning_0",
        blockType: "reasoning_summary",
        blockIndex: 0,
        delta: "正在分析",
      }),
    ).toBe(true);
    expect(
      agentEventValidationError({
        type: "message.delta",
        runId: "run_1",
        messageId: "message_1",
        blockId: "reasoning_0",
        blockIndex: 0,
        delta: "正在分析",
      }),
    ).toContain("agent_event.schema_invalid at /blockType");
  });

  it("reports stable paths for Agent event domain failures", () => {
    const failure = {
      code: "provider_timeout",
      message: "Provider timed out",
      retryable: true,
    } as const;
    const mismatch = AgentEventContract.parse({
      type: "agent.error",
      code: failure.code,
      message: failure.message,
      failure: { ...failure, code: "different", message: "Different" },
    });
    expect(mismatch).toMatchObject({
      ok: false,
      issues: [
        {
          code: "agent_event.failure_code_mismatch",
          path: "/failure/code",
        },
        {
          code: "agent_event.failure_message_mismatch",
          path: "/failure/message",
        },
      ],
    });

    const history = AgentEventContract.parse({
      type: "session.history",
      requestId: "history_1",
      sessionId: "session_1",
      timeline: [
        {
          itemId: "message:user_1",
          sessionId: "session_1",
          runId: "run_1",
          sequence: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          type: "user.message",
          messageId: "user_1",
          content: "Design a page",
          documentId: "document_1",
          revision: 0,
          scope: {
            kind: "selection",
            selectedNodeIds: ["node_1"],
            primaryNodeId: "node_2",
          },
        },
        {
          itemId: "run:run_1",
          sessionId: "session_1",
          runId: "run_1",
          sequence: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          type: "run",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          stopReason: "complete",
          failure,
        },
      ],
    });
    expect(history).toMatchObject({
      ok: false,
      issues: [
        {
          code: "agent_event.history_primary_selection_invalid",
          path: "/timeline/0/scope/primaryNodeId",
        },
        {
          code: "agent_event.history_failure_state_invalid",
          path: "/timeline/1/failure",
        },
      ],
    });
  });

  it("represents a strict recoverable session history response", () => {
    const historyEvent = {
      type: "session.history",
      requestId: "history_1",
      sessionId: "session_1",
      timeline: [
        {
          itemId: "tool:tool_1",
          sessionId: "session_1",
          runId: "run_1",
          sequence: 3,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          type: "tool",
          toolCallId: "tool_1",
          toolName: "design.update",
          input: { nodeId: "node_1" },
          risk: "design_write",
          status: "completed",
          result: { changed: true },
          revision: 5,
          transactionId: "transaction_1",
        },
      ],
    };

    expect(Value.Check(AgentEventSchema, historyEvent)).toBe(true);
    expect(
      Value.Check(AgentEventSchema, {
        ...historyEvent,
        timeline: [{ ...historyEvent.timeline[0], internal: true }],
      }),
    ).toBe(false);
  });

  it("carries bounded structured tool failure recovery details", () => {
    const failure = {
      type: "tool.failed",
      runId: "run_1",
      toolCallId: "tool_1",
      code: "design.invalid",
      message: "Transaction would violate document invariants",
      retryable: false,
      recoverable: true,
      details: {
        kind: "design-transaction",
        fingerprint: "design_deadbeef",
        issues: [
          {
            commandId: "update_card",
            nodeId: "card_1",
            path: "/nodesById/card_1/properties",
            message: "Expected union value",
          },
        ],
        recovery: {
          action: "inspect-and-revise",
          toolName: "opendesign_inspect_document",
          required: true,
        },
      },
    };

    expect(Value.Check(AgentEventSchema, failure)).toBe(true);
    expect(
      Value.Check(AgentEventSchema, {
        ...failure,
        details: { ...failure.details, filePath: "C:\\private\\draft" },
      }),
    ).toBe(false);

    expect(
      Value.Check(AgentEventSchema, {
        ...failure,
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
              recovery: "Defer secondary elements to continuation.",
            },
          ],
          recovery: { action: "correct-and-retry", required: false },
        },
      }),
    ).toBe(true);
    const workflowFailure = {
      ...failure,
      code: "design_capture_required",
      details: {
        kind: "design-workflow",
        fingerprint: "workflow_deadbeef",
        workflowCode: "capture_required",
        phase: "capture",
        requiresInspection: false,
        issues: [
          {
            code: "design_workflow.capture_required",
            path: "/designWorkflow",
            message: "Capture the current canvas before review",
            recovery: "Capture once, then continue review.",
          },
        ],
        recovery: { action: "follow-workflow", required: true },
      },
    };
    expect(isAgentEvent(workflowFailure)).toBe(true);
    expect(
      isAgentEvent({ ...workflowFailure, code: "design_inspection_required" }),
    ).toBe(true);
    expect(isAgentEvent({ ...workflowFailure, code: "provider_error" })).toBe(
      false,
    );
    expect(
      isAgentEvent({
        ...workflowFailure,
        details: { ...workflowFailure.details, phase: "material-write" },
      }),
    ).toBe(false);
    expect(
      isAgentEvent({
        ...workflowFailure,
        details: { ...workflowFailure.details, workflowCode: "unknown" },
      }),
    ).toBe(false);
  });

  it("carries bounded structured Provider failure diagnostics", () => {
    const failure = {
      code: "provider_timeout",
      message: "Provider stream timed out",
      retryable: true,
      provider: "provider_1",
      providerRequestId: "provider_request_1",
      modelRequestId: "model_request_1",
      timeout: { phase: "stream-idle", thresholdMs: 120_000 },
    } as const;
    expect(
      Value.Check(AgentEventSchema, {
        type: "agent.error",
        code: failure.code,
        message: failure.message,
        runId: "run_1",
        failure,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentEventSchema, {
        type: "agent.error",
        code: failure.code,
        message: failure.message,
        runId: "run_1",
        failure: {
          ...failure,
          timeout: { phase: "socket", thresholdMs: -1 },
        },
      }),
    ).toBe(false);
    expect(
      isAgentEvent({
        type: "agent.error",
        code: failure.code,
        message: failure.message,
        runId: "run_1",
        failure: { ...failure, message: "Contradictory failure" },
      }),
    ).toBe(false);
  });

  it("accepts only bounded five-retry model reconnect lifecycle events", () => {
    expect(
      isAgentEvent({
        type: "model.retrying",
        runId: "run_1",
        retry: 2,
        maxRetries: 5,
        delayMs: 900,
      }),
    ).toBe(true);
    expect(
      isAgentEvent({
        type: "model.recovered",
        runId: "run_1",
        retriesUsed: 3,
        maxRetries: 5,
      }),
    ).toBe(true);
    expect(
      isAgentEvent({
        type: "model.retrying",
        runId: "run_1",
        retry: 6,
        maxRetries: 5,
        delayMs: 0,
      }),
    ).toBe(false);
  });
});
