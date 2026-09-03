import { describe, expect, it, vi } from "vitest";
import type { VectorNetwork } from "@opendesign/design-contracts";
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

  it("finds a path nearest point after the target's full affine transform", () => {
    const onLines = vi.fn();
    const controller = new VectorGeometrySnapController({ onLines });
    controller.begin({
      layers: [
        {
          network: {
            vertices: [{ id: "moving", x: 0, y: 0 }],
            segments: [],
            paths: [],
            regions: [],
          },
          nodeId: "moving-vector",
          visibleHandleVertexIds: [],
          worldTransform: [1, 0, 0, 1, 0, 0],
        },
        {
          network: {
            vertices: [
              { id: "start", x: 0, y: 0 },
              { id: "end", x: 100, y: 0 },
            ],
            segments: [
              {
                id: "line",
                startVertexId: "start",
                endVertexId: "end",
              },
            ],
            paths: [
              {
                closed: false,
                id: "target-path",
                segments: [{ reversed: false, segmentId: "line" }],
              },
            ],
            regions: [],
          },
          nodeId: "target-vector",
          visibleHandleVertexIds: [],
          worldTransform: [2, 1, 0.5, 1, 10, 20],
        },
      ],
      moving: [{ nodeId: "moving-vector", vertexIds: ["moving"] }],
      settings: { geometry: true, objects: false, pixelGrid: false },
      viewport: { height: 600, panX: 0, panY: 0, width: 800, zoom: 1 },
    });

    expect(controller.update({ x: 108, y: 74 }, false)).toEqual({
      x: 110,
      y: 70,
    });
    expect(onLines).toHaveBeenLastCalledWith([
      expect.objectContaining({
        kind: "point",
        position: { x: 110, y: 70 },
      }),
    ]);
  });

  it("transforms cubic control points before resolving the nearest point", () => {
    const controller = new VectorGeometrySnapController({ onLines: vi.fn() });
    controller.begin({
      layers: [
        {
          network: {
            vertices: [{ id: "moving", x: 0, y: 0 }],
            segments: [],
            paths: [],
            regions: [],
          },
          nodeId: "moving-vector",
          visibleHandleVertexIds: [],
          worldTransform: [1, 0, 0, 1, 0, 0],
        },
        {
          network: {
            vertices: [
              { id: "start", x: 0, y: 0 },
              { id: "end", x: 100, y: 0 },
            ],
            segments: [
              {
                id: "cubic",
                startVertexId: "start",
                endVertexId: "end",
                tangentStart: { x: 0, y: 100 },
                tangentEnd: { x: 0, y: 100 },
              },
            ],
            paths: [
              {
                closed: false,
                id: "target-path",
                segments: [{ reversed: false, segmentId: "cubic" }],
              },
            ],
            regions: [],
          },
          nodeId: "target-vector",
          visibleHandleVertexIds: [],
          worldTransform: [0, 2, -1, 0, 10, 20],
        },
      ],
      moving: [{ nodeId: "moving-vector", vertexIds: ["moving"] }],
      settings: { geometry: true, objects: false, pixelGrid: false },
      viewport: { height: 600, panX: 0, panY: 0, width: 800, zoom: 1 },
    });

    const result = controller.update({ x: -61, y: 120 }, false);
    expect(result.x).toBeCloseTo(-65, 5);
    expect(result.y).toBeCloseTo(120, 5);
  });

  it("excludes a moving anchor's incident path without hiding other paths", () => {
    const controller = new VectorGeometrySnapController({ onLines: vi.fn() });
    const pathNetwork: VectorNetwork = {
      vertices: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 100, y: 100 },
        { id: "c", x: 0, y: 200 },
        { id: "d", x: 100, y: 300 },
      ],
      segments: [
        { id: "ab", startVertexId: "a", endVertexId: "b" },
        { id: "cd", startVertexId: "c", endVertexId: "d" },
      ],
      paths: [
        {
          closed: false,
          id: "incident",
          segments: [{ reversed: false, segmentId: "ab" }],
        },
        {
          closed: false,
          id: "available",
          segments: [{ reversed: false, segmentId: "cd" }],
        },
      ],
      regions: [],
    };
    controller.begin({
      layers: [
        {
          network: pathNetwork,
          nodeId: "vector",
          visibleHandleVertexIds: [],
          worldTransform: [1, 0, 0, 1, 0, 0],
        },
      ],
      moving: [{ nodeId: "vector", vertexIds: ["a"] }],
      settings: { geometry: true, objects: false, pixelGrid: false },
      viewport: { height: 600, panX: 0, panY: 0, width: 800, zoom: 1 },
    });

    expect(controller.update({ x: 50, y: 53 }, false)).toEqual({
      x: 50,
      y: 53,
    });
    expect(controller.update({ x: 50, y: 253 }, false)).toEqual({
      x: 51.5,
      y: 251.5,
    });
  });

  it("snaps a handle to a non-incident path and ignores its own segment", () => {
    const controller = new VectorGeometrySnapController({ onLines: vi.fn() });
    const handleNetwork: VectorNetwork = {
      vertices: [
        { handleMode: "corner" as const, id: "a", x: 0, y: 0 },
        { handleMode: "corner" as const, id: "b", x: 60, y: 30 },
        { id: "c", x: 0, y: 50 },
        { id: "d", x: 100, y: 150 },
      ],
      segments: [
        {
          id: "ab",
          startVertexId: "a",
          endVertexId: "b",
          tangentStart: { x: 20, y: 0 },
        },
        { id: "cd", startVertexId: "c", endVertexId: "d" },
      ],
      paths: [
        {
          closed: false,
          id: "own",
          segments: [{ reversed: false, segmentId: "ab" }],
        },
        {
          closed: false,
          id: "target",
          segments: [{ reversed: false, segmentId: "cd" }],
        },
      ],
      regions: [],
    };
    controller.beginHandle({
      layers: [
        {
          network: handleNetwork,
          nodeId: "vector",
          visibleHandleVertexIds: ["a"],
          worldTransform: [1, 0, 0, 1, 0, 0],
        },
      ],
      moving: {
        nodeId: "vector",
        position: { x: 20, y: 0 },
        reference: { segmentId: "ab", side: "start" },
      },
      settings: { geometry: true, objects: false, pixelGrid: false },
      viewport: { height: 600, panX: 0, panY: 0, width: 800, zoom: 1 },
    });

    expect(controller.update({ x: 10, y: 15 }, false)).toEqual({
      x: 10,
      y: 15,
    });
    expect(controller.update({ x: 30, y: 103 }, false)).toEqual({
      x: 31.5,
      y: 101.5,
    });
  });
});
