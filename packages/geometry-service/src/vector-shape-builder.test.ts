import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { VectorNetwork } from "@opendesign/design-contracts";
import { beforeAll, describe, expect, it } from "vitest";
import {
  materializeVectorNetwork,
  mergeVectorNetworks,
} from "./vector-materialization.js";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "./vector-path.js";
import { serializeVectorNetwork } from "./editable-vector.js";
import { buildVectorShapeBuilderEdit } from "./vector-shape-builder.js";

const require = createRequire(import.meta.url);
let provider: VectorGeometryProvider;

beforeAll(async () => {
  provider = await createPathKitGeometryProvider({
    wasmBinary: await readFile(
      require.resolve("pathkit-wasm/bin/pathkit.wasm"),
    ),
  });
});

describe("vector Shape Builder geometry", () => {
  it("extracts one overlap region and preserves its topmost paint", () => {
    const sources = overlappingSources();
    const result = buildVectorShapeBuilderEdit(
      sources,
      [{ x: 75, y: 50 }],
      "extract",
      provider,
      "shape_extract",
    );

    expect(result).toMatchObject({
      ok: true,
      action: "extract",
      selectedSourceIds: ["left", "right"],
      sourceResults: [
        { sourceId: "left", changed: true },
        { sourceId: "right", changed: true },
      ],
    });
    if (!result.ok || !result.resultNetwork) return;
    expect(bounds(result.resultNetwork)).toEqual({
      x: 50,
      y: 0,
      width: 50,
      height: 100,
    });
    expect(result.resultNetwork.regions[0]?.fills).toEqual([
      { type: "solid", color: "#2563eb", opacity: 1 },
    ]);
    expect(bounds(result.sourceResults[0]!.network!)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 100,
    });
    expect(bounds(result.sourceResults[1]!.network!)).toEqual({
      x: 100,
      y: 0,
      width: 50,
      height: 100,
    });
  });

  it("merges every region crossed by a drag into one painted result", () => {
    const sources = overlappingSources();
    sources.forEach(({ network }) =>
      network.regions.forEach((region) => {
        region.fills = [{ type: "solid", color: "#2563eb", opacity: 1 }];
      }),
    );
    const result = buildVectorShapeBuilderEdit(
      sources,
      [
        { x: 25, y: 50 },
        { x: 125, y: 50 },
      ],
      "merge",
      provider,
      "shape_merge",
    );

    expect(result).toMatchObject({
      ok: true,
      action: "merge",
      sourceResults: [
        { sourceId: "left", changed: true, network: null },
        { sourceId: "right", changed: true, network: null },
      ],
    });
    if (!result.ok || !result.resultNetwork) return;
    expect(result.selectedRegionIds).toHaveLength(3);
    expect(bounds(result.resultNetwork)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 100,
    });
    expect(result.resultNetwork.regions).toHaveLength(1);
    expect(result.resultNetwork.regions[0]?.fills).toEqual([
      { type: "solid", color: "#2563eb", opacity: 1 },
    ]);
  });

  it("subtracts only the hit atomic region and leaves missed sources untouched", () => {
    const sources = overlappingSources();
    const result = buildVectorShapeBuilderEdit(
      sources,
      [{ x: 25, y: 50 }],
      "subtract",
      provider,
      "shape_subtract",
    );

    expect(result).toMatchObject({
      ok: true,
      action: "subtract",
      resultNetwork: null,
      selectedSourceIds: ["left"],
      sourceResults: [
        { sourceId: "left", changed: true },
        { sourceId: "right", changed: false },
      ],
    });
    if (!result.ok) return;
    expect(bounds(result.sourceResults[0]!.network!)).toEqual({
      x: 50,
      y: 0,
      width: 50,
      height: 100,
    });
    expect(result.sourceResults[1]!.network).toEqual(sources[1]!.network);
  });

  it("resolves explicit regions already authored inside one Vector Network", () => {
    const source = mergeVectorNetworks([
      paintedRect("top", "#f97316", 0, 0, 100, 50),
      paintedRect("bottom", "#16a34a", 0, 50, 100, 50),
    ]);
    if (!source.ok) throw new Error(source.message);
    const result = buildVectorShapeBuilderEdit(
      [{ sourceId: "slices", network: source.network }],
      [{ x: 50, y: 25 }],
      "subtract",
      provider,
      "shape_authored",
    );

    expect(result).toMatchObject({
      ok: true,
      selectedSourceIds: ["slices"],
      sourceResults: [{ changed: true, sourceId: "slices" }],
    });
    if (!result.ok || !result.sourceResults[0]?.network) return;
    expect(bounds(result.sourceResults[0].network)).toEqual({
      x: 0,
      y: 50,
      width: 100,
      height: 50,
    });
    expect(result.sourceResults[0].network.regions[0]?.fills).toEqual([
      { type: "solid", color: "#16a34a", opacity: 1 },
    ]);
  });

  it("keeps disconnected components independently clickable", () => {
    const ring = paintedPath(
      "ring",
      "#ef4444",
      "M0 0L200 0L200 200L0 200Z M50 50L150 50L150 150L50 150Z",
      "evenodd",
    );
    const stripe = paintedRect("stripe", "#2563eb", 80, -20, 40, 240);
    const result = buildVectorShapeBuilderEdit(
      [
        { sourceId: "ring", network: ring },
        { sourceId: "stripe", network: stripe },
      ],
      [{ x: 100, y: 25 }],
      "extract",
      provider,
      "shape_component",
    );

    expect(result).toMatchObject({ ok: true, action: "extract" });
    if (!result.ok || !result.resultNetwork) return;
    expect(bounds(result.resultNetwork)).toEqual({
      x: 80,
      y: 0,
      width: 40,
      height: 50,
    });
  });

  it("preserves holes while exposing a nested painted island independently", () => {
    const target = paintedPath(
      "nested",
      "#7c3aed",
      [
        "M0 0L200 0L200 200L0 200Z",
        "M40 40L160 40L160 160L40 160Z",
        "M80 80L120 80L120 120L80 120Z",
      ].join(" "),
      "evenodd",
    );
    expect(
      buildVectorShapeBuilderEdit(
        [{ sourceId: "nested", network: target }],
        [{ x: 60, y: 60 }],
        "extract",
        provider,
        "shape_hole",
      ),
    ).toMatchObject({ ok: false, code: "no-region" });

    const island = buildVectorShapeBuilderEdit(
      [{ sourceId: "nested", network: target }],
      [{ x: 100, y: 100 }],
      "extract",
      provider,
      "shape_island",
    );
    expect(island).toMatchObject({ ok: true, action: "extract" });
    if (!island.ok || !island.resultNetwork) return;
    expect(bounds(island.resultNetwork)).toEqual({
      x: 80,
      y: 80,
      width: 40,
      height: 40,
    });
  });

  it("fails closed for misses and action-specific ambiguous selections", () => {
    expect(
      buildVectorShapeBuilderEdit(
        overlappingSources(),
        [{ x: 300, y: 300 }],
        "subtract",
        provider,
        "shape_miss",
      ),
    ).toMatchObject({ ok: false, code: "no-region" });
    expect(
      buildVectorShapeBuilderEdit(
        overlappingSources(),
        [
          { x: 25, y: 50 },
          { x: 125, y: 50 },
        ],
        "extract",
        provider,
        "shape_ambiguous",
      ),
    ).toMatchObject({ ok: false, code: "ambiguous-region" });
    expect(
      buildVectorShapeBuilderEdit(
        overlappingSources(),
        [{ x: 75, y: 50 }],
        "merge",
        provider,
        "shape_insufficient",
      ),
    ).toMatchObject({ ok: false, code: "insufficient-regions" });
    expect(
      buildVectorShapeBuilderEdit(
        overlappingSources(),
        [
          { x: 25, y: 50 },
          { x: 125, y: 50 },
        ],
        "merge",
        provider,
        "shape_mixed_paint",
      ),
    ).toMatchObject({ ok: false, code: "ambiguous-region" });
  });
});

function overlappingSources() {
  return [
    {
      sourceId: "left",
      network: paintedRect("left", "#ef4444", 0, 0, 100, 100),
    },
    {
      sourceId: "right",
      network: paintedRect("right", "#2563eb", 50, 0, 100, 100),
    },
  ];
}

function paintedRect(
  prefix: string,
  color: string,
  x: number,
  y: number,
  width: number,
  height: number,
): VectorNetwork {
  const result = materializeVectorNetwork(
    `M${x} ${y}L${x + width} ${y}L${x + width} ${y + height}L${x} ${y + height}Z`,
    "nonzero",
    prefix,
  );
  if (!result.ok) throw new Error(result.message);
  result.network.regions[0]!.fills = [{ type: "solid", color, opacity: 1 }];
  return result.network;
}

function paintedPath(
  prefix: string,
  color: string,
  path: string,
  fillRule: "evenodd" | "nonzero",
): VectorNetwork {
  const materialized = materializeVectorNetwork(path, fillRule, prefix);
  if (!materialized.ok) throw new Error(materialized.message);
  materialized.network.regions.forEach((region) => {
    region.fills = [{ type: "solid", color, opacity: 1 }];
  });
  return materialized.network;
}

function bounds(network: VectorNetwork) {
  const serialized = serializeVectorNetwork(network);
  if (!serialized.ok) {
    throw new Error(serialized.issues.map((issue) => issue.message).join("; "));
  }
  return serialized.bounds;
}
