import type { VectorNetwork } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  appendVectorContour,
  appendVectorPoint,
} from "./vector-point-append.js";

describe("appendVectorContour", () => {
  it("adds one stable open contour to an existing Vector network", () => {
    const network = openNetwork();

    const result = appendVectorContour(
      network,
      { x: 20, y: 50 },
      { x: 80, y: 90 },
    );

    expect(result).toMatchObject({
      endVertexId: "vertex_edit_2",
      ok: true,
      pathId: "path_edit_1",
      segmentId: "segment_edit_1",
      startVertexId: "vertex_edit_1",
    });
    if (!result.ok) return;
    expect(result.network.paths.at(-1)).toEqual({
      id: "path_edit_1",
      closed: false,
      segments: [{ segmentId: "segment_edit_1", reversed: false }],
    });
    expect(result.network.segments.at(-1)).toEqual({
      id: "segment_edit_1",
      startVertexId: "vertex_edit_1",
      endVertexId: "vertex_edit_2",
    });
    expect(network).toEqual(openNetwork());
  });

  it("rejects overlapping, non-finite, and invalid input without mutation", () => {
    const network = openNetwork();
    expect(
      appendVectorContour(network, { x: 20, y: 20 }, { x: 20, y: 20 }),
    ).toMatchObject({ ok: false, code: "no-op" });
    expect(
      appendVectorContour(network, { x: Number.NaN, y: 20 }, { x: 40, y: 40 }),
    ).toMatchObject({ ok: false, code: "invalid-network" });
    const invalid = openNetwork();
    invalid.paths[0]!.segments[0]!.segmentId = "missing";
    expect(
      appendVectorContour(invalid, { x: 20, y: 20 }, { x: 40, y: 40 }),
    ).toMatchObject({ ok: false, code: "invalid-network" });
    expect(network).toEqual(openNetwork());
  });
});

describe("appendVectorPoint", () => {
  it("extends an open endpoint and transfers its cap to the new endpoint", () => {
    const network = openNetwork();
    network.vertices[1] = {
      ...network.vertices[1]!,
      handleMode: "mirrored",
      strokeCap: "round",
    };
    network.segments[0]!.tangentEnd = { x: -12, y: 3 };

    const result = appendVectorPoint(network, "vertex_b", { x: 180, y: 20 });

    expect(result).toMatchObject({
      ok: true,
      pathId: "path_open",
      segmentId: "segment_edit_1",
      vertexId: "vertex_edit_1",
    });
    if (!result.ok) return;
    expect(result.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [
          { segmentId: "segment_ab", reversed: false },
          { segmentId: "segment_edit_1", reversed: false },
        ],
      },
    ]);
    expect(result.network.segments.at(-1)).toEqual({
      id: "segment_edit_1",
      startVertexId: "vertex_b",
      endVertexId: "vertex_edit_1",
      tangentStart: { x: 12, y: -3 },
    });
    expect(
      result.network.vertices.find(({ id }) => id === "vertex_b"),
    ).not.toHaveProperty("strokeCap");
    expect(result.network.vertices.at(-1)).toEqual({
      id: "vertex_edit_1",
      x: 180,
      y: 20,
      strokeCap: "round",
    });
    expect(network.paths[0]?.segments).toHaveLength(1);
  });

  it("prepends in traversal order and mirrors a smooth start handle", () => {
    const network = openNetwork();
    network.vertices[0]!.handleMode = "smooth";
    network.segments[0]!.tangentStart = { x: 15, y: 4 };

    const result = appendVectorPoint(network, "vertex_a", { x: -40, y: -10 });

    expect(result).toMatchObject({ ok: true, pathId: "path_open" });
    if (!result.ok) return;
    expect(result.network.paths[0]?.segments[0]).toEqual({
      segmentId: "segment_edit_1",
      reversed: false,
    });
    expect(result.network.segments.at(-1)).toEqual({
      id: "segment_edit_1",
      startVertexId: "vertex_edit_1",
      endVertexId: "vertex_a",
      tangentEnd: { x: -15, y: -4 },
    });
  });

  it("creates a shared branch path from an internal point", () => {
    const network = threePointNetwork();
    network.vertices[1]!.cornerRadius = 8;

    const result = appendVectorPoint(network, "vertex_b", { x: 80, y: 90 });

    expect(result).toMatchObject({
      ok: true,
      pathId: "path_edit_1",
      segmentId: "segment_edit_1",
      vertexId: "vertex_edit_1",
    });
    if (!result.ok) return;
    expect(result.network.paths.at(-1)).toEqual({
      id: "path_edit_1",
      closed: false,
      segments: [{ segmentId: "segment_edit_1", reversed: false }],
    });
    expect(result.network.segments.at(-1)).toEqual({
      id: "segment_edit_1",
      startVertexId: "vertex_b",
      endVertexId: "vertex_edit_1",
    });
    expect(
      result.network.vertices.find(({ id }) => id === "vertex_b"),
    ).toMatchObject({ handleMode: "independent" });
    expect(
      result.network.vertices.find(({ id }) => id === "vertex_b"),
    ).not.toHaveProperty("cornerRadius");
  });

  it("fails without mutating invalid, missing, or overlapping input", () => {
    const network = openNetwork();
    expect(
      appendVectorPoint(network, "missing", { x: 10, y: 10 }),
    ).toMatchObject({ ok: false, code: "missing-vertex" });
    expect(
      appendVectorPoint(network, "vertex_a", { x: 0, y: 0 }),
    ).toMatchObject({ ok: false, code: "no-op" });
    expect(
      appendVectorPoint(network, "vertex_a", { x: Number.NaN, y: 1 }),
    ).toMatchObject({ ok: false, code: "invalid-network" });
    expect(network).toEqual(openNetwork());
  });
});

function openNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
      { id: "vertex_b", x: 100, y: 0, handleMode: "corner" },
    ],
    segments: [
      {
        id: "segment_ab",
        startVertexId: "vertex_a",
        endVertexId: "vertex_b",
      },
    ],
    paths: [
      {
        id: "path_open",
        closed: false,
        segments: [{ segmentId: "segment_ab", reversed: false }],
      },
    ],
    regions: [],
  };
}

function threePointNetwork(): VectorNetwork {
  const network = openNetwork();
  network.vertices.push({
    id: "vertex_c",
    x: 160,
    y: 40,
    handleMode: "corner",
  });
  network.segments.push({
    id: "segment_bc",
    startVertexId: "vertex_b",
    endVertexId: "vertex_c",
  });
  network.paths[0]!.segments.push({
    segmentId: "segment_bc",
    reversed: false,
  });
  return network;
}
