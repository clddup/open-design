import { describe, expect, it } from "vitest";
import {
  appendPenVertex,
  createPenDraft,
  penDraftHandlePath,
  penDraftPreviewPath,
  penDraftToVectorNetwork,
  removeLastPenVertex,
  setPenVertexHandle,
} from "./pen-tool.js";

describe("Pen draft state", () => {
  it("builds a stable open contour from ordered clicks", () => {
    const draft = createPenDraft({ x: 10, y: 20 });
    expect(appendPenVertex(draft, { x: 110, y: 20 })).toBe(true);
    expect(appendPenVertex(draft, { x: 80, y: 120 })).toBe(true);

    expect(penDraftToVectorNetwork(draft, false)).toEqual({
      vertices: [
        { id: "vertex_1", x: 10, y: 20 },
        { id: "vertex_2", x: 110, y: 20 },
        { id: "vertex_3", x: 80, y: 120 },
      ],
      segments: [
        {
          id: "segment_1",
          startVertexId: "vertex_1",
          endVertexId: "vertex_2",
        },
        {
          id: "segment_2",
          startVertexId: "vertex_2",
          endVertexId: "vertex_3",
        },
      ],
      paths: [
        {
          id: "path_1",
          closed: false,
          segments: [
            { segmentId: "segment_1", reversed: false },
            { segmentId: "segment_2", reversed: false },
          ],
        },
      ],
      regions: [],
    });
  });

  it("mirrors click-drag handles into the incoming and outgoing tangents", () => {
    const draft = createPenDraft({ x: 10, y: 20 });
    setPenVertexHandle(draft, 0, { x: 30, y: 10 });
    appendPenVertex(draft, { x: 100, y: 80 });
    setPenVertexHandle(draft, 1, { x: 20, y: -25 });

    expect(penDraftToVectorNetwork(draft, false)?.segments[0]).toEqual({
      id: "segment_1",
      startVertexId: "vertex_1",
      endVertexId: "vertex_2",
      tangentStart: { x: 30, y: 10 },
      tangentEnd: { x: -20, y: 25 },
    });
    expect(penDraftHandlePath(draft)).toContain("M -20 10 L 10 20");
    expect(penDraftHandlePath(draft)).toContain("L 120 55");
  });

  it("closes through a final segment and creates one fill region", () => {
    const draft = createPenDraft({ x: 0, y: 0 });
    appendPenVertex(draft, { x: 100, y: 0 });
    appendPenVertex(draft, { x: 50, y: 100 });

    const network = penDraftToVectorNetwork(draft, true);
    expect(network?.segments.at(-1)).toEqual({
      id: "segment_3",
      startVertexId: "vertex_3",
      endVertexId: "vertex_1",
    });
    expect(network?.paths[0]).toMatchObject({ closed: true });
    expect(network?.regions).toEqual([
      {
        id: "region_1",
        windingRule: "nonzero",
        loops: [{ pathId: "path_1", reversed: false }],
      },
    ]);
  });

  it("shows a rubber-band segment and a closed-path preview", () => {
    const draft = createPenDraft({ x: 0, y: 0 });
    appendPenVertex(draft, { x: 100, y: 0 });
    appendPenVertex(draft, { x: 50, y: 100 });

    expect(penDraftPreviewPath(draft, { x: 120, y: 120 }, false)).toBe(
      "M 0 0 L 100 0 L 50 100 L 120 120",
    );
    expect(penDraftPreviewPath(draft, { x: 0, y: 0 }, true)).toBe(
      "M 0 0 L 100 0 L 50 100 L 0 0 Z",
    );
  });

  it("ignores coincident points and supports stepwise Backspace removal", () => {
    const draft = createPenDraft({ x: 0, y: 0 });
    expect(appendPenVertex(draft, { x: 0, y: 0 })).toBe(false);
    expect(appendPenVertex(draft, { x: 20, y: 10 })).toBe(true);
    expect(removeLastPenVertex(draft)).toBe(true);
    expect(draft.vertices).toHaveLength(1);
    expect(removeLastPenVertex(draft)).toBe(true);
    expect(removeLastPenVertex(draft)).toBe(false);
  });
});
