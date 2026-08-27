import {
  isAgentAttachment,
  type AgentAttachment,
  type SelectionScope,
  type TrustedToolContext,
  type TrustedToolResult,
} from "@opendesign/agent-contracts";
import type { AgentRunRequest } from "./run-request.js";

const MAX_MODEL_TOOL_RESULT_STRING_CHARACTERS = 16_000;
const MAX_MODEL_TOOL_RESULT_CHARACTERS = 50_000;
const MAX_MODEL_TOOL_RESULT_EXCERPT_CHARACTERS = 32_000;

export function projectToolResultForModel(value: unknown): unknown {
  const projected = projectToolResultValue(value);
  const projectedCharacters = jsonCharacterLength(projected);
  if (projectedCharacters <= MAX_MODEL_TOOL_RESULT_CHARACTERS) return projected;
  const excerpt = JSON.stringify(projected).slice(
    0,
    MAX_MODEL_TOOL_RESULT_EXCERPT_CHARACTERS,
  );
  const workflow = workflowProjection(projected);
  return {
    notice: `[OpenDesign omitted part of an oversized structured tool result (${projectedCharacters} projected characters; model projection limit ${MAX_MODEL_TOOL_RESULT_CHARACTERS})]`,
    summary: summarizeToolResultValue(projected),
    excerpt,
    ...workflow,
  };
}

export function toolResultAttachments(content: unknown): AgentAttachment[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return [];
  }
  const attachments = (content as { attachments?: unknown }).attachments;
  return Array.isArray(attachments)
    ? attachments.filter(isAgentAttachment)
    : [];
}

export function createTrustedToolContext(
  request: AgentRunRequest,
  revision: number,
): TrustedToolContext {
  const scope = Object.freeze({
    ...request.scope,
    selectedNodeIds: Object.freeze([...request.scope.selectedNodeIds]),
  }) as unknown as SelectionScope;
  return Object.freeze({
    runId: request.runId,
    sessionId: request.sessionId,
    documentId: request.documentId,
    revision,
    scope,
    mutationTarget: Object.freeze({ ...request.mutationTarget }),
  });
}

export function validateDesignRevision(
  revision: TrustedToolResult["designRevision"],
  currentRevision: number,
): TrustedToolResult["designRevision"] {
  if (revision === undefined) return undefined;
  const validRebase =
    revision.previousRevision > currentRevision &&
    revision.rebasedFromRevision === currentRevision;
  if (
    (revision.previousRevision !== currentRevision && !validRebase) ||
    (revision.rebasedFromRevision !== undefined && !validRebase) ||
    !Number.isInteger(revision.revision) ||
    revision.revision <= revision.previousRevision ||
    revision.transactionId.length === 0
  ) {
    throw new RangeError("Tool returned an invalid design revision transition");
  }
  return revision;
}

export function validateObservedRevision(
  revision: TrustedToolResult["observedRevision"],
  currentRevision: number,
): number | undefined {
  if (revision === undefined) return undefined;
  if (!Number.isInteger(revision) || revision < currentRevision) {
    throw new RangeError("Tool returned an invalid observed design revision");
  }
  return revision;
}

function projectToolResultValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_MODEL_TOOL_RESULT_STRING_CHARACTERS) return value;
    return `[OpenDesign omitted ${value.length} characters from an oversized tool-result field]`;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth >= 32) return "[OpenDesign omitted deeply nested tool result]";
  if (Array.isArray(value)) {
    return value.map((item) => projectToolResultValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (isFirstSliceCheckpointResult(value)) {
      return projectRecordValue(compactFirstSliceResult(value), depth);
    }
    if (isDesignChangeSetResult(value)) {
      return projectToolResultValue(compactDesignChangeSet(value), depth + 1);
    }
    return projectRecordValue(value as Record<string, unknown>, depth);
  }
  return `[OpenDesign omitted unsupported ${typeof value} tool-result value]`;
}

function projectRecordValue(
  value: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      projectToolResultValue(child, depth + 1),
    ]),
  );
}

function isFirstSliceCheckpointResult(
  value: object,
): value is Record<string, unknown> {
  const record = value as Record<string, unknown>;
  return (
    isRecord(record.checkpoint) &&
    record.checkpoint.action === "first-slice-and-capture"
  );
}

function compactFirstSliceResult(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const plan = isRecord(value.plan) ? value.plan : undefined;
  const targets = Array.isArray(plan?.targets)
    ? plan.targets.flatMap((target) =>
        isRecord(target)
          ? [
              {
                targetId: target.targetId,
                label: target.label,
                pageId: target.pageId,
                artboard: target.artboard,
                regions: isRecord(target.composition)
                  ? target.composition.regions
                  : undefined,
              },
            ]
          : [],
      )
    : [];
  const layoutQuality = isRecord(value.layoutQuality)
    ? {
        version: value.layoutQuality.version,
        revision: value.layoutQuality.revision,
        artboardFrameId: value.layoutQuality.artboardFrameId,
        errorCount: value.layoutQuality.errorCount,
        warningCount: value.layoutQuality.warningCount,
        issues: Array.isArray(value.layoutQuality.issues)
          ? value.layoutQuality.issues.slice(0, 12)
          : [],
      }
    : undefined;
  return {
    ok: value.ok,
    status: value.status,
    label: value.label,
    revision: value.revision,
    committedSteps: value.committedSteps,
    plan: plan
      ? {
          version: plan.version,
          deliverable: plan.deliverable,
          objective: plan.objective,
          outputMode: plan.outputMode,
          targets,
          rasterAssetRoles: plan.rasterAssetRoles,
          logoOutputs: plan.logoOutputs,
          logoExploration: plan.logoExploration,
        }
      : undefined,
    allocation: value.allocation,
    firstSlice: value.firstSlice,
    delivery: value.delivery,
    captureTarget: value.captureTarget,
    layoutQuality,
    reviewWorkflow: value.reviewWorkflow,
    checkpoint: value.checkpoint,
    warnings: value.warnings,
    attachment: value.attachment,
    attachments: value.attachments,
  };
}

function compactDesignChangeSet(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const detailCounts = Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      (key === "changes" || key.endsWith("Changes")) && Array.isArray(child)
        ? [[key, child.length]]
        : [],
    ),
  );
  return {
    ...Object.fromEntries(
      Object.entries(value).filter(
        ([key]) => key !== "changes" && !key.endsWith("Changes"),
      ),
    ),
    changeDetailsOmitted: detailCounts,
  };
}

function isDesignChangeSetResult(
  value: object,
): value is Record<string, unknown> {
  const record = value as Record<string, unknown>;
  return (
    typeof record.documentId === "string" &&
    Number.isInteger(record.fromRevision) &&
    Number.isInteger(record.toRevision) &&
    Array.isArray(record.addedNodeIds) &&
    Array.isArray(record.changedNodeIds) &&
    Array.isArray(record.removedNodeIds) &&
    Array.isArray(record.changes)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeToolResultValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const normalized = value.replaceAll(/\s+/g, " ").trim();
    return normalized.length <= 240
      ? normalized
      : `${normalized.slice(0, 240)}…`;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth >= 3) {
    if (Array.isArray(value)) return { itemCount: value.length };
    if (typeof value === "object") {
      return { keys: Object.keys(value).slice(0, 12) };
    }
    return `[omitted ${typeof value}]`;
  }
  if (Array.isArray(value)) {
    return {
      itemCount: value.length,
      sample: value
        .slice(0, 3)
        .map((item) => summarizeToolResultValue(item, depth + 1)),
    };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([key, child]) => [
          key,
          summarizeToolResultValue(child, depth + 1),
        ]),
    );
  }
  return `[omitted ${typeof value}]`;
}

function jsonCharacterLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function workflowProjection(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(record.delivery === undefined ? {} : { delivery: record.delivery }),
    ...(record.unfinishedDelivery === undefined
      ? {}
      : { unfinishedDelivery: record.unfinishedDelivery }),
  };
}
