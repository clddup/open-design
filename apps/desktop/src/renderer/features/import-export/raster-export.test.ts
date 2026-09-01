import { createWelcomeDocument } from "@opendesign/editor-runtime";
import type { LeaferEngineCallbacks } from "@opendesign/leafer-engine";
import { describe, expect, it, vi } from "vitest";
import {
  exportDesignFlattenRaster,
  exportDesignRaster,
} from "./raster-export.js";

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
    const documentSnapshot = createWelcomeDocument();
    const sync = vi.fn();
    const dispose = vi.fn();
    const exportRaster = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      width: 2240,
      height: 1440,
      mimeType: "image/png",
    });
    const textRunProjection = {
      documentId: documentSnapshot.documentId,
      pageId: request.pageId,
      revision: documentSnapshot.revision,
      resultsByNodeId: new Map(),
    };
    const result = await exportDesignRaster(
      documentSnapshot,
      request,
      undefined,
      {
        createAdapter: vi
          .fn()
          .mockResolvedValue({ sync, dispose, exportRaster }),
        textRunProjection,
      },
    );

    expect(result.mimeType).toBe("image/png");
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "page_welcome",
        selection: { nodeIds: [] },
        reducedMotion: true,
        textRunProjection,
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
        { createAdapter },
      ),
    ).rejects.toThrow("outside Page");
    expect(createAdapter).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort();
    await expect(
      exportDesignRaster(createWelcomeDocument(), request, controller.signal, {
        createAdapter,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("isolates an ordered Flatten selection on the same frozen surface", async () => {
    const documentSnapshot = createWelcomeDocument();
    const sync = vi.fn();
    const dispose = vi.fn();
    const exportFlattenRaster = vi.fn().mockResolvedValue({
      bounds: { x: 80, y: 64, width: 320, height: 120 },
      bytes: new Uint8Array([1, 2, 3]),
      width: 640,
      height: 240,
      mimeType: "image/png",
    });
    const flattenRequest = {
      pageId: "page_welcome",
      nodeIds: ["title_welcome", "shape_accent"],
      neutralizeRootNodeId: "title_welcome",
    };
    const result = await exportDesignFlattenRaster(
      documentSnapshot,
      flattenRequest,
      undefined,
      {
        createAdapter: vi.fn().mockResolvedValue({
          sync,
          dispose,
          exportFlattenRaster,
        }),
        textRunProjection: {
          documentId: documentSnapshot.documentId,
          pageId: "page_welcome",
          revision: documentSnapshot.revision,
          resultsByNodeId: new Map(),
        },
      },
    );

    expect(exportFlattenRaster).toHaveBeenCalledWith(flattenRequest);
    expect(result.bounds).toEqual({ x: 80, y: 64, width: 320, height: 120 });
    expect(sync).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("fails closed when the target projection contains a missing image", async () => {
    const documentSnapshot = createWelcomeDocument();
    const dispose = vi.fn();
    const exportRaster = vi.fn();
    const createAdapter = vi
      .fn()
      .mockImplementation(
        (_host: HTMLElement, callbacks: LeaferEngineCallbacks) =>
          Promise.resolve({
            dispose,
            exportRaster,
            sync: () =>
              callbacks.onWarningsChange?.([
                {
                  code: "missing-image",
                  message: "Image data is unavailable",
                  nodeId: "frame_welcome",
                },
              ]),
          }),
      );

    await expect(
      exportDesignRaster(documentSnapshot, request, undefined, {
        createAdapter,
        textRunProjection: {
          documentId: documentSnapshot.documentId,
          pageId: request.pageId,
          revision: documentSnapshot.revision,
          resultsByNodeId: new Map(),
        },
      }),
    ).rejects.toThrow("missing-image (frame_welcome)");
    expect(exportRaster).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
