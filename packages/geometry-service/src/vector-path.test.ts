import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createPathKitGeometryProvider,
  VECTOR_GEOMETRY_PROVIDER_ID,
  VECTOR_GEOMETRY_PROVIDER_VERSION,
  type CreatePathKitGeometryProviderOptions,
  type VectorBooleanOperation,
  type VectorGeometryProvider,
} from "@opendesign/geometry-service/vector-path";

const require = createRequire(import.meta.url);
let provider: VectorGeometryProvider;

beforeAll(async () => {
  const wasmPath = require.resolve("pathkit-wasm/bin/pathkit.wasm");
  provider = await createPathKitGeometryProvider({
    wasmBinary: await readFile(wasmPath),
  });
});

describe("Skia PathKit geometry provider", () => {
  it("requires the host to provide an explicit WASM source", async () => {
    await expect(
      createPathKitGeometryProvider({} as CreatePathKitGeometryProviderOptions),
    ).rejects.toThrow("explicit locateFile or wasmBinary");
  });

  it("pins provider identity without exposing PathKit objects", () => {
    expect(provider.id).toBe(VECTOR_GEOMETRY_PROVIDER_ID);
    expect(provider.version).toBe(VECTOR_GEOMETRY_PROVIDER_VERSION);
    expect(provider.id).toBe("skia-pathkit");
    expect(provider.version).toBe("1.0.0");
  });

  it("performs deterministic union and subtract operations on cubic paths", () => {
    const inputs = [
      {
        path: "M0 50C0 22.386 22.386 0 50 0S100 22.386 100 50S77.614 100 50 100S0 77.614 0 50Z",
      },
      { path: "M50 25H125V75H50Z" },
    ];
    const first = provider.combine(inputs, "union");
    const second = provider.combine(inputs, "union");
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      empty: false,
      provider: "skia-pathkit",
      providerVersion: "1.0.0",
    });
    if (!first.ok) throw new Error(first.message);
    expect(first.path).toContain("C");
    expect(first.bounds).toMatchObject({
      x: 0,
      y: 0,
      width: 125,
      height: 100,
    });

    const subtracted = provider.combine(
      [{ path: "M0 0H100V100H0Z" }, { path: "M25 25H75V75H25Z" }],
      "subtract",
    );
    expect(subtracted).toMatchObject({
      ok: true,
      empty: false,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    if (!subtracted.ok) throw new Error(subtracted.message);
    expect(subtracted.path.match(/M/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("supports intersect and exclude, including an honest empty result", () => {
    expect(
      provider.combine(
        [{ path: "M0 0H40V40H0Z" }, { path: "M20 0H60V40H20Z" }],
        "intersect",
      ),
    ).toMatchObject({
      ok: true,
      empty: false,
      bounds: { x: 20, y: 0, width: 20, height: 40 },
    });
    expect(
      provider.combine(
        [{ path: "M0 0H10V10H0Z" }, { path: "M20 20H30V30H20Z" }],
        "intersect",
      ),
    ).toMatchObject({ ok: true, empty: true, path: "", bounds: null });
    const excluded = provider.combine(
      [{ path: "M0 0H40V40H0Z" }, { path: "M20 0H60V40H20Z" }],
      "exclude",
    );
    expect(excluded).toMatchObject({
      ok: true,
      empty: false,
      bounds: { x: 0, y: 0, width: 60, height: 40 },
    });
  });

  it("converts open strokes to editable outline geometry", () => {
    const outlined = provider.outlineStroke(
      { path: "M10 20C40 0 60 40 90 20" },
      { width: 12, cap: "round", join: "round", miterLimit: 4 },
    );
    expect(outlined).toMatchObject({ ok: true, empty: false });
    if (!outlined.ok) throw new Error(outlined.message);
    expect(outlined.path.endsWith("Z")).toBe(true);
    expect(outlined.bounds?.width).toBeGreaterThan(80);
    expect(outlined.bounds?.height).toBeGreaterThan(12);
  });

  it("normalizes self-intersections and rejects malformed or unsafe inputs", () => {
    expect(
      provider.normalize({ path: "M0 0L100 100L0 100L100 0Z" }),
    ).toMatchObject({ ok: true, empty: false });
    expect(provider.normalize({ path: "javascript:alert(1)" })).toMatchObject({
      ok: false,
      code: "invalid-input",
    });
    expect(provider.normalize({ path: "M0 0L" })).toMatchObject({
      ok: false,
      code: "parse-failed",
    });
    const evenOdd = provider.normalize({
      path: "M0 0H100V100H0ZM25 25H75V75H25Z",
      fillRule: "evenodd",
    });
    expect(evenOdd).toMatchObject({ ok: true, fillRule: "evenodd" });
    expect(provider.combine([{ path: "M0 0Z" }], "union")).toMatchObject({
      ok: false,
      code: "insufficient-paths",
    });
    expect(
      provider.combine(
        [{ path: "M0 0H10V10H0Z" }, { path: "M5 0H15V10H5Z" }],
        "merge" as VectorBooleanOperation,
      ),
    ).toMatchObject({ ok: false, code: "invalid-input" });
    expect(
      provider.normalize({ path: `M${"0".repeat(200_000)}` }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
    expect(
      provider.combine(
        Array.from({ length: 129 }, () => ({ path: "M0 0Z" })),
        "union",
      ),
    ).toMatchObject({ ok: false, code: "invalid-input" });
    expect(
      provider.outlineStroke(
        { path: "M0 0L10 10" },
        { width: Number.NaN, cap: "butt", join: "miter", miterLimit: 4 },
      ),
    ).toMatchObject({ ok: false, code: "invalid-input" });
  });
});
