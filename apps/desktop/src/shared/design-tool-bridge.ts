import { isSelectionScope } from "@opendesign/agent-contracts";
import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import { validateDesignAgentToolInput } from "./design-agent-tools";

export type DesignToolBridgeRequest = {
  type: "design-tool.request";
  requestId: string;
  call: ToolCallRequest;
  context: TrustedToolContext;
};

export type DesignToolBridgeCancel = {
  type: "design-tool.cancel";
  requestId: string;
};

export type DesignToolBridgeResponse =
  | {
      type: "design-tool.response";
      requestId: string;
      ok: true;
      result: TrustedToolResult;
    }
  | {
      type: "design-tool.response";
      requestId: string;
      ok: false;
      error: string;
    };

export type RendererDesignToolRequest = {
  requestId: string;
  call: ToolCallRequest;
  context: TrustedToolContext;
};

export type RendererDesignToolCancel = {
  requestId: string;
};

export type RendererDesignToolResponse =
  | { requestId: string; ok: true; result: TrustedToolResult }
  | { requestId: string; ok: false; error: string };

export function isDesignToolBridgeRequest(
  value: unknown,
): value is DesignToolBridgeRequest {
  if (!record(value) || value.type !== "design-tool.request") return false;
  return (
    safeId(value.requestId) &&
    isToolCall(value.call) &&
    isTrustedContext(value.context)
  );
}

export function isDesignToolBridgeCancel(
  value: unknown,
): value is DesignToolBridgeCancel {
  return (
    record(value) &&
    value.type === "design-tool.cancel" &&
    safeId(value.requestId)
  );
}

export function isDesignToolBridgeResponse(
  value: unknown,
): value is DesignToolBridgeResponse {
  if (
    !record(value) ||
    value.type !== "design-tool.response" ||
    !safeId(value.requestId) ||
    typeof value.ok !== "boolean"
  ) {
    return false;
  }
  return value.ok
    ? isTrustedToolResult(value.result)
    : safeText(value.error, 20_000);
}

export function isRendererDesignToolRequest(
  value: unknown,
): value is RendererDesignToolRequest {
  return (
    record(value) &&
    safeId(value.requestId) &&
    isToolCall(value.call) &&
    isTrustedContext(value.context)
  );
}

export function isRendererDesignToolCancel(
  value: unknown,
): value is RendererDesignToolCancel {
  return (
    record(value) &&
    safeId(value.requestId) &&
    Object.keys(value).every((key) => key === "requestId")
  );
}

export function isRendererDesignToolResponse(
  value: unknown,
): value is RendererDesignToolResponse {
  if (
    !record(value) ||
    !safeId(value.requestId) ||
    typeof value.ok !== "boolean"
  ) {
    return false;
  }
  return value.ok
    ? isTrustedToolResult(value.result)
    : safeText(value.error, 20_000);
}

function isToolCall(value: unknown): value is ToolCallRequest {
  return (
    record(value) &&
    safeId(value.toolCallId) &&
    safeId(value.toolName) &&
    validateDesignAgentToolInput(value.toolName, value.input) &&
    Object.keys(value).every((key) =>
      ["toolCallId", "toolName", "input"].includes(key),
    )
  );
}

function isTrustedContext(value: unknown): value is TrustedToolContext {
  return (
    record(value) &&
    safeId(value.runId) &&
    safeId(value.sessionId) &&
    safeId(value.documentId) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    isSelectionScope(value.scope) &&
    Object.keys(value).every((key) =>
      ["runId", "sessionId", "documentId", "revision", "scope"].includes(key),
    )
  );
}

function isTrustedToolResult(value: unknown): value is TrustedToolResult {
  if (!record(value) || !jsonSizeWithin(value.content, 4_000_000)) return false;
  const observedRevision = value.observedRevision;
  if (
    observedRevision !== undefined &&
    (!Number.isInteger(observedRevision) || Number(observedRevision) < 0)
  ) {
    return false;
  }
  const revision = value.designRevision;
  if (
    revision !== undefined &&
    (!record(revision) ||
      !Number.isInteger(revision.previousRevision) ||
      Number(revision.previousRevision) < 0 ||
      !Number.isInteger(revision.revision) ||
      Number(revision.revision) <= Number(revision.previousRevision) ||
      !safeId(revision.transactionId) ||
      !Object.keys(revision).every((key) =>
        ["previousRevision", "revision", "transactionId"].includes(key),
      ) ||
      (observedRevision !== undefined &&
        Number(observedRevision) !== Number(revision.revision)))
  ) {
    return false;
  }
  return Object.keys(value).every((key) =>
    ["content", "observedRevision", "designRevision"].includes(key),
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeId(value: unknown): value is string {
  return (
    safeText(value, 512) &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  );
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

function jsonSizeWithin(value: unknown, maximum: number): boolean {
  try {
    return JSON.stringify(value).length <= maximum;
  } catch {
    return false;
  }
}
