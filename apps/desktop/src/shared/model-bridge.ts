import {
  CanonicalStreamEventSchema,
  SerializableModelRequestSchema,
  type CanonicalStreamEvent,
  type SerializableModelRequest,
} from "@opendesign/model-gateway";
import { Type } from "@sinclair/typebox";
import {
  defineContract,
  formatValidationFailure,
  type ValidationIssue,
} from "./contract-validation";

const MAX_MODEL_TOOL_SCHEMA_BYTES = 512_000;
const MAX_MODEL_TOOLS_BYTES = 2_000_000;
const MAX_MODEL_CONTENT_BYTES = 2_000_000;
const MODEL_IMAGE_REFERENCE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MODEL_DOCUMENT_REFERENCE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/yaml",
]);
const ModelBridgeIdSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const ModelBridgeRequestSchema = Type.Object(
  {
    type: Type.Literal("model.request"),
    requestId: ModelBridgeIdSchema,
    request: SerializableModelRequestSchema,
  },
  { additionalProperties: false },
);
const ModelBridgeCancelSchema = Type.Object(
  {
    type: Type.Literal("model.cancel"),
    requestId: ModelBridgeIdSchema,
  },
  { additionalProperties: false },
);
const ModelBridgeResponseSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("model.event"),
      requestId: ModelBridgeIdSchema,
      event: CanonicalStreamEventSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("model.response"),
      requestId: ModelBridgeIdSchema,
      ok: Type.Literal(true),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("model.response"),
      requestId: ModelBridgeIdSchema,
      ok: Type.Literal(false),
      error: Type.String({ maxLength: 20_000 }),
    },
    { additionalProperties: false },
  ),
]);
const ModelBridgeRequestIdentitySchema = Type.Object(
  {
    type: Type.Literal("model.request"),
    requestId: ModelBridgeIdSchema,
  },
  { additionalProperties: true },
);
const ModelBridgeResponseIdentitySchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal("model.event"),
      Type.Literal("model.response"),
    ]),
    requestId: ModelBridgeIdSchema,
  },
  { additionalProperties: true },
);

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

const ModelBridgeRequestContract = defineContract<ModelBridgeRequest>({
  schema: ModelBridgeRequestSchema,
  code: "model_bridge_request.schema_invalid",
  subject: "model bridge request",
  clone: false,
  refine: (value) => modelRequestBudgetIssues(value.request),
});
const ModelBridgeCancelContract = defineContract<ModelBridgeCancel>({
  schema: ModelBridgeCancelSchema,
  code: "model_bridge_cancel.schema_invalid",
  subject: "model bridge cancel",
  clone: false,
});
const ModelBridgeResponseContract = defineContract<ModelBridgeResponse>({
  schema: ModelBridgeResponseSchema,
  code: "model_bridge_response.schema_invalid",
  subject: "model bridge response",
  clone: false,
  refine: (value) =>
    value.type === "model.event" ? modelEventBudgetIssues(value.event) : [],
});
const ModelBridgeRequestIdentityContract = defineContract<{
  type: "model.request";
  requestId: string;
}>({
  schema: ModelBridgeRequestIdentitySchema,
  code: "model_bridge_request_identity.schema_invalid",
  subject: "model bridge request identity",
  clone: false,
});
const ModelBridgeResponseIdentityContract = defineContract<{
  type: "model.event" | "model.response";
  requestId: string;
}>({
  schema: ModelBridgeResponseIdentitySchema,
  code: "model_bridge_response_identity.schema_invalid",
  subject: "model bridge response identity",
  clone: false,
});

export function isModelBridgeRequest(
  value: unknown,
): value is ModelBridgeRequest {
  return ModelBridgeRequestContract.parse(value).ok;
}

export function modelBridgeRequestValidationError(
  value: unknown,
): string | null {
  const result = ModelBridgeRequestContract.parse(value);
  return result.ok
    ? null
    : formatValidationFailure("model bridge request", result.issues);
}

export function modelBridgeRequestId(value: unknown): string | null {
  const result = ModelBridgeRequestIdentityContract.parse(value);
  return result.ok ? result.value.requestId : null;
}

export function isModelBridgeCancel(
  value: unknown,
): value is ModelBridgeCancel {
  return ModelBridgeCancelContract.parse(value).ok;
}

export function isModelBridgeResponse(
  value: unknown,
): value is ModelBridgeResponse {
  return ModelBridgeResponseContract.parse(value).ok;
}

export function modelBridgeResponseValidationError(
  value: unknown,
): string | null {
  const result = ModelBridgeResponseContract.parse(value);
  return result.ok
    ? null
    : formatValidationFailure("model bridge response", result.issues);
}

export function modelBridgeResponseId(value: unknown): string | null {
  const result = ModelBridgeResponseIdentityContract.parse(value);
  return result.ok ? result.value.requestId : null;
}

function modelRequestBudgetIssues(
  request: SerializableModelRequest,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!jsonSizeWithin(request.tools, MAX_MODEL_TOOLS_BYTES)) {
    issues.push(
      bridgeIssue(
        "model_bridge_request.tools_too_large",
        "/request/tools",
        `Tool definitions exceed the ${MAX_MODEL_TOOLS_BYTES} byte aggregate limit`,
      ),
    );
  }
  request.tools.forEach((tool, index) => {
    if (!jsonSizeWithin(tool.inputSchema, MAX_MODEL_TOOL_SCHEMA_BYTES)) {
      issues.push(
        bridgeIssue(
          "model_bridge_request.tool_schema_too_large",
          `/request/tools/${index}/inputSchema`,
          `Tool schema exceeds the ${MAX_MODEL_TOOL_SCHEMA_BYTES} byte limit`,
        ),
      );
    }
  });
  request.messages.forEach((message, messageIndex) => {
    if (message.role === "user") {
      if (typeof message.content === "string") return;
      message.content.forEach((block, blockIndex) => {
        if (block.type === "image") {
          issues.push(
            bridgeIssue(
              "model_bridge_request.inline_image_forbidden",
              `/request/messages/${messageIndex}/content/${blockIndex}`,
              "Agent utility requests must use a content-addressed image_ref instead of inline image data",
            ),
          );
          return;
        }
        if (block.type === "text") return;
        const allowed =
          block.type === "image_ref"
            ? MODEL_IMAGE_REFERENCE_MIME_TYPES.has(block.mimeType)
            : MODEL_DOCUMENT_REFERENCE_MIME_TYPES.has(block.mimeType);
        if (!allowed) {
          issues.push(
            bridgeIssue(
              "model_bridge_request.attachment_mime_invalid",
              `/request/messages/${messageIndex}/content/${blockIndex}/mimeType`,
              `Attachment MIME type ${JSON.stringify(block.mimeType)} does not match ${block.type}`,
            ),
          );
        }
      });
      return;
    }
    if (message.role === "tool") {
      if (!jsonSizeWithin(message.content, MAX_MODEL_CONTENT_BYTES)) {
        issues.push(
          bridgeIssue(
            "model_bridge_request.tool_content_too_large",
            `/request/messages/${messageIndex}/content`,
            `Tool content exceeds the ${MAX_MODEL_CONTENT_BYTES} byte limit`,
          ),
        );
      }
      return;
    }
    if (message.role !== "assistant") return;
    message.blocks.forEach((block, blockIndex) => {
      if (
        block.type === "tool_call" &&
        !jsonSizeWithin(block.input, MAX_MODEL_CONTENT_BYTES)
      ) {
        issues.push(
          bridgeIssue(
            "model_bridge_request.tool_input_too_large",
            `/request/messages/${messageIndex}/blocks/${blockIndex}/input`,
            `Tool-call input exceeds the ${MAX_MODEL_CONTENT_BYTES} byte limit`,
          ),
        );
      }
    });
  });
  return issues;
}

function modelEventBudgetIssues(
  event: CanonicalStreamEvent,
): ValidationIssue[] {
  if (
    event.type !== "block.completed" ||
    event.block.type !== "tool_call" ||
    jsonSizeWithin(event.block.input, MAX_MODEL_CONTENT_BYTES)
  ) {
    return [];
  }
  return [
    bridgeIssue(
      "model_bridge_response.tool_input_too_large",
      "/event/block/input",
      `Completed tool-call input exceeds the ${MAX_MODEL_CONTENT_BYTES} byte limit`,
    ),
  ];
}

function jsonSizeWithin(value: unknown, maximum: number): boolean {
  try {
    return JSON.stringify(value).length <= maximum;
  } catch {
    return false;
  }
}

function bridgeIssue(
  code: string,
  path: string,
  message: string,
): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery:
      "Reject the malformed model bridge payload and resend one value produced by the authoritative canonical wire contract.",
  };
}
