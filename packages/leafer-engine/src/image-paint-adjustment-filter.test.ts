// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { installLeaferImagePaintAdjustmentFilter } from "./image-paint-adjustment-filter.js";

afterEach(() => vi.restoreAllMocks());

describe("Leafer Image Paint adjustments", () => {
  it("derives and reuses one adjusted image per source/filter identity", () => {
    const pixels = new Uint8ClampedArray([80, 100, 120, 255]);
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: pixels })),
      putImageData: vi.fn(),
    };
    vi.spyOn(document, "createElement").mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement);
    const derivatives: Array<Record<string, unknown>> = [];
    const paintImage: {
      applyFilter?: (
        leafPaint: unknown,
        source: unknown,
        filters: unknown,
        ui: unknown,
      ) => void;
      recycleImage: ReturnType<typeof vi.fn>;
    } = {
      recycleImage: vi.fn(() => ({})),
    };
    const leafer = {
      PaintImage: paintImage,
      Creator: {
        image: vi.fn((config: Record<string, unknown>) => {
          const derivative = {
            ...config,
            use: 0,
            destroy: vi.fn(),
          };
          derivatives.push(derivative);
          return derivative;
        }),
      },
    };
    installLeaferImagePaintAdjustmentFilter(leafer as never);
    const source = {
      url: "data:image/png;base64,AQID",
      view: {},
      width: 1,
      height: 1,
      use: 2,
      hasAlphaPixel: true,
      getFull() {
        return this.view;
      },
      destroyFilter: vi.fn(),
    };
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = {};

    paintImage.applyFilter?.(
      first,
      source,
      [{ type: "exposure", value: 0.25 }],
      {},
    );
    paintImage.applyFilter?.(
      second,
      source,
      [{ type: "exposure", value: 0.25 }],
      {},
    );

    expect(derivatives).toHaveLength(1);
    expect(first.image).toBe(second.image);
    expect((first.image as { parent: unknown }).parent).toBe(source);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(context.putImageData).toHaveBeenCalledOnce();
    expect([...pixels]).not.toEqual([80, 100, 120, 255]);
  });
});
