import {
  createEmptyDesignDocument,
  createWelcomeDocument,
  getNodeBounds,
  getSelectionBounds,
} from "@opendesign/editor-runtime";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../../state/workspace-runtime";
import { useCanvasWorkspaceController } from "./use-canvas-workspace-controller";

describe("useCanvasWorkspaceController", () => {
  it("zooms around the viewport center without changing the document revision", () => {
    const workspace = createWorkspace();
    const runtime = workspace.getActiveRuntime();
    const { result, unmount } = renderHook(() =>
      useCanvasWorkspaceController(controllerArgs(workspace)),
    );
    act(() => {
      runtime.setViewport({
        width: 1000,
        height: 800,
        zoom: 2,
        panX: -100,
        panY: 50,
      });
      result.current.changeZoom(4);
    });

    expect(runtime.getSnapshot().state.viewport).toEqual({
      width: 1000,
      height: 800,
      zoom: 4,
      panX: -700,
      panY: -300,
    });
    expect(runtime.getSnapshot().document.revision).toBe(0);

    act(() => result.current.changeZoom(100));
    expect(runtime.getSnapshot().state.viewport.zoom).toBe(8);
    act(() => result.current.changeZoom(0));
    expect(runtime.getSnapshot().state.viewport.zoom).toBe(0.1);
    unmount();
  });

  it("fits the current Page and selection from authoritative geometry", () => {
    const workspace = createWorkspace();
    const runtime = workspace.getActiveRuntime();
    runtime.setViewport({ width: 1200, height: 800 });
    const { result, unmount } = renderHook(() =>
      useCanvasWorkspaceController(controllerArgs(workspace)),
    );

    act(() => result.current.fitCanvas("page"));
    const pageBounds = getNodeBounds(
      runtime.getSnapshot().document,
      "frame_welcome",
    );
    if (!pageBounds) throw new Error("Welcome Frame bounds are missing");
    expectBoundsCentered(runtime.getSnapshot().state.viewport, pageBounds);

    act(() => {
      runtime.setSelection(["title_welcome"]);
      result.current.fitCanvas("selection");
    });
    const selectionBounds = getSelectionBounds(runtime.getSnapshot().document, [
      "title_welcome",
    ]);
    if (!selectionBounds) throw new Error("Selection bounds are missing");
    expectBoundsCentered(runtime.getSnapshot().state.viewport, selectionBounds);
    expect(runtime.getSnapshot().document.revision).toBe(0);
    unmount();
  });

  it("routes shortcuts only in the editor and never steals editable controls", () => {
    const workspace = createWorkspace();
    const runtime = workspace.getActiveRuntime();
    const toggleLeftPanel = vi.fn();
    const openRenameLayers = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ editorActive }: { editorActive: boolean }) =>
        useCanvasWorkspaceController(
          controllerArgs(workspace, {
            editorActive,
            openRenameLayers,
            toggleLeftPanel,
          }),
        ),
      { initialProps: { editorActive: false } },
    );

    fireEvent.keyDown(window, { key: "r", code: "KeyR" });
    fireEvent.keyDown(window, {
      key: "1",
      code: "Digit1",
      metaKey: true,
      shiftKey: true,
    });
    expect(runtime.getSnapshot().state.tool).toBe("select");
    expect(toggleLeftPanel).not.toHaveBeenCalled();

    rerender({ editorActive: true });
    fireEvent.keyDown(window, { key: "r", code: "KeyR" });
    expect(runtime.getSnapshot().state.tool).toBe("rectangle");

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "f", code: "KeyF" });
    fireEvent.keyDown(input, {
      key: "r",
      code: "KeyR",
      metaKey: true,
    });
    input.remove();
    expect(runtime.getSnapshot().state.tool).toBe("rectangle");
    expect(openRenameLayers).not.toHaveBeenCalled();

    act(() => runtime.setSelection(["title_welcome"]));
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([]);
    expect(result.current.layerHoverTarget).toBeNull();
    unmount();
  });

  it("uses the latest active Runtime after a Design File switch", () => {
    const workspace = createWorkspace();
    const firstRuntime = workspace.getActiveRuntime();
    const { rerender, unmount } = renderHook(
      ({ runtime }: { runtime: typeof firstRuntime }) => {
        return useCanvasWorkspaceController(
          controllerArgs(workspace, {
            documentId: runtime.getSnapshot().document.documentId,
            runtime,
          }),
        );
      },
      { initialProps: { runtime: firstRuntime } },
    );
    workspace.openFile(
      {
        projectId: "project_beta",
        designFileId: "design_beta",
        name: "Beta",
      },
      createEmptyDesignDocument("document_beta", "page_beta"),
    );
    const secondRuntime = workspace.getActiveRuntime();
    rerender({ runtime: secondRuntime });

    fireEvent.keyDown(window, { key: "r", code: "KeyR" });

    expect(firstRuntime.getSnapshot().state.tool).toBe("select");
    expect(secondRuntime.getSnapshot().state.tool).toBe("rectangle");
    unmount();
  });

  it("routes Figma-compatible Flatten shortcuts on macOS and Windows", () => {
    const workspace = createWorkspace();
    const flattenSelection = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ platform }: { platform: NodeJS.Platform }) =>
        useCanvasWorkspaceController(
          controllerArgs(workspace, {
            canFlattenSelection: true,
            flattenSelection,
            platform,
          }),
        ),
      { initialProps: { platform: "darwin" as NodeJS.Platform } },
    );

    fireEvent.keyDown(window, { code: "KeyE", key: "e", metaKey: true });
    expect(flattenSelection).toHaveBeenCalledTimes(1);

    rerender({ platform: "win32" });
    fireEvent.keyDown(window, { code: "KeyE", key: "e", ctrlKey: true });
    expect(flattenSelection).toHaveBeenCalledTimes(2);

    rerender({ platform: "win32" });
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { code: "KeyE", key: "e", ctrlKey: true });
    input.remove();
    expect(flattenSelection).toHaveBeenCalledTimes(2);
    unmount();

    const disabled = renderHook(() =>
      useCanvasWorkspaceController(
        controllerArgs(workspace, {
          canFlattenSelection: false,
          flattenSelection,
          platform: "win32",
        }),
      ),
    );
    fireEvent.keyDown(window, { code: "KeyE", key: "e", ctrlKey: true });
    expect(flattenSelection).toHaveBeenCalledTimes(2);
    disabled.unmount();
  });

  it("routes Figma-compatible Flip shortcuts without stealing text input", () => {
    const workspace = createWorkspace();
    const flipSelection = vi.fn();
    const { unmount } = renderHook(() =>
      useCanvasWorkspaceController(
        controllerArgs(workspace, {
          canFlipSelection: true,
          flipSelection,
          platform: "win32",
        }),
      ),
    );

    fireEvent.keyDown(window, { code: "KeyH", key: "H", shiftKey: true });
    fireEvent.keyDown(window, { code: "KeyV", key: "V", shiftKey: true });
    expect(flipSelection).toHaveBeenNthCalledWith(1, "horizontal");
    expect(flipSelection).toHaveBeenNthCalledWith(2, "vertical");

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { code: "KeyH", key: "H", shiftKey: true });
    input.remove();
    expect(flipSelection).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("routes duplicate and delete shortcuts to the marked Smart Selection subset", () => {
    const workspace = createWorkspace();
    const runtime = workspace.getActiveRuntime();
    const duplicateSelection = vi.fn();
    const deleteNodes = vi.fn();
    const { result, unmount } = renderHook(() =>
      useCanvasWorkspaceController(
        controllerArgs(workspace, { deleteNodes, duplicateSelection }),
      ),
    );
    const nodeIds = ["feature_one", "feature_two", "feature_three"];
    act(() => {
      runtime.setSelection(nodeIds, "feature_two");
      result.current.setSmartSelectionMarkState({
        dimension: "horizontal",
        documentId: runtime.getSnapshot().document.documentId,
        markedNodeIds: ["feature_two"],
        nodeIds,
        pageId: "page_welcome",
        revision: runtime.getSnapshot().document.revision,
      });
    });

    fireEvent.keyDown(window, { code: "KeyD", key: "d", metaKey: true });
    expect(duplicateSelection).toHaveBeenCalledWith(["feature_two"]);
    fireEvent.keyDown(window, { code: "Backspace", key: "Backspace" });
    expect(deleteNodes).toHaveBeenCalledWith(["feature_two"]);

    act(() => runtime.setSelection(["feature_one", "feature_two"]));
    fireEvent.keyDown(window, { code: "KeyD", key: "d", metaKey: true });
    expect(duplicateSelection).toHaveBeenLastCalledWith(undefined);
    unmount();
  });

  it("owns disposable hover, text and image session bridges", async () => {
    const workspace = createWorkspace();
    const setEditorError = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ activePageId }: { activePageId: string }) =>
        useCanvasWorkspaceController(
          controllerArgs(workspace, { activePageId, setEditorError }),
        ),
      { initialProps: { activePageId: "page_welcome" } },
    );
    act(() => {
      result.current.setLayerHoverTarget({ nodeId: "title_welcome" });
      result.current.handleImageCropControllerChange(
        (nodeId) => nodeId === "image_valid",
      );
      result.current.handleImageAreaSelectionControllerChange(() => false);
      result.current.handleImageExpandControllerChange(() => true);
    });

    expect(result.current.layerHoverTarget).toEqual({
      nodeId: "title_welcome",
    });
    expect(result.current.startImageCrop("image_valid")).toBe(true);
    expect(result.current.startImageCrop("image_other")).toBe(false);
    expect(result.current.startImageAreaSelection("image_valid")).toBe(false);
    expect(setEditorError).toHaveBeenLastCalledWith(
      "error.imageAreaSelectionUnavailable",
    );
    expect(result.current.startImageExpand("image_valid")).toBe(true);

    rerender({ activePageId: "page_other" });
    await waitFor(() => expect(result.current.layerHoverTarget).toBeNull());
    expect(result.current.textRangeSelection).toBeNull();
    unmount();
  });
});

type ControllerArgs = Parameters<typeof useCanvasWorkspaceController>[0];

function createWorkspace() {
  return new WorkspaceRuntime({
    projectId: "project_alpha",
    designFileId: "design_alpha",
    name: "Alpha",
    document: createWelcomeDocument(),
  });
}

function controllerArgs(
  workspace: WorkspaceRuntime,
  overrides: Partial<ControllerArgs> = {},
): ControllerArgs {
  const runtime = workspace.getActiveRuntime();
  return {
    activePageId: "page_welcome",
    applyBooleanOperation: vi.fn(),
    canDeleteSelection: true,
    canFlattenSelection: false,
    canFlipSelection: false,
    canRenameSelection: true,
    canToggleMaskSelection: true,
    deleteNodes: vi.fn(),
    documentId: runtime.getSnapshot().document.documentId,
    duplicateSelection: vi.fn(),
    editorActive: true,
    flattenSelection: vi.fn(),
    flipSelection: vi.fn(),
    groupSelection: vi.fn(),
    openRenameLayers: vi.fn(),
    platform: "darwin",
    reorderSelection: vi.fn(),
    runtime,
    setEditorError: vi.fn(),
    t: (key) => key,
    toggleLeftPanel: vi.fn(),
    toggleMaskSelection: vi.fn(),
    toggleSelectedLayerState: vi.fn(),
    toggleUtilityPanel: vi.fn(),
    ungroupSelection: vi.fn(),
    workspace,
    ...overrides,
  };
}

function expectBoundsCentered(
  viewport: {
    width: number;
    height: number;
    zoom: number;
    panX: number;
    panY: number;
  },
  bounds: { x: number; y: number; width: number; height: number },
) {
  expect(
    (bounds.x + bounds.width / 2) * viewport.zoom + viewport.panX,
  ).toBeCloseTo(viewport.width / 2);
  expect(
    (bounds.y + bounds.height / 2) * viewport.zoom + viewport.panY,
  ).toBeCloseTo(viewport.height / 2);
}
