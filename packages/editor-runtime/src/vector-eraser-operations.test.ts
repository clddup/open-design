import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type {
  DesignOperation,
  DesignDocument,
  VectorNetwork,
  VectorNode,
} from "@opendesign/design-contracts";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "@opendesign/geometry-service/vector-path";
import { beforeAll, describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { EditorRuntime } from "./runtime.js";
import { planVectorLayersErase } from "./vector-eraser-operations.js";

const require = createRequire(import.meta.url);
let provider: VectorGeometryProvider;

beforeAll(async () => {
  provider = await createPathKitGeometryProvider({
    wasmBinary: await readFile(
      require.resolve("pathkit-wasm/bin/pathkit.wasm"),
    ),
  });
});

describe("vector eraser runtime plan", () => {
  it("keeps a crossed filled shape in the same editable layer", () => {
    const document = documentWithVector(closedNetwork(), {
      fills: [{ type: "solid", color: "#ff3355", opacity: 1 }],
      strokeWidth: 0,
      strokes: [],
    });
    const plan = planVectorLayersErase(
      document,
      "page_welcome",
      [{ nodeId: "vector_target", geometryIdPrefix: "erase_target" }],
      [
        { x: 150, y: 60 },
        { x: 150, y: 220 },
      ],
      20,
      "round",
      provider,
    );
    expect(plan).toMatchObject({
      ok: true,
      eraserResult: {
        deletedNodeIds: [],
        remainingNodeIds: ["vector_target"],
      },
    });
    if (!plan.ok) return;
    expect(plan.operations).toEqual([
      expect.objectContaining({
        type: "update_properties",
        nodeId: "vector_target",
      }),
    ]);

    const runtime = applyPlan(document, plan.operations);
    const result = runtime.getSnapshot().document.nodesById.vector_target;
    expect(result).toBeDefined();
    if (
      !result ||
      result.kind !== "vector" ||
      !("network" in result.properties)
    )
      return;
    expect(result.properties.network.paths).toHaveLength(2);
    expect(result.properties.strokes).toEqual([]);
    expect(result.properties.strokeWidth).toBe(0);
    expect(result.properties.network.regions[0]?.fills).toEqual([
      { type: "solid", color: "#ff3355", opacity: 1 },
    ]);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
  });

  it("materializes an open stroke and erases it without creating siblings", () => {
    const document = documentWithVector(openNetwork(), {
      fills: [],
      strokeWidth: 20,
      strokes: [{ type: "solid", color: "#151515", opacity: 1 }],
    });
    const plan = planVectorLayersErase(
      document,
      "page_welcome",
      [{ nodeId: "vector_target", geometryIdPrefix: "erase_stroke" }],
      [
        { x: 150, y: 60 },
        { x: 150, y: 180 },
      ],
      24,
      "square",
      provider,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const runtime = applyPlan(document, plan.operations);
    const result = runtime.getSnapshot().document.nodesById.vector_target;
    if (
      !result ||
      result.kind !== "vector" ||
      !("network" in result.properties)
    ) {
      throw new Error("Missing erased Vector layer");
    }
    expect(result.properties.network.paths).toHaveLength(2);
    expect(result.properties.network.regions[0]?.fills).toEqual([
      { type: "solid", color: "#151515", opacity: 1 },
    ]);
    expect(
      Object.keys(runtime.getSnapshot().document.nodesById).filter((id) =>
        id.startsWith("vector_"),
      ),
    ).toEqual(["vector_target"]);
  });

  it("deletes only a fully erased target in the same transaction", () => {
    const document = documentWithVector(closedNetwork(), {
      fills: [{ type: "solid", color: "#ff3355", opacity: 1 }],
      strokeWidth: 0,
      strokes: [],
    });
    const second = structuredClone(document.nodesById.vector_target);
    if (!second || second.kind !== "vector") throw new Error("Missing vector");
    second.id = "vector_second";
    second.transform = [1, 0, 0, 1, 180, 20];
    document.nodesById[second.id] = second;
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    frame.childIds.push(second.id);

    const plan = planVectorLayersErase(
      document,
      "page_welcome",
      [
        { nodeId: "vector_target", geometryIdPrefix: "erase_first" },
        { nodeId: "vector_second", geometryIdPrefix: "erase_second" },
      ],
      [{ x: 150, y: 134 }],
      180,
      "square",
      provider,
    );
    expect(plan).toMatchObject({
      ok: true,
      eraserResult: {
        deletedNodeIds: ["vector_target"],
        remainingNodeIds: ["vector_second"],
      },
    });
    if (!plan.ok) return;
    const runtime = applyPlan(document, plan.operations);
    expect(
      runtime.getSnapshot().document.nodesById.vector_target,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.vector_second,
    ).toBeDefined();
    expect(runtime.getSnapshot().document.revision).toBe(1);
  });

  it("rejects locked targets before producing partial operations", () => {
    const document = documentWithVector(closedNetwork(), {
      fills: [{ type: "solid", color: "#ff3355", opacity: 1 }],
      strokeWidth: 0,
      strokes: [],
    });
    document.nodesById.vector_target!.locked = true;
    expect(
      planVectorLayersErase(
        document,
        "page_welcome",
        [{ nodeId: "vector_target", geometryIdPrefix: "erase_target" }],
        [{ x: 150, y: 134 }],
        40,
        "round",
        provider,
      ),
    ).toMatchObject({ ok: false, code: "locked" });
  });
});

function applyPlan(
  document: DesignDocument,
  operations: readonly DesignOperation[],
): EditorRuntime {
  const runtime = new EditorRuntime(document);
  expect(
    runtime.apply({
      transactionId: "erase_vector",
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: { type: "user", id: "local-user" },
      label: "Erase vector",
      commands: [...operations],
    }),
  ).toMatchObject({ ok: true, revision: { revision: 1 } });
  return runtime;
}

function documentWithVector(
  network: VectorNetwork,
  appearance: Pick<
    VectorNode["properties"],
    "fills" | "strokes" | "strokeWidth"
  >,
): DesignDocument {
  const document = structuredClone(createWelcomeDocument());
  const frame = document.nodesById.frame_welcome;
  if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
  const node: VectorNode = {
    id: "vector_target",
    name: "Vector target",
    parentId: frame.id,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 20, 20],
    size: { width: 100, height: 100 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "vector",
    properties: { network, fillRule: "nonzero", ...appearance },
  };
  document.nodesById[node.id] = node;
  frame.childIds.push(node.id);
  return document;
}

function closedNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 0, y: 0 },
      { id: "vertex_b", x: 100, y: 0 },
      { id: "vertex_c", x: 100, y: 100 },
      { id: "vertex_d", x: 0, y: 100 },
    ],
    segments: [
      { id: "segment_ab", startVertexId: "vertex_a", endVertexId: "vertex_b" },
      { id: "segment_bc", startVertexId: "vertex_b", endVertexId: "vertex_c" },
      { id: "segment_cd", startVertexId: "vertex_c", endVertexId: "vertex_d" },
      { id: "segment_da", startVertexId: "vertex_d", endVertexId: "vertex_a" },
    ],
    paths: [
      {
        id: "path_closed",
        closed: true,
        segments: ["segment_ab", "segment_bc", "segment_cd", "segment_da"].map(
          (segmentId) => ({ segmentId, reversed: false }),
        ),
      },
    ],
    regions: [
      {
        id: "region_face",
        windingRule: "nonzero",
        loops: [{ pathId: "path_closed", reversed: false }],
      },
    ],
  };
}

function openNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 0, y: 50 },
      { id: "vertex_b", x: 100, y: 50 },
    ],
    segments: [
      { id: "segment_ab", startVertexId: "vertex_a", endVertexId: "vertex_b" },
    ],
    paths: [
      {
        id: "path_open",
        closed: false,
        segments: [{ segmentId: "segment_ab", reversed: false }],
      },
    ],
    regions: [],
  };
}
