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
      settings: { objects: false, pixelGrid: false },
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
      settings: { objects: false, pixelGrid: false },
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
      settings: { objects: false, pixelGrid: false },
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
      settings: { objects: false, pixelGrid: false },
      viewport: { panX: 0, panY: 0, zoom: 1, width: 800, height: 600 },
    });

    const actual = [94, 96, 99, 101, 104, 106, 104, 96].map((rawX) => {
      bounds = { ...bounds, x: rawX };
      controller.update();
      return bounds.x;
    });

    expect(actual).toEqual([94, 100, 100, 100, 100, 106, 100, 100]);
  });
});
