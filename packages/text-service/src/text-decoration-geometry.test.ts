import { describe, expect, it, vi } from "vitest";
import {
  subtractTextDecorationInk,
  type TextDecorationGeometryPath,
  type TextDecorationGeometryProvider,
} from "./text-decoration-geometry.js";

describe("text decoration geometry", () => {
  it("positions glyph outlines and subtracts long runs in bounded batches", () => {
    const batchSizes: number[] = [];
    const transform = vi.fn(
      (
        path: TextDecorationGeometryPath,
        matrix: [number, number, number, number, number, number],
      ) => ({
        empty: false,
        fillRule: "nonzero" as const,
        ok: true as const,
        path: `${path.path}@${matrix[4]},${matrix[5]}`,
      }),
    );
    const provider: TextDecorationGeometryProvider = {
      combine: (paths) => {
        batchSizes.push(paths.length);
        return {
          empty: false,
          fillRule: "nonzero",
          ok: true,
          path: `${paths[0]!.path}#${paths.length - 1}`,
        };
      },
      transform,
    };
    const glyphs = Array.from({ length: 130 }, (_, index) => ({
      path: `M${index} 0Z`,
      x: index * 2,
      y: -index,
    }));

    const result = subtractTextDecorationInk("M0 0H500V2H0Z", glyphs, provider);

    expect(result).toMatchObject({ empty: false, ok: true });
    expect(batchSizes).toEqual([65, 65, 3]);
    expect(transform).toHaveBeenCalledTimes(130);
    expect(transform).toHaveBeenNthCalledWith(
      2,
      { fillRule: "nonzero", path: "M1 0Z" },
      [1, 0, 0, 1, 2, -1],
    );
  });

  it("preserves empty glyphs and reports geometry failures", () => {
    const provider: TextDecorationGeometryProvider = {
      combine: () => ({ message: "difference failed", ok: false }),
      transform: (path) => ({
        empty: false,
        fillRule: "nonzero",
        ok: true,
        path: path.path,
      }),
    };
    expect(
      subtractTextDecorationInk(
        "M0 0H10V2H0Z",
        [{ path: "", x: 0, y: 0 }],
        provider,
      ),
    ).toEqual({ empty: false, ok: true, path: "M0 0H10V2H0Z" });
    expect(
      subtractTextDecorationInk(
        "M0 0H10V2H0Z",
        [{ path: "M0 0H1V1Z", x: 0, y: 0 }],
        provider,
      ),
    ).toEqual({
      message: "Exact underline skip-ink clipping failed: difference failed",
      ok: false,
    });
  });
});
