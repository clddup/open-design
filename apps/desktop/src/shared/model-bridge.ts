import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalStreamEvent,
  CanonicalTool,
  ModelRequest,
} from "@opendesign/model-gateway";
import { MAX_AGENT_ATTACHMENT_BYTES } from "@opendesign/agent-contracts";

const MAX_MODEL_TOOL_SCHEMA_BYTES = 512_000;
const MAX_MODEL_TOOLS_BYTES = 2_000_000;

export type SerializableModelRequest = Omit<ModelRequest, "signal">;

export type ModelBridgeRequest = {
  type: "model.request";
  requestId: string;
  request: SerializableModelRequest;
};

export type ModelBridgeCancel = {
  type: "model.cancel";
  requestId: string;
};

export type ModelBridgeResponse =
  | {
      type: "model.event";
      requestId: string;
      event: CanonicalStreamEvent;
    }
  | {
      type: "model.response";
      requestId: string;
      ok: true;
    }
  | {
      type: "model.response";
      requestId: string;
      ok: false;
      error: string;
    };

export function isModelBridgeRequest(
  value: unknown,
): value is ModelBridgeRequest {
  return modelBridgeRequestValidationError(value) === null;
}

export function modelBridgeRequestValidationError(
  value: unknown,
): string | null {
  if (!record(value) || value.type !== "model.request") {
    return "message is not a model.request object";
  }
  const request = value.request;
  if (!safeId(value.requestId)) return "requestId is invalid";
  if (!record(request)) return "request is not an object";
  if (!safeId(request.attemptId)) return "attemptId is invalid";
  if (request.sessionId !== undefined && !safeId(request.sessionId)) {
    return "sessionId is invalid";
  }
  if (!isModelSelection(request.modelSelection)) {
    return "modelSelection is invalid";
  }
  if (!safeText(request.system, 200_000)) return "system is invalid";
  if (!Array.isArray(request.messages) || request.messages.length > 1_000) {
    return "messages are invalid";
  }
  const invalidMessage = request.messages.findIndex(
    (message) => !isCanonicalMessage(message),
  );
  if (invalidMessage >= 0) return `messages[${invalidMessage}] is invalid`;
  if (!Array.isArray(request.tools) || request.tools.length > 256) {
    return "tools are invalid";
  }
  if (!jsonSizeWithin(request.tools, MAX_MODEL_TOOLS_BYTES)) {
    return "tools exceed the aggregate size limit";
  }
  const invalidTool = request.tools.findIndex((tool) => !isCanonicalTool(tool));
  if (invalidTool >= 0) return `tools[${invalidTool}] is invalid`;
  return null;
}

export function modelBridgeRequestId(value: unknown): string | null {
  return record(value) &&
    value.type === "model.request" &&
    safeId(value.requestId)
    ? value.requestId
    : null;
}

export function isModelBridgeCancel(
  value: unknown,
): value is ModelBridgeCancel {
  return (
    record(value) && value.type === "model.cancel" && safeId(value.requestId)
  );
}

export function isModelBridgeResponse(
  value: unknown,
): value is ModelBridgeResponse {
  return modelBridgeResponseValidationError(value) === null;
}

export function modelBridgeResponseValidationError(
  value: unknown,
): string | null {
  if (
    !record(value) ||
    !safeId(value.requestId) ||
    (value.type !== "model.event" && value.type !== "model.response")
  ) {
    return "message is not a correlated model response";
  }
  if (value.type === "model.event") {
    return isCanonicalStreamEvent(value.event) ? null : "event is invalid";
  }
  if (typeof value.ok !== "boolean") return "response status is invalid";
  if (value.ok) {
    return Object.keys(value).every((key) =>
      ["type", "requestId", "ok"].includes(key),
    )
      ? null
      : "successful response contains unexpected fields";
  }
  return safeText(value.error, 20_000) ? null : "response error is invalid";
}

export function modelBridgeResponseId(value: unknown): string | null {
  return record(value) &&
    (value.type === "model.event" || value.type === "model.response") &&
    safeId(value.requestId)
    ? value.requestId
    : null;
}

function isCanonicalMessage(value: unknown): value is CanonicalMessage {
  if (!record(value)) return false;
  if (value.role === "user") {
    return (
      safeText(value.content, 2_000_000) ||
      (Array.isArray(value.content) &&
        value.content.length <= 16 &&
        value.content.every(isCanonicalUserContentBlock))
    );
  }
  if (value.role === "tool") {
    return (
      safeId(value.toolCallId) &&
      (value.toolName === undefined || safeId(value.toolName)) &&
      typeof value.isError === "boolean" &&
      jsonSizeWithin(value.content, 2_000_000)
    );
  }
  return (
    value.role === "assistant" &&
    Array.isArray(value.blocks) &&
    value.blocks.length <= 2_000 &&
    value.blocks.every(isCanonicalBlock) &&
    (value.source === undefined || isResolvedModelIdentity(value.source))
  );
}

function isCanonicalUserContentBlock(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.type === "text") {
    return (
      safeText(value.text, 250_000) &&
      Object.keys(value).every((key) => ["type", "text"].includes(key))
    );
  }
  const exactAttachmentKeys = Object.keys(value).every((key) =>
    ["type", "attachmentId", "name", "mimeType", "byteSize"].includes(key),
  );
  const commonAttachment =
    safeText(value.name, 255) &&
    Number.isInteger(value.byteSize) &&
    Number(value.byteSize) > 0 &&
    Number(value.byteSize) <= MAX_AGENT_ATTACHMENT_BYTES &&
    exactAttachmentKeys;
  if (!commonAttachment || typeof value.attachmentId !== "string") {
    return false;
  }
  if (value.type === "image_ref") {
    return (
      /^image_[a-f0-9]{64}$/.test(value.attachmentId) &&
      ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        String(value.mimeType),
      )
    );
  }
  return (
    value.type === "document_ref" &&
    /^file_[a-f0-9]{64}$/.test(value.attachmentId) &&
    [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/markdown",
      "text/csv",
      "text/html",
      "application/json",
      "application/yaml",
    ].includes(String(value.mimeType))
  );
}

function isCanonicalTool(value: unknown): value is CanonicalTool {
  return (
    record(value) &&
    safeId(value.name) &&
    safeText(value.description, 20_000) &&
    record(value.inputSchema) &&
    jsonSizeWithin(value.inputSchema, MAX_MODEL_TOOL_SCHEMA_BYTES)
  );
}

function isCanonicalBlock(value: unknown): value is CanonicalContentBlock {
  if (!record(value) || !safeId(value.id)) return false;
  if (value.type === "text") return safeText(value.text, 2_000_000);
  if (value.type === "reasoning_summary") {
    return (
      (value.status === "completed" || value.status === "omitted") &&
      (value.summary === undefined || safeText(value.summary, 2_000_000)) &&
      (value.signature === undefined || safeText(value.signature, 200_000))
    );
  }
  return (
    value.type === "tool_call" &&
    safeId(value.toolCallId) &&
    safeId(value.name) &&
    jsonSizeWithin(value.input, 2_000_000)
  );
}

function isCanonicalStreamEvent(value: unknown): value is CanonicalStreamEvent {
  if (!record(value) || !safeId(value.attemptId)) return false;
  if (value.type === "attempt.started") {
    return (
      safeText(value.model, 256) && isResolvedModelIdentity(value.identity)
    );
  }
  if (value.type === "block.started") {
    return (
      safeId(value.blockId) &&
      ["text", "reasoning_summary", "tool_call"].includes(String(value.kind))
    );
  }
  if (value.type === "block.delta") {
    return safeId(value.blockId) && safeText(value.delta, 2_000_000);
  }
  if (value.type === "block.completed") return isCanonicalBlock(value.block);
  if (value.type === "attempt.completed") {
    return (
      [
        "complete",
        "tool_use",
        "length",
        "cancelled",
        "content_filter",
        "error",
        "other",
      ].includes(String(value.stopReason)) && isUsage(value.usage)
    );
  }
  return (
    value.type === "attempt.failed" &&
    record(value.error) &&
    safeText(value.error.code, 256) &&
    safeText(value.error.message, 20_000) &&
    typeof value.error.retryable === "boolean"
  );
}

function isModelSelection(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    safeId(value.providerId) &&
    safeText(value.modelId, 256) &&
    (value.reasoningEffort === undefined ||
      isReasoningEffort(value.reasoningEffort))
  );
}

function isResolvedModelIdentity(value: unknown): boolean {
  return (
    isModelSelection(value) &&
    record(value) &&
    isApiFormat(value.apiFormat) &&
    (value.responseId === undefined || safeId(value.responseId))
  );
}

function isUsage(value: unknown): boolean {
  if (!record(value)) return false;
  return [
    value.inputTokens,
    value.outputTokens,
    value.cacheReadTokens,
    value.cacheWriteTokens,
    value.reasoningTokens,
  ].every((item) => typeof item === "number" && Number.isFinite(item));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeId(value: unknown): value is string {
  return safeText(value, 512) && !hasControlCharacter(value);
}

function isReasoningEffort(value: unknown): boolean {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function isApiFormat(value: unknown): boolean {
  return (
    value === "openai-responses" ||
    value === "openai-chat-completions" ||
    value === "anthropic-messages"
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function safeText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function jsonSizeWithin(value: unknown, maximum: number): boolean {
  try {
    return JSON.stringify(value).length <= maximum;
  } catch {
    return false;
  }
}
