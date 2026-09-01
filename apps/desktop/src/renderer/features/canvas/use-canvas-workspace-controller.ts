import type {
  BooleanOperation,
  DesignDocument,
} from "@opendesign/design-contracts";
import {
  getNodeBounds,
  getSelectionBounds,
  screenToDocument,
  type EditorRuntime,
  type LayerOrderAction,
} from "@opendesign/editor-runtime";
import type {
  LeaferTextRangeSelection,
  LeaferTextStyleUpdate,
} from "@opendesign/leafer-engine";
import type { TextLayoutProvider } from "@opendesign/text-service";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import type { LayerHoverTarget } from "./layer-hover-target";
import type { Tool } from "../../state/editor";
import type { WorkspaceRuntime } from "../../state/workspace-runtime";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;
type CanvasFitTarget = "page" | "selection";

interface CanvasShortcutContext {
  applyBooleanOperation: (operation: BooleanOperation) => void;
  canDeleteSelection: boolean;
  canFlattenSelection: boolean;
  canRenameSelection: boolean;
  canToggleMaskSelection: boolean;
  changeZoom: (zoom: number) => void;
  deleteNodes: (nodeIds: readonly string[]) => void;
  duplicateSelection: () => void;
  editorActive: boolean;
  fitCanvas: (target: CanvasFitTarget) => void;
  flattenSelection: () => void;
  groupSelection: () => void;
  openRenameLayers: () => void;
  platform: NodeJS.Platform;
  reorderSelection: (action: LayerOrderAction) => void;
  toggleLeftPanel: () => void;
  toggleMaskSelection: () => void;
  toggleSelectedLayerState: (field: "locked" | "visible") => void;
  toggleUtilityPanel: () => void;
  ungroupSelection: () => void;
}

export function useCanvasWorkspaceController({
  activePageId,
  applyBooleanOperation,
  canDeleteSelection,
  canFlattenSelection,
  canRenameSelection,
  canToggleMaskSelection,
  deleteNodes,
  documentId,
  duplicateSelection,
  editorActive,
  flattenSelection,
  groupSelection,
  openRenameLayers,
  platform,
  reorderSelection,
  runtime,
  setEditorError,
  t,
  toggleLeftPanel,
  toggleMaskSelection,
  toggleSelectedLayerState,
  toggleUtilityPanel,
  ungroupSelection,
  workspace,
}: {
  activePageId: string;
  applyBooleanOperation: (operation: BooleanOperation) => void;
  canDeleteSelection: boolean;
  canFlattenSelection: boolean;
  canRenameSelection: boolean;
  canToggleMaskSelection: boolean;
  deleteNodes: (nodeIds: readonly string[]) => void;
  documentId: string;
  duplicateSelection: () => void;
  editorActive: boolean;
  flattenSelection: () => void;
  groupSelection: () => void;
  openRenameLayers: () => void;
  platform: NodeJS.Platform;
  reorderSelection: (action: LayerOrderAction) => void;
  runtime: EditorRuntime;
  setEditorError: (error: string | null) => void;
  t: Translate;
  toggleLeftPanel: () => void;
  toggleMaskSelection: () => void;
  toggleSelectedLayerState: (field: "locked" | "visible") => void;
  toggleUtilityPanel: () => void;
  ungroupSelection: () => void;
  workspace: WorkspaceRuntime;
}) {
  const [layerHoverTarget, setLayerHoverTarget] =
    useState<LayerHoverTarget | null>(null);
  const [textRangeSelection, setTextRangeSelection] =
    useState<LeaferTextRangeSelection | null>(null);
  const [textLayoutProviderEpoch, setTextLayoutProviderEpoch] = useState(0);
  const textEditingStyleController = useRef<
    ((style: LeaferTextStyleUpdate) => boolean) | null
  >(null);
  const imageCropController = useRef<((nodeId: string) => boolean) | null>(
    null,
  );
  const imageAreaSelectionController = useRef<
    ((nodeId: string) => boolean) | null
  >(null);
  const imageExpandController = useRef<((nodeId: string) => boolean) | null>(
    null,
  );

  const changeZoom = useCallback(
    (zoom: number) => {
      const viewport = runtime.getSnapshot().state.viewport;
      const nextZoom = Math.min(8, Math.max(0.1, zoom));
      const anchor = { x: viewport.width / 2, y: viewport.height / 2 };
      const documentAnchor = screenToDocument(anchor, viewport);
      runtime.setViewport({
        zoom: nextZoom,
        panX: anchor.x - documentAnchor.x * nextZoom,
        panY: anchor.y - documentAnchor.y * nextZoom,
      });
    },
    [runtime],
  );

  const fitCanvas = useCallback(
    (target: CanvasFitTarget) => {
      const current = runtime.getSnapshot();
      const bounds =
        target === "selection"
          ? getSelectionBounds(
              current.document,
              current.state.selection.nodeIds,
            )
          : pageBounds(current.document, activePageId);
      if (!bounds) return;
      const { width, height } = current.state.viewport;
      if (width <= 0 || height <= 0) return;
      const padding = 64;
      const zoom = Math.min(
        8,
        Math.max(
          0.1,
          Math.min(
            (width - padding * 2) / Math.max(bounds.width, 1),
            (height - padding * 2) / Math.max(bounds.height, 1),
          ),
        ),
      );
      runtime.setViewport({
        zoom,
        panX: width / 2 - (bounds.x + bounds.width / 2) * zoom,
        panY: height / 2 - (bounds.y + bounds.height / 2) * zoom,
      });
    },
    [activePageId, runtime],
  );

  const shortcutContext = useRef<CanvasShortcutContext>({
    applyBooleanOperation,
    canDeleteSelection,
    canFlattenSelection,
    canRenameSelection,
    canToggleMaskSelection,
    changeZoom,
    deleteNodes,
    duplicateSelection,
    editorActive,
    fitCanvas,
    flattenSelection,
    groupSelection,
    openRenameLayers,
    platform,
    reorderSelection,
    toggleLeftPanel,
    toggleMaskSelection,
    toggleSelectedLayerState,
    toggleUtilityPanel,
    ungroupSelection,
  });
  shortcutContext.current = {
    applyBooleanOperation,
    canDeleteSelection,
    canFlattenSelection,
    canRenameSelection,
    canToggleMaskSelection,
    changeZoom,
    deleteNodes,
    duplicateSelection,
    editorActive,
    fitCanvas,
    flattenSelection,
    groupSelection,
    openRenameLayers,
    platform,
    reorderSelection,
    toggleLeftPanel,
    toggleMaskSelection,
    toggleSelectedLayerState,
    toggleUtilityPanel,
    ungroupSelection,
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      handleCanvasShortcut(event, runtime, shortcutContext.current);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [runtime]);

  useEffect(() => {
    setLayerHoverTarget(null);
    setTextRangeSelection(null);
  }, [activePageId, documentId]);

  const handleTextLayoutProviderReady = useCallback(
    (provider: TextLayoutProvider) => {
      workspace.setTextLayoutProvider(provider);
      setTextLayoutProviderEpoch((current) => current + 1);
    },
    [workspace],
  );
  const handleTextEditingStyleControllerChange = useCallback(
    (controller: ((style: LeaferTextStyleUpdate) => boolean) | null) => {
      textEditingStyleController.current = controller;
    },
    [],
  );
  const updateTextEditingStyle = useCallback(
    (style: LeaferTextStyleUpdate) =>
      textEditingStyleController.current?.(style) ?? false,
    [],
  );
  const handleImageCropControllerChange = useCallback(
    (controller: ((nodeId: string) => boolean) | null) => {
      imageCropController.current = controller;
    },
    [],
  );
  const handleImageAreaSelectionControllerChange = useCallback(
    (controller: ((nodeId: string) => boolean) | null) => {
      imageAreaSelectionController.current = controller;
    },
    [],
  );
  const handleImageExpandControllerChange = useCallback(
    (controller: ((nodeId: string) => boolean) | null) => {
      imageExpandController.current = controller;
    },
    [],
  );
  const startImageCrop = useCallback(
    (nodeId: string) => imageCropController.current?.(nodeId) ?? false,
    [],
  );
  const startImageAreaSelection = useCallback(
    (nodeId: string) => {
      const started = imageAreaSelectionController.current?.(nodeId) ?? false;
      if (!started) setEditorError(t("error.imageAreaSelectionUnavailable"));
      return started;
    },
    [setEditorError, t],
  );
  const startImageExpand = useCallback(
    (nodeId: string) => {
      const started = imageExpandController.current?.(nodeId) ?? false;
      if (!started) setEditorError(t("error.imageExpandUnavailable"));
      return started;
    },
    [setEditorError, t],
  );

  return {
    changeZoom,
    fitCanvas,
    handleImageAreaSelectionControllerChange,
    handleImageCropControllerChange,
    handleImageExpandControllerChange,
    handleTextEditingStyleControllerChange,
    handleTextLayoutProviderReady,
    layerHoverTarget,
    setLayerHoverTarget,
    setTextRangeSelection,
    startImageAreaSelection,
    startImageCrop,
    startImageExpand,
    textLayoutProviderEpoch,
    textRangeSelection,
    updateTextEditingStyle,
  };
}

function handleCanvasShortcut(
  event: KeyboardEvent,
  runtime: EditorRuntime,
  context: CanvasShortcutContext,
): void {
  if (!context.editorActive || event.defaultPrevented || event.isComposing) {
    return;
  }
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && !event.altKey && !event.shiftKey && event.code === "KeyR") {
    event.preventDefault();
    if (!isEditableTarget(event.target) && context.canRenameSelection) {
      context.openRenameLayers();
    }
    return;
  }
  if (isEditableTarget(event.target)) return;
  const selection = runtime.getSnapshot().state.selection.nodeIds;
  if (event.key === "Escape" && selection.length > 0) {
    event.preventDefault();
    runtime.setSelection([]);
    return;
  }
  if (
    modifier &&
    event.shiftKey &&
    !event.altKey &&
    (event.code === "Digit1" || event.code === "Digit2")
  ) {
    event.preventDefault();
    if (event.code === "Digit1") context.toggleLeftPanel();
    else context.toggleUtilityPanel();
    return;
  }
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) runtime.redo();
    else runtime.undo();
    return;
  }
  if (modifier && event.key.toLowerCase() === "d") {
    event.preventDefault();
    context.duplicateSelection();
    return;
  }
  if (modifier && !event.altKey && !event.shiftKey && event.code === "KeyE") {
    event.preventDefault();
    if (context.canFlattenSelection) context.flattenSelection();
    return;
  }
  if (modifier && event.key.toLowerCase() === "g") {
    event.preventDefault();
    if (event.shiftKey) context.ungroupSelection();
    else context.groupSelection();
    return;
  }
  const maskShortcut =
    event.code === "KeyM" &&
    !event.shiftKey &&
    (context.platform === "darwin"
      ? event.metaKey && event.ctrlKey && !event.altKey
      : event.ctrlKey && event.altKey && !event.metaKey);
  if (maskShortcut) {
    event.preventDefault();
    if (context.canToggleMaskSelection) context.toggleMaskSelection();
    return;
  }
  if (
    modifier &&
    event.shiftKey &&
    !event.altKey &&
    (event.code === "KeyL" || event.code === "KeyH")
  ) {
    event.preventDefault();
    context.toggleSelectedLayerState(
      event.code === "KeyL" ? "locked" : "visible",
    );
    return;
  }
  const booleanShortcut = booleanOperationForShortcut(event);
  if (
    booleanShortcut &&
    event.altKey &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey
  ) {
    event.preventDefault();
    context.applyBooleanOperation(booleanShortcut);
    return;
  }
  const bracket = bracketDirection(event);
  if (
    modifier &&
    bracket &&
    (context.platform === "darwin" ? !event.shiftKey : !event.altKey)
  ) {
    event.preventDefault();
    const terminal =
      context.platform === "darwin" ? event.altKey : event.shiftKey;
    context.reorderSelection(
      bracket === "right"
        ? terminal
          ? "bring-to-front"
          : "bring-forward"
        : terminal
          ? "send-to-back"
          : "send-backward",
    );
    return;
  }
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    context.canDeleteSelection
  ) {
    event.preventDefault();
    context.deleteNodes(selection);
    return;
  }
  if (event.shiftKey && (event.key === "1" || event.key === "2")) {
    event.preventDefault();
    context.fitCanvas(event.key === "1" ? "page" : "selection");
    return;
  }
  if (modifier && ["=", "+", "-", "0"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "0") context.changeZoom(1);
    else {
      const zoom = runtime.getSnapshot().state.viewport.zoom;
      context.changeZoom(zoom * (event.key === "-" ? 0.9 : 1.1));
    }
    return;
  }
  const next = toolForShortcut(event);
  if (next) runtime.setTool(next);
}

function booleanOperationForShortcut(
  event: KeyboardEvent,
): BooleanOperation | null {
  return (
    (
      {
        KeyU: "union",
        KeyS: "subtract",
        KeyI: "intersect",
        KeyE: "exclude",
      } as const
    )[event.code as "KeyU" | "KeyS" | "KeyI" | "KeyE"] ??
    (
      {
        u: "union",
        s: "subtract",
        i: "intersect",
        e: "exclude",
      } as const
    )[event.key.toLowerCase() as "u" | "s" | "i" | "e"] ??
    null
  );
}

function bracketDirection(event: KeyboardEvent): "left" | "right" | null {
  if (event.code === "BracketRight" || event.key === "]" || event.key === "}") {
    return "right";
  }
  if (event.code === "BracketLeft" || event.key === "[" || event.key === "{") {
    return "left";
  }
  return null;
}

function toolForShortcut(event: KeyboardEvent): Tool | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const tools: Record<string, Tool> = {
    v: "select",
    f: "frame",
    r: "rectangle",
    o: "ellipse",
    l: event.shiftKey ? "arrow" : "line",
    p: "pen",
    t: "text",
  };
  return tools[event.key.toLowerCase()] ?? null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest(
          '[role="combobox"], [role="listbox"], [role="option"], [role="textbox"]',
        ) !== null))
  );
}

function pageBounds(document: DesignDocument, pageId: string) {
  const page = document.pagesById[pageId];
  if (!page) return null;
  const bounds = page.rootNodeIds
    .map((nodeId) => getNodeBounds(document, nodeId))
    .filter((value): value is NonNullable<typeof value> => value !== null);
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map((rect) => rect.x));
  const minY = Math.min(...bounds.map((rect) => rect.y));
  const maxX = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...bounds.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
