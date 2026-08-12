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

const t: Translate = (key, parameters) =>
  key === "sidebar.defaultPageName"
    ? `Page ${String(parameters?.count ?? "")}`
    : key;

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
});
