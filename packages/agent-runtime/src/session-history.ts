import {
  isAgentToolFailureDetails,
  isSessionTimelineItem,
  type AssistantTimelineBlock,
  type SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { normalizeAssistantTimelineBlocks } from "./timeline-blocks.js";

export function normalizeSessionHistory(
  timeline: readonly unknown[],
): SessionTimelineItem[] {
  return timeline.map((item, index) => {
    const normalized = normalizeItem(item);
    if (!isSessionTimelineItem(normalized)) {
      throw new TypeError(
        `Session history item ${index} (${itemType(item)}) is incompatible with the current Agent protocol`,
      );
    }
    return normalized;
  });
}

function normalizeItem(item: unknown): unknown {
  if (!isRecord(item)) return item;
  if (item.type === "assistant.message" && Array.isArray(item.blocks)) {
    return {
      ...item,
      blocks: normalizeAssistantTimelineBlocks(
        item.blocks as AssistantTimelineBlock[],
      ),
    };
  }
  if (
    item.type === "tool" &&
    isRecord(item.error) &&
    item.error.details !== undefined &&
    !isAgentToolFailureDetails(item.error.details)
  ) {
    const error = { ...item.error };
    delete error.details;
    return { ...item, error };
  }
  return item;
}

function itemType(value: unknown): string {
  return isRecord(value) && typeof value.type === "string"
    ? value.type.slice(0, 128)
    : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
