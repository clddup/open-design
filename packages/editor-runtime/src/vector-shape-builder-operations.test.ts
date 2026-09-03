import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type {
  DesignDocument,
  DesignOperation,
  VectorNetwork,
  VectorNode,
} from "@opendesign/design-contracts";
import { serializeVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import { materializeVectorNetwork } from "@opendesign/geometry-service/vector-materialization";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "@opendesign/geometry-service/vector-path";
import { beforeAll, describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { EditorRuntime } from "./runtime.js";
import { planVectorShapeBuilderEdit } from "./vector-shape-builder-operations.js";

const require = createRequire(import.meta.url);
let provider: VectorGeometryProvider;

beforeAll(async () => {
  provider = await createPathKitGeometryProvider({
    wasmBinary: await readFile(
      require.resolve("pathkit-wasm/bin/pathkit.wasm"),
    ),
  });
});

describe("vector Shape Builder runtime plan", () => {
  it("materializes document-space sources and applies Extract as one undoable transaction", () => {
    const document = documentWithVectors();
    const plan = planVectorShapeBuilderEdit(
      document,
      "page_welcome",
      input(document, "extract", "vector_extracted"),
      provider,
    );

    expect(plan).toMatchObject({
      ok: true,
      shapeBuilderResult: {
        selectionNodeIds: ["vector_extracted"],
      },
    });
    if (!plan.ok) return;
    const runtime = applyPlan(document, plan.operations);
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(parentSpaceBounds(runtime, "vector_extracted")).toEqual({
      x: 70,
      y: 20,
      width: 50,
      height: 100,
    });
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.vector_extracted,
    ).toBeUndefined();
  });

  it("merges fully consumed sources into one editable sibling", () => {
    const document = documentWithVectors();
    const plan = planVectorShapeBuilderEdit(
      document,
      "page_welcome",
      {
        ...input(document, "merge", "vector_merged"),
        points: [
          { x: 125, y: 130 },
          { x: 225, y: 130 },
        ],
      },
      provider,
    );

    expect(plan).toMatchObject({
      ok: true,
      shapeBuilderResult: {
        selectionNodeIds: ["vector_merged"],
      },
    });
    if (!plan.ok) return;
    const runtime = applyPlan(document, plan.operations);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.document.nodesById.vector_left).toBeUndefined();
    expect(snapshot.document.nodesById.vector_right).toBeUndefined();
    expect(snapshot.document.nodesById.vector_merged).toBeDefined();
    expect(snapshot.document.revision).toBe(1);
  });

  it("subtracts a region without creating a result layer", () => {
    const document = documentWithVectors();
    const plan = planVectorShapeBuilderEdit(
      document,
      "page_welcome",
      { ...input(document, "subtract"), points: [{ x: 125, y: 130 }] },
      provider,
    );

    expect(plan).toMatchObject({
      ok: true,
      shapeBuilderResult: {
        selectionNodeIds: ["vector_left"],
      },
    });
    if (!plan.ok) return;
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      type: "update_properties",
      nodeId: "vector_left",
    });
  });

  it("fails closed for stale, locked, mixed-parent, and non-invertible sources", () => {
    const stale = documentWithVectors();
    expect(
      planVectorShapeBuilderEdit(
        stale,
        "page_welcome",
        { ...input(stale, "subtract"), baseRevision: stale.revision - 1 },
        provider,
      ),
    ).toMatchObject({ ok: false, code: "conflict" });

    const locked = documentWithVectors();
    locked.nodesById.vector_left!.locked = true;
    expect(
      planVectorShapeBuilderEdit(
        locked,
        "page_welcome",
        input(locked, "subtract"),
        provider,
      ),
    ).toMatchObject({ ok: false, code: "locked" });

    const mixed = documentWithVectors();
    mixed.nodesById.vector_right!.parentId = "feature_group";
    expect(
      planVectorShapeBuilderEdit(
        mixed,
        "page_welcome",
        input(mixed, "subtract"),
        provider,
      ),
    ).toMatchObject({ ok: false, code: "mixed-parent" });

    const transformed = documentWithVectors();
    transformed.nodesById.vector_left!.transform = [0, 0, 0, 0, 20, 20];
    expect(
      planVectorShapeBuilderEdit(
        transformed,
        "page_welcome",
        input(transformed, "subtract"),
        provider,
      ),
    ).toMatchObject({ ok: false, code: "non-invertible" });

    const composited = documentWithVectors();
    composited.nodesById.vector_left!.opacity = 0.5;
    expect(
      planVectorShapeBuilderEdit(
        composited,
        "page_welcome",
        input(composited, "subtract"),
        provider,
      ),
    ).toMatchObject({ ok: false, code: "requires-raster-compositing" });
  });
});

function input(
  document: DesignDocument,
  action: "extract" | "merge" | "subtract",
  resultNodeId?: string,
) {
  return {
    action,
    baseRevision: document.revision,
    geometryIdPrefix: `shape_${action}`,
    nodeIds: ["vector_left", "vector_right"],
    points: [{ x: 175, y: 130 }],
    ...(resultNodeId ? { resultNodeId } : {}),
  } as const;
}

function documentWithVectors(): DesignDocument {
  const document = structuredClone(createWelcomeDocument());
  const frame = document.nodesById.frame_welcome;
  if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
  const left = vectorNode(
    "vector_left",
    "Left",
    paintedRect("left", "#ef4444"),
    [1, 0, 0, 1, 20, 20],
    frame.id,
  );
  const right = vectorNode(
    "vector_right",
    "Right",
    paintedRect("right", "#ef4444"),
    [1, 0, 0, 1, 70, 20],
    frame.id,
  );
  document.nodesById[left.id] = left;
  document.nodesById[right.id] = right;
  frame.childIds.push(left.id, right.id);
  return document;
}

function vectorNode(
  id: string,
  name: string,
  network: VectorNetwork,
  transform: VectorNode["transform"],
  parentId: string,
): VectorNode {
  return {
    id,
    name,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform,
    size: { width: 100, height: 100 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "vector",
    properties: {
      network,
      fillRule: "nonzero",
      fills: [],
      strokes: [],
      strokeWidth: 0,
    },
  };
}

function paintedRect(prefix: string, color: string): VectorNetwork {
  const result = materializeVectorNetwork(
    "M0 0L100 0L100 100L0 100Z",
    "nonzero",
    prefix,
  );
  if (!result.ok) throw new Error(result.message);
  result.network.regions[0]!.fills = [{ type: "solid", color, opacity: 1 }];
  return result.network;
}

function applyPlan(
  document: DesignDocument,
  operations: readonly DesignOperation[],
): EditorRuntime {
  const runtime = new EditorRuntime(document);
  expect(
    runtime.apply({
      transactionId: "shape_builder_transaction",
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: { type: "user", id: "local-user" },
      label: "Shape Builder",
      commands: [...operations],
    }),
  ).toMatchObject({ ok: true, revision: { revision: 1 } });
  return runtime;
}

function parentSpaceBounds(runtime: EditorRuntime, nodeId: string) {
  const node = runtime.getSnapshot().document.nodesById[nodeId];
  if (!node || node.kind !== "vector" || !("network" in node.properties)) {
    throw new Error(`Missing Vector ${nodeId}`);
  }
  const local = networkBounds(node.properties.network);
  return {
    x: node.transform[4] + local.x,
    y: node.transform[5] + local.y,
    width: local.width,
    height: local.height,
  };
}

function networkBounds(network: VectorNetwork) {
  const serialized = serializeVectorNetwork(network);
  if (!serialized.ok) throw new Error("Invalid fixture network");
  return serialized.bounds;
}
