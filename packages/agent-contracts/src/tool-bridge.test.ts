import { describe, expect, it, vi } from "vitest";
import {
  designToolBridgeRequestId,
  designToolBridgeResponseId,
  isDesignToolBridgeCancel,
  isDesignToolBridgeProgress,
  isDesignToolBridgeRequest,
  isDesignToolBridgeResponse,
  isToolExecutionEvent,
  isTrustedToolContext,
  isTrustedToolFailure,
  isTrustedToolResult,
} from "./index.js";

const context = {
  runId: "run_1",
  sessionId: "session_1",
  documentId: "document_1",
  revision: 3,
  scope: {
    kind: "selection",
    selectedNodeIds: ["node_1"],
    primaryNodeId: "node_1",
    pageId: "page_1",
  },
  mutationTarget: { kind: "page", pageId: "page_1" },
} as const;

const request = {
  type: "design-tool.request",
  requestId: "request_1",
  call: {
    toolCallId: "call_1",
    toolName: "opendesign_apply_design",
    input: { transaction: "trusted-by-tool-validator" },
  },
  context,
} as const;

describe("agent tool wire contracts", () => {
  it("requires the host tool's semantic input validator", () => {
    const validateInput = vi.fn(() => true);

    expect(isDesignToolBridgeRequest(request, validateInput)).toBe(true);
    expect(validateInput).toHaveBeenCalledWith(
      request.call.toolName,
      request.call.input,
    );
    expect(isDesignToolBridgeRequest(request, () => false)).toBe(false);
    expect(
      isDesignToolBridgeRequest(
        { ...request, call: { ...request.call, toolName: "unknown_tool" } },
        (toolName) => toolName === request.call.toolName,
      ),
    ).toBe(false);
  });

  it("rejects forged context and non-exact wire objects", () => {
    expect(isTrustedToolContext(context)).toBe(true);
    expect(
      isTrustedToolContext({
        ...context,
        scope: { ...context.scope, primaryNodeId: "node_2" },
      }),
    ).toBe(false);
    expect(
      isDesignToolBridgeRequest(
        { ...request, secretPath: "/tmp/private" },
        () => true,
      ),
    ).toBe(false);
  });

  it("validates bounded failures and their structured recovery details", () => {
    const failure = {
      code: "design.duplicate",
      message: "Node already exists",
      retryable: false,
      recoverable: true,
      details: {
        kind: "design-transaction",
        fingerprint: "design_1",
        issues: [{ path: "", message: "Node already exists" }],
        recovery: {
          action: "inspect-and-revise",
          toolName: "opendesign_inspect_document",
          required: true,
        },
      },
    } as const;

    expect(isTrustedToolFailure(failure)).toBe(true);
    expect(
      isTrustedToolFailure({
        ...failure,
        details: {
          ...failure.details,
          recovery: { ...failure.details.recovery, required: false },
        },
      }),
    ).toBe(false);
    expect(isTrustedToolFailure({ ...failure, runTerminal: false })).toBe(
      false,
    );
  });

  it("enforces revision and rebase invariants on trusted results", () => {
    const result = {
      content: { applied: true },
      observedRevision: 6,
      designRevision: {
        previousRevision: 5,
        rebasedFromRevision: 3,
        revision: 6,
        transactionId: "transaction_1",
      },
    } as const;

    expect(isTrustedToolResult(result)).toBe(true);
    expect(
      isTrustedToolResult({
        ...result,
        designRevision: { ...result.designRevision, revision: 5 },
      }),
    ).toBe(false);
    expect(
      isTrustedToolResult({
        ...result,
        designRevision: { ...result.designRevision, rebasedFromRevision: 5 },
      }),
    ).toBe(false);
    expect(isTrustedToolResult({ ...result, observedRevision: 7 })).toBe(false);
  });

  it("rejects oversized and non-serializable result content", () => {
    expect(isTrustedToolResult({ content: "x".repeat(4_000_001) })).toBe(false);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(isTrustedToolResult({ content: cyclic })).toBe(false);
  });

  it("validates progress, cancellation, responses, and execution events", () => {
    expect(
      isDesignToolBridgeProgress({
        type: "design-tool.progress",
        requestId: "request_1",
        message: "Applying",
        progress: 0.5,
      }),
    ).toBe(true);
    expect(
      isDesignToolBridgeProgress({
        type: "design-tool.progress",
        requestId: "request_1",
        message: "x".repeat(2_001),
        progress: 0.5,
      }),
    ).toBe(false);
    expect(
      isDesignToolBridgeCancel({
        type: "design-tool.cancel",
        requestId: "request_1",
      }),
    ).toBe(true);
    expect(
      isDesignToolBridgeResponse({
        type: "design-tool.response",
        requestId: "request_1",
        ok: true,
        result: { content: { applied: true } },
      }),
    ).toBe(true);
    expect(
      isToolExecutionEvent({
        type: "progress",
        message: "Applying",
        progress: 1.1,
      }),
    ).toBe(false);
  });

  it("extracts correlation IDs from malformed matching envelopes", () => {
    expect(
      designToolBridgeRequestId({
        type: "design-tool.request",
        requestId: "request_1",
        call: null,
      }),
    ).toBe("request_1");
    expect(
      designToolBridgeResponseId({
        type: "design-tool.response",
        requestId: "request_1",
        ok: "invalid",
      }),
    ).toBe("request_1");
    expect(
      designToolBridgeResponseId({
        type: "model.response",
        requestId: "request_1",
      }),
    ).toBeNull();
  });
});
