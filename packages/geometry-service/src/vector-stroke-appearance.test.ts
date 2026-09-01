import type { VectorNetwork } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  projectVectorNetworkStrokePaths,
  resolveVectorVertexStrokeAppearance,
  vectorNetworkHasVertexStrokeOverrides,
} from "./vector-stroke-appearance.js";

describe("vector vertex stroke appearance", () => {
  it("resolves vertex overrides before the node fallback", () => {
    expect(
      resolveVectorVertexStrokeAppearance(
        { strokeCap: "round", strokeJoin: "bevel" },
        { strokeCap: "square", strokeJoin: "miter" },
      ),
    ).toEqual({ cap: "round", join: "bevel" });
    expect(
      resolveVectorVertexStrokeAppearance({}, { strokeCap: "none" }),
    ).toEqual({ cap: "butt", join: "miter" });
  });

  it("detects only authored vertex overrides", () => {
    const network = {
      vertices: [{ id: "vertex_a", x: 0, y: 0 }],
    } as VectorNetwork;
    expect(vectorNetworkHasVertexStrokeOverrides(network)).toBe(false);
    network.vertices[0]!.strokeJoin = "round";
    expect(vectorNetworkHasVertexStrokeOverrides(network)).toBe(true);
  });

  it("projects segment, join, and endpoint-cap paths from one topology", () => {
    const result = projectVectorNetworkStrokePaths(
      {
        vertices: [
          { id: "vertex_a", x: 0, y: 0, strokeCap: "round" },
          { id: "vertex_b", x: 50, y: 50, strokeJoin: "bevel" },
          { id: "vertex_c", x: 100, y: 0 },
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
        ],
        paths: [
          {
            id: "path_open",
            closed: false,
            segments: [
              { segmentId: "segment_ab", reversed: false },
              { segmentId: "segment_bc", reversed: false },
            ],
          },
        ],
        regions: [],
      },
      { strokeCap: "none", strokeJoin: "miter" },
      8,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paths.map(({ role }) => role)).toEqual([
      "segment",
      "segment",
      "join",
      "cap",
      "cap",
    ]);
    expect(result.paths[2]).toMatchObject({ join: "bevel" });
    expect(result.paths[3]).toMatchObject({ cap: "round" });
  });

  it("keeps dash phase continuous across a vertex with its authored join", () => {
    const result = projectVectorNetworkStrokePaths(
      {
        vertices: [
          { id: "vertex_a", x: 0, y: 0, strokeCap: "round" },
          { id: "vertex_b", x: 50, y: 0, strokeJoin: "bevel" },
          { id: "vertex_c", x: 100, y: 0 },
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
        ],
        paths: [
          {
            id: "path_open",
            closed: false,
            segments: [
              { segmentId: "segment_ab", reversed: false },
              { segmentId: "segment_bc", reversed: false },
            ],
          },
        ],
        regions: [],
      },
      { strokeCap: "none", strokeJoin: "miter" },
      8,
      0,
      0,
      [60, 10],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paths.filter(({ role }) => role === "segment")).toHaveLength(
      3,
    );
    expect(result.paths.filter(({ role }) => role === "join")).toEqual([
      expect.objectContaining({ join: "bevel" }),
    ]);
    expect(result.paths.find(({ role }) => role === "cap")).toMatchObject({
      cap: "round",
    });
  });

  it("consumes the shared rounded topology before projecting stroke parts", () => {
    const result = projectVectorNetworkStrokePaths(
      {
        vertices: [
          { id: "vertex_a", x: 0, y: 0, cornerRadius: 10 },
          { id: "vertex_b", x: 100, y: 0, strokeJoin: "bevel" },
          { id: "vertex_c", x: 100, y: 100 },
          { id: "vertex_d", x: 0, y: 100 },
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
            id: "segment_cd",
            startVertexId: "vertex_c",
            endVertexId: "vertex_d",
          },
          {
            id: "segment_da",
            startVertexId: "vertex_d",
            endVertexId: "vertex_a",
          },
        ],
        paths: [
          {
            id: "path_square",
            closed: true,
            segments: [
              { segmentId: "segment_ab", reversed: false },
              { segmentId: "segment_bc", reversed: false },
              { segmentId: "segment_cd", reversed: false },
              { segmentId: "segment_da", reversed: false },
            ],
          },
        ],
        regions: [
          {
            id: "region_square",
            windingRule: "nonzero",
            loops: [{ pathId: "path_square", reversed: false }],
          },
        ],
      },
      { strokeCap: "none", strokeJoin: "miter" },
      8,
      4,
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.paths.some((path) => path.path.includes("C"))).toBe(true);
  });
});
