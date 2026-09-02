import { describe, expect, it } from "vitest";
import {
  appendPenPoint,
  createPenDraft,
  dragAppendedPenPoint,
  dragPenPathStart,
  finishPenPath,
  finishPenPathAtVertex,
  penDraftHandlePath,
  penDraftPreviewPath,
  startIndependentPenPath,
  startPenPathAtVertex,
} from "./pen-tool.js";

describe("Pen network draft", () => {
  it("builds one stable open contour from ordered clicks", () => {
    const draft = createPenDraft({ x: 10, y: 20 });
    expect(appendPenPoint(draft, { x: 110, y: 20 }).ok).toBe(true);
    expect(appendPenPoint(draft, { x: 80, y: 120 }).ok).toBe(true);

    expect(draft.network.vertices).toHaveLength(3);
    expect(draft.network.segments).toHaveLength(2);
    expect(draft.network.paths).toHaveLength(1);
    expect(draft.network.paths[0]?.closed).toBe(false);
    expect(draft.network.paths[0]?.segments).toHaveLength(2);
    expect(draft.network.regions).toEqual([]);
  });

  it("preserves click-drag handles across appended points", () => {
    const draft = createPenDraft({ x: 10, y: 20 });
    dragPenPathStart(draft, { x: 40, y: 30 });
    const appended = appendPenPoint(draft, { x: 100, y: 80 });
    if (!appended.ok || !appended.edit) throw new Error("Missing Pen edit");
    const dragged = dragAppendedPenPoint(draft, appended.edit, {
      x: 120,
      y: 55,
    });
    expect(dragged.ok).toBe(true);

    expect(draft.network.segments[0]).toMatchObject({
      tangentStart: { x: 30, y: 10 },
      tangentEnd: { x: -20, y: 25 },
    });
    expect(penDraftHandlePath(draft)).toContain("M 10 20 L 40 30");
    expect(penDraftHandlePath(draft)).toContain("L 120 55");
    expect(appendPenPoint(draft, { x: 180, y: 90 }).ok).toBe(true);
    expect(draft.network.segments[1]?.tangentStart).toEqual({ x: 20, y: -25 });
  });

  it("closes an active contour on its existing start vertex", () => {
    const draft = triangleDraft();
    const firstVertexId = draft.network.vertices[0]!.id;

    expect(finishPenPathAtVertex(draft, firstVertexId).ok).toBe(true);
    expect(draft.activeVertexId).toBeNull();
    expect(draft.network.segments).toHaveLength(3);
    expect(draft.network.paths[0]?.closed).toBe(true);
    expect(draft.network.regions).toEqual([
      expect.objectContaining({
        loops: [
          expect.objectContaining({ pathId: draft.network.paths[0]!.id }),
        ],
      }),
    ]);
  });

  it("previews a rubber band and an exact target closure", () => {
    const draft = triangleDraft();
    const firstVertexId = draft.network.vertices[0]!.id;

    expect(penDraftPreviewPath(draft, { x: 120, y: 120 }, undefined)).toBe(
      "M 0 0 L 100 0 L 50 100 L 120 120",
    );
    expect(penDraftPreviewPath(draft, undefined, firstVertexId)).toBe(
      "M 0 0 L 100 0 L 50 100 L 0 0 Z",
    );
  });

  it("creates independent contours and branches in one Vector Network", () => {
    const draft = triangleDraft();
    const junctionVertexId = draft.network.vertices[1]!.id;
    finishPenPath(draft);

    startIndependentPenPath(draft, { x: 180, y: 20 });
    expect(appendPenPoint(draft, { x: 240, y: 80 }).ok).toBe(true);
    finishPenPath(draft);
    expect(startPenPathAtVertex(draft, junctionVertexId)).toBe(true);
    expect(appendPenPoint(draft, { x: -60, y: 40 }).ok).toBe(true);

    expect(draft.network.paths).toHaveLength(3);
    expect(draft.network.vertices).toHaveLength(6);
    expect(draft.network.paths.filter(({ closed }) => !closed)).toHaveLength(3);
  });

  it("connects a pending independent start to an existing vertex", () => {
    const draft = triangleDraft();
    finishPenPath(draft);
    startIndependentPenPath(draft, { x: 200, y: 60 });
    const targetVertexId = draft.network.vertices[1]!.id;

    expect(finishPenPathAtVertex(draft, targetVertexId).ok).toBe(true);
    expect(draft.network.paths).toHaveLength(2);
    expect(draft.network.vertices).toHaveLength(4);
    expect(draft.activeVertexId).toBeNull();
  });
});

function triangleDraft() {
  const draft = createPenDraft({ x: 0, y: 0 });
  appendPenPoint(draft, { x: 100, y: 0 });
  appendPenPoint(draft, { x: 50, y: 100 });
  return draft;
}
