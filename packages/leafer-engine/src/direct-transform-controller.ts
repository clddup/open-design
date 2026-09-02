import type * as LeaferEditorModule from "leafer-editor";
import {
  createGridChildMoveSession,
  createGridChildSpanRequest,
  createGridChildSpanSession,
  gridChildMoveChanged,
  updateGridChildMoveSession,
  updateGridChildSpanSession,
  type DirectGridChildMoveSession,
  type DirectGridChildSpanSession,
} from "./direct-grid-transform-session.js";
import {
  createDirectTransformOperations,
  readDirectTransformElementState,
  type DirectTransformElementState,
} from "./direct-transform-element-state.js";
import { DirectTransformSnapSession } from "./direct-transform-snap-session.js";
import type { LeaferElementSpec, LeaferSceneProjection } from "./mapping.js";
import type {
  LeaferEngineSyncInput,
  LeaferGridChildMoveRequest,
  LeaferGridChildSpanRequest,
  LeaferOperationKind,
  LeaferOperationRequest,
  LeaferSnapGuideLine,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferEditor = InstanceType<LeaferModule["Editor"]>;
type LeaferElement = InstanceType<LeaferModule["UI"]>;

export {
  directTransformElementBounds,
  type DirectTransformElementState,
} from "./direct-transform-element-state.js";

interface DirectTransformSession {
  before: Map<string, DirectTransformElementState>;
  changed: boolean;
  documentId: string;
  kind: LeaferOperationKind;
  pageId: string;
  revision: number;
  selectionNodeIds: string[];
  gridChildMove?: DirectGridChildMoveSession;
  gridChildSpan?: DirectGridChildSpanSession;
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
  onSnapGuideLines: (lines: readonly LeaferSnapGuideLine[]) => void;
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

export class DirectTransformController {
  readonly #moveSnap: DirectTransformSnapSession;
  readonly #options: DirectTransformControllerOptions;
  #previewFrame: number | null = null;
  #session: DirectTransformSession | null = null;

  constructor(options: DirectTransformControllerOptions) {
    this.#options = options;
    this.#moveSnap = new DirectTransformSnapSession({
      currentDocument: () => this.#options.current().input?.document ?? null,
      element: options.element,
      onLines: options.onSnapGuideLines,
    });
  }

  get active(): boolean {
    return this.#session !== null;
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
      return;
    }
    if (session.kind === "move" && !session.gridChildMove) {
      this.#moveSnap.syncViewport(input);
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
    if (
      revisionChanged &&
      session.kind === "move" &&
      session.gridChildMove === undefined
    ) {
      this.#moveSnap.refresh({
        engineInput: sync.input,
        excludedNodeIds: new Set(session.before.keys()),
        selectedNodeIds: session.selectionNodeIds,
      });
    }
    session.revision = sync.input.document.revision;
  }

  begin(kind?: LeaferOperationKind): void {
    const current = this.#options.current();
    if (this.#session) {
      if (kind && this.#session.kind === "transform") {
        this.#session.kind = kind;
        this.#startMoveSnap(this.#session, current.input);
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
    const selectionNodeIds = this.#selectedNodeIds();
    const gridChildMove = createGridChildMoveSession({
      cellAt: this.#options.gridChildCellAt,
      element: this.#options.element,
      engineInput: input,
      selectedNodeIds: selectionNodeIds,
    });
    const gridChildSpan = createGridChildSpanSession({
      before,
      engineInput: input,
      selectedNodeIds: selectionNodeIds,
    });
    this.#session = {
      before,
      changed: false,
      documentId: input.document.documentId,
      kind: kind ?? this.#currentKind(),
      pageId: input.pageId,
      revision: input.document.revision,
      selectionNodeIds,
      ...(gridChildMove ? { gridChildMove } : {}),
      ...(gridChildSpan ? { gridChildSpan } : {}),
    };
    this.#startMoveSnap(this.#session, input);
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
      updateGridChildMoveSession({
        element: this.#options.element,
        preview: this.#options.previewGridChildDrop,
        session: session.gridChildMove,
      });
    }
    if (session.gridChildSpan && session.kind === "resize") {
      updateGridChildSpanSession({
        before: session.before,
        element: this.#options.element,
        preview: this.#options.previewGridChildSpan,
        session: session.gridChildSpan,
      });
    }
    if (session.kind === "move") this.#moveSnap.update();
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
    this.#moveSnap.finish();
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
      if (!gridChildMoveChanged(move)) return false;
      return this.#options.onGridChildMove({
        anchorNodeId: move.anchorNodeId,
        expectedRevision: session.revision,
        frameId: move.frameId,
        nodeIds: move.nodeIds,
        target: move.target,
      });
    }
    if (session.gridChildSpan && session.kind === "resize") {
      const document = current.input?.document;
      this.#options.restoreProjection();
      if (!document) return false;
      const request = createGridChildSpanRequest({
        document,
        expectedRevision: session.revision,
        session: session.gridChildSpan,
      });
      return request ? this.#options.onGridChildSpan(request) : false;
    }
    const document = current.input?.document;
    if (!document) return false;
    const operations = createDirectTransformOperations({
      before: session.before,
      document,
      element: this.#options.element,
      projection: current.projection,
    });
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
    if (this.#moveSnap.handleKeyDown(event)) return false;
    if (!this.#session || event.code !== "Escape") return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancel(true);
    return true;
  }

  handleKeyUp(event: KeyboardEvent): void {
    this.#moveSnap.handleKeyUp(event);
  }

  handleWindowBlur(): void {
    this.#moveSnap.resetModifiers();
  }

  cancel(restore = false): boolean {
    this.cancelPreview();
    if (!this.#session) return false;
    const session = this.#session;
    const gridChildMove = session.gridChildMove;
    const gridChildSpan = session.gridChildSpan;
    this.#session = null;
    this.#moveSnap.cancel();
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

  #startMoveSnap(
    session: DirectTransformSession,
    input: LeaferEngineSyncInput | null,
  ): void {
    if (!input || session.kind !== "move" || session.gridChildMove) {
      return;
    }
    this.#moveSnap.begin({
      engineInput: input,
      excludedNodeIds: new Set(session.before.keys()),
      selectedNodeIds: session.selectionNodeIds,
    });
  }

  #capture(
    nodeIds: readonly string[],
  ): Map<string, DirectTransformElementState> {
    const captured = new Map<string, DirectTransformElementState>();
    nodeIds.forEach((nodeId) => {
      const element = this.#options.element(nodeId);
      if (element) {
        captured.set(nodeId, readDirectTransformElementState(element));
      }
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

function sameStringList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
