import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { serializeVectorNetwork } from "./editable-vector.js";
import {
  outlineVectorNetworkStroke,
  outlineVectorPath,
} from "./vector-materialization.js";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "./vector-path.js";

const require = createRequire(import.meta.url);
let provider: VectorGeometryProvider;

beforeAll(async () => {
  provider = await createPathKitGeometryProvider({
    wasmBinary: await readFile(
      require.resolve("pathkit-wasm/bin/pathkit.wasm"),
    ),
  });
});

describe("editable stroke outline", () => {
  it("materializes an open round stroke as a closed editable network", () => {
    const result = outlineVectorPath(
      { path: "M10 20C40 0 60 40 90 20" },
      {
        align: "center",
        cap: "round",
        join: "round",
        miterLimit: 4,
        width: 12,
      },
      provider,
      "stroke",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.paths.every((path) => path.closed)).toBe(true);
    expect(result.network.regions).toHaveLength(1);
    const serialized = serializeVectorNetwork(result.network);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(serialized.bounds.width).toBeGreaterThan(80);
    expect(serialized.bounds.height).toBeGreaterThan(12);
  });

  it("preserves dashed and aligned stroke geometry", () => {
    const dashed = outlineVectorPath(
      { path: "M0 0L100 0" },
      {
        align: "center",
        cap: "butt",
        dashPattern: [12, 8],
        join: "miter",
        miterLimit: 4,
        width: 10,
      },
      provider,
      "dash",
    );
    expect(dashed.ok).toBe(true);
    if (dashed.ok) expect(dashed.network.paths.length).toBeGreaterThan(1);

    const inside = outlineVectorPath(
      { path: "M0 0L100 0L100 100L0 100L0 0Z" },
      {
        align: "inside",
        cap: "butt",
        join: "miter",
        miterLimit: 4,
        width: 10,
      },
      provider,
      "inside",
    );
    expect(inside.ok).toBe(true);
    if (!inside.ok) return;
    const serialized = serializeVectorNetwork(inside.network);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(serialized.bounds).toMatchObject({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it("rejects non-center alignment for open paths", () => {
    expect(
      outlineVectorPath(
        { path: "M0 0L100 0" },
        {
          align: "outside",
          cap: "butt",
          join: "miter",
          miterLimit: 4,
          width: 10,
        },
        provider,
        "outside",
      ),
    ).toMatchObject({ ok: false, code: "invalid-input" });
  });

  it("materializes vertex-local cap and join overrides", () => {
    const network = {
      vertices: [
        { id: "vertex_a", x: 0, y: 0, strokeCap: "round" as const },
        { id: "vertex_b", x: 50, y: 50, strokeJoin: "bevel" as const },
        { id: "vertex_c", x: 100, y: 0, strokeCap: "square" as const },
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
    };
    const result = outlineVectorNetworkStroke(
      network,
      { path: "M0 0L50 50L100 0" },
      {
        align: "center",
        cap: "butt",
        join: "miter",
        miterLimit: 4,
        width: 10,
      },
      provider,
      "vertex_stroke",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.paths.every((path) => path.closed)).toBe(true);
    const serialized = serializeVectorNetwork(result.network);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(serialized.bounds.x).toBeLessThan(0);
    expect(serialized.bounds.width).toBeGreaterThan(100);
  });

  it("preserves one continuous custom dash phase with vertex overrides", () => {
    const result = outlineVectorNetworkStroke(
      {
        vertices: [
          { id: "vertex_a", x: 0, y: 0, strokeCap: "round" },
          { id: "vertex_b", x: 100, y: 0 },
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
      },
      { path: "M0 0L100 0" },
      {
        align: "center",
        cap: "butt",
        dashPattern: [10, 5, 2, 5],
        join: "miter",
        miterLimit: 4,
        width: 10,
      },
      provider,
      "dashed_vertex_stroke",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.paths.every((path) => path.closed)).toBe(true);
    expect(result.network.regions.length).toBeGreaterThan(0);
  });

  it("materializes rounded closed geometry together with vertex stroke overrides", () => {
    const network = {
      vertices: [
        { id: "vertex_a", x: 0, y: 0, cornerRadius: 12 },
        { id: "vertex_b", x: 100, y: 0, strokeJoin: "bevel" as const },
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
          windingRule: "nonzero" as const,
          loops: [{ pathId: "path_square", reversed: false }],
        },
      ],
    };
    const source = structuredClone(network);
    const result = outlineVectorNetworkStroke(
      network,
      { path: "M0 0L100 0L100 100L0 100Z" },
      {
        align: "center",
        cap: "butt",
        cornerRadius: 4,
        join: "miter",
        miterLimit: 4,
        width: 10,
      },
      provider,
      "rounded_vertex_stroke",
    );
    expect(result.ok).toBe(true);
    expect(network).toEqual(source);
    if (result.ok)
      expect(serializeVectorNetwork(result.network)).toMatchObject({
        ok: true,
      });
  });
});
