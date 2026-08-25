import {
  DEFAULT_LAYOUT_SIZING,
  normalizeLineEndpoints,
  type DesignOperation,
  type LayoutSizing,
  type Transform,
} from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import type { LeaferElementSpec, LeaferSceneProjection } from "./mapping.js";
import type {
  LeaferEngineSyncInput,
  LeaferGridChildMoveRequest,
  LeaferGridChildSpanRequest,
  LeaferOperationKind,
  LeaferOperationRequest,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferEditor = InstanceType<LeaferModule["Editor"]>;
type LeaferElement = InstanceType<LeaferModule["UI"]>;

export interface DirectTransformElementState {
  linePoints?: readonly [number, number, number, number];
  size: { height: number; width: number };
  transform: Transform;
}

interface DirectTransformSession {
  before: Map<string, DirectTransformElementState>;
  changed: boolean;
  documentId: string;
  kind: LeaferOperationKind;
  pageId: string;
  revision: number;
  selectionNodeIds: string[];
  gridChildMove?: {
    anchorNodeId: string;
    frameId: string;
    hitOffset: { row: number; column: number };
    initialTarget: { row: number; column: number };
    nodeIds: string[];
    target: { row: number; column: number };
  };
  gridChildSpan?: {
    frameId: string;
    initialTarget: {
      row: number;
      column: number;
      rowSpan: number;
      columnSpan: number;
    };
    nodeId: string;
    size: { width: number; height: number };
    sizing: LayoutSizing;
    target: {
      row: number;
      column: number;
      rowSpan: number;
      columnSpan: number;
    } | null;
  };
}

interface DirectTransformControllerOptions {
  canPreviewBoolean: () => boolean;
  current: () => {
    disposed: boolean;
    input: LeaferEngineSyncInput | null;
    projection: LeaferSceneProjection | null;
    synchronizing: boolean;
  };
  editor: LeaferEditor;
  element: (nodeId: string) => LeaferElement | undefined;
  finishNodePresentation: (nodeId: string) => void;
  hasComponentTarget: () => boolean;
  gridChildCellAt: (
    frameId: string,
    point: { x: number; y: number },
  ) => { row: number; column: number } | null;
  nodeId: (element: LeaferElement) => string | undefined;
  onGridChildMove: (request: LeaferGridChildMoveRequest) => boolean;
  onGridChildSpan: (request: LeaferGridChildSpanRequest) => boolean;
  onOperations: (request: LeaferOperationRequest) => boolean;
  onPreviewBoolean: (
    states: ReadonlyMap<string, DirectTransformElementState>,
  ) => void;
  previewGridChildDrop: (
    frameId: string,
    point: { x: number; y: number } | null,
  ) => { row: number; column: number } | null;
  previewGridChildSpan: (
    frameId: string,
    nodeId: string,
    before: DirectTransformElementState,
    next: DirectTransformElementState | null,
  ) => {
    row: number;
    column: number;
    rowSpan: number;
    columnSpan: number;
  } | null;
  restoreProjection: () => void;
}

interface DirectTransformProjectionSync {
  changedNodeIds: ReadonlySet<string>;
  input: LeaferEngineSyncInput;
  projection: LeaferSceneProjection;
  projectionContinuityLost: boolean;
}

const MATRIX_EPSILON = 0.000_001;

export class DirectTransformController {
  readonly #options: DirectTransformControllerOptions;
  #previewFrame: number | null = null;
  #session: DirectTransformSession | null = null;

  constructor(options: DirectTransformControllerOptions) {
    this.#options = options;
  }

  syncInput(input: LeaferEngineSyncInput): void {
    const session = this.#session;
    if (!session) return;
    const identityChanged =
      session.documentId !== input.document.documentId ||
      session.pageId !== input.pageId;
    if (
      identityChanged ||
      input.tool !== "select" ||
      input.vectorEditScope !== undefined ||
      (session.gridChildMove !== undefined &&
        session.gridChildMove.frameId !== input.gridEditorFrameId) ||
      (session.gridChildSpan !== undefined &&
        session.gridChildSpan.frameId !== input.gridEditorFrameId) ||
      !sameStringList(session.selectionNodeIds, input.selection.nodeIds)
    ) {
      this.cancel(!identityChanged);
    }
  }

  syncProjection(sync: DirectTransformProjectionSync): void {
    const session = this.#session;
    if (!session) return;
    const revisionChanged = session.revision !== sync.input.document.revision;
    const contiguousRevision =
      revisionChanged &&
      sync.input.changes?.documentId === session.documentId &&
      sync.input.changes.fromRevision === session.revision &&
      sync.input.changes.toRevision === sync.input.document.revision;
    const invalidatesInteraction = (nodeId: string) =>
      sync.changedNodeIds.has(nodeId) ||
      (sync.projection.affectedNodeIds?.has(nodeId) === true &&
        isLockedSpec(sync.projection.elementsById.get(nodeId)));
    if (
      sync.projectionContinuityLost ||
      (revisionChanged && !contiguousRevision) ||
      (session.gridChildMove !== undefined &&
        sync.changedNodeIds.has(session.gridChildMove.frameId)) ||
      (session.gridChildSpan !== undefined &&
        sync.changedNodeIds.has(session.gridChildSpan.frameId)) ||
      [...session.before.keys()].some(invalidatesInteraction)
    ) {
      this.cancel(true);
      return;
    }
    session.revision = sync.input.document.revision;
  }

  begin(kind?: LeaferOperationKind): void {
    const current = this.#options.current();
    if (this.#session) {
      if (kind && this.#session.kind === "transform") {
        this.#session.kind = kind;
      }
      return;
    }
    if (
      current.synchronizing ||
      current.disposed ||
      this.#selectionIsLocked()
    ) {
      return;
    }
    const input = current.input;
    if (!input || input.tool !== "select" || input.vectorEditScope) return;
    const nodeIds = this.#selectedSubtreeIds();
    if (nodeIds.length === 0) return;
    nodeIds.forEach(this.#options.finishNodePresentation);
    const before = this.#capture(nodeIds);
    const gridChildMove = this.#gridChildMove(input);
    const gridChildSpan = this.#gridChildSpan(input, before);
    this.#session = {
      before,
      changed: false,
      documentId: input.document.documentId,
      kind: kind ?? this.#currentKind(),
      pageId: input.pageId,
      revision: input.document.revision,
      selectionNodeIds: this.#selectedNodeIds(),
      ...(gridChildMove ? { gridChildMove } : {}),
      ...(gridChildSpan ? { gridChildSpan } : {}),
    };
  }

  markChanged(): void {
    const current = this.#options.current();
    if (current.synchronizing || current.disposed) return;
    this.begin();
    const session = this.#session;
    if (!session) {
      if (this.#selectionIsLocked()) this.#options.restoreProjection();
      return;
    }
    session.changed = true;
    if (session.gridChildMove && session.kind === "move") {
      const anchor = this.#options.element(session.gridChildMove.anchorNodeId);
      if (anchor) {
        const hit = this.#options.previewGridChildDrop(
          session.gridChildMove.frameId,
          elementCenter(anchor),
        );
        if (hit) {
          session.gridChildMove.target = {
            row: hit.row - session.gridChildMove.hitOffset.row,
            column: hit.column - session.gridChildMove.hitOffset.column,
          };
        }
      }
    }
    if (session.gridChildSpan && session.kind === "resize") {
      const span = session.gridChildSpan;
      const before = session.before.get(span.nodeId);
      const element = this.#options.element(span.nodeId);
      if (before && element) {
        const next = readElementState(element);
        span.target = this.#options.previewGridChildSpan(
          span.frameId,
          span.nodeId,
          before,
          next,
        );
        const bounds = directTransformElementBounds(next);
        span.size = { width: bounds.width, height: bounds.height };
      }
    }
    this.#schedulePreview();
    if (
      !this.#options.editor.editBox.dragging &&
      !this.#options.editor.editBox.gesturing
    ) {
      queueMicrotask(() => {
        if (this.#session === session) this.finish();
      });
    }
  }

  finish(): boolean {
    const current = this.#options.current();
    const session = this.#session;
    if (!session || current.synchronizing || current.disposed) return false;
    this.#session = null;
    this.cancelPreview();
    if (session.gridChildMove) {
      this.#options.previewGridChildDrop(session.gridChildMove.frameId, null);
    }
    if (session.gridChildSpan) {
      const before = session.before.get(session.gridChildSpan.nodeId);
      if (before) {
        this.#options.previewGridChildSpan(
          session.gridChildSpan.frameId,
          session.gridChildSpan.nodeId,
          before,
          null,
        );
      }
    }
    if (!session.changed) return false;
    if (session.gridChildMove && session.kind === "move") {
      const move = session.gridChildMove;
      this.#options.restoreProjection();
      if (sameGridCell(move.initialTarget, move.target)) return false;
      return this.#options.onGridChildMove({
        anchorNodeId: move.anchorNodeId,
        expectedRevision: session.revision,
        frameId: move.frameId,
        nodeIds: move.nodeIds,
        target: move.target,
      });
    }
    if (session.gridChildSpan && session.kind === "resize") {
      return this.#finishGridChildSpan(session);
    }
    const operations = this.#operationsFrom(session.before);
    if (operations.length === 0) return false;
    const accepted = this.#options.onOperations({
      kind: session.kind,
      operations,
      selectionNodeIds: session.selectionNodeIds,
    });
    if (!accepted) this.#options.restoreProjection();
    return accepted;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.#session || event.code !== "Escape") return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancel(true);
    return true;
  }

  cancel(restore = false): boolean {
    this.cancelPreview();
    if (!this.#session) return false;
    const session = this.#session;
    const gridChildMove = session.gridChildMove;
    const gridChildSpan = session.gridChildSpan;
    this.#session = null;
    if (gridChildMove) {
      this.#options.previewGridChildDrop(gridChildMove.frameId, null);
    }
    if (gridChildSpan) {
      const before = session.before.get(gridChildSpan.nodeId);
      if (before) {
        this.#options.previewGridChildSpan(
          gridChildSpan.frameId,
          gridChildSpan.nodeId,
          before,
          null,
        );
      }
    }
    if (restore && !this.#options.current().disposed) {
      this.#options.restoreProjection();
    }
    return true;
  }

  cancelPreview(): void {
    if (this.#previewFrame === null) return;
    cancelAnimationFrame(this.#previewFrame);
    this.#previewFrame = null;
  }

  dispose(): void {
    this.cancel();
  }

  #capture(
    nodeIds: readonly string[],
  ): Map<string, DirectTransformElementState> {
    const captured = new Map<string, DirectTransformElementState>();
    nodeIds.forEach((nodeId) => {
      const element = this.#options.element(nodeId);
      if (element) captured.set(nodeId, readElementState(element));
    });
    return captured;
  }

  #currentKind(): LeaferOperationKind {
    if (this.#options.editor.resizing) return "resize";
    if (this.#options.editor.rotating) return "rotate";
    if (this.#options.editor.skewing) return "skew";
    if (this.#options.editor.moving) return "move";
    return "transform";
  }

  #gridChildMove(
    input: LeaferEngineSyncInput,
  ): DirectTransformSession["gridChildMove"] {
    const frameId = input.gridEditorFrameId;
    const frame = frameId ? input.document.nodesById[frameId] : undefined;
    const nodeIds = this.#selectedNodeIds();
    const anchorNodeId = input.selection.anchorNodeId ?? nodeIds.at(-1);
    if (
      !frameId ||
      !frame ||
      (frame.kind !== "frame" && frame.kind !== "slot") ||
      frame.properties.autoLayout?.mode !== "grid" ||
      nodeIds.length === 0 ||
      !anchorNodeId ||
      !nodeIds.includes(anchorNodeId)
    ) {
      return undefined;
    }
    for (const nodeId of nodeIds) {
      const node = input.document.nodesById[nodeId];
      if (
        !node ||
        node.parentId !== frameId ||
        !node.visible ||
        node.layoutPositioning === "absolute" ||
        !node.gridPlacement
      ) {
        return undefined;
      }
    }
    const initialPlacement =
      input.document.nodesById[anchorNodeId]?.gridPlacement;
    const anchor = this.#options.element(anchorNodeId);
    const hit = anchor
      ? this.#options.gridChildCellAt(frameId, elementCenter(anchor))
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
      nodeIds,
      target: {
        row: initialPlacement.row,
        column: initialPlacement.column,
      },
    };
  }

  #gridChildSpan(
    input: LeaferEngineSyncInput,
    before: ReadonlyMap<string, DirectTransformElementState>,
  ): DirectTransformSession["gridChildSpan"] {
    const frameId = input.gridEditorFrameId;
    const nodeId = this.#selectedNodeIds()[0];
    const frame = frameId ? input.document.nodesById[frameId] : undefined;
    const node = nodeId ? input.document.nodesById[nodeId] : undefined;
    const sizing = node?.layoutSizing ?? DEFAULT_LAYOUT_SIZING;
    const placement = node?.gridPlacement;
    const state = nodeId ? before.get(nodeId) : undefined;
    if (
      input.selection.nodeIds.length !== 1 ||
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

  #finishGridChildSpan(session: DirectTransformSession): boolean {
    const span = session.gridChildSpan;
    const document = this.#options.current().input?.document;
    const node = span && document?.nodesById[span.nodeId];
    if (!span || !node) {
      this.#options.restoreProjection();
      return false;
    }
    this.#options.restoreProjection();
    if (!span.target) return false;
    const spanChanged = !sameGridSpan(span.initialTarget, span.target);
    const canPersistSize =
      node.kind !== "group" &&
      node.kind !== "boolean" &&
      node.kind !== "instance";
    const persistedSize = canPersistSize
      ? {
          width:
            span.sizing.horizontal === "fill"
              ? node.size.width
              : span.size.width,
          height:
            span.sizing.vertical === "fill"
              ? node.size.height
              : span.size.height,
        }
      : undefined;
    const sizeChanged =
      persistedSize !== undefined &&
      (!nearlyEqual(persistedSize.width, node.size.width) ||
        !nearlyEqual(persistedSize.height, node.size.height));
    if (!spanChanged && !sizeChanged) {
      return false;
    }
    return this.#options.onGridChildSpan({
      expectedRevision: session.revision,
      frameId: span.frameId,
      nodeId: span.nodeId,
      ...(canPersistSize ? { size: span.size } : {}),
      target: span.target,
    });
  }

  #operationsFrom(
    before: ReadonlyMap<string, DirectTransformElementState>,
  ): DesignOperation[] {
    const current = this.#options.current();
    const document = current.input?.document;
    const projection = current.projection;
    if (!document) return [];
    const operations: DesignOperation[] = [];
    for (const [nodeId, previous] of before) {
      const node = document.nodesById[nodeId];
      const element = this.#options.element(nodeId);
      const spec = projection?.elementsById.get(nodeId);
      if (!node || !element || isLockedSpec(spec)) continue;
      const next = readElementState(element);
      const linePointsChanged =
        node.kind === "line" &&
        previous.linePoints !== undefined &&
        next.linePoints !== undefined &&
        !sameNumberList(previous.linePoints, next.linePoints);
      let nextTransform = next.transform;
      let nextSize = node.kind === "line" ? node.size : next.size;
      let lineProperties:
        | { end: { x: number; y: number }; start: { x: number; y: number } }
        | undefined;
      if (linePointsChanged && next.linePoints) {
        const geometry = normalizeLineEndpoints(
          { x: next.linePoints[0], y: next.linePoints[1] },
          { x: next.linePoints[2], y: next.linePoints[3] },
        );
        nextTransform = translateLocalTransform(
          next.transform,
          geometry.bounds.x,
          geometry.bounds.y,
        );
        nextSize = {
          width: geometry.bounds.width,
          height: geometry.bounds.height,
        };
        lineProperties = { start: geometry.start, end: geometry.end };
      }
      const transformChanged = !sameTransform(node.transform, nextTransform);
      const sizeChanged =
        node.kind !== "group" &&
        node.kind !== "boolean" &&
        node.kind !== "instance" &&
        (!nearlyEqual(node.size.width, nextSize.width) ||
          !nearlyEqual(node.size.height, nextSize.height));
      if (!transformChanged && !sizeChanged && !lineProperties) continue;
      operations.push({
        commandId: `leafer_transform_${nodeId}`,
        type: "update_properties",
        nodeId,
        ...(transformChanged ? { transform: nextTransform } : undefined),
        ...(sizeChanged ? { size: nextSize } : undefined),
        ...(lineProperties ? { properties: lineProperties } : undefined),
      });
    }
    return operations;
  }

  #schedulePreview(): void {
    if (
      this.#previewFrame !== null ||
      !this.#session ||
      !this.#options.canPreviewBoolean()
    ) {
      return;
    }
    const session = this.#session;
    this.#previewFrame = requestAnimationFrame(() => {
      this.#previewFrame = null;
      if (this.#session !== session) return;
      const states = this.#capture([...session.before.keys()]);
      this.#options.onPreviewBoolean(states);
    });
  }

  #selectedNodeIds(): string[] {
    return this.#options.editor.list.flatMap((element) => {
      const nodeId = this.#options.nodeId(element as LeaferElement);
      return nodeId ? [nodeId] : [];
    });
  }

  #selectedSubtreeIds(): string[] {
    const projection = this.#options.current().projection;
    if (!projection) return [];
    const result: string[] = [];
    const visited = new Set<string>();
    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const spec = projection.elementsById.get(nodeId);
      if (!spec) return;
      result.push(nodeId);
      spec.childIds.forEach(visit);
    };
    this.#selectedNodeIds().forEach(visit);
    return result;
  }

  #selectionIsLocked(): boolean {
    if (this.#options.hasComponentTarget()) return true;
    const projection = this.#options.current().projection;
    return this.#options.editor.list.some((element) => {
      const nodeId = this.#options.nodeId(element as LeaferElement);
      return (
        nodeId !== undefined &&
        isLockedSpec(projection?.elementsById.get(nodeId))
      );
    });
  }
}

function isLockedSpec(spec: LeaferElementSpec | undefined): boolean {
  const metadata = spec?.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignLocked === true
  );
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MATRIX_EPSILON;
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeTransform(transform: Transform): Transform {
  return transform.map(normalizeNumber) as Transform;
}

function readElementState(element: LeaferElement): DirectTransformElementState {
  const matrix = element.localTransform;
  const tag = readTag(element);
  const textBounds =
    tag === "Text" ? element.getBounds("box", "inner") : undefined;
  const linePoints =
    tag === "Arrow" || tag === "Line" ? readLinePoints(element) : undefined;
  return {
    transform: normalizeTransform([
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
      matrix.e,
      matrix.f,
    ]),
    size: {
      width: normalizeNumber(
        element.width === undefined
          ? (textBounds?.width ?? 0)
          : Number(element.width) || 0,
      ),
      height: normalizeNumber(
        element.height === undefined
          ? (textBounds?.height ?? 0)
          : Number(element.height) || 0,
      ),
    },
    ...(linePoints ? { linePoints } : undefined),
  };
}

export function directTransformElementBounds(
  state: DirectTransformElementState,
): { x: number; y: number; width: number; height: number } {
  const localPoints = state.linePoints
    ? [
        { x: state.linePoints[0], y: state.linePoints[1] },
        { x: state.linePoints[2], y: state.linePoints[3] },
      ]
    : [
        { x: 0, y: 0 },
        { x: state.size.width, y: 0 },
        { x: state.size.width, y: state.size.height },
        { x: 0, y: state.size.height },
      ];
  const [a, b, c, d, e, f] = state.transform;
  const points = localPoints.map(({ x, y }) => ({
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  }));
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return {
    x: normalizeNumber(left),
    y: normalizeNumber(top),
    width: normalizeNumber(right - left),
    height: normalizeNumber(bottom - top),
  };
}

function elementCenter(element: LeaferElement): { x: number; y: number } {
  const bounds = directTransformElementBounds(readElementState(element));
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function sameGridCell(
  left: { row: number; column: number },
  right: { row: number; column: number },
): boolean {
  return left.row === right.row && left.column === right.column;
}

function sameGridSpan(
  left: { row: number; column: number; rowSpan: number; columnSpan: number },
  right: { row: number; column: number; rowSpan: number; columnSpan: number },
): boolean {
  return (
    left.row === right.row &&
    left.column === right.column &&
    left.rowSpan === right.rowSpan &&
    left.columnSpan === right.columnSpan
  );
}

function readLinePoints(
  element: LeaferElement,
): readonly [number, number, number, number] | undefined {
  const points = (element as LeaferElement & { points?: unknown }).points;
  if (
    Array.isArray(points) &&
    points.length >= 4 &&
    points.slice(0, 4).every((value) => typeof value === "number")
  ) {
    return points.slice(0, 4).map(normalizeNumber) as [
      number,
      number,
      number,
      number,
    ];
  }
  if (
    Array.isArray(points) &&
    points.length >= 2 &&
    points[0] &&
    points[1] &&
    typeof points[0] === "object" &&
    typeof points[1] === "object"
  ) {
    const start = points[0] as { x?: unknown; y?: unknown };
    const end = points[1] as { x?: unknown; y?: unknown };
    if (
      typeof start.x === "number" &&
      typeof start.y === "number" &&
      typeof end.x === "number" &&
      typeof end.y === "number"
    ) {
      return [start.x, start.y, end.x, end.y].map(normalizeNumber) as [
        number,
        number,
        number,
        number,
      ];
    }
  }
  return undefined;
}

function readTag(element: LeaferElement): string {
  return (element as LeaferElement & { tag?: string }).tag ?? "";
}

function sameNumberList(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => nearlyEqual(value, right[index] ?? 0))
  );
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameTransform(left: Transform, right: Transform): boolean {
  return left.every((value, index) => nearlyEqual(value, right[index] ?? 0));
}

function translateLocalTransform(
  transform: Transform,
  localX: number,
  localY: number,
): Transform {
  return normalizeTransform([
    transform[0],
    transform[1],
    transform[2],
    transform[3],
    transform[4] + transform[0] * localX + transform[2] * localY,
    transform[5] + transform[1] * localX + transform[3] * localY,
  ]);
}
