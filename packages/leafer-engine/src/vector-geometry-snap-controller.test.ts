import { describe, expect, it, vi } from "vitest";
import { VectorGeometrySnapController } from "./vector-geometry-snap-controller.js";

const network = {
  vertices: [
    { handleMode: "corner" as const, id: "a", x: 0, y: 0 },
    { handleMode: "corner" as const, id: "b", x: 60, y: 30 },
  ],
  segments: [],
  paths: [],
  regions: [],
};

describe("VectorGeometrySnapController", () => {
  it("freezes document-space anchor targets and excludes moving points", () => {
    const onLines = vi.fn();
    const controller = new VectorGeometrySnapController({ onLines });
    controller.begin({
      layers: [
        {
          network,
          nodeId: "vector",
          visibleHandleVertexIds: [],
          worldTransform: [1, 0, 0, 1, 100, 200],
        },
      ],
      moving: [{ nodeId: "vector", vertexIds: ["a"] }],
      settings: { geometry: true, objects: true, pixelGrid: false },
      viewport: { height: 600, panX: 0, panY: 0, width: 800, zoom: 1 },
    });

    expect(controller.update({ x: 57, y: 28 }, false)).toEqual({
      x: 60,
      y: 30,
    });
    expect(onLines).toHaveBeenLastCalledWith([
      expect.objectContaining({ axis: "x", position: 160 }),
      expect.objectContaining({ axis: "y", position: 230 }),
    ]);
  });

  it("uses Control suppression without changing the frozen drag session", () => {
    const onLines = vi.fn();
    const controller = new VectorGeometrySnapController({ onLines });
    controller.begin({
      layers: [
        {
          network,
          nodeId: "vector",
          visibleHandleVertexIds: [],
          worldTransform: [1, 0, 0, 1, 0, 0],
        },
      ],
      moving: [{ nodeId: "vector", vertexIds: ["a"] }],
      settings: { geometry: true, objects: false, pixelGrid: true },
      viewport: { height: 600, panX: 0, panY: 0, width: 800, zoom: 1 },
    });

    expect(controller.update({ x: 57.2, y: 28.4 }, true)).toEqual({
      x: 57.2,
      y: 28.4,
    });
    expect(onLines).toHaveBeenLastCalledWith([]);
    expect(controller.update({ x: 57.2, y: 28.4 }, false)).toEqual({
      x: 60,
      y: 30,
    });
  });

  it("recomputes the screen-derived threshold after viewport zoom changes", () => {
    const controller = new VectorGeometrySnapController({ onLines: vi.fn() });
    controller.begin({
      layers: [
        {
          network,
          nodeId: "vector",
          visibleHandleVertexIds: [],
          worldTransform: [1, 0, 0, 1, 0, 0],
        },
      ],
      moving: [{ nodeId: "vector", vertexIds: ["a"] }],
      settings: { geometry: true, objects: false, pixelGrid: false },
      viewport: { height: 600, panX: 0, panY: 0, width: 800, zoom: 1 },
    });

    controller.syncViewport({
      height: 600,
      panX: 0,
      panY: 0,
      width: 800,
      zoom: 2,
    });
    expect(controller.update({ x: 57, y: 27 }, false)).toEqual({
      x: 57,
      y: 27,
    });
  });

  it("snaps a visible Bézier handle to anchors and other visible handles", () => {
    const onLines = vi.fn();
    const controller = new VectorGeometrySnapController({ onLines });
    controller.beginHandle({
      layers: [
        {
          network: {
            vertices: [
              { handleMode: "mirrored", id: "a", x: 0, y: 0 },
              { handleMode: "mirrored", id: "b", x: 60, y: 30 },
            ],
            segments: [
              {
                id: "ab",
                startVertexId: "a",
                endVertexId: "b",
                tangentEnd: { x: -20, y: 0 },
                tangentStart: { x: 20, y: 0 },
              },
            ],
            paths: [
              {
                closed: false,
                id: "path",
                segments: [{ reversed: false, segmentId: "ab" }],
              },
            ],
            regions: [],
          },
          nodeId: "vector",
          visibleHandleVertexIds: ["a", "b"],
          worldTransform: [1, 0, 0, 1, 100, 200],
        },
      ],
      moving: {
        nodeId: "vector",
        position: { x: 120, y: 200 },
        reference: { segmentId: "ab", side: "start" },
      },
      settings: { geometry: true, objects: false, pixelGrid: false },
      viewport: { height: 600, panX: 0, panY: 0, width: 800, zoom: 1 },
    });

    expect(controller.update({ x: 3, y: 8 }, false)).toEqual({ x: 3, y: 8 });
    expect(controller.update({ x: -17, y: 28 }, false)).toEqual({
      x: -20,
      y: 30,
    });
    expect(onLines).toHaveBeenLastCalledWith([
      expect.objectContaining({ axis: "x", position: 100 }),
      expect.objectContaining({ axis: "y", position: 230 }),
    ]);
  });
});
