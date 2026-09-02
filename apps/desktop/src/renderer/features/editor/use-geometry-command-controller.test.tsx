import { act, renderHook } from "@testing-library/react";
import type { VectorNode } from "@opendesign/design-contracts";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import { useEditorCommandController } from "./use-editor-command-controller";
import { useGeometryCommandController } from "./use-geometry-command-controller";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

const t: Translate = (key) => `中文:${key}`;

function geometryProvider(): VectorGeometryProvider {
  const geometry = (path: string) => ({
    ok: true as const,
    path,
    fillRule: "nonzero" as const,
    bounds: { x: -2, y: -2, width: 104, height: 4 },
    empty: false,
    provider: "skia-pathkit" as const,
    providerVersion: "1.0.0" as const,
  });
  return {
    id: "skia-pathkit",
    version: "1.0.0",
    combine: (paths) => geometry(paths[0]?.path ?? "M0 0L1 0Z"),
    dash: (path) => geometry(path.path),
    normalize: (path) => geometry(path.path),
    outlineStroke: () => geometry("M-2 -2L102 -2L102 2L-2 2L-2 -2Z"),
    transform: (path) => geometry(path.path),
  };
}

function runtimeWithSelectedVector() {
  const document = structuredClone(createWelcomeDocument());
  const frame = document.nodesById.frame_welcome;
  if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
  const vector: VectorNode = {
    id: "vector_stroked",
    kind: "vector",
    name: "Stroked path",
    parentId: frame.id,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 40, 40],
    size: { width: 100, height: 1 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    properties: {
      fillRule: "nonzero",
      fills: [],
      network: {
        vertices: [
          { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
          { id: "vertex_b", x: 100, y: 0, handleMode: "corner" },
        ],
        segments: [
          {
            id: "segment_ab",
            startVertexId: "vertex_a",
            endVertexId: "vertex_b",
          },
        ],
        paths: [
          {
            id: "path_open",
            closed: false,
            segments: [{ segmentId: "segment_ab", reversed: false }],
          },
        ],
        regions: [],
      },
      strokes: [{ type: "solid", color: "#2563eb", opacity: 1 }],
      strokeWidth: 4,
    },
  };
  document.nodesById[vector.id] = vector;
  frame.childIds.push(vector.id);
  const runtime = new EditorRuntime(document);
  runtime.setSelection([vector.id], vector.id);
  return runtime;
}

describe("useGeometryCommandController", () => {
  it("updates selected Vector point appearance as one undoable transaction", () => {
    const runtime = runtimeWithSelectedVector();
    const setEditorError = vi.fn<(message: string | null) => void>();
    const transactionCounter = { current: 0 };
    const { result } = renderHook(() => {
      const editor = useEditorCommandController({
        runtime,
        setEditorError,
        t,
        transactionCounter,
      });
      const snapshot = runtime.getSnapshot();
      return useGeometryCommandController({
        activePageId: "page_welcome",
        applyCommands: editor.applyCommands,
        componentTargetActive: false,
        document: snapshot.document,
        runtime,
        selectedNodeIds: snapshot.state.selection.nodeIds,
        setEditorError,
        t,
        transactionCounter,
      });
    });

    act(() => {
      expect(
        result.current.setVectorVertexAppearance(
          "vector_stroked",
          ["vertex_a"],
          { strokeCap: "round", strokeJoin: "bevel" },
        ),
      ).toBe(true);
    });
    const vector = runtime.getSnapshot().document.nodesById.vector_stroked;
    expect(vector?.kind).toBe("vector");
    if (vector?.kind !== "vector" || !("network" in vector.properties)) {
      throw new Error("Missing editable vector");
    }
    expect(vector.properties.network.vertices[0]).toMatchObject({
      id: "vertex_a",
      strokeCap: "round",
      strokeJoin: "bevel",
    });
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);

    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    const restored = runtime.getSnapshot().document.nodesById.vector_stroked;
    expect(restored?.kind).toBe("vector");
    if (restored?.kind !== "vector" || !("network" in restored.properties)) {
      throw new Error("Missing editable vector");
    }
    expect(restored.properties.network.vertices[0]?.strokeCap).toBeUndefined();
    expect(restored.properties.network.vertices[0]?.strokeJoin).toBeUndefined();
  });

  it("updates selected closed Vector point radius as one undoable transaction", () => {
    const runtime = runtimeWithSelectedVector();
    const document = structuredClone(runtime.getSnapshot().document);
    const vector = document.nodesById.vector_stroked;
    if (vector?.kind !== "vector" || !("network" in vector.properties)) {
      throw new Error("Missing editable vector");
    }
    vector.properties.network.vertices.push({ id: "vertex_c", x: 50, y: 80 });
    vector.properties.network.segments.push(
      { id: "segment_bc", startVertexId: "vertex_b", endVertexId: "vertex_c" },
      { id: "segment_ca", startVertexId: "vertex_c", endVertexId: "vertex_a" },
    );
    vector.properties.network.paths[0] = {
      id: "path_open",
      closed: true,
      segments: [
        { segmentId: "segment_ab", reversed: false },
        { segmentId: "segment_bc", reversed: false },
        { segmentId: "segment_ca", reversed: false },
      ],
    };
    vector.properties.network.regions = [
      {
        id: "region_face",
        windingRule: "nonzero",
        loops: [{ pathId: "path_open", reversed: false }],
      },
    ];
    const closedRuntime = new EditorRuntime(structuredClone(document));
    closedRuntime.setSelection(["vector_stroked"], "vector_stroked");
    const setEditorError = vi.fn<(message: string | null) => void>();
    const transactionCounter = { current: 0 };
    const { result } = renderHook(() => {
      const editor = useEditorCommandController({
        runtime: closedRuntime,
        setEditorError,
        t,
        transactionCounter,
      });
      const snapshot = closedRuntime.getSnapshot();
      return useGeometryCommandController({
        activePageId: "page_welcome",
        applyCommands: editor.applyCommands,
        componentTargetActive: false,
        document: snapshot.document,
        runtime: closedRuntime,
        selectedNodeIds: snapshot.state.selection.nodeIds,
        setEditorError,
        t,
        transactionCounter,
      });
    });

    act(() => {
      expect(
        result.current.setVectorVertexAppearance(
          "vector_stroked",
          ["vertex_a"],
          { cornerRadius: 10 },
        ),
      ).toBe(true);
    });
    const updated =
      closedRuntime.getSnapshot().document.nodesById.vector_stroked;
    if (updated?.kind !== "vector" || !("network" in updated.properties)) {
      throw new Error("Missing updated vector");
    }
    expect(updated.properties.network.vertices[0]?.cornerRadius).toBe(10);
    expect(closedRuntime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(closedRuntime.undo()).toMatchObject({ ok: true, mode: "undo" });
  });

  it("outlines the selected stroke through one EditorRuntime transaction", async () => {
    const runtime = runtimeWithSelectedVector();
    const setEditorError = vi.fn<(message: string | null) => void>();
    const transactionCounter = { current: 0 };
    const provider = geometryProvider();
    const { result } = renderHook(() => {
      const editor = useEditorCommandController({
        runtime,
        setEditorError,
        t,
        transactionCounter,
      });
      const snapshot = runtime.getSnapshot();
      return useGeometryCommandController({
        activePageId: "page_welcome",
        applyCommands: editor.applyCommands,
        componentTargetActive: false,
        document: snapshot.document,
        runtime,
        selectedNodeIds: snapshot.state.selection.nodeIds,
        setEditorError,
        t,
        transactionCounter,
        vectorGeometryProvider: () => Promise.resolve(provider),
      });
    });

    expect(result.current.canOutlineStroke).toBe(true);
    let applied = false;
    await act(async () => {
      applied = await result.current.outlineSelectedStroke();
    });

    const snapshot = runtime.getSnapshot();
    const resultId = snapshot.state.selection.nodeIds[0];
    expect(applied).toBe(true);
    expect(snapshot.document.nodesById.vector_stroked).toBeDefined();
    expect(resultId).not.toBe("vector_stroked");
    expect(snapshot.document.nodesById[resultId ?? "missing"]).toMatchObject({
      kind: "vector",
      properties: {
        fills: [{ type: "solid", color: "#2563eb", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
    });
    expect(snapshot.state.history.undo).toHaveLength(1);
    expect(setEditorError).toHaveBeenLastCalledWith(null);
  });

  it("splits a selected multi-path Vector and selects every sibling result", () => {
    const base = runtimeWithSelectedVector();
    const document = structuredClone(base.getSnapshot().document);
    const vector = document.nodesById.vector_stroked;
    if (vector?.kind !== "vector" || !("network" in vector.properties)) {
      throw new Error("Missing editable vector");
    }
    vector.properties.network.vertices.push({
      id: "vertex_c",
      x: 50,
      y: 80,
    });
    vector.properties.network.segments.push({
      id: "segment_ac",
      startVertexId: "vertex_a",
      endVertexId: "vertex_c",
    });
    vector.properties.network.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_ac", reversed: false }],
    });
    const runtime = new EditorRuntime(document);
    runtime.setSelection([vector.id], vector.id);
    const setEditorError = vi.fn<(message: string | null) => void>();
    const transactionCounter = { current: 0 };
    const { result } = renderHook(() => {
      const editor = useEditorCommandController({
        runtime,
        setEditorError,
        t,
        transactionCounter,
      });
      const snapshot = runtime.getSnapshot();
      return useGeometryCommandController({
        activePageId: "page_welcome",
        applyCommands: editor.applyCommands,
        componentTargetActive: false,
        document: snapshot.document,
        runtime,
        selectedNodeIds: snapshot.state.selection.nodeIds,
        setEditorError,
        t,
        transactionCounter,
      });
    });

    expect(result.current.canSplitVector).toBe(true);
    act(() => expect(result.current.splitSelectedVector()).toBe(true));

    const snapshot = runtime.getSnapshot();
    expect(snapshot.state.selection.nodeIds).toHaveLength(2);
    expect(
      snapshot.state.selection.nodeIds.map((nodeId) => {
        const resultNode = snapshot.document.nodesById[nodeId];
        return resultNode?.kind === "vector" &&
          "network" in resultNode.properties
          ? resultNode.properties.network.paths[0]?.id
          : undefined;
      }),
    ).toEqual(["path_open", "path_branch"]);
    expect(snapshot.state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "vector_stroked",
    ]);
  });

  it("flattens the authoritative selection through one transaction", async () => {
    const runtime = runtimeWithSelectedVector();
    const setEditorError = vi.fn<(message: string | null) => void>();
    const transactionCounter = { current: 0 };
    const provider = geometryProvider();
    const { result } = renderHook(() => {
      const editor = useEditorCommandController({
        runtime,
        setEditorError,
        t,
        transactionCounter,
      });
      const snapshot = runtime.getSnapshot();
      return useGeometryCommandController({
        activePageId: "page_welcome",
        applyCommands: editor.applyCommands,
        componentTargetActive: false,
        document: snapshot.document,
        runtime,
        selectedNodeIds: snapshot.state.selection.nodeIds,
        setEditorError,
        t,
        transactionCounter,
        vectorGeometryProvider: () => Promise.resolve(provider),
      });
    });

    expect(result.current.canFlattenSelection).toBe(true);
    let applied = false;
    await act(async () => {
      applied = await result.current.flattenSelection();
    });

    const snapshot = runtime.getSnapshot();
    const resultId = snapshot.state.selection.nodeIds[0];
    expect(applied).toBe(true);
    expect(snapshot.document.nodesById.vector_stroked).toBeUndefined();
    expect(resultId).not.toBe("vector_stroked");
    expect(snapshot.document.nodesById[resultId ?? "missing"]).toMatchObject({
      kind: "vector",
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
      },
    });
    expect(snapshot.state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.vector_stroked,
    ).toBeDefined();
  });

  it("enables the same Flatten command for a regular shape selection", async () => {
    const runtime = new EditorRuntime(structuredClone(createWelcomeDocument()));
    runtime.setSelection(["feature_three"], "feature_three");
    const transactionCounter = { current: 0 };
    const { result } = renderHook(() => {
      const editor = useEditorCommandController({
        runtime,
        setEditorError: vi.fn(),
        t,
        transactionCounter,
      });
      const snapshot = runtime.getSnapshot();
      return useGeometryCommandController({
        activePageId: "page_welcome",
        applyCommands: editor.applyCommands,
        componentTargetActive: false,
        document: snapshot.document,
        runtime,
        selectedNodeIds: snapshot.state.selection.nodeIds,
        setEditorError: vi.fn(),
        t,
        transactionCounter,
        vectorGeometryProvider: () => Promise.resolve(geometryProvider()),
      });
    });

    expect(result.current.canFlattenSelection).toBe(true);
    await act(async () => {
      expect(await result.current.flattenSelection()).toBe(true);
    });
    const selectedId = runtime.getSnapshot().state.selection.nodeIds[0];
    expect(
      runtime.getSnapshot().document.nodesById.feature_three,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById[selectedId ?? "missing"],
    ).toMatchObject({
      kind: "vector",
    });
  });

  it("uses the same command for descendant compositing and commits the PNG asset once", async () => {
    const document = structuredClone(createWelcomeDocument());
    const group = document.nodesById.feature_group;
    const child = group?.childIds[0]
      ? document.nodesById[group.childIds[0]]
      : undefined;
    if (group?.kind !== "group" || !child) {
      throw new Error("Missing Group fixture");
    }
    child.opacity = 0.5;
    const runtime = new EditorRuntime(document);
    runtime.setSelection([group.id], group.id);
    const transactionCounter = { current: 0 };
    const rasterize = vi.fn().mockResolvedValue({
      bounds: { x: 40, y: 320, width: 992, height: 252 },
      bytes: new Uint8Array([1, 2, 3]),
      width: 1_984,
      height: 504,
      mimeType: "image/png",
    });
    const { result } = renderHook(() => {
      const editor = useEditorCommandController({
        runtime,
        setEditorError: vi.fn(),
        t,
        transactionCounter,
      });
      const snapshot = runtime.getSnapshot();
      return useGeometryCommandController({
        activePageId: "page_welcome",
        applyCommands: editor.applyCommands,
        componentTargetActive: false,
        document: snapshot.document,
        runtime,
        selectedNodeIds: snapshot.state.selection.nodeIds,
        setEditorError: vi.fn(),
        t,
        transactionCounter,
        flattenRasterizer: rasterize,
        vectorGeometryProvider: () => Promise.resolve(geometryProvider()),
      });
    });

    expect(result.current.canFlattenSelection).toBe(true);
    await act(async () => {
      expect(await result.current.flattenSelection()).toBe(true);
    });

    const snapshot = runtime.getSnapshot();
    const resultId = snapshot.state.selection.nodeIds[0];
    expect(rasterize).toHaveBeenCalledOnce();
    expect(snapshot.document.nodesById[resultId ?? "missing"]).toMatchObject({
      kind: "vector",
      transform: [1, 0, 0, 1, 40, 320],
    });
    expect(snapshot.document.assetsById[`${resultId}_raster`]).toMatchObject({
      mimeType: "image/png",
      source: { type: "data", value: "AQID" },
    });
    expect(snapshot.state.history.undo).toHaveLength(1);
  });
});
