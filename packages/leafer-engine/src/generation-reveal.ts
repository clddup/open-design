export const GENERATION_REVEAL_LEAD_MS = 80;
export const GENERATION_REVEAL_WIREFRAME_MS = 140;
export const GENERATION_REVEAL_FADE_MS = 180;

const GENERATION_REVEAL_TARGET_SPAN_MS = 1_600;
const GENERATION_REVEAL_MIN_STAGGER_MS = 32;
const GENERATION_REVEAL_MAX_STAGGER_MS = 140;
const GENERATION_REVEAL_MAX_BEATS = 48;

export interface ScheduledGenerationReveal {
  fadeEndsAt: number;
  nodeId: string;
  startsAt: number;
  wireframeEndsAt: number;
}

export type GenerationRevealPaintState =
  | { phase: "pending"; nodeOpacity: 0; overlayOpacity: 0 }
  | { phase: "wireframe"; nodeOpacity: 0; overlayOpacity: 1 }
  | {
      phase: "fading";
      nodeOpacity: number;
      overlayOpacity: number;
    }
  | { phase: "done"; nodeOpacity: 1; overlayOpacity: 0 };

export function scheduleGenerationReveals(
  nodeIds: readonly string[],
  requestedStartAt: number,
  nextAvailableStartAt: number | null,
): {
  items: ScheduledGenerationReveal[];
  nextAvailableStartAt: number | null;
} {
  const uniqueNodeIds = [...new Set(nodeIds)];
  if (uniqueNodeIds.length === 0) {
    return { items: [], nextAvailableStartAt };
  }
  const beatCount = Math.min(uniqueNodeIds.length, GENERATION_REVEAL_MAX_BEATS);
  const stagger = generationRevealStagger(beatCount);
  const firstStart = Math.max(
    finiteTime(requestedStartAt) + GENERATION_REVEAL_LEAD_MS,
    nextAvailableStartAt ?? Number.NEGATIVE_INFINITY,
  );
  const items = uniqueNodeIds.map((nodeId, index) => {
    const beatIndex = Math.min(
      beatCount - 1,
      Math.floor((index * beatCount) / uniqueNodeIds.length),
    );
    const startsAt = firstStart + beatIndex * stagger;
    const wireframeEndsAt = startsAt + GENERATION_REVEAL_WIREFRAME_MS;
    return {
      nodeId,
      startsAt,
      wireframeEndsAt,
      fadeEndsAt: wireframeEndsAt + GENERATION_REVEAL_FADE_MS,
    };
  });
  return {
    items,
    nextAvailableStartAt: items.at(-1)!.startsAt + stagger,
  };
}

export function generationRevealPaintState(
  item: ScheduledGenerationReveal,
  now: number,
): GenerationRevealPaintState {
  if (now < item.startsAt) {
    return { phase: "pending", nodeOpacity: 0, overlayOpacity: 0 };
  }
  if (now < item.wireframeEndsAt) {
    return { phase: "wireframe", nodeOpacity: 0, overlayOpacity: 1 };
  }
  if (now < item.fadeEndsAt) {
    const linear =
      (now - item.wireframeEndsAt) /
      Math.max(1, item.fadeEndsAt - item.wireframeEndsAt);
    const eased = easeOutCubic(linear);
    return {
      phase: "fading",
      nodeOpacity: eased,
      overlayOpacity: 1 - eased,
    };
  }
  return { phase: "done", nodeOpacity: 1, overlayOpacity: 0 };
}

export function generationRevealStagger(nodeCount: number): number {
  if (nodeCount <= 1) return GENERATION_REVEAL_MAX_STAGGER_MS;
  return Math.max(
    GENERATION_REVEAL_MIN_STAGGER_MS,
    Math.min(
      GENERATION_REVEAL_MAX_STAGGER_MS,
      Math.floor(GENERATION_REVEAL_TARGET_SPAN_MS / (nodeCount - 1)),
    ),
  );
}

function easeOutCubic(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - clamped, 3);
}

function finiteTime(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
