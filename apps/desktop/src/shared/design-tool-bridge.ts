import {
  isToolCallRequest,
  isTrustedToolContext,
  isTrustedToolFailure,
  isTrustedToolResult,
  type ToolCallRequest,
  type TrustedToolContext,
  type TrustedToolFailure,
  type TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  isDesignTargetQualityProfile,
  type DesignTargetQualityProfile,
} from "./design-plan-quality-profile";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  isPreparedImageEditSource,
  isPreparedAgentRasterExport,
  validateDesignAgentToolInput,
} from "./design-agent-tools";

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

export function isRendererDesignToolRequest(
  value: unknown,
): value is RendererDesignToolRequest {
  if (
    !record(value) ||
    !safeId(value.requestId) ||
    !isToolCallRequest(value.call, validateDesignAgentToolInput) ||
    !isTrustedToolContext(value.context) ||
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

export function rendererDesignToolRequestId(value: unknown): string | null {
  return record(value) && safeId(value.requestId) ? value.requestId : null;
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
      ["requestId", "phase", "progress", "message"].includes(key),
    ) &&
    (value.message === undefined || safeText(value.message, 2_000))
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
  if (
    value.performance !== undefined &&
    !isRendererDesignToolPerformance(value.performance)
  ) {
    return false;
  }
  return value.ok
    ? isRendererTrustedToolResult(value.result) &&
        Object.keys(value).every((key) =>
          ["requestId", "ok", "result", "performance"].includes(key),
        )
    : isTrustedToolFailure(value.error) &&
        Object.keys(value).every((key) =>
          ["requestId", "ok", "error", "performance"].includes(key),
        );
}

function isRendererDesignToolPerformance(
  value: unknown,
): value is RendererDesignToolPerformance {
  return (
    record(value) &&
    boundedPerformanceInteger(value.canvasWaitCount, 10_000) &&
    boundedPerformanceInteger(value.canvasWaitMs, 86_400_000) &&
    boundedPerformanceInteger(value.configuredStageDelayMs, 86_400_000) &&
    Object.keys(value).every((key) =>
      ["canvasWaitCount", "canvasWaitMs", "configuredStageDelayMs"].includes(
        key,
      ),
    )
  );
}

function boundedPerformanceInteger(value: unknown, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximum
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
    (value.qualityProfile === undefined ||
      isDesignTargetQualityProfile(value.qualityProfile)) &&
    Object.keys(value).every((key) =>
      ["kind", "pageId", "nodeId", "qualityProfile"].includes(key),
    )
  );
}

function isRendererTrustedToolResult(
  value: unknown,
): value is TrustedToolResult {
  if (!record(value)) return false;
  if (
    !isPreparedAgentRasterExport(value.content) &&
    !isPreparedImageEditSource(value.content)
  ) {
    return isTrustedToolResult(value);
  }
  return isTrustedToolResult({ ...value, content: null });
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
