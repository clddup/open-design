import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { createEmptyDesignDocument } from "./document.js";
import { EditorRuntime } from "./runtime.js";
import {
  planRasterizedFlattenNodes,
  prepareRasterFlattenNodes,
} from "./vector-flatten-raster.js";

describe("raster-composited Flatten", () => {
  it("preserves a single root shell while baking descendant compositing atomically", () => {
    const document = nestedOpacityDocument();
    const preparation = prepareRasterFlattenNodes(document, "page", ["root"]);
    expect(preparation).toMatchObject({
      kind: "ready",
      request: { neutralizeRootNodeId: "root", nodeIds: ["root"] },
    });
    if (preparation.kind !== "ready") return;
    const plan = planRasterizedFlattenNodes(
      document,
      preparation.request,
      "flattened",
      "raster",
      rasterResult(),
    );
    if (!plan.ok) throw new Error(plan.message);

    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "flatten_raster",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "test" },
        label: "Flatten raster",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    const after = runtime.getSnapshot().document;
    const flattened = after.nodesById.flattened;
    expect(flattened).toMatchObject({
      kind: "vector",
      opacity: 0.8,
      blendMode: "normal",
      effects: [{ type: "layer-blur", radius: 2 }],
      transform: [1, 0, 0, 1, 4, 6],
      size: { width: 120, height: 80 },
    });
    expect(after.nodesById.root).toBeUndefined();
    expect(after.nodesById.child).toBeUndefined();
    expect(after.assetsById.flatten_asset).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      size: { width: 240, height: 160 },
    });
    if (!flattened || flattened.kind !== "vector") {
      throw new Error("Missing flattened Vector");
    }
    if (!("network" in flattened.properties)) {
      throw new Error("Missing flattened Vector Network");
    }
    expect(flattened.properties.network.regions[0]?.fills).toEqual([
      {
        type: "image",
        assetId: "flatten_asset",
        fit: "fill",
        opacity: 1,
      },
    ]);

    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.assetsById.flatten_asset,
    ).toBeUndefined();
    expect(runtime.getSnapshot().document.nodesById.root).toBeDefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(reopened.getSnapshot().document.nodesById.flattened?.kind).toBe(
      "vector",
    );
  });

  it("allows a complete multi-root opacity and mask stack", () => {
    const document = multiRootDocument();
    const preparation = prepareRasterFlattenNodes(document, "page", [
      "mask",
      "content",
    ]);
    expect(preparation).toMatchObject({
      kind: "ready",
      request: { nodeIds: ["mask", "content"] },
    });
    if (preparation.kind !== "ready") return;
    expect(preparation.request).not.toHaveProperty("neutralizeRootNodeId");
    const plan = planRasterizedFlattenNodes(
      document,
      preparation.request,
      "flattened",
      "multi",
      rasterResult(),
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    const inserted = plan.operations.find(
      (operation) => operation.type === "insert_element",
    );
    expect(inserted).toMatchObject({
      node: { opacity: 1, transform: [1, 0, 0, 1, 4, 6] },
    });
    expect(
      inserted && "node" in inserted ? inserted.node : null,
    ).not.toHaveProperty("maskMode");
  });

  it("rejects a partial root mask scope and descendant background blur", () => {
    const partial = multiRootDocument();
    partial.nodesById.tail = rectangle("tail", null, 140);
    partial.pagesById.page!.rootNodeIds.push("tail");
    expect(
      prepareRasterFlattenNodes(partial, "page", ["mask", "content"]),
    ).toMatchObject({ kind: "failed" });

    const background = nestedOpacityDocument();
    const child = background.nodesById.child;
    if (!child) throw new Error("Missing child");
    child.effects = [{ type: "background-blur", radius: 8 }];
    expect(
      prepareRasterFlattenNodes(background, "page", ["root"]),
    ).toMatchObject({ kind: "failed" });

    const outlineMask = nestedOpacityDocument();
    outlineMask.nodesById.root!.maskMode = "outline";
    expect(
      prepareRasterFlattenNodes(outlineMask, "page", ["root"]),
    ).toMatchObject({ kind: "failed" });
  });

  it("does not rasterize ordinary exact geometry and rejects a stale result", () => {
    const document = nestedOpacityDocument();
    const child = document.nodesById.child;
    if (!child) throw new Error("Missing child");
    child.opacity = 1;
    expect(prepareRasterFlattenNodes(document, "page", ["root"])).toEqual({
      kind: "not-required",
    });

    child.opacity = 0.5;
    const preparation = prepareRasterFlattenNodes(document, "page", ["root"]);
    if (preparation.kind !== "ready") throw new Error("Missing preparation");
    const stale = structuredClone(document);
    stale.revision += 1;
    expect(
      planRasterizedFlattenNodes(
        stale,
        preparation.request,
        "flattened",
        "stale",
        rasterResult(),
      ),
    ).toMatchObject({ ok: false, code: "unsupported-topology" });
  });
});

function nestedOpacityDocument(): DesignDocument {
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
    transform: [1, 0, 0, 1, 20, 30],
    size: { width: 80, height: 60 },
    opacity: 0.8,
    blendMode: "normal",
    effects: [{ type: "layer-blur", radius: 2 }],
    exportSettings: [],
    properties: {},
    extensions: {},
  };
  const child = rectangle("child", root.id, 0);
  child.opacity = 0.5;
  document.nodesById.root = root;
  document.nodesById.child = child;
  document.pagesById.page!.rootNodeIds = [root.id];
  return document;
}

function multiRootDocument(): DesignDocument {
  const document = structuredClone(createEmptyDesignDocument("multi", "page"));
  const mask = rectangle("mask", null, 0);
  mask.maskMode = "alpha";
  const content = rectangle("content", null, 70);
  content.opacity = 0.6;
  document.nodesById.mask = mask;
  document.nodesById.content = content;
  document.pagesById.page!.rootNodeIds = [mask.id, content.id];
  return document;
}

function rectangle(
  id: string,
  parentId: string | null,
  x: number,
): Extract<DesignNode, { kind: "rectangle" }> {
  return {
    id,
    kind: "rectangle",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, x, 0],
    size: { width: 64, height: 48 },
    opacity: 1,
    exportSettings: [],
    properties: {
      fills: [{ type: "solid", color: "#2563eb", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
    },
    extensions: {},
  };
}

function rasterResult() {
  return {
    bounds: { x: 4, y: 6, width: 120, height: 80 },
    asset: {
      id: "flatten_asset",
      kind: "image" as const,
      name: "Flatten raster",
      mimeType: "image/png",
      source: { type: "data" as const, value: "iVBORw==" },
      size: { width: 240, height: 160 },
      extensions: {},
    },
  };
}
