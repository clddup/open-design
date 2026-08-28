import {
  ToolCallRequestSchema,
  TrustedToolContextSchema,
  TrustedToolContextContract,
  TrustedToolFailureSchema,
  TrustedToolFailureContract,
  TrustedToolResultSchema,
  TrustedToolResultContract,
  type AgentToolFailureIssue,
  type ToolCallRequest,
  type TrustedToolContext,
  type TrustedToolFailure,
  type TrustedToolResult,
} from "@opendesign/agent-contracts";
import { executableJsonSchema } from "@opendesign/design-contracts";
import { Type, type TSchema } from "@sinclair/typebox";
import {
  DESIGN_TARGET_QUALITY_PROFILE_SCHEMA,
  type DesignTargetQualityProfile,
} from "./design-plan-quality-profile";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  isPreparedImageEditSource,
  isPreparedAgentRasterExport,
  rendererDesignToolInputIssues,
} from "./design-agent-tools";
import { defineContract, type ValidationIssue } from "./contract-validation";

const RendererBridgeIdSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const RendererDesignTargetQualityProfileSchema: TSchema =
  DESIGN_TARGET_QUALITY_PROFILE_SCHEMA;
const RendererDesignCaptureTargetSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("page"),
      pageId: RendererBridgeIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("frame"),
      pageId: RendererBridgeIdSchema,
      nodeId: RendererBridgeIdSchema,
      qualityProfile: Type.Optional(RendererDesignTargetQualityProfileSchema),
    },
    { additionalProperties: false },
  ),
]);
const RendererDesignToolRequestSchema = executableJsonSchema(
  Type.Object(
    {
      requestId: RendererBridgeIdSchema,
      call: ToolCallRequestSchema,
      context: TrustedToolContextSchema,
      captureTarget: Type.Optional(RendererDesignCaptureTargetSchema),
    },
    { additionalProperties: false },
  ),
);
const RendererDesignToolCancelSchema = Type.Object(
  { requestId: RendererBridgeIdSchema },
  { additionalProperties: false },
);
const RendererDesignToolProgressSchema = Type.Object(
  {
    requestId: RendererBridgeIdSchema,
    phase: Type.Union([
      Type.Literal("accepted"),
      Type.Literal("applying"),
      Type.Literal("capturing"),
      Type.Literal("persisting"),
    ]),
    progress: Type.Number({ minimum: 0, maximum: 1 }),
    message: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
  },
  { additionalProperties: false },
);
const RendererDesignToolPerformanceSchema = Type.Object(
  {
    canvasWaitCount: Type.Integer({ minimum: 0, maximum: 10_000 }),
    canvasWaitMs: Type.Integer({ minimum: 0, maximum: 86_400_000 }),
    configuredStageDelayMs: Type.Integer({
      minimum: 0,
      maximum: 86_400_000,
    }),
  },
  { additionalProperties: false },
);
const RendererDesignToolResponseSchema = Type.Union([
  Type.Object(
    {
      requestId: RendererBridgeIdSchema,
      ok: Type.Literal(true),
      result: TrustedToolResultSchema,
      performance: Type.Optional(RendererDesignToolPerformanceSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      requestId: RendererBridgeIdSchema,
      ok: Type.Literal(false),
      error: TrustedToolFailureSchema,
      performance: Type.Optional(RendererDesignToolPerformanceSchema),
    },
    { additionalProperties: false },
  ),
]);
const RendererBridgeRequestIdentitySchema = Type.Object(
  { requestId: RendererBridgeIdSchema },
  { additionalProperties: true },
);

export type RendererDesignToolRequest = {
  requestId: string;
  call: ToolCallRequest;
  context: TrustedToolContext;
  captureTarget?: RendererDesignCaptureTarget;
};

export type RendererDesignCaptureTarget =
  | { kind: "page"; pageId: string }
  | {
      kind: "frame";
      pageId: string;
      nodeId: string;
      qualityProfile?: DesignTargetQualityProfile;
    };

export type RendererDesignToolCancel = {
  requestId: string;
};

export type RendererDesignToolProgressPhase =
  "accepted" | "applying" | "capturing" | "persisting";

export type RendererDesignToolProgress = {
  requestId: string;
  phase: RendererDesignToolProgressPhase;
  progress: number;
  message?: string;
};

export type RendererDesignToolPerformance = {
  canvasWaitCount: number;
  canvasWaitMs: number;
  configuredStageDelayMs: number;
};

export type RendererDesignToolResponse =
  | {
      requestId: string;
      ok: true;
      result: TrustedToolResult;
      performance?: RendererDesignToolPerformance;
    }
  | {
      requestId: string;
      ok: false;
      error: TrustedToolFailure;
      performance?: RendererDesignToolPerformance;
    };

export const RendererDesignToolRequestContract =
  defineContract<RendererDesignToolRequest>({
    schema: RendererDesignToolRequestSchema,
    code: "renderer_design_tool_request.schema_invalid",
    subject: "Renderer design tool request",
    clone: false,
    refine: (value) => {
      const issues: ValidationIssue[] = [
        ...rendererToolInputValidationIssues(
          value.call.toolName,
          value.call.input,
        ),
        ...prefixIssues(
          TrustedToolContextContract.issues(value.context),
          "/context",
        ),
      ];
      if (
        value.call.toolName === DESIGN_CAPTURE_TOOL_NAME
          ? value.captureTarget === undefined
          : value.captureTarget !== undefined
      ) {
        issues.push(
          bridgeIssue(
            "renderer_design_tool_request.capture_target_invalid",
            "/captureTarget",
            value.call.toolName === DESIGN_CAPTURE_TOOL_NAME
              ? "Canvas capture requires one Main-selected Page or Frame target"
              : "Only canvas capture may carry a capture target",
          ),
        );
      }
      return issues;
    },
  });

export const RendererDesignToolCancelContract =
  defineContract<RendererDesignToolCancel>({
    schema: RendererDesignToolCancelSchema,
    code: "renderer_design_tool_cancel.schema_invalid",
    subject: "Renderer design tool cancel",
    clone: false,
  });

export const RendererDesignToolProgressContract =
  defineContract<RendererDesignToolProgress>({
    schema: RendererDesignToolProgressSchema,
    code: "renderer_design_tool_progress.schema_invalid",
    subject: "Renderer design tool progress",
    clone: false,
  });

export const RendererDesignToolResponseContract =
  defineContract<RendererDesignToolResponse>({
    schema: RendererDesignToolResponseSchema,
    code: "renderer_design_tool_response.schema_invalid",
    subject: "Renderer design tool response",
    clone: false,
    selectSchema: rendererResponseSchemaForInput,
    refine: (value) => {
      return value.ok
        ? prefixIssues(rendererTrustedToolResultIssues(value.result), "/result")
        : prefixIssues(
            TrustedToolFailureContract.issues(value.error),
            "/error",
          );
    },
  });

const RendererBridgeRequestIdentityContract = defineContract<{
  requestId: string;
}>({
  schema: RendererBridgeRequestIdentitySchema,
  code: "renderer_design_tool_request_id.schema_invalid",
  subject: "Renderer design tool request ID",
  clone: false,
});

export function isRendererDesignToolRequest(
  value: unknown,
): value is RendererDesignToolRequest {
  return RendererDesignToolRequestContract.parse(value).ok;
}

export function rendererDesignToolRequestId(value: unknown): string | null {
  const result = RendererBridgeRequestIdentityContract.parse(value);
  return result.ok ? result.value.requestId : null;
}

export function isRendererDesignToolCancel(
  value: unknown,
): value is RendererDesignToolCancel {
  return RendererDesignToolCancelContract.parse(value).ok;
}

export function isRendererDesignToolProgress(
  value: unknown,
): value is RendererDesignToolProgress {
  return RendererDesignToolProgressContract.parse(value).ok;
}

export function isRendererDesignToolResponse(
  value: unknown,
): value is RendererDesignToolResponse {
  return RendererDesignToolResponseContract.parse(value).ok;
}

function rendererTrustedToolResultIssues(
  value: TrustedToolResult,
): ValidationIssue[] {
  const content = value.content;
  if (
    !isPreparedAgentRasterExport(content) &&
    !isPreparedImageEditSource(content)
  ) {
    return TrustedToolResultContract.issues(value);
  }
  return TrustedToolResultContract.issues({ ...value, content: null });
}

function rendererToolInputValidationIssues(
  toolName: string,
  input: unknown,
): ValidationIssue[] {
  return rendererDesignToolInputIssues(toolName, input).map((issue) =>
    inputIssue(issue, "/call/input"),
  );
}

function inputIssue(
  issue: AgentToolFailureIssue,
  prefix: string,
): ValidationIssue {
  return {
    code: issue.code ?? "renderer_design_tool_request.input_invalid",
    path: issue.path === "/" ? prefix : `${prefix}${issue.path}`,
    message: issue.message,
    ...(issue.expected === undefined ? {} : { expected: issue.expected }),
    ...(issue.actual === undefined ? {} : { actual: issue.actual }),
    recovery:
      issue.recovery ??
      "Correct the reported tool input field before retrying.",
  };
}

function rendererResponseSchemaForInput(value: unknown): TSchema | undefined {
  if (!isRecord(value) || typeof value.ok !== "boolean") return undefined;
  return RendererDesignToolResponseSchema.anyOf.find((schema) => {
    const properties = isRecord(schema) ? schema.properties : undefined;
    const ok = isRecord(properties) ? properties.ok : undefined;
    return isRecord(ok) && ok.const === value.ok;
  });
}

function prefixIssues(
  issues: readonly ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path === "/" ? prefix : `${prefix}${issue.path}`,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
      "Reject the malformed bridge payload and resend one value produced by the authoritative Renderer design-tool contract.",
  };
}
