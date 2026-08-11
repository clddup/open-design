import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_EVENT_VERSION,
  formatDiagnosticReport,
  isDiagnosticEvent,
  isRendererDiagnosticReport,
  type DiagnosticEvent,
} from "./diagnostics";

const event: DiagnosticEvent = {
  version: DIAGNOSTIC_EVENT_VERSION,
  eventId: "diagnostic_123",
  occurredAt: "2026-08-10T12:00:00.000Z",
  level: "error",
  source: "agent",
  presentation: "toast",
  code: "model_bridge_failed",
  message: "The model bridge stopped before returning a response.",
  appVersion: "0.1.0",
  platform: "win32",
  context: {
    conversationId: "conversation_1",
    runId: "run_1",
    requestId: "request_1",
    toolCallId: "tool_1",
  },
};

describe("diagnostic contract", () => {
  it("accepts bounded structured events and renderer reports", () => {
    expect(isDiagnosticEvent(event)).toBe(true);
    expect(
      isRendererDiagnosticReport({
        level: "error",
        presentation: "toast",
        code: "renderer_failed",
        message: "Renderer operation failed",
        context: { runId: "run_1" },
      }),
    ).toBe(true);
  });

  it("rejects unbounded payloads and unknown context fields", () => {
    expect(
      isRendererDiagnosticReport({
        level: "error",
        presentation: "toast",
        code: "renderer_failed",
        message: "Renderer operation failed",
        context: { runId: "run_1", prompt: "secret prompt" },
      }),
    ).toBe(false);
    expect(isDiagnosticEvent({ ...event, credential: "secret" })).toBe(false);
  });

  it("formats a copy-ready report with correlation identifiers", () => {
    expect(formatDiagnosticReport(event)).toContain(
      "Conversation ID: conversation_1",
    );
    expect(formatDiagnosticReport(event)).toContain("Run ID: run_1");
    expect(formatDiagnosticReport(event)).toContain("Request ID: request_1");
    expect(formatDiagnosticReport(event)).toContain("Tool Call ID: tool_1");
    expect(formatDiagnosticReport(event)).toContain(event.message);
  });

  it("preserves structured Provider timeout evidence in copied diagnostics", () => {
    const timeoutEvent: DiagnosticEvent = {
      ...event,
      code: "provider_timeout",
      message: "Provider stream timed out",
      failure: {
        code: "provider_timeout",
        message: "Provider stream timed out",
        retryable: true,
        provider: "provider_1",
        providerRequestId: "provider_request_1",
        modelRequestId: "model_request_1",
        timeout: { phase: "stream-idle", thresholdMs: 120_000 },
      },
    };

    expect(isDiagnosticEvent(timeoutEvent)).toBe(true);
    const report = formatDiagnosticReport(timeoutEvent);
    expect(report).toContain("Failure:");
    expect(report).toContain('"phase": "stream-idle"');
    expect(report).toContain('"modelRequestId": "model_request_1"');
    expect(report).toContain('"providerRequestId": "provider_request_1"');
  });

  it("preserves invariant targets in the copy-ready diagnostic", () => {
    const invariantEvent: DiagnosticEvent = {
      ...event,
      source: "design-tool",
      code: "design.invalid",
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

    expect(isDiagnosticEvent(invariantEvent)).toBe(true);
    const report = formatDiagnosticReport(invariantEvent);
    expect(report).toContain("Details:");
    expect(report).toContain('"commandId": "update_card"');
    expect(report).toContain('"nodeId": "card_1"');
    expect(report).toContain('"path": "/nodesById/card_1/properties"');
  });
});
