import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import {
  resolveLineEndpointGeometry,
  resolveLineEndpointVisiblePath,
  serializeLineEndpointPath,
  type PaintedLineEndpoint,
} from "./line-endpoint.js";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "./vector-path.js";

const require = createRequire(import.meta.url);
const ENDPOINTS: readonly PaintedLineEndpoint[] = [
  "line-arrow",
  "triangle-arrow",
  "reversed-triangle-arrow",
  "circle",
  "diamond",
];
let provider: VectorGeometryProvider;

beforeAll(async () => {
  provider = await createPathKitGeometryProvider({
    wasmBinary: await readFile(
      require.resolve("pathkit-wasm/bin/pathkit.wasm"),
    ),
  });
});

describe("line endpoint geometry", () => {
  it.each(ENDPOINTS)(
    "materializes %s as exact visible geometry",
    (endpoint) => {
      const result = resolveLineEndpointVisiblePath({
        endpoint,
        lineStart: { x: 12, y: 18 },
        lineEnd: { x: 132, y: 78 },
        position: "end",
        provider,
        strokeCap: "round",
        strokeJoin: "round",
        strokeWidth: 4,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.empty).toBe(false);
      expect(result.bounds?.width).toBeGreaterThan(0);
      expect(result.bounds?.height).toBeGreaterThan(0);
    },
  );

  it("uses opposite endpoint directions without changing the shared shape", () => {
    const options = {
      endpoint: "triangle-arrow" as const,
      lineStart: { x: 10, y: 20 },
      lineEnd: { x: 110, y: 20 },
      provider,
      strokeCap: "square" as const,
      strokeJoin: "bevel" as const,
      strokeWidth: 10,
    };
    const start = resolveLineEndpointVisiblePath({
      ...options,
      position: "start",
    });
    const end = resolveLineEndpointVisiblePath({ ...options, position: "end" });

    expect(start.ok && end.ok).toBe(true);
    if (!start.ok || !end.ok) return;
    expect(start.bounds).not.toBeNull();
    expect(end.bounds).not.toBeNull();
    if (!start.bounds || !end.bounds) return;
    expect(start.bounds.x).toBeLessThan(options.lineStart.x);
    expect(end.bounds.x + end.bounds.width).toBeGreaterThan(options.lineEnd.x);
    expect(start.bounds.width).toBeCloseTo(end.bounds.width);
    expect(start.bounds.x + end.bounds.x + end.bounds.width).toBeCloseTo(120);
  });

  it("rejects zero-length Lines before producing partial endpoint geometry", () => {
    expect(
      resolveLineEndpointVisiblePath({
        endpoint: "diamond",
        lineStart: { x: 20, y: 20 },
        lineEnd: { x: 20, y: 20 },
        position: "end",
        provider,
        strokeCap: "butt",
        strokeJoin: "miter",
        strokeWidth: 4,
      }),
    ).toMatchObject({
      ok: false,
      code: "invalid-input",
      message: "Line endpoint requires a non-zero line",
    });
  });

  it("serializes the same canonical path consumed by SVG and adapters", () => {
    expect(
      serializeLineEndpointPath(resolveLineEndpointGeometry("line-arrow")),
    ).toBe("M-3 -2.25L0 0L-3 2.25");
    expect(
      serializeLineEndpointPath(resolveLineEndpointGeometry("diamond")),
    ).toBe("M2 0L0 2L-2 0L0 -2Z");
  });
});
