import { createHash } from "node:crypto";
import {
  isAgentAttachment,
  type AgentToolFailureIssue,
  type TrustedToolFailure,
  type TrustedToolResult,
  type ToolRisk,
} from "@opendesign/agent-contracts";
import type { AgentRunRequest } from "./run-request.js";
import type { AgentToolDefinition } from "./runtime-ports.js";
import type { toolResultAttachments } from "./tool-execution-semantics.js";

export const TOOL_RESULT_KIND = "opendesign.tool-result";
export const TOOL_PROGRESS_KIND = "opendesign.tool-progress";

export interface PiToolSuccessDetails {
  kind: typeof TOOL_RESULT_KIND;
  version: 1;
  content: unknown;
  attachments: ReturnType<typeof toolResultAttachments>;
  observedRevision?: number;
  designRevision?: NonNullable<TrustedToolResult["designRevision"]>;
}

export interface PiToolProgressDetails {
  kind: typeof TOOL_PROGRESS_KIND;
  version: 1;
  message: string;
  progress: number;
}

export function readProgressDetails(value: unknown): PiToolProgressDetails {
  const details = readResultDetails(value);
  if (
    details.kind !== TOOL_PROGRESS_KIND ||
    details.version !== 1 ||
    typeof details.message !== "string" ||
    details.message.length > 20_000 ||
    typeof details.progress !== "number" ||
    !Number.isFinite(details.progress) ||
    details.progress < 0 ||
    details.progress > 1
  ) {
    throw new Error("Pi tool update has invalid OpenDesign progress details");
  }
  return details as unknown as PiToolProgressDetails;
}

export function readSuccessDetails(value: unknown): PiToolSuccessDetails {
  const details = readResultDetails(value);
  if (
    details.kind !== TOOL_RESULT_KIND ||
    details.version !== 1 ||
    !Array.isArray(details.attachments) ||
    !details.attachments.every(isAgentAttachment)
  ) {
    throw new Error("Pi tool result has invalid OpenDesign completion details");
  }
  return details as unknown as PiToolSuccessDetails;
}

export function inferPiToolFailure(
  active: { budgetExceeded: boolean; toolName: string },
  result: unknown,
): TrustedToolFailure {
  const message = toolResultErrorText(result);
  if (active.budgetExceeded) {
    return failure("tool_budget_exceeded", message, false);
  }
  if (
    !active.toolName.startsWith("opendesign_") ||
    message.includes("not found")
  ) {
    return failure("unknown_tool", message, false);
  }
  if (message.includes("output token limit")) {
    return failure("truncated_tool_call", message, true);
  }
  if (message.toLowerCase().includes("abort")) {
    return failure("run_cancelled", message, false);
  }
  return failure("invalid_tool_input", message, true);
}

export function toolValidationFailure(
  definition: AgentToolDefinition,
  input: unknown,
): TrustedToolFailure | undefined {
  const issues = definition.validateInputIssues(input).slice(0, 128);
  return issues.length > 0
    ? invalidInputFailure(definition, issues)
    : undefined;
}

export function modelResultText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "null");
}

export function modelFailureText(failure: TrustedToolFailure): string {
  return JSON.stringify({ ok: false, error: failure });
}

export function resolveApprovalPrompt(
  prompt: AgentToolDefinition["approvalPrompt"],
  input: unknown,
  request: Readonly<AgentRunRequest>,
  toolName: string,
  risk: ToolRisk,
): { title: string; summary: string } {
  const resolved =
    typeof prompt === "function"
      ? prompt(input, request)
      : (prompt ?? {
          title: `Allow ${toolName}`,
          summary: `Allow this ${risk} tool for the current run scope.`,
        });
  if (
    typeof resolved.title !== "string" ||
    resolved.title.length < 1 ||
    resolved.title.length > 2_000 ||
    typeof resolved.summary !== "string" ||
    resolved.summary.length > 20_000
  ) {
    throw new TypeError(`Tool ${toolName} produced an invalid approval prompt`);
  }
  return resolved;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Tool execution failed";
}

function readResultDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pi tool result is not an object");
  }
  const details = (value as { details?: unknown }).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw new Error("Pi tool result does not contain structured details");
  }
  return details as Record<string, unknown>;
}

function failure(
  code: string,
  message: string,
  recoverable: boolean,
): TrustedToolFailure {
  return { code, message, retryable: false, recoverable };
}

function invalidInputFailure(
  definition: AgentToolDefinition,
  issues: readonly AgentToolFailureIssue[],
): TrustedToolFailure {
  const explanation = validationIssuesMessage(definition.name, issues);
  const base = failure(
    "invalid_tool_input",
    explanation.length <= 20_000
      ? explanation
      : `The ${definition.name} arguments do not match its schema. Review the tool parameters and submit a corrected call.`,
    true,
  );
  return {
    ...base,
    details: {
      kind: "tool-validation",
      fingerprint: validationFingerprint(definition.name, issues),
      issues: issues.map((issue) => structuredClone(issue)),
      recovery: { action: "correct-and-retry", required: false },
    },
  };
}

function validationIssuesMessage(
  toolName: string,
  issues: readonly AgentToolFailureIssue[],
): string {
  const detail = issues
    .slice(0, 8)
    .map((issue) => {
      const code = issue.code ? `${issue.code} ` : "";
      const path = issue.path || "/";
      return `${code}at ${path}: ${issue.message}${issue.recovery ? `. ${issue.recovery}` : ""}`;
    })
    .join(" ");
  return `Invalid ${toolName} input. ${detail}`.slice(0, 20_000);
}

function validationFingerprint(
  toolName: string,
  issues: readonly { code?: string; path: string }[],
): string {
  const canonical = issues
    .map((issue) => `${issue.code ?? "invalid"}:${issue.path}`)
    .sort()
    .join("|");
  return `validation_${createHash("sha256")
    .update(toolName)
    .update("\0")
    .update(canonical)
    .digest("hex")
    .slice(0, 16)}`;
}

function toolResultErrorText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Tool call failed";
  }
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return "Tool call failed";
  const text = content
    .flatMap((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        return [];
      }
      const candidate = block as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string"
        ? [candidate.text]
        : [];
    })
    .join("\n");
  return text.length > 0 ? text : "Tool call failed";
}
