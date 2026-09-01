import type { DesignNode } from "@opendesign/design-contracts";
import { createEmptyDesignDocument } from "@opendesign/editor-runtime";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import { RASTER_EXPORT_MAX_ENCODED_BYTES } from "@opendesign/import-export-service/raster";
import { describe, expect, it, vi } from "vitest";
import { planFlattenWithRasterFallback } from "./flatten-rasterization";

describe("Renderer Flatten raster fallback", () => {
  it("turns isolated PNG bytes into one atomic Flatten plan", async () => {
    const document = structuredClone(
      createEmptyDesignDocument("flatten", "page"),
    );
    const root: Extract<DesignNode, { kind: "group" }> = {
      id: "root",
      kind: "group",
      name: "Root",
      parentId: null,
      childIds: ["child"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      opacity: 1,
      exportSettings: [],
      properties: {},
      extensions: {},
    };
    const child: Extract<DesignNode, { kind: "rectangle" }> = {
      id: "child",
      kind: "rectangle",
      name: "Child",
      parentId: root.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      opacity: 0.5,
      exportSettings: [],
      properties: {
        fills: [{ type: "solid", color: "#000000", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
      },
      extensions: {},
    };
    document.nodesById.root = root;
    document.nodesById.child = child;
    document.pagesById.page.rootNodeIds = [root.id];
    const rasterize = vi.fn().mockResolvedValue({
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      bytes: new Uint8Array([1, 2, 3]),
      width: 200,
      height: 200,
      mimeType: "image/png",
    });

    const plan = await planFlattenWithRasterFallback({
      document,
      pageId: "page",
      nodeIds: [root.id],
      resultNodeId: "flattened",
      geometryIdPrefix: "flatten",
      provider: {} as VectorGeometryProvider,
      rasterize,
    });

    expect(rasterize).toHaveBeenCalledWith(
      document,
      {
        pageId: "page",
        nodeIds: ["root"],
        neutralizeRootNodeId: "root",
      },
      undefined,
      undefined,
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(plan.operations[0]).toMatchObject({
      type: "put_asset",
      asset: {
        id: "flattened_raster",
        source: { type: "data", value: "AQID" },
      },
    });
  });

  it("does not hide a non-compositing Vector failure behind raster fallback", async () => {
    const document = createEmptyDesignDocument("flatten", "page");
    const rasterize = vi.fn();

    const plan = await planFlattenWithRasterFallback({
      document,
      pageId: "page",
      nodeIds: ["missing"],
      resultNodeId: "flattened",
      geometryIdPrefix: "flatten",
      provider: {} as VectorGeometryProvider,
      rasterize,
    });

    expect(plan).toMatchObject({ ok: false, code: "unsupported-topology" });
    expect(rasterize).not.toHaveBeenCalled();
  });

  it("rejects oversized encoded PNG bytes before base64 allocation", async () => {
    const document = structuredClone(
      createEmptyDesignDocument("flatten", "page"),
    );
    const root: Extract<DesignNode, { kind: "group" }> = {
      id: "root",
      kind: "group",
      name: "Root",
      parentId: null,
      childIds: ["child"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 10, height: 10 },
      opacity: 1,
      exportSettings: [],
      properties: {},
      extensions: {},
    };
    const child: Extract<DesignNode, { kind: "rectangle" }> = {
      id: "child",
      kind: "rectangle",
      name: "Child",
      parentId: root.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 10, height: 10 },
      opacity: 0.5,
      exportSettings: [],
      properties: {
        fills: [{ type: "solid", color: "#000000", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
      },
      extensions: {},
    };
    document.nodesById.root = root;
    document.nodesById.child = child;
    document.pagesById.page.rootNodeIds = [root.id];

    await expect(
      planFlattenWithRasterFallback({
        document,
        pageId: "page",
        nodeIds: [root.id],
        resultNodeId: "flattened",
        geometryIdPrefix: "flatten",
        provider: {} as VectorGeometryProvider,
        rasterize: vi.fn().mockResolvedValue({
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          bytes: {
            byteLength: RASTER_EXPORT_MAX_ENCODED_BYTES + 1,
          } as Uint8Array,
          width: 20,
          height: 20,
          mimeType: "image/png",
        }),
      }),
    ).rejects.toThrow("encoded asset boundary");
  });
});
