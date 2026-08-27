import type {
  DesignDocument,
  ViewportState,
} from "@opendesign/design-contracts";
import {
  documentToScreen,
  getNodeBounds,
  MAX_LAYER_NAME_LENGTH,
} from "@opendesign/editor-runtime";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import styles from "./CanvasFrameLabels.module.scss";

export type CanvasFrameLabel = {
  kind: "component" | "frame" | "slice";
  name: string;
  nodeId: string;
  selected: boolean;
  x: number;
  y: number;
};

export function CanvasFrameLabels({
  document,
  onRename,
  onSelect,
  pageId,
  selectedNodeIds,
  viewport,
}: {
  document: DesignDocument;
  onRename: (
    nodeId: string,
    name: string,
  ) => { ok: true } | { ok: false; error: string };
  onSelect: (nodeId: string) => void;
  pageId: string;
  selectedNodeIds: readonly string[];
  viewport: ViewportState;
}) {
  const composing = useRef(false);
  const editor = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{
    draft: string;
    error: string | null;
    nodeId: string;
  } | null>(null);
  const labels = useMemo(
    () => resolveCanvasFrameLabels(document, pageId, viewport, selectedNodeIds),
    [document, pageId, selectedNodeIds, viewport],
  );
  useEffect(() => {
    if (editing && !labels.some((label) => label.nodeId === editing.nodeId)) {
      composing.current = false;
      setEditing(null);
    }
  }, [editing, labels]);
  useEffect(() => {
    if (!editing) return;
    editor.current?.focus();
    editor.current?.select();
  }, [editing?.nodeId]);
  if (labels.length === 0) return null;

  const cancelEditing = () => {
    composing.current = false;
    setEditing(null);
  };
  const commit = () => {
    if (!editing) return;
    const nextName = editing.draft.trim();
    const currentName = labels.find(
      (label) => label.nodeId === editing.nodeId,
    )?.name;
    if (nextName === currentName) {
      cancelEditing();
      return;
    }
    const result = onRename(editing.nodeId, nextName);
    if (result.ok) {
      cancelEditing();
      return;
    }
    setEditing({ ...editing, error: result.error });
  };

  return (
    <div className={styles.root}>
      {labels.map((label) => {
        const activeEditor = editing?.nodeId === label.nodeId ? editing : null;
        return (
          <div
            className={styles.item}
            data-kind={label.kind}
            data-selected={label.selected ? "true" : "false"}
            key={label.nodeId}
            style={
              {
                "--canvas-frame-label-x": `${label.x}px`,
                "--canvas-frame-label-y": `${label.y}px`,
                "--canvas-frame-label-editor-width": `${labelEditorWidth(activeEditor?.draft ?? label.name)}px`,
              } as CSSProperties
            }
          >
            {activeEditor ? (
              <>
                <input
                  aria-invalid={activeEditor.error ? "true" : undefined}
                  aria-label={label.name}
                  className={styles.input}
                  maxLength={MAX_LAYER_NAME_LENGTH}
                  onBlur={() => {
                    if (!composing.current) commit();
                  }}
                  onChange={(event) =>
                    setEditing({
                      ...activeEditor,
                      draft: event.target.value,
                      error: null,
                    })
                  }
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onKeyDown={(event) =>
                    handleEditorKeyDown(
                      event,
                      composing.current,
                      commit,
                      cancelEditing,
                    )
                  }
                  onPointerDown={stopCanvasPointer}
                  ref={editor}
                  value={activeEditor.draft}
                />
                {activeEditor.error && (
                  <span className={styles.error} role="alert">
                    {activeEditor.error}
                  </span>
                )}
              </>
            ) : (
              <button
                aria-pressed={label.selected}
                className={styles.label}
                onClick={() => onSelect(label.nodeId)}
                onDoubleClick={() => {
                  composing.current = false;
                  setEditing({
                    draft: label.name,
                    error: null,
                    nodeId: label.nodeId,
                  });
                }}
                onPointerDown={stopCanvasPointer}
                title={label.name}
                type="button"
              >
                {label.name}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function resolveCanvasFrameLabels(
  document: DesignDocument,
  pageId: string,
  viewport: ViewportState,
  selectedNodeIds: readonly string[],
): CanvasFrameLabel[] {
  const page = document.pagesById[pageId];
  if (!page) return [];
  const componentRootIds = new Set(
    Object.values(document.componentsById).map(
      (component) => component.rootNodeId,
    ),
  );
  const selectedIds = new Set(selectedNodeIds);
  return page.rootNodeIds.flatMap((nodeId) => {
    const node = document.nodesById[nodeId];
    if (!node || !node.visible || node.opacity <= 0) return [];
    const kind = labelKind(node.kind, componentRootIds.has(nodeId));
    if (!kind) return [];
    const bounds = getNodeBounds(document, nodeId);
    if (!bounds) return [];
    const topLeft = documentToScreen({ x: bounds.x, y: bounds.y }, viewport);
    const bottomRight = documentToScreen(
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      viewport,
    );
    if (!intersectsViewport(topLeft, bottomRight, viewport)) return [];
    return [
      {
        kind,
        name: node.name,
        nodeId,
        selected: selectedIds.has(nodeId),
        x: roundScreenCoordinate(topLeft.x),
        y: roundScreenCoordinate(topLeft.y - 20),
      },
    ];
  });
}

function labelKind(
  nodeKind: string,
  componentRoot: boolean,
): CanvasFrameLabel["kind"] | null {
  if (componentRoot) return "component";
  if (nodeKind === "frame") return "frame";
  if (nodeKind === "slice") return "slice";
  return null;
}

function intersectsViewport(
  topLeft: { x: number; y: number },
  bottomRight: { x: number; y: number },
  viewport: ViewportState,
): boolean {
  const margin = 32;
  return (
    bottomRight.x >= -margin &&
    bottomRight.y >= -margin &&
    topLeft.x <= viewport.width + margin &&
    topLeft.y <= viewport.height + margin
  );
}

function roundScreenCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function handleEditorKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  composing: boolean,
  commit: () => void,
  cancel: () => void,
): void {
  event.stopPropagation();
  if (event.key === "Enter") {
    if (composing || event.nativeEvent.isComposing) return;
    event.preventDefault();
    commit();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancel();
  }
}

function labelEditorWidth(value: string): number {
  return Math.min(240, Math.max(96, value.length * 7 + 16));
}

function stopCanvasPointer(event: PointerEvent<HTMLElement>): void {
  event.stopPropagation();
}
