import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { VectorNetwork } from "@opendesign/design-contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { materializeVectorNetwork } from "./vector-materialization.js";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "./vector-path.js";
import {
  createVectorEraserPath,
  erasePaintedVectorNetwork,
} from "./vector-eraser.js";

const require = createRequire(import.meta.url);
let provider: VectorGeometryProvider;

beforeAll(async () => {
  provider = await createPathKitGeometryProvider({
    wasmBinary: await readFile(
      require.resolve("pathkit-wasm/bin/pathkit.wasm"),
    ),
  });
});

describe("vector eraser geometry", () => {
  it("keeps disconnected results in one editable vector network", () => {
    const source = paintedRect("source", "#ff3355");
    const eraser = createVectorEraserPath(
      [
        { x: 50, y: -20 },
        { x: 50, y: 120 },
      ],
      20,
      "round",
      provider,
    );
    expect(eraser.ok).toBe(true);
    if (!eraser.ok) return;

    const result = erasePaintedVectorNetwork(
      source,
      eraser.path,
      provider,
      "erased",
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.network) return;
    expect(result.changed).toBe(true);
    expect(result.network.paths).toHaveLength(2);
    expect(result.network.regions).toHaveLength(1);
    expect(result.network.regions[0]?.fills).toEqual([
      { type: "solid", color: "#ff3355", opacity: 1 },
    ]);
  });

  it("returns an empty result when the gesture removes the entire shape", () => {
    const source = paintedRect("source", "#ff3355");
    const eraser = createVectorEraserPath(
      [{ x: 50, y: 50 }],
      200,
      "square",
      provider,
    );
    expect(eraser.ok).toBe(true);
    if (!eraser.ok) return;
    expect(
      erasePaintedVectorNetwork(source, eraser.path, provider, "erased"),
    ).toMatchObject({ ok: true, changed: true, network: null });
  });

  it("does not rewrite geometry when the eraser misses", () => {
    const source = paintedRect("source", "#ff3355");
    const eraser = createVectorEraserPath(
      [{ x: 300, y: 300 }],
      20,
      "round",
      provider,
    );
    expect(eraser.ok).toBe(true);
    if (!eraser.ok) return;
    expect(
      erasePaintedVectorNetwork(source, eraser.path, provider, "erased"),
    ).toEqual({ ok: true, changed: false, network: source });
  });

  it("preserves independently painted region appearance", () => {
    const red = paintedRect("red", "#ff0000");
    const blue = paintedRect("blue", "#0000ff", 120);
    const source: VectorNetwork = {
      vertices: [...red.vertices, ...blue.vertices],
      segments: [...red.segments, ...blue.segments],
      paths: [...red.paths, ...blue.paths],
      regions: [...red.regions, ...blue.regions],
    };
    const eraser = createVectorEraserPath(
      [
        { x: 50, y: -20 },
        { x: 50, y: 120 },
      ],
      16,
      "round",
      provider,
    );
    expect(eraser.ok).toBe(true);
    if (!eraser.ok) return;
    const result = erasePaintedVectorNetwork(
      source,
      eraser.path,
      provider,
      "erased",
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.network) return;
    expect(result.network.regions.map((region) => region.fills)).toEqual([
      [{ type: "solid", color: "#ff0000", opacity: 1 }],
      [{ type: "solid", color: "#0000ff", opacity: 1 }],
    ]);
  });

  it("rejects invalid gestures before invoking geometry", () => {
    expect(createVectorEraserPath([], 20, "round", provider)).toMatchObject({
      ok: false,
      code: "invalid-input",
    });
    expect(
      createVectorEraserPath([{ x: 0, y: 0 }], 0, "square", provider),
    ).toMatchObject({ ok: false, code: "invalid-input" });
  });
});

function paintedRect(prefix: string, color: string, x = 0): VectorNetwork {
  const result = materializeVectorNetwork(
    `M${x} 0L${x + 100} 0L${x + 100} 100L${x} 100Z`,
    "nonzero",
    prefix,
  );
  if (!result.ok) throw new Error(result.message);
  result.network.regions[0]!.fills = [{ type: "solid", color, opacity: 1 }];
  return result.network;
}
