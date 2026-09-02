import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import { DirectMoveSnapController } from "./direct-move-snap-controller.js";

describe("DirectMoveSnapController", () => {
  it("treats each Leafer move event as raw and reapplies modifier changes", () => {
    const document = structuredClone(createWelcomeDocument());
    document.pagesById.page_welcome!.guides = [{ axis: "X", offset: 100 }];
    let bounds = { x: 97, y: 40, width: 20, height: 20 };
    const onLines = vi.fn();
    const controller = new DirectMoveSnapController({
      onLines,
      selectionBounds: () => bounds,
      selectionFrame: () => ({
        bounds,
        transform: [1, 0, 0, 1, 0, 0],
      }),
      translate: (_nodeIds, delta) => {
        bounds = { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y };
        return true;
      },
    });
    controller.begin({
      document,
      excludedNodeIds: new Set(["title_welcome"]),
      nodeIds: ["title_welcome"],
      pageId: "page_welcome",
      rulerGuidesVisible: true,
      settings: { geometry: false, objects: false, pixelGrid: false },
      viewport: { panX: 0, panY: 0, zoom: 1, width: 800, height: 600 },
    });

    controller.update();
    expect(bounds.x).toBe(100);
    bounds = { ...bounds, x: 98 };
    controller.update();
    expect(bounds.x).toBe(100);

    controller.setSuppressed(true);
    expect(bounds.x).toBe(98);
    expect(onLines).toHaveBeenLastCalledWith([]);
    controller.setSuppressed(false);
    expect(bounds.x).toBe(100);
    const nextDocument = structuredClone(document);
    nextDocument.pagesById.page_welcome!.guides = [{ axis: "X", offset: 130 }];
    controller.refresh({
      document: nextDocument,
      excludedNodeIds: new Set(["title_welcome"]),
      nodeIds: ["title_welcome"],
      pageId: "page_welcome",
      rulerGuidesVisible: true,
      settings: { geometry: false, objects: false, pixelGrid: false },
      viewport: { panX: 0, panY: 0, zoom: 1, width: 800, height: 600 },
    });
    expect(bounds.x).toBe(98);
    controller.finish();
    expect(bounds.x).toBe(98);
  });

  it("scopes Frame-local guides to layers inside that Frame", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing Frame");
    frame.properties.guides = [{ axis: "X", offset: 70 }];
    let bounds = { x: 148, y: 40, width: 20, height: 20 };
    const controller = new DirectMoveSnapController({
      onLines: vi.fn(),
      selectionBounds: () => bounds,
      selectionFrame: () => ({
        bounds,
        transform: [1, 0, 0, 1, 0, 0],
      }),
      translate: (_nodeIds, delta) => {
        bounds = { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y };
        return true;
      },
    });
    const shared = {
      document,
      excludedNodeIds: new Set<string>(),
      pageId: "page_welcome",
      rulerGuidesVisible: true,
      settings: { geometry: false, objects: false, pixelGrid: false },
      viewport: { panX: 0, panY: 0, zoom: 1, width: 800, height: 600 },
    };

    controller.begin({ ...shared, nodeIds: ["title_welcome"] });
    controller.update();
    expect(bounds.x).toBe(150);
    controller.finish();

    bounds = { ...bounds, x: 148 };
    controller.begin({ ...shared, nodeIds: ["frame_welcome"] });
    controller.update();
    expect(bounds.x).toBe(148);
  });

  it("enters, crosses, and leaves the threshold without accumulating correction", () => {
    const document = structuredClone(createWelcomeDocument());
    document.pagesById.page_welcome!.guides = [{ axis: "X", offset: 100 }];
    let bounds = { x: 94, y: 40, width: 100, height: 20 };
    const controller = new DirectMoveSnapController({
      onLines: vi.fn(),
      selectionBounds: () => bounds,
      selectionFrame: () => ({
        bounds,
        transform: [1, 0, 0, 1, 0, 0],
      }),
      translate: (_nodeIds, delta) => {
        bounds = { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y };
        return true;
      },
    });
    controller.begin({
      document,
      excludedNodeIds: new Set(["title_welcome"]),
      nodeIds: ["title_welcome"],
      pageId: "page_welcome",
      rulerGuidesVisible: true,
      settings: { geometry: false, objects: false, pixelGrid: false },
      viewport: { panX: 0, panY: 0, zoom: 1, width: 800, height: 600 },
    });

    const actual = [94, 96, 99, 101, 104, 106, 104, 96].map((rawX) => {
      bounds = { ...bounds, x: rawX };
      controller.update();
      return bounds.x;
    });

    expect(actual).toEqual([94, 100, 100, 100, 100, 106, 100, 100]);
  });

  it("snaps inside a rotated Frame to its visible local guide", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing Frame");
    const c = Math.SQRT1_2;
    frame.transform = [c, c, -c, c, 100, 100];
    frame.properties.guides = [{ axis: "X", offset: 70 }];
    let selectionFrame = {
      bounds: { x: 68, y: 20, width: 20, height: 20 },
      transform: [...frame.transform] as typeof frame.transform,
    };
    const translations: Array<{ x: number; y: number }> = [];
    const onLines = vi.fn();
    const controller = new DirectMoveSnapController({
      onLines,
      selectionBounds: () => ({ x: 120, y: 160, width: 30, height: 30 }),
      selectionFrame: () => selectionFrame,
      translate: (_nodeIds, delta) => {
        translations.push(delta);
        const transform = [
          ...selectionFrame.transform,
        ] as typeof frame.transform;
        transform[4] += delta.x;
        transform[5] += delta.y;
        selectionFrame = { ...selectionFrame, transform };
        return true;
      },
    });

    controller.begin({
      document,
      excludedNodeIds: new Set(["title_welcome"]),
      nodeIds: ["title_welcome"],
      pageId: "page_welcome",
      rulerGuidesVisible: true,
      settings: { geometry: false, objects: false, pixelGrid: false },
      viewport: { panX: 0, panY: 0, zoom: 1, width: 800, height: 600 },
    });
    controller.update();

    expect(translations).toHaveLength(1);
    expect(translations[0]!.x).toBeCloseTo(2 * c);
    expect(translations[0]!.y).toBeCloseTo(2 * c);
    expect(onLines).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: "segment", source: "guide" }),
    ]);
  });
});
