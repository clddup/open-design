import { act, renderHook } from "@testing-library/react";
import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import type {
  MessageKey,
  MessageParameters,
} from "../../../shared/i18n/messages";
import { useEditorCommandController } from "./use-editor-command-controller";
import { useLayerCommandController } from "./use-layer-command-controller";
import { usePageCommandController } from "./use-page-command-controller";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

const t: Translate = (key) => `中文:${key}`;

function renderControllers(runtime: EditorRuntime) {
  const setEditorError = vi.fn<(message: string | null) => void>();
  const transactionCounter = { current: 0 };
  const hook = renderHook(() => {
    const editor = useEditorCommandController({
      runtime,
      setEditorError,
      t,
      transactionCounter,
    });
    const page = usePageCommandController({
      applyCommands: editor.applyCommands,
      runtime,
      setEditorError,
      t,
      transactionCounter,
    });
    const snapshot = runtime.getSnapshot();
    const layer = useLayerCommandController({
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
    return { editor, layer, page };
  });
  return { ...hook, setEditorError };
}

describe("editor command controllers", () => {
  it("routes property and page writes through the single EditorRuntime history", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const { result, setEditorError } = renderControllers(runtime);

    act(() =>
      result.current.editor.updateNode("title_welcome", { opacity: 0.5 }),
    );
    const created = result.current.page.createPage();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.name).toBe("Page 2");
    const renamed = result.current.page.renamePage(created.pageId, "Flows");
    expect(renamed).toEqual({
      ok: true,
      pageId: created.pageId,
      name: "Flows",
    });

    const snapshot = runtime.getSnapshot();
    expect(snapshot.document.nodesById.title_welcome?.opacity).toBe(0.5);
    expect(snapshot.document.pagesById[created.pageId]?.name).toBe("Flows");
    expect(snapshot.document.revision).toBe(3);
    expect(snapshot.state.history.undo).toHaveLength(3);
    expect(setEditorError).toHaveBeenLastCalledWith(null);

    act(() => {
      runtime.undo();
    });
    expect(runtime.getSnapshot().document.pagesById[created.pageId]?.name).toBe(
      "Page 2",
    );
  });

  it("keeps compound layer operations atomic and derives capabilities from the authoritative snapshot", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(
      ["title_welcome", "subtitle_welcome"],
      "title_welcome",
    );
    const { result, rerender } = renderControllers(runtime);

    expect(result.current.layer.canGroupSelection).toBe(true);
    act(() => result.current.layer.groupSelection());
    let snapshot = runtime.getSnapshot();
    const group = Object.values(snapshot.document.nodesById).find(
      (node) =>
        node.kind === "group" && node.childIds.includes("title_welcome"),
    );
    expect(group?.childIds).toEqual(["title_welcome", "subtitle_welcome"]);
    expect(snapshot.document.revision).toBe(1);
    expect(snapshot.state.history.undo).toHaveLength(1);
    expect(snapshot.state.selection.nodeIds).toEqual([group?.id]);

    rerender();
    expect(result.current.layer.canUngroupSelection).toBe(true);
    act(() => result.current.layer.ungroupSelection());
    snapshot = runtime.getSnapshot();
    expect(snapshot.document.nodesById[group?.id ?? "missing"]).toBeUndefined();
    expect(snapshot.document.revision).toBe(2);
    expect(snapshot.state.history.undo).toHaveLength(2);
    expect(snapshot.state.selection.nodeIds).toEqual([
      "title_welcome",
      "subtitle_welcome",
    ]);
  });

  it("routes Inspector constraints and populated Frame resize through one responsive planner", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const { result, setEditorError } = renderControllers(runtime);
    act(() =>
      result.current.editor.setNodeConstraints("title_welcome", {
        horizontal: "left-right",
        vertical: "top",
      }),
    );
    act(() =>
      result.current.editor.updateNode("frame_welcome", {
        size: { width: 1600, height: 900 },
      }),
    );
    const snapshot = runtime.getSnapshot();
    expect(snapshot.document.nodesById.title_welcome?.constraints).toEqual({
      horizontal: "left-right",
      vertical: "top",
    });
    expect(snapshot.document.nodesById.frame_welcome?.size).toEqual({
      width: 1600,
      height: 900,
    });
    expect(snapshot.document.nodesById.title_welcome?.size.width).toBe(1200);
    expect(snapshot.document.revision).toBe(2);
    expect(snapshot.state.history.undo).toHaveLength(2);
    expect(setEditorError).toHaveBeenLastCalledWith(null);
  });

  it("routes Inspector Auto Layout through one host-derived reversible transaction", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const { result, setEditorError } = renderControllers(runtime);
    act(() =>
      result.current.editor.setFrameAutoLayout("frame_welcome", {
        mode: "vertical",
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        gap: 12,
        primaryAlignment: "start",
        counterAlignment: "center",
      }),
    );
    const snapshot = runtime.getSnapshot();
    expect(snapshot.document.nodesById.frame_welcome).toMatchObject({
      properties: { autoLayout: { mode: "vertical", gap: 12 } },
    });
    expect(snapshot.document.revision).toBe(1);
    expect(snapshot.state.history.undo).toHaveLength(1);
    expect(setEditorError).toHaveBeenLastCalledWith(null);
  });

  it("routes flow-child Fill sizing through the dedicated planner", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("missing Frame");
    frame.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 8,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    const runtime = new EditorRuntime(document);
    const { result, setEditorError } = renderControllers(runtime);
    act(() =>
      result.current.editor.setNodeLayoutSizing("title_welcome", {
        horizontal: "fill",
        vertical: "fixed",
      }),
    );
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.layoutSizing,
    ).toEqual({ horizontal: "fill", vertical: "fixed" });
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(setEditorError).toHaveBeenLastCalledWith(null);
  });

  it("routes flow and absolute child positioning through one reversible planner", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("missing Frame");
    frame.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 8,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    const runtime = new EditorRuntime(document);
    const { result, setEditorError } = renderControllers(runtime);
    act(() =>
      result.current.editor.setNodeLayoutPositioning(
        "title_welcome",
        "absolute",
        { horizontal: "right", vertical: "top" },
      ),
    );
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      layoutPositioning: "absolute",
      constraints: { horizontal: "right", vertical: "top" },
    });
    act(() =>
      result.current.editor.setNodeLayoutPositioning("title_welcome", null),
    );
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.layoutPositioning,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.constraints,
    ).toBeUndefined();
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(2);
    expect(setEditorError).toHaveBeenLastCalledWith(null);
  });

  it("routes Auto Layout min/max through the dedicated planner and supports clearing", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("missing Frame");
    frame.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 8,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    const runtime = new EditorRuntime(document);
    const { result, setEditorError } = renderControllers(runtime);
    act(() =>
      result.current.editor.setNodeLayoutLimits("title_welcome", {
        minWidth: 160,
        maxWidth: 640,
        minHeight: 48,
      }),
    );
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.layoutLimits,
    ).toEqual({ minWidth: 160, maxWidth: 640, minHeight: 48 });
    act(() => result.current.editor.setNodeLayoutLimits("title_welcome", null));
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.layoutLimits,
    ).toBeUndefined();
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(2);
    expect(setEditorError).toHaveBeenLastCalledWith(null);
  });

  it("commits a canvas Grid track reorder as one reversible Runtime history entry", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("missing Frame");
    frame.properties.autoLayout = {
      mode: "grid",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      rowGap: 0,
      columnGap: 0,
      rows: [{ type: "fixed", value: 180 }],
      columns: frame.childIds.map((_, index) => ({
        type: "fixed" as const,
        value: 80 + index,
      })),
      itemsPositioning: "row-auto-flow",
    };
    const runtime = new EditorRuntime(document);
    const beforeFrame = structuredClone(
      runtime.getSnapshot().document.nodesById.frame_welcome,
    );
    const { result, setEditorError } = renderControllers(runtime);
    let accepted = false;

    act(() => {
      accepted = result.current.editor.reorderGridTracks(
        frame.id,
        "columns",
        [0],
        frame.childIds.length,
      );
    });

    expect(accepted).toBe(true);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.document.revision).toBe(1);
    expect(snapshot.state.history.undo).toHaveLength(1);
    const reorderedFrame = snapshot.document.nodesById.frame_welcome;
    if (reorderedFrame?.kind !== "frame") throw new Error("missing Frame");
    expect(reorderedFrame.properties.autoLayout).toMatchObject({
      columns: [{ value: 81 }, { value: 82 }, { value: 83 }, { value: 80 }],
    });
    expect(setEditorError).toHaveBeenLastCalledWith(null);

    act(() => {
      runtime.undo();
    });
    expect(runtime.getSnapshot().document.nodesById.frame_welcome).toEqual(
      beforeFrame,
    );
  });
});
