import {
  DEFAULT_LAYOUT_SIZING,
  type DesignDocument,
  type LayoutSizing,
} from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import {
  directTransformElementBounds,
  directTransformElementCenter,
  readDirectTransformElementState,
  type DirectTransformElementState,
} from "./direct-transform-element-state.js";
import type {
  LeaferEngineSyncInput,
  LeaferGridChildSpanRequest,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;

const MATRIX_EPSILON = 0.000_001;

export interface DirectGridChildMoveSession {
  anchorNodeId: string;
  frameId: string;
  hitOffset: { row: number; column: number };
  initialTarget: { row: number; column: number };
  nodeIds: string[];
  target: { row: number; column: number };
}

export interface DirectGridChildSpanSession {
  frameId: string;
  initialTarget: GridSpanTarget;
  nodeId: string;
  size: { width: number; height: number };
  sizing: LayoutSizing;
  target: GridSpanTarget | null;
}

interface GridSpanTarget {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
}

export function createGridChildMoveSession(input: {
  cellAt: (
    frameId: string,
    point: { x: number; y: number },
  ) => { row: number; column: number } | null;
  element: (nodeId: string) => LeaferElement | undefined;
  engineInput: LeaferEngineSyncInput;
  selectedNodeIds: string[];
}): DirectGridChildMoveSession | undefined {
  const { engineInput, selectedNodeIds } = input;
  const frameId = engineInput.gridEditorFrameId;
  const frame = frameId ? engineInput.document.nodesById[frameId] : undefined;
  const anchorNodeId =
    engineInput.selection.anchorNodeId ?? selectedNodeIds.at(-1);
  if (
    !frameId ||
    !frame ||
    (frame.kind !== "frame" && frame.kind !== "slot") ||
    frame.properties.autoLayout?.mode !== "grid" ||
    selectedNodeIds.length === 0 ||
    !anchorNodeId ||
    !selectedNodeIds.includes(anchorNodeId) ||
    !selectedNodeIds.every((nodeId) =>
      isMovableGridChild(engineInput.document, frameId, nodeId),
    )
  ) {
    return undefined;
  }
  const initialPlacement =
    engineInput.document.nodesById[anchorNodeId]?.gridPlacement;
  const anchor = input.element(anchorNodeId);
  const hit = anchor
    ? input.cellAt(frameId, directTransformElementCenter(anchor))
    : null;
  if (!initialPlacement || !hit) return undefined;
  return {
    anchorNodeId,
    frameId,
    hitOffset: {
      row: hit.row - initialPlacement.row,
      column: hit.column - initialPlacement.column,
    },
    initialTarget: {
      row: initialPlacement.row,
      column: initialPlacement.column,
    },
    nodeIds: selectedNodeIds,
    target: {
      row: initialPlacement.row,
      column: initialPlacement.column,
    },
  };
}

export function updateGridChildMoveSession(input: {
  element: (nodeId: string) => LeaferElement | undefined;
  preview: (
    frameId: string,
    point: { x: number; y: number },
  ) => { row: number; column: number } | null;
  session: DirectGridChildMoveSession;
}): void {
  const anchor = input.element(input.session.anchorNodeId);
  if (!anchor) return;
  const hit = input.preview(
    input.session.frameId,
    directTransformElementCenter(anchor),
  );
  if (!hit) return;
  input.session.target = {
    row: hit.row - input.session.hitOffset.row,
    column: hit.column - input.session.hitOffset.column,
  };
}

export function gridChildMoveChanged(
  session: DirectGridChildMoveSession,
): boolean {
  return !sameGridCell(session.initialTarget, session.target);
}

export function createGridChildSpanSession(input: {
  before: ReadonlyMap<string, DirectTransformElementState>;
  engineInput: LeaferEngineSyncInput;
  selectedNodeIds: readonly string[];
}): DirectGridChildSpanSession | undefined {
  const { engineInput, selectedNodeIds } = input;
  const frameId = engineInput.gridEditorFrameId;
  const nodeId = selectedNodeIds[0];
  const frame = frameId ? engineInput.document.nodesById[frameId] : undefined;
  const node = nodeId ? engineInput.document.nodesById[nodeId] : undefined;
  const sizing = node?.layoutSizing ?? DEFAULT_LAYOUT_SIZING;
  const placement = node?.gridPlacement;
  const state = nodeId ? input.before.get(nodeId) : undefined;
  if (
    selectedNodeIds.length !== 1 ||
    !frameId ||
    !nodeId ||
    !frame ||
    (frame.kind !== "frame" && frame.kind !== "slot") ||
    frame.properties.autoLayout?.mode !== "grid" ||
    !node ||
    node.parentId !== frameId ||
    !node.visible ||
    node.layoutPositioning === "absolute" ||
    !placement ||
    !state ||
    (sizing.horizontal !== "fill" && sizing.vertical !== "fill")
  ) {
    return undefined;
  }
  const target = {
    row: placement.row,
    column: placement.column,
    rowSpan: placement.rowSpan,
    columnSpan: placement.columnSpan,
  };
  return {
    frameId,
    initialTarget: target,
    nodeId,
    size: state.size,
    sizing,
    target: { ...target },
  };
}

export function updateGridChildSpanSession(input: {
  before: ReadonlyMap<string, DirectTransformElementState>;
  element: (nodeId: string) => LeaferElement | undefined;
  preview: (
    frameId: string,
    nodeId: string,
    before: DirectTransformElementState,
    next: DirectTransformElementState | null,
  ) => GridSpanTarget | null;
  session: DirectGridChildSpanSession;
}): void {
  const before = input.before.get(input.session.nodeId);
  const element = input.element(input.session.nodeId);
  if (!before || !element) return;
  const next = readDirectTransformElementState(element);
  input.session.target = input.preview(
    input.session.frameId,
    input.session.nodeId,
    before,
    next,
  );
  const bounds = directTransformElementBounds(next);
  input.session.size = { width: bounds.width, height: bounds.height };
}

export function createGridChildSpanRequest(input: {
  document: DesignDocument;
  expectedRevision: number;
  session: DirectGridChildSpanSession;
}): LeaferGridChildSpanRequest | null {
  const { session } = input;
  const node = input.document.nodesById[session.nodeId];
  if (!node || !session.target) return null;
  const spanChanged = !sameGridSpan(session.initialTarget, session.target);
  const canPersistSize =
    node.kind !== "group" &&
    node.kind !== "boolean" &&
    node.kind !== "instance";
  const persistedSize = canPersistSize
    ? {
        width:
          session.sizing.horizontal === "fill"
            ? node.size.width
            : session.size.width,
        height:
          session.sizing.vertical === "fill"
            ? node.size.height
            : session.size.height,
      }
    : null;
  const sizeChanged =
    persistedSize !== null &&
    (!nearlyEqual(persistedSize.width, node.size.width) ||
      !nearlyEqual(persistedSize.height, node.size.height));
  if (!spanChanged && !sizeChanged) return null;
  return {
    expectedRevision: input.expectedRevision,
    frameId: session.frameId,
    nodeId: session.nodeId,
    ...(canPersistSize ? { size: session.size } : {}),
    target: session.target,
  };
}

function isMovableGridChild(
  document: DesignDocument,
  frameId: string,
  nodeId: string,
): boolean {
  const node = document.nodesById[nodeId];
  return Boolean(
    node &&
    node.parentId === frameId &&
    node.visible &&
    node.layoutPositioning !== "absolute" &&
    node.gridPlacement,
  );
}

function sameGridCell(
  left: { row: number; column: number },
  right: { row: number; column: number },
): boolean {
  return left.row === right.row && left.column === right.column;
}

function sameGridSpan(left: GridSpanTarget, right: GridSpanTarget): boolean {
  return (
    left.row === right.row &&
    left.column === right.column &&
    left.rowSpan === right.rowSpan &&
    left.columnSpan === right.columnSpan
  );
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MATRIX_EPSILON;
}
