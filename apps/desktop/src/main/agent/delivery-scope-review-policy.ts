import type { AgentRequest } from "@opendesign/agent-contracts";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

const LONG_BRIEF_CHARACTERS = 2_000;
const MINIMUM_STRUCTURED_ITEMS = 4;
const MINIMUM_EXPLICIT_DELIVERABLES = 4;

/**
 * Long product briefs need a user-visible delivery scope before canvas work.
 * This policy only selects the planning UX; it grants no capability and does
 * not infer targets. Small requests remain direct.
 */
export function resolveDeliveryScopeReview(
  request: Readonly<RunStartRequest>,
): "direct" | "required" {
  if (request.continuation !== undefined) return "direct";
  if (
    request.attachments?.some((attachment) =>
      attachment.attachmentId.startsWith("file_"),
    )
  ) {
    return "required";
  }
  const prompt = request.prompt.trim();
  if (prompt.length >= LONG_BRIEF_CHARACTERS) return "required";
  if (structuredBriefItemCount(prompt) >= MINIMUM_STRUCTURED_ITEMS) {
    return "required";
  }
  return explicitDeliverableCount(prompt) >= MINIMUM_EXPLICIT_DELIVERABLES
    ? "required"
    : "direct";
}

function structuredBriefItemCount(prompt: string): number {
  return prompt
    .split(/\r?\n/u)
    .filter((line) => /^\s*(?:[-*•]|\d+[.)、])\s*\S/u.test(line)).length;
}

function explicitDeliverableCount(prompt: string): number {
  const matches = prompt.matchAll(
    /(?:\b(\d{1,2})\s+(?:pages?|screens?|views?|artboards?|directions?)\b|([一二三四五六七八九十两]{1,3}|\d{1,2})\s*个?(?:页面|界面|画板|方向|方案))/giu,
  );
  let maximum = 0;
  for (const match of matches) {
    const value = match[1] ?? match[2];
    maximum = Math.max(maximum, parseCount(value));
  }
  return maximum;
}

function parseCount(value: string | undefined): number {
  if (!value) return 0;
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric)) return numeric;
  const simple = new Map([
    ["一", 1],
    ["二", 2],
    ["两", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6],
    ["七", 7],
    ["八", 8],
    ["九", 9],
    ["十", 10],
  ]);
  if (simple.has(value)) return simple.get(value) ?? 0;
  const ten = value.indexOf("十");
  if (ten < 0) return 0;
  const tens = ten === 0 ? 1 : (simple.get(value.slice(0, ten)) ?? 0);
  const ones =
    ten === value.length - 1 ? 0 : (simple.get(value.slice(ten + 1)) ?? 0);
  return tens * 10 + ones;
}
