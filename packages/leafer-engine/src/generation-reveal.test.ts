import { describe, expect, it } from "vitest";
import {
  GENERATION_REVEAL_FADE_MS,
  GENERATION_REVEAL_LEAD_MS,
  GENERATION_REVEAL_WIREFRAME_MS,
  generationRevealPaintState,
  generationRevealStagger,
  scheduleGenerationReveals,
} from "./generation-reveal.js";

describe("Agent generation reveal schedule", () => {
  it("keeps a readable parent-first beat for ordinary batches", () => {
    const scheduled = scheduleGenerationReveals(
      ["frame", "title", "body"],
      1_000,
      null,
    );

    expect(scheduled.items.map((item) => item.nodeId)).toEqual([
      "frame",
      "title",
      "body",
    ]);
    expect(scheduled.items[0]?.startsAt).toBe(
      1_000 + GENERATION_REVEAL_LEAD_MS,
    );
    expect(scheduled.items[1]!.startsAt).toBeGreaterThan(
      scheduled.items[0]!.startsAt,
    );
    expect(scheduled.nextAvailableStartAt).toBeGreaterThan(
      scheduled.items.at(-1)!.startsAt,
    );
  });

  it("bounds dense batches instead of making users wait per node", () => {
    const ids = Array.from({ length: 1_000 }, (_, index) => `node_${index}`);
    const scheduled = scheduleGenerationReveals(ids, 0, null);
    const first = scheduled.items[0]!;
    const last = scheduled.items.at(-1)!;

    expect(last.startsAt - first.startsAt).toBeLessThanOrEqual(1_600);
    expect(
      new Set(scheduled.items.map((item) => item.startsAt)).size,
    ).toBeLessThanOrEqual(48);
    expect(new Set(scheduled.items.map((item) => item.nodeId))).toHaveLength(
      ids.length,
    );
    expect(generationRevealStagger(48)).toBeGreaterThanOrEqual(32);
  });

  it("appends later transaction stages without replaying prior nodes", () => {
    const first = scheduleGenerationReveals(["frame", "hero"], 100, null);
    const second = scheduleGenerationReveals(
      ["footer", "footer"],
      120,
      first.nextAvailableStartAt,
    );

    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.startsAt).toBeGreaterThan(
      first.items.at(-1)!.startsAt,
    );
  });

  it("separates pending, wireframe, fade, and final document presentation", () => {
    const item = scheduleGenerationReveals(["node"], 1_000, null).items[0]!;
    expect(generationRevealPaintState(item, item.startsAt - 1)).toEqual({
      phase: "pending",
      nodeOpacity: 0,
      overlayOpacity: 0,
    });
    expect(generationRevealPaintState(item, item.startsAt)).toEqual({
      phase: "wireframe",
      nodeOpacity: 0,
      overlayOpacity: 1,
    });
    const fading = generationRevealPaintState(
      item,
      item.startsAt + GENERATION_REVEAL_WIREFRAME_MS + 60,
    );
    expect(fading.phase).toBe("fading");
    expect(fading.nodeOpacity).toBeGreaterThan(0);
    expect(fading.nodeOpacity).toBeLessThan(1);
    expect(fading.overlayOpacity).toBeCloseTo(1 - fading.nodeOpacity);
    expect(
      generationRevealPaintState(
        item,
        item.startsAt +
          GENERATION_REVEAL_WIREFRAME_MS +
          GENERATION_REVEAL_FADE_MS,
      ),
    ).toEqual({ phase: "done", nodeOpacity: 1, overlayOpacity: 0 });
  });
});
