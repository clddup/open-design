import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import { exportDesignRaster } from "./raster-export.js";

const request = {
  version: 1,
  pageId: "page_welcome",
  rootNodeId: "frame_welcome",
  format: "png",
  size: { mode: "scale", value: 2 },
  background: { mode: "transparent" },
  resampling: "smooth",
} as const;

describe("exportDesignRaster", () => {
  it("uses an isolated frozen projection and disposes it after delivery", async () => {
    const sync = vi.fn();
    const dispose = vi.fn();
    const exportRaster = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      width: 2240,
      height: 1440,
      mimeType: "image/png",
    });
    const result = await exportDesignRaster(
      createWelcomeDocument(),
      request,
      undefined,
      vi.fn().mockResolvedValue({ sync, dispose, exportRaster }),
    );

    expect(result.mimeType).toBe("image/png");
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "page_welcome",
        selection: { nodeIds: [] },
        reducedMotion: true,
      }),
    );
    expect(exportRaster).toHaveBeenCalledWith(request);
    expect(dispose).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-export-surface]")).toBeNull();
  });

  it("rejects stale scope and cancellation without creating an adapter", async () => {
    const createAdapter = vi.fn();
    await expect(
      exportDesignRaster(
        createWelcomeDocument(),
        { ...request, rootNodeId: "missing" },
        undefined,
        createAdapter,
      ),
    ).rejects.toThrow("outside Page");
    expect(createAdapter).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort();
    await expect(
      exportDesignRaster(
        createWelcomeDocument(),
        request,
        controller.signal,
        createAdapter,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
