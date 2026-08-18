import {
  MAX_ASSISTANT_TEXT_BLOCK_CHARACTERS,
  MAX_REASONING_SUMMARY_CHARACTERS,
  type AssistantTimelineBlock,
} from "@opendesign/agent-contracts";
import { createHash } from "node:crypto";

const MAX_TIMELINE_BLOCKS = 1_024;
const MAX_PROTOCOL_ID_CHARACTERS = 256;

export function normalizeAssistantTimelineBlocks(
  blocks: readonly AssistantTimelineBlock[],
): AssistantTimelineBlock[] {
  const normalized = blocks.flatMap<AssistantTimelineBlock>((block) => {
    if (block.type === "text") {
      return splitText(block.text, MAX_ASSISTANT_TEXT_BLOCK_CHARACTERS).map(
        (text, part) => ({
          blockId: partBlockId(block.blockId, part),
          type: "text" as const,
          text,
        }),
      );
    }
    if (block.summary === undefined) {
      return [{ ...block, blockId: boundedProtocolId(block.blockId) }];
    }
    return splitText(block.summary, MAX_REASONING_SUMMARY_CHARACTERS).map(
      (summary, part) => ({
        blockId: partBlockId(block.blockId, part),
        type: "reasoning_summary" as const,
        status: block.status,
        summary,
      }),
    );
  });
  if (normalized.length > MAX_TIMELINE_BLOCKS) {
    throw new RangeError(
      `Assistant message requires ${normalized.length} timeline blocks; maximum is ${MAX_TIMELINE_BLOCKS}`,
    );
  }
  return normalized;
}

function splitText(value: string, maximum: number): string[] {
  if (value.length <= maximum) return [value];
  const parts: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + maximum);
    if (
      end < value.length &&
      isHighSurrogate(value.charCodeAt(end - 1)) &&
      isLowSurrogate(value.charCodeAt(end))
    ) {
      end -= 1;
    }
    parts.push(value.slice(start, end));
    start = end;
  }
  return parts;
}

function partBlockId(blockId: string, part: number): string {
  return boundedProtocolId(part === 0 ? blockId : `${blockId}_part_${part}`);
}

function boundedProtocolId(value: string): string {
  if (value.length <= MAX_PROTOCOL_ID_CHARACTERS) return value;
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${value.slice(0, MAX_PROTOCOL_ID_CHARACTERS - digest.length - 1)}_${digest}`;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}
