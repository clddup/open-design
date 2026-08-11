import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  AgentRequestSchema,
  MAX_SELECTED_NODE_IDS,
  SelectionScopeSchema,
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
});
