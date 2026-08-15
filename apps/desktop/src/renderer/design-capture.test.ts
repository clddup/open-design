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
    const textRunProjection = {
      documentId: documentSnapshot.documentId,
      pageId: "page_welcome",
      revision: documentSnapshot.revision,
      resultsByNodeId: new Map(),
    };
    const target = {
      kind: "frame" as const,
      pageId: "page_welcome",
      nodeId: "frame_welcome",
    };

    const result = await captureDesignTarget(
      documentSnapshot,
      target,
      undefined,
      { createAdapter, textRunProjection },
    );

    expect(result.bytes).toEqual(new Uint8Array([4, 5, 6]));
    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith({
      document: documentSnapshot,
      pageId: "page_welcome",
      reducedMotion: true,
      selection: { nodeIds: [] },
      textRunProjection,
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
        { createAdapter },
      ),
    ).rejects.toThrow("Capture Page is unavailable");
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("bounds a stalled offscreen export and disposes its surface", async () => {
    const documentSnapshot = createWelcomeDocument();
    const adapter = {
      capture: vi.fn(() => new Promise<never>(() => undefined)),
      dispose: vi.fn(),
      exportRaster: vi.fn(),
      finishGenerationPresentation: vi.fn(),
      retryBooleanGeometry: vi.fn(),
      setVectorPointMode: vi.fn(),
      sync: vi.fn(),
      textLayoutProvider: {
        id: "test-text-layout",
        version: "1",
        measure: vi.fn(),
      },
    } satisfies LeaferEngineAdapter;

    await expect(
      captureDesignTarget(
        documentSnapshot,
        {
          kind: "frame",
          pageId: "page_welcome",
          nodeId: "frame_welcome",
        },
        undefined,
        { createAdapter: vi.fn().mockResolvedValue(adapter), timeoutMs: 5 },
      ),
    ).rejects.toThrow("design_capture.export_timeout");
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-capture-surface="design-target"]'),
    ).toBeNull();
  });

  it("reports only real capture stage transitions", async () => {
    const documentSnapshot = createWelcomeDocument();
    const onStage = vi.fn();
    const adapter = {
      capture: vi.fn().mockResolvedValue({
        bytes: new Uint8Array([1]),
        height: 10,
        mimeType: "image/jpeg" as const,
        width: 10,
      }),
      dispose: vi.fn(),
      exportRaster: vi.fn(),
      finishGenerationPresentation: vi.fn(),
      retryBooleanGeometry: vi.fn(),
      setVectorPointMode: vi.fn(),
      sync: vi.fn(),
      textLayoutProvider: {
        id: "test-text-layout",
        version: "1",
        measure: vi.fn(),
      },
    } satisfies LeaferEngineAdapter;

    await captureDesignTarget(
      documentSnapshot,
      {
        kind: "frame",
        pageId: "page_welcome",
        nodeId: "frame_welcome",
      },
      undefined,
      {
        createAdapter: vi.fn().mockResolvedValue(adapter),
        onStage,
      },
    );

    expect(
      onStage.mock.calls.map((call) => call[0] as string | undefined),
    ).toEqual([
      "surface-created",
      "adapter-created",
      "scene-synced",
      "export-started",
      "export-completed",
    ]);
  });
});
