import { createWelcomeDocument } from "@opendesign/editor-runtime";
import type { LeaferEngineAdapter } from "@opendesign/leafer-engine";
import { describe, expect, it, vi } from "vitest";
import { captureDesignTarget } from "./design-capture";

describe("deterministic design target capture", () => {
  it("projects an immutable document into an offscreen Leafer target", async () => {
    const documentSnapshot = createWelcomeDocument();
    const capture = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([4, 5, 6]),
      height: 720,
      mimeType: "image/jpeg",
      width: 1_200,
    });
    const sync = vi.fn();
    const dispose = vi.fn();
    const adapter = {
      capture,
      dispose,
      exportRaster: vi.fn(),
      finishGenerationPresentation: vi.fn(),
      retryBooleanGeometry: vi.fn(),
      setVectorPointMode: vi.fn(),
      sync,
      textLayoutProvider: {
        id: "test-text-layout",
        version: "1",
        measure: vi.fn(),
      },
    } satisfies LeaferEngineAdapter;
    const createAdapter = vi.fn().mockResolvedValue(adapter);
    const target = {
      kind: "frame" as const,
      pageId: "page_welcome",
      nodeId: "frame_welcome",
    };

    const result = await captureDesignTarget(
      documentSnapshot,
      target,
      undefined,
      createAdapter,
    );

    expect(result.bytes).toEqual(new Uint8Array([4, 5, 6]));
    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith({
      document: documentSnapshot,
      pageId: "page_welcome",
      reducedMotion: true,
      selection: { nodeIds: [] },
      tool: "select",
      viewport: {
        panX: 0,
        panY: 0,
        zoom: 1,
        width: 1_280,
        height: 960,
      },
    });
    expect(capture).toHaveBeenCalledWith(target);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-capture-surface="design-target"]'),
    ).toBeNull();
  });

  it("rejects missing Pages without creating a rendering surface", async () => {
    const createAdapter = vi.fn();
    await expect(
      captureDesignTarget(
        createWelcomeDocument(),
        { kind: "page", pageId: "page_missing" },
        undefined,
        createAdapter,
      ),
    ).rejects.toThrow("Capture Page is unavailable");
    expect(createAdapter).not.toHaveBeenCalled();
  });
});
