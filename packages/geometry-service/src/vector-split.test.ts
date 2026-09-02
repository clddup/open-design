import type { VectorNetwork } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { splitVectorNetwork } from "./vector-split.js";

function branchingNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 0, y: 0 },
      { id: "vertex_b", x: 40, y: 0 },
      { id: "vertex_c", x: 80, y: 0 },
      { id: "vertex_d", x: 40, y: 40 },
    ],
    segments: [
      { id: "segment_ab", startVertexId: "vertex_a", endVertexId: "vertex_b" },
      { id: "segment_bc", startVertexId: "vertex_b", endVertexId: "vertex_c" },
      { id: "segment_bd", startVertexId: "vertex_b", endVertexId: "vertex_d" },
    ],
    paths: [
      {
        id: "path_horizontal",
        closed: false,
        segments: [
          { segmentId: "segment_ab", reversed: false },
          { segmentId: "segment_bc", reversed: false },
        ],
      },
      {
        id: "path_branch",
        closed: false,
        segments: [{ segmentId: "segment_bd", reversed: false }],
      },
    ],
    regions: [],
  };
}

describe("splitVectorNetwork", () => {
  it("separates document-ordered path runs and duplicates shared junctions locally", () => {
    const result = splitVectorNetwork(branchingNetwork());
    expect(result).toMatchObject({
      ok: true,
      pathIds: ["path_horizontal", "path_branch"],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.networks).toHaveLength(2);
    expect(result.networks[0]?.paths.map((path) => path.id)).toEqual([
      "path_horizontal",
    ]);
    expect(result.networks[0]?.vertices.map((vertex) => vertex.id)).toEqual([
      "vertex_a",
      "vertex_b",
      "vertex_c",
    ]);
    expect(result.networks[1]?.paths.map((path) => path.id)).toEqual([
      "path_branch",
    ]);
    expect(result.networks[1]?.vertices.map((vertex) => vertex.id)).toEqual([
      "vertex_b",
      "vertex_d",
    ]);
  });

  it("preserves a single-loop region with its owning path", () => {
    const source = branchingNetwork();
    source.paths[0]!.closed = true;
    source.segments.push({
      id: "segment_ca",
      startVertexId: "vertex_c",
      endVertexId: "vertex_a",
    });
    source.paths[0]!.segments.push({
      segmentId: "segment_ca",
      reversed: false,
    });
    source.regions.push({
      id: "region_face",
      windingRule: "nonzero",
      loops: [{ pathId: "path_horizontal", reversed: false }],
    });

    const result = splitVectorNetwork(source);
    if (!result.ok) throw new Error(result.message);
    expect(result.networks[0]?.regions).toEqual(source.regions);
    expect(result.networks[1]?.regions).toEqual([]);
  });

  it("rejects no-op and cross-path compound Fill without partial output", () => {
    const single = branchingNetwork();
    single.paths = single.paths.slice(0, 1);
    single.segments = single.segments.slice(0, 2);
    single.vertices = single.vertices.slice(0, 3);
    expect(splitVectorNetwork(single)).toMatchObject({
      ok: false,
      code: "no-op",
    });

    const compound = branchingNetwork();
    compound.paths[0]!.closed = true;
    compound.paths[1]!.closed = true;
    compound.segments.push(
      {
        id: "segment_ca",
        startVertexId: "vertex_c",
        endVertexId: "vertex_a",
      },
      {
        id: "segment_db",
        startVertexId: "vertex_d",
        endVertexId: "vertex_b",
      },
    );
    compound.paths[0]!.segments.push({
      segmentId: "segment_ca",
      reversed: false,
    });
    compound.paths[1]!.segments.push({
      segmentId: "segment_db",
      reversed: false,
    });
    compound.regions.push({
      id: "region_compound",
      windingRule: "evenodd",
      loops: [
        { pathId: "path_horizontal", reversed: false },
        { pathId: "path_branch", reversed: true },
      ],
    });
    expect(splitVectorNetwork(compound)).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
  });
});
