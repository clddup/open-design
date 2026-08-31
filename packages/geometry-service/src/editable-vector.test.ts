import type { VectorNetwork } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  normalizeVectorNetwork,
  serializeVectorNetwork,
  serializeVectorRegion,
  validateVectorNetwork,
  vectorNetworkHasBranches,
} from "./editable-vector.js";

function openCubicNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_start", x: 0, y: 0 },
      { id: "vertex_end", x: 100, y: 0 },
    ],
    segments: [
      {
        id: "segment_curve",
        startVertexId: "vertex_start",
        endVertexId: "vertex_end",
        tangentStart: { x: 0, y: 100 },
        tangentEnd: { x: 0, y: 100 },
      },
    ],
    paths: [
      {
        id: "path_open",
        closed: false,
        segments: [{ segmentId: "segment_curve", reversed: false }],
      },
    ],
    regions: [],
  };
}

function closedNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 10, y: 20 },
      { id: "vertex_b", x: 110, y: 20 },
      { id: "vertex_c", x: 110, y: 120 },
    ],
    segments: [
      {
        id: "segment_ab",
        startVertexId: "vertex_a",
        endVertexId: "vertex_b",
      },
      {
        id: "segment_bc",
        startVertexId: "vertex_b",
        endVertexId: "vertex_c",
      },
      {
        id: "segment_ca",
        startVertexId: "vertex_c",
        endVertexId: "vertex_a",
      },
    ],
    paths: [
      {
        id: "path_closed",
        closed: true,
        segments: [
          { segmentId: "segment_ab", reversed: false },
          { segmentId: "segment_bc", reversed: false },
          { segmentId: "segment_ca", reversed: false },
        ],
      },
    ],
    regions: [
      {
        id: "region_face",
        windingRule: "nonzero",
        loops: [{ pathId: "path_closed", reversed: false }],
      },
    ],
  };
}

describe("editable vector geometry", () => {
  it("serializes one explicit region independently", () => {
    expect(serializeVectorRegion(closedNetwork(), "region_face")).toEqual({
      ok: true,
      path: "M 10 20 L 110 20 L 110 120 L 10 20 Z",
      regionId: "region_face",
    });
    expect(serializeVectorRegion(closedNetwork(), "missing")).toMatchObject({
      ok: false,
      issues: [{ message: "region missing does not exist" }],
    });
  });

  it("serializes open cubic paths deterministically with tight bounds", () => {
    expect(serializeVectorNetwork(openCubicNetwork())).toEqual({
      ok: true,
      bounds: { x: 0, y: 0, width: 100, height: 75 },
      network: openCubicNetwork(),
      path: "M 0 0 C 0 100 100 100 100 0",
    });
  });

  it("serializes closed path runs and regions without duplicating geometry", () => {
    expect(serializeVectorNetwork(closedNetwork())).toMatchObject({
      ok: true,
      bounds: { x: 10, y: 20, width: 100, height: 100 },
      path: "M 10 20 L 110 20 L 110 120 L 10 20 Z",
    });
  });

  it("serializes compound region loops in their effective fill direction", () => {
    const network = closedNetwork();
    network.vertices.push(
      { id: "vertex_d", x: 40, y: 40 },
      { id: "vertex_e", x: 80, y: 40 },
      { id: "vertex_f", x: 60, y: 80 },
    );
    network.segments.push(
      { id: "segment_de", startVertexId: "vertex_d", endVertexId: "vertex_e" },
      { id: "segment_ef", startVertexId: "vertex_e", endVertexId: "vertex_f" },
      { id: "segment_fd", startVertexId: "vertex_f", endVertexId: "vertex_d" },
    );
    network.paths.push({
      id: "path_hole",
      closed: true,
      segments: [
        { segmentId: "segment_de", reversed: false },
        { segmentId: "segment_ef", reversed: false },
        { segmentId: "segment_fd", reversed: false },
      ],
    });
    network.regions[0]!.loops.push({
      pathId: "path_hole",
      reversed: true,
    });

    expect(serializeVectorNetwork(network)).toMatchObject({
      ok: true,
      path: "M 10 20 L 110 20 L 110 120 L 10 20 Z M 40 40 L 60 80 L 80 40 L 40 40 Z",
    });
  });

  it("rejects conflicting effective directions for one rendered path", () => {
    const network = closedNetwork();
    network.regions.push({
      id: "region_conflict",
      windingRule: "nonzero",
      loops: [{ pathId: "path_closed", reversed: true }],
    });

    const result = serializeVectorNetwork(network);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Conflicting loop directions should fail");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "/paths/0" }),
    );
    expect(result.issues[0]?.message).toContain(
      "conflicting region loop directions",
    );
  });

  it("normalizes editable coordinates and returns the required node offset", () => {
    const result = normalizeVectorNetwork(closedNetwork());
    expect(result).toMatchObject({
      ok: true,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      offset: { x: 10, y: 20 },
      path: "M 0 0 L 100 0 L 100 100 L 0 0 Z",
    });
    if (!result.ok) throw new Error("Expected normalized vector network");
    expect(result.network.vertices[0]).toEqual({
      id: "vertex_a",
      x: 0,
      y: 0,
    });
  });

  it("detects branch vertices independently of path-run decomposition", () => {
    const network: VectorNetwork = {
      vertices: [
        { id: "vertex_center", x: 50, y: 50 },
        { id: "vertex_top", x: 50, y: 0 },
        { id: "vertex_left", x: 0, y: 100 },
        { id: "vertex_right", x: 100, y: 100 },
      ],
      segments: [
        {
          id: "segment_top",
          startVertexId: "vertex_center",
          endVertexId: "vertex_top",
        },
        {
          id: "segment_left",
          startVertexId: "vertex_center",
          endVertexId: "vertex_left",
        },
        {
          id: "segment_right",
          startVertexId: "vertex_center",
          endVertexId: "vertex_right",
        },
      ],
      paths: [
        {
          id: "path_top",
          closed: false,
          segments: [{ segmentId: "segment_top", reversed: false }],
        },
        {
          id: "path_left",
          closed: false,
          segments: [{ segmentId: "segment_left", reversed: false }],
        },
        {
          id: "path_right",
          closed: false,
          segments: [{ segmentId: "segment_right", reversed: false }],
        },
      ],
      regions: [],
    };

    expect(validateVectorNetwork(network)).toEqual([]);
    expect(vectorNetworkHasBranches(network)).toBe(true);
    expect(vectorNetworkHasBranches(openCubicNetwork())).toBe(false);
  });

  it("rejects dangling vertices and segments", () => {
    const network = closedNetwork();
    network.vertices.push({ id: "vertex_dangling", x: 0, y: 0 });
    network.segments.push({
      id: "segment_dangling",
      startVertexId: "vertex_a",
      endVertexId: "vertex_missing",
    });

    expect(validateVectorNetwork(network)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/segments/3/endVertexId",
          message: "vertex vertex_missing does not exist",
        }),
        expect.objectContaining({
          path: "/segments/3",
          message: "segment segment_dangling is not owned by a path run",
        }),
        expect.objectContaining({
          path: "/vertices/3",
          message: "vertex vertex_dangling is not connected to a segment",
        }),
      ]),
    );
  });

  it("rejects non-contiguous runs and duplicate segment ownership", () => {
    const network = closedNetwork();
    network.paths[0]!.segments = [
      { segmentId: "segment_ab", reversed: false },
      { segmentId: "segment_ca", reversed: false },
      { segmentId: "segment_bc", reversed: false },
    ];
    network.paths.push({
      id: "path_duplicate",
      closed: false,
      segments: [{ segmentId: "segment_ab", reversed: false }],
    });

    const messages = validateVectorNetwork(network).map(
      (issue) => issue.message,
    );
    expect(messages.some((message) => message.includes("not contiguous"))).toBe(
      true,
    );
    expect(messages.some((message) => message.includes("already owned"))).toBe(
      true,
    );
  });

  it("rejects incorrect open and closed topology", () => {
    const closed = closedNetwork();
    closed.paths[0]!.segments.pop();
    const open = closedNetwork();
    open.paths[0]!.closed = false;

    expect(
      validateVectorNetwork(closed).some((issue) =>
        issue.message.includes("does not return"),
      ),
    ).toBe(true);
    expect(
      validateVectorNetwork(open).some((issue) =>
        issue.message.includes("open path"),
      ),
    ).toBe(true);
  });

  it("rejects regions that reference open paths", () => {
    const network = closedNetwork();
    network.paths[0]!.closed = false;

    expect(validateVectorNetwork(network)).toContainEqual({
      path: "/regions/0/loops/0/pathId",
      message: "region loops require a closed path, received path_closed",
    });
  });
});
