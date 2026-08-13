import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  AgentRequestSchema,
  MAX_SELECTED_NODE_IDS,
  SelectionScopeSchema,
  isAgentEvent,
  isAgentRequest,
  isSelectionScope,
} from "./index.js";

const validStart = {
  type: "run.start",
  runId: "run_1",
  sessionId: "session_1",
  prompt: "Align the selected layers",
  documentId: "document_1",
  revision: 4,
  modelSelection: {
    providerId: "provider_1",
    modelId: "design-model",
    reasoningEffort: "medium",
  },
  modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
  scope: {
    kind: "selection",
    selectedNodeIds: ["node_1", "node_2"],
    primaryNodeId: "node_1",
    pageId: "page_1",
  },
  mutationTarget: { kind: "page", pageId: "page_1" },
} as const;

describe("Agent contracts", () => {
  it("accepts a strict host-bound selection snapshot", () => {
    expect(isAgentRequest(validStart)).toBe(true);
    expect(
      Value.Check(SelectionScopeSchema, {
        kind: "page",
        selectedNodeIds: ["node_1"],
        pageId: "page_1",
      }),
    ).toBe(true);
    expect(
      Value.Check(SelectionScopeSchema, {
        kind: "document",
        selectedNodeIds: [],
      }),
    ).toBe(true);
  });

  it("accepts bounded Main-owned continuation provenance", () => {
    const continuation = {
      parentRunId: "run_parent",
      rootRunId: "run_root",
      attempt: 1,
      maxAttempts: 3,
      reason: "budget",
    } as const;
    expect(isAgentRequest({ ...validStart, continuation })).toBe(true);
    expect(
      isAgentEvent({
        type: "run.started",
        runId: "run_next",
        startedAt: "2026-08-12T12:00:00.000Z",
        continuation,
      }),
    ).toBe(true);
    expect(
      isAgentRequest({
        ...validStart,
        continuation: { ...continuation, attempt: 4 },
      }),
    ).toBe(false);
    expect(
      isAgentEvent({
        type: "run.continuation",
        runId: "run_parent",
        status: "scheduled",
        attempt: 1,
        maxAttempts: 3,
        reason: "budget",
      }),
    ).toBe(false);
    expect(
      isAgentEvent({
        type: "run.continuation",
        runId: "run_parent",
        status: "scheduled",
        attempt: 1,
        maxAttempts: 3,
        reason: "budget",
        nextRunId: "run_next",
      }),
    ).toBe(true);
  });

  it("accepts only bounded host-resolved model context metadata", () => {
    expect(isAgentRequest(validStart)).toBe(true);
    expect(
      isAgentRequest({
        ...validStart,
        modelContext: { contextWindow: 1_000, maxOutputTokens: 128 },
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        modelContext: {
          contextWindow: 200_000,
          maxOutputTokens: 16_384,
          apiKey: "forged",
        },
      }),
    ).toBe(false);
  });

  it("accepts only bounded content-addressed image, document, and SVG handles", () => {
    const imageAttachment = {
      attachmentId: `image_${"a".repeat(64)}`,
      name: "inspiration.png",
      mimeType: "image/png",
      byteSize: 1024,
    } as const;
    const documentAttachment = {
      attachmentId: `file_${"b".repeat(64)}`,
      name: "product-brief.md",
      mimeType: "text/markdown",
      byteSize: 2048,
    } as const;
    const svgAttachment = {
      attachmentId: `svg_${"c".repeat(64)}`,
      name: "brand-mark.svg",
      mimeType: "image/svg+xml",
      byteSize: 4096,
    } as const;

    expect(
      isAgentRequest({
        ...validStart,
        attachments: [imageAttachment, documentAttachment, svgAttachment],
      }),
    ).toBe(true);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: [
          { ...imageAttachment, attachmentId: "../../private.png" },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: Array.from({ length: 7 }, (_, index) => ({
          ...imageAttachment,
          attachmentId: `image_${String(index).repeat(64)}`,
        })),
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: [
          { ...documentAttachment, mimeType: "application/octet-stream" },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: [
          {
            ...documentAttachment,
            attachmentId: `image_${"b".repeat(64)}`,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: [
          { ...svgAttachment, attachmentId: `file_${"c".repeat(64)}` },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: [{ ...svgAttachment, mimeType: "text/plain" }],
      }),
    ).toBe(false);
  });

  it("rejects extra cross-process properties, duplicates, and oversized selections", () => {
    expect(
      Value.Check(AgentRequestSchema, { ...validStart, unexpected: true }),
    ).toBe(false);
    expect(
      Value.Check(AgentRequestSchema, {
        ...validStart,
        scope: { ...validStart.scope, unexpected: true },
      }),
    ).toBe(false);
    expect(
      isSelectionScope({
        kind: "selection",
        selectedNodeIds: ["node_1", "node_1"],
      }),
    ).toBe(false);
    expect(
      isSelectionScope({
        kind: "selection",
        selectedNodeIds: Array.from(
          { length: MAX_SELECTED_NODE_IDS + 1 },
          (_, index) => `node_${index}`,
        ),
      }),
    ).toBe(false);
  });

  it("requires a primary node to belong to the selected node IDs", () => {
    const semanticMismatch = {
      ...validStart.scope,
      primaryNodeId: "node_elsewhere",
    };

    expect(Value.Check(SelectionScopeSchema, semanticMismatch)).toBe(true);
    expect(isSelectionScope(semanticMismatch)).toBe(false);
    expect(isAgentRequest({ ...validStart, scope: semanticMismatch })).toBe(
      false,
    );
  });

  it("keeps selection context separate from the immutable write target", () => {
    expect(
      isAgentRequest({
        ...validStart,
        scope: {
          ...validStart.scope,
          selectedNodeIds: ["node_2"],
          primaryNodeId: "node_2",
        },
      }),
    ).toBe(true);
    expect(
      isAgentRequest({
        ...validStart,
        mutationTarget: { kind: "page", pageId: "page_other" },
      }),
    ).toBe(false);
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
