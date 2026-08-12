import {
  isDesignMutationTarget,
  isSelectionScope,
} from "@opendesign/agent-contracts";
import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolFailure,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  isPreparedAgentRasterExport,
  validateDesignAgentToolInput,
} from "./design-agent-tools";

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
      error: TrustedToolFailure;
    };

export type RendererDesignToolRequest = {
  requestId: string;
  call: ToolCallRequest;
  context: TrustedToolContext;
  captureTarget?: RendererDesignCaptureTarget;
};

export type RendererDesignCaptureTarget =
  | { kind: "page"; pageId: string }
  | { kind: "frame"; pageId: string; nodeId: string };

export type RendererDesignToolCancel = {
  requestId: string;
};

export type RendererDesignToolProgressPhase =
  "accepted" | "applying" | "capturing" | "persisting";

export type RendererDesignToolProgress = {
  requestId: string;
  phase: RendererDesignToolProgressPhase;
  progress: number;
};

export type RendererDesignToolResponse =
  | { requestId: string; ok: true; result: TrustedToolResult }
  | { requestId: string; ok: false; error: TrustedToolFailure };

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

export function designToolBridgeRequestId(value: unknown): string | null {
  return record(value) &&
    value.type === "design-tool.request" &&
    safeId(value.requestId)
    ? value.requestId
    : null;
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
    : isTrustedToolFailure(value.error);
}

export function designToolBridgeResponseId(value: unknown): string | null {
  return record(value) &&
    value.type === "design-tool.response" &&
    safeId(value.requestId)
    ? value.requestId
    : null;
}

export function isRendererDesignToolRequest(
  value: unknown,
): value is RendererDesignToolRequest {
  if (
    !record(value) ||
    !safeId(value.requestId) ||
    !isToolCall(value.call) ||
    !isTrustedContext(value.context) ||
    !Object.keys(value).every((key) =>
      ["requestId", "call", "context", "captureTarget"].includes(key),
    )
  ) {
    return false;
  }
  if (value.call.toolName === DESIGN_CAPTURE_TOOL_NAME) {
    return isRendererDesignCaptureTarget(value.captureTarget);
  }
  return value.captureTarget === undefined;
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

export function isRendererDesignToolProgress(
  value: unknown,
): value is RendererDesignToolProgress {
  return (
    record(value) &&
    safeId(value.requestId) &&
    ["accepted", "applying", "capturing", "persisting"].includes(
      String(value.phase),
    ) &&
    typeof value.progress === "number" &&
    Number.isFinite(value.progress) &&
    value.progress >= 0 &&
    value.progress <= 1 &&
    Object.keys(value).every((key) =>
      ["requestId", "phase", "progress"].includes(key),
    )
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
    : isTrustedToolFailure(value.error);
}

export function isTrustedToolFailure(
  value: unknown,
): value is TrustedToolFailure {
  if (
    !record(value) ||
    !safeId(value.code) ||
    !safeText(value.message, 20_000) ||
    typeof value.retryable !== "boolean" ||
    typeof value.recoverable !== "boolean" ||
    !Object.keys(value).every((key) =>
      ["code", "message", "retryable", "recoverable", "details"].includes(key),
    )
  ) {
    return false;
  }
  return (
    value.details === undefined ||
    isDesignTransactionFailureDetails(value.details)
  );
}

function isDesignTransactionFailureDetails(value: unknown): boolean {
  if (
    !record(value) ||
    value.kind !== "design-transaction" ||
    !safeId(value.fingerprint) ||
    !Array.isArray(value.issues) ||
    value.issues.length === 0 ||
    value.issues.length > 128 ||
    !value.issues.every(isDesignTransactionFailureIssue) ||
    !record(value.recovery) ||
    value.recovery.action !== "inspect-and-revise" ||
    value.recovery.toolName !== "opendesign_inspect_document" ||
    value.recovery.required !== true ||
    !Object.keys(value.recovery).every((key) =>
      ["action", "toolName", "required"].includes(key),
    ) ||
    !optionalBoundedInteger(value.attempt) ||
    !optionalBoundedInteger(value.maxAttempts) ||
    (value.retrySuppressed !== undefined &&
      typeof value.retrySuppressed !== "boolean") ||
    !Object.keys(value).every((key) =>
      [
        "kind",
        "fingerprint",
        "issues",
        "recovery",
        "attempt",
        "maxAttempts",
        "retrySuppressed",
      ].includes(key),
    )
  ) {
    return false;
  }
  return true;
}

function isDesignTransactionFailureIssue(value: unknown): boolean {
  return (
    record(value) &&
    (value.commandId === undefined || safeId(value.commandId)) &&
    (value.nodeId === undefined || safeId(value.nodeId)) &&
    safeText(value.path, 4_000, true) &&
    safeText(value.message, 20_000) &&
    Object.keys(value).every((key) =>
      ["commandId", "nodeId", "path", "message"].includes(key),
    )
  );
}

function optionalBoundedInteger(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100)
  );
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
    isDesignMutationTarget(value.mutationTarget) &&
    Object.keys(value).every((key) =>
      [
        "runId",
        "sessionId",
        "documentId",
        "revision",
        "scope",
        "mutationTarget",
      ].includes(key),
    )
  );
}

function isRendererDesignCaptureTarget(
  value: unknown,
): value is RendererDesignCaptureTarget {
  if (!record(value) || !safeId(value.pageId)) return false;
  if (value.kind === "page") {
    return Object.keys(value).every((key) => ["kind", "pageId"].includes(key));
  }
  return (
    value.kind === "frame" &&
    safeId(value.nodeId) &&
    Object.keys(value).every((key) =>
      ["kind", "pageId", "nodeId"].includes(key),
    )
  );
}

function isTrustedToolResult(value: unknown): value is TrustedToolResult {
  if (
    !record(value) ||
    (!isPreparedAgentRasterExport(value.content) &&
      !jsonSizeWithin(value.content, 4_000_000))
  )
    return false;
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
      (revision.rebasedFromRevision !== undefined &&
        (!Number.isInteger(revision.rebasedFromRevision) ||
          Number(revision.rebasedFromRevision) < 0 ||
          Number(revision.rebasedFromRevision) >=
            Number(revision.previousRevision))) ||
      !safeId(revision.transactionId) ||
      !Object.keys(revision).every((key) =>
        [
          "previousRevision",
          "rebasedFromRevision",
          "revision",
          "transactionId",
        ].includes(key),
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

function safeText(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximum
  );
}

function jsonSizeWithin(value: unknown, maximum: number): boolean {
  try {
    return JSON.stringify(value).length <= maximum;
  } catch {
    return false;
  }
}
