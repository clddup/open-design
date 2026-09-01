import { describe, expect, it } from "vitest";
import { serializeVectorNetwork } from "./editable-vector.js";
import {
  materializeTransformedVectorNetwork,
  materializeVectorNetwork,
  mergeVectorNetworks,
} from "./vector-materialization.js";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "./vector-path.js";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll } from "vitest";

const require = createRequire(import.meta.url);
let provider: VectorGeometryProvider;

beforeAll(async () => {
  provider = await createPathKitGeometryProvider({
    wasmBinary: await readFile(
      require.resolve("pathkit-wasm/bin/pathkit.wasm"),
    ),
  });
});

describe("vector path materialization", () => {
  it("transforms and merges independently painted geometry", () => {
    const first = materializeTransformedVectorNetwork(
      { path: "M0 0L20 0L20 20L0 20Z" },
      [1, 0, 0, 1, 10, 20],
      provider,
      "first",
    );
    const second = materializeTransformedVectorNetwork(
      { path: "M0 0L10 0L10 10L0 10Z" },
      [1, 0, 0, 1, 50, 60],
      provider,
      "second",
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    first.network.regions[0]!.fills = [
      { type: "solid", color: "#ff0000", opacity: 1 },
    ];
    second.network.regions[0]!.fills = [
      { type: "solid", color: "#0000ff", opacity: 1 },
    ];
    const merged = mergeVectorNetworks([first.network, second.network]);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.network.regions.map((region) => region.fills)).toEqual([
      [{ type: "solid", color: "#ff0000", opacity: 1 }],
      [{ type: "solid", color: "#0000ff", opacity: 1 }],
    ]);
    expect(merged.network.vertices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 10, y: 20 }),
        expect.objectContaining({ x: 50, y: 60 }),
      ]),
    );
  });

  it("creates stable editable paths and one fill region from closed contours", () => {
    const result = materializeVectorNetwork(
      "M0 0L100 0L100 100L0 0Z M25 25L25 50L50 25L25 25Z",
      "evenodd",
      "outline",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.paths).toHaveLength(2);
    expect(result.network.paths.every((path) => path.closed)).toBe(true);
    expect(result.network.regions).toEqual([
      {
        id: "outline_region_0",
        windingRule: "evenodd",
        loops: [
          { pathId: "outline_path_0", reversed: false },
          { pathId: "outline_path_1", reversed: false },
        ],
      },
    ]);
    expect(serializeVectorNetwork(result.network).ok).toBe(true);
  });

  it("converts quadratic and cubic commands to editable Bézier tangents", () => {
    const result = materializeVectorNetwork(
      "M0 0Q50 100 100 0C125 -50 175 -50 200 0",
      "nonzero",
      "curve",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const quadratic = result.network.segments[0];
    expect(quadratic?.tangentStart?.x).toBeCloseTo(100 / 3);
    expect(quadratic?.tangentStart?.y).toBeCloseTo(200 / 3);
    expect(quadratic?.tangentEnd?.x).toBeCloseTo(-100 / 3);
    expect(quadratic?.tangentEnd?.y).toBeCloseTo(200 / 3);
    expect(result.network.segments[1]).toMatchObject({
      tangentStart: { x: 25, y: -50 },
      tangentEnd: { x: -25, y: -50 },
    });
    expect(result.network.regions).toEqual([]);
  });

  it("rejects relative, arc, malformed, and unsafe ID inputs", () => {
    expect(
      materializeVectorNetwork("m0 0l1 1", "nonzero", "path"),
    ).toMatchObject({ ok: false, code: "unsupported-command" });
    expect(
      materializeVectorNetwork("M0 0A10 10 0 0 1 20 0", "nonzero", "path"),
    ).toMatchObject({ ok: false, code: "unsupported-command" });
    expect(
      materializeVectorNetwork("M0 nope", "nonzero", "path"),
    ).toMatchObject({ ok: false, code: "invalid-input" });
    expect(
      materializeVectorNetwork("M0 0L1 1", "nonzero", "1 bad"),
    ).toMatchObject({ ok: false, code: "invalid-input" });
  });
});
