import type { Point } from "@opendesign/design-contracts";
import { normalizeVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import type * as LeaferEditorModule from "leafer-editor";
import { constrainPointToOctant } from "./angle-constraint.js";
import {
  LEAFER_EDITOR_SELECTION_COLOR,
  type LeaferElementSpec,
  type LeaferSceneProjection,
} from "./mapping.js";
import {
  appendPenVertex,
  createPenDraft,
  penDraftHandlePath,
  penDraftPreviewPath,
  penDraftToVectorNetwork,
  removeLastPenVertex,
  setPenVertexHandle,
  type PenDraft,
} from "./pen-tool.js";
import { asLeaferEvent, eventClientPoint } from "./pointer-event.js";
import type {
  LeaferCreateVectorRequest,
  LeaferEngineSyncInput,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

interface PenToolSession {
  activeVertexIndex: number | null;
  anchors: LeaferElement[];
  closeCandidate: boolean;
  cursor: Point;
  documentId: string;
  draft: PenDraft;
  handlePath: LeaferElement;
  pageId: string;
  parent: LeaferGroup;
  parentId: string | null;
  pointerDownClient: Point | null;
  previewGroup: LeaferGroup;
  previewPath: LeaferElement;
  revision: number;
}

interface PendingPenCommit {
  documentId: string;
  pageId: string;
  request: LeaferCreateVectorRequest;
  revision: number;
}

interface PenToolControllerOptions {
  current: () => {
    disposed: boolean;
    input: LeaferEngineSyncInput | null;
    projection: LeaferSceneProjection | null;
  };
  element: (nodeId: string) => LeaferElement | undefined;
  leafer: LeaferModule;
  nodeId: (element: LeaferElement) => string | undefined;
  onCreate: (request: LeaferCreateVectorRequest) => boolean;
  report: (error: unknown) => void;
  restoreProjection: () => void;
  root: LeaferGroup;
}

interface PenToolProjectionSync {
  changedNodeIds: ReadonlySet<string>;
  input: LeaferEngineSyncInput;
  projection: LeaferSceneProjection;
  projectionContinuityLost: boolean;
}

const MATRIX_EPSILON = 0.000_001;
const MIN_DRAW_DISTANCE = 4;
const PEN_CLOSE_DISTANCE = 10;
const PEN_HANDLE_COLOR = "#8aa4ff";

export class PenToolController {
  readonly #options: PenToolControllerOptions;
  #finishAfterProjectionSync = false;
  #pendingCommit: PendingPenCommit | null = null;
  #session: PenToolSession | null = null;

  constructor(options: PenToolControllerOptions) {
    this.#options = options;
  }

  prepareSync(
    input: LeaferEngineSyncInput,
    projectionWillChange: boolean,
  ): void {
    const session = this.#session;
    if (!session) return;
    if (
      session.documentId !== input.document.documentId ||
      session.pageId !== input.pageId
    ) {
      this.cancel();
      return;
    }
    if (input.tool === "pen") {
      if (!projectionWillChange) this.#updatePreview(input.viewport.zoom);
      return;
    }
    if (projectionWillChange) {
      this.#finishAfterProjectionSync = true;
      return;
    }
    this.#queueOpenCommit();
  }

  syncProjection(sync: PenToolProjectionSync): void {
    const session = this.#session;
    if (!session) {
      this.#finishAfterProjectionSync = false;
      return;
    }
    const revisionChanged = session.revision !== sync.input.document.revision;
    const contiguousRevision =
      revisionChanged &&
      sync.input.changes?.documentId === session.documentId &&
      sync.input.changes.fromRevision === session.revision &&
      sync.input.changes.toRevision === sync.input.document.revision;
    const parentSpec = session.parentId
      ? sync.projection.elementsById.get(session.parentId)
      : undefined;
    const parentInvalid =
      session.parentId !== null &&
      (sync.changedNodeIds.has(session.parentId) ||
        !isCreationContainer(parentSpec) ||
        isLockedSpec(parentSpec));
    if (
      sync.projectionContinuityLost ||
      (revisionChanged && !contiguousRevision) ||
      parentInvalid
    ) {
      this.cancel();
      return;
    }
    session.revision = sync.input.document.revision;
    this.#updatePreview(sync.input.viewport.zoom);
    if (this.#finishAfterProjectionSync) this.#queueOpenCommit();
  }

  completeSync(): void {
    const pending = this.#pendingCommit;
    this.#pendingCommit = null;
    if (!pending) return;
    this.#submit(pending);
  }

  abortSync(): void {
    this.cancel();
  }

  pointerDown(event: unknown): void {
    const current = this.#options.current();
    const input = current.input;
    if (current.disposed || !input || input.tool !== "pen") return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel || pointer.right || pointer.middle) return;
    const existing = this.#session;
    if (existing) {
      const rawLocal = pointer.getInnerPoint(existing.parent);
      if (this.#isCloseCandidate(existing, rawLocal, input.viewport.zoom)) {
        this.finish(true);
        return;
      }
      const previous = existing.draft.vertices.at(-1);
      const local =
        pointer.shiftKey && previous
          ? constrainPointToOctant(previous, rawLocal)
          : rawLocal;
      const zoom = normalizedZoom(input.viewport.zoom);
      if (
        previous &&
        pointDistance(previous, local) * zoom < MIN_DRAW_DISTANCE
      ) {
        return;
      }
      if (!appendPenVertex(existing.draft, local)) return;
      existing.activeVertexIndex = existing.draft.vertices.length - 1;
      existing.closeCandidate = false;
      existing.cursor = local;
      existing.pointerDownClient = eventClientPoint(pointer);
      this.#updatePreview(input.viewport.zoom);
      return;
    }

    const parentId = this.#resolveParent(pointer.target);
    if (parentId === undefined) return;
    const parent = this.#parent(parentId);
    if (!parent) return;
    const local = pointer.getInnerPoint(parent);
    const previewGroup = new this.#options.leafer.Group({
      editable: false,
      hittable: false,
    }) as LeaferGroup;
    const previewPath = new this.#options.leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
      strokeCap: "round",
      strokeJoin: "round",
    }) as LeaferElement;
    const handlePath = new this.#options.leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: PEN_HANDLE_COLOR,
    }) as LeaferElement;
    previewGroup.add(previewPath);
    previewGroup.add(handlePath);
    parent.add(previewGroup);
    this.#session = {
      activeVertexIndex: 0,
      anchors: [],
      closeCandidate: false,
      cursor: local,
      documentId: input.document.documentId,
      draft: createPenDraft(local),
      handlePath,
      pageId: input.pageId,
      parent,
      parentId,
      pointerDownClient: eventClientPoint(pointer),
      previewGroup,
      previewPath,
      revision: input.document.revision,
    };
    this.#updatePreview(input.viewport.zoom);
  }

  pointerMove(event: unknown): void {
    const session = this.#session;
    const current = this.#options.current();
    const input = current.input;
    if (!session || current.disposed || !input || input.tool !== "pen") return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel) return;
    const rawLocal = pointer.getInnerPoint(session.parent);
    if (
      session.activeVertexIndex !== null &&
      session.pointerDownClient !== null
    ) {
      const vertex = session.draft.vertices[session.activeVertexIndex];
      const local =
        pointer.shiftKey && vertex
          ? constrainPointToOctant(vertex, rawLocal)
          : rawLocal;
      session.cursor = local;
      const client = eventClientPoint(pointer);
      const dragged =
        pointDistance(session.pointerDownClient, client) >= MIN_DRAW_DISTANCE;
      if (vertex) {
        setPenVertexHandle(
          session.draft,
          session.activeVertexIndex,
          dragged
            ? { x: local.x - vertex.x, y: local.y - vertex.y }
            : { x: 0, y: 0 },
        );
      }
      session.closeCandidate = false;
    } else {
      session.closeCandidate = this.#isCloseCandidate(
        session,
        rawLocal,
        input.viewport.zoom,
      );
      const previous = session.draft.vertices.at(-1);
      session.cursor =
        pointer.shiftKey && previous && !session.closeCandidate
          ? constrainPointToOctant(previous, rawLocal)
          : rawLocal;
    }
    this.#updatePreview(input.viewport.zoom);
  }

  pointerUp(event: unknown): void {
    const session = this.#session;
    if (!session || session.activeVertexIndex === null) return;
    this.pointerMove(event);
    const current = this.#session;
    const zoom = this.#options.current().input?.viewport.zoom ?? 1;
    if (!current) return;
    current.activeVertexIndex = null;
    current.pointerDownClient = null;
    current.closeCandidate = this.#isCloseCandidate(
      current,
      current.cursor,
      zoom,
    );
    this.#updatePreview(zoom);
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const session = this.#session;
    if (!session) return false;
    if (event.code === "Escape" || event.code === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (session.draft.vertices.length >= 2) this.finish(false);
      else this.cancel();
      return true;
    }
    if (event.code !== "Backspace" && event.code !== "Delete") return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    removeLastPenVertex(session.draft);
    if (session.draft.vertices.length === 0) {
      this.cancel();
      return true;
    }
    session.activeVertexIndex = null;
    session.pointerDownClient = null;
    session.closeCandidate = false;
    const last = session.draft.vertices.at(-1)!;
    session.cursor = { x: last.x, y: last.y };
    this.#updatePreview(this.#options.current().input?.viewport.zoom ?? 1);
    return true;
  }

  finish(closed: boolean): boolean {
    const pending = this.#takeCommit(closed);
    if (!pending) return false;
    return this.#submit(pending);
  }

  cancel(): boolean {
    this.#finishAfterProjectionSync = false;
    this.#pendingCommit = null;
    return this.#clearSession();
  }

  dispose(): void {
    this.cancel();
  }

  #clearSession(): boolean {
    const session = this.#session;
    if (!session) return false;
    this.#session = null;
    session.previewGroup.remove();
    session.previewGroup.destroy();
    return true;
  }

  #isCloseCandidate(
    session: PenToolSession,
    point: Point,
    zoom: number,
  ): boolean {
    const first = session.draft.vertices[0];
    return (
      first !== undefined &&
      session.draft.vertices.length >= 3 &&
      pointDistance(first, point) * normalizedZoom(zoom) <= PEN_CLOSE_DISTANCE
    );
  }

  #parent(parentId: string | null): LeaferGroup | undefined {
    return parentId
      ? (this.#options.element(parentId) as LeaferGroup | undefined)
      : this.#options.root;
  }

  #queueOpenCommit(): void {
    this.#finishAfterProjectionSync = false;
    this.#pendingCommit = this.#takeCommit(false);
  }

  #resolveParent(target: unknown): string | null | undefined {
    const projection = this.#options.current().projection;
    let element = isElement(target) ? target : undefined;
    while (element) {
      const nodeId = this.#options.nodeId(element);
      const spec = nodeId ? projection?.elementsById.get(nodeId) : undefined;
      if (isLockedSpec(spec)) return undefined;
      if (isCreationContainer(spec)) return spec.id;
      element = isElement(element.parent) ? element.parent : undefined;
    }
    return null;
  }

  #submit(pending: PendingPenCommit): boolean {
    const current = this.#options.current();
    const input = current.input;
    if (
      current.disposed ||
      !input ||
      input.document.documentId !== pending.documentId ||
      input.pageId !== pending.pageId ||
      input.document.revision !== pending.revision
    ) {
      return false;
    }
    const accepted = this.#options.onCreate(pending.request);
    if (!accepted) this.#options.restoreProjection();
    return accepted;
  }

  #takeCommit(closed: boolean): PendingPenCommit | null {
    const session = this.#session;
    if (!session) return null;
    const network = penDraftToVectorNetwork(session.draft, closed);
    this.#clearSession();
    if (!network) return null;
    const normalized = normalizeVectorNetwork(network);
    if (!normalized.ok || !normalized.offset) {
      const message = normalized.ok
        ? "Pen geometry could not be normalized"
        : normalized.issues.map((issue) => issue.message).join("; ");
      this.#options.report(new Error(message));
      return null;
    }
    return {
      documentId: session.documentId,
      pageId: session.pageId,
      revision: session.revision,
      request: {
        closed,
        height: normalized.bounds.height,
        network: normalized.network,
        pageId: session.pageId,
        parentId: session.parentId,
        width: normalized.bounds.width,
        x: normalized.offset.x,
        y: normalized.offset.y,
      },
    };
  }

  #updatePreview(zoomValue: number): void {
    const session = this.#session;
    if (!session) return;
    const zoom = normalizedZoom(zoomValue);
    const anchorSize = 7 / zoom;
    const path = penDraftPreviewPath(
      session.draft,
      session.cursor,
      session.closeCandidate,
    );
    session.previewPath.set({
      path: path ?? "",
      fill: session.closeCandidate
        ? {
            type: "solid",
            color: LEAFER_EDITOR_SELECTION_COLOR,
            opacity: 0.08,
          }
        : "transparent",
      strokeWidth: 1.5 / zoom,
    });
    session.handlePath.set({
      path: penDraftHandlePath(session.draft) ?? "",
      strokeWidth: 1 / zoom,
    });

    while (session.anchors.length > session.draft.vertices.length) {
      const anchor = session.anchors.pop();
      anchor?.remove();
      anchor?.destroy();
    }
    session.draft.vertices.forEach((vertex, index) => {
      let anchor = session.anchors[index];
      if (!anchor) {
        anchor = new this.#options.leafer.Ellipse({
          editable: false,
          hittable: false,
        });
        session.anchors.push(anchor);
        session.previewGroup.add(anchor);
      }
      const closeTarget = index === 0 && session.closeCandidate;
      anchor.set({
        x: vertex.x - anchorSize / 2,
        y: vertex.y - anchorSize / 2,
        width: anchorSize,
        height: anchorSize,
        fill: closeTarget ? LEAFER_EDITOR_SELECTION_COLOR : "#ffffff",
        stroke: LEAFER_EDITOR_SELECTION_COLOR,
        strokeWidth: 1.25 / zoom,
      });
    });
  }
}

function isCreationContainer(
  spec: LeaferElementSpec | undefined,
): spec is LeaferElementSpec & { kind: "frame" | "group" | "slot" } {
  return (
    spec?.kind === "frame" || spec?.kind === "slot" || spec?.kind === "group"
  );
}

function isElement(value: unknown): value is LeaferElement {
  return (
    typeof value === "object" && value !== null && "localTransform" in value
  );
}

function isLockedSpec(spec: LeaferElementSpec | undefined): boolean {
  const metadata = spec?.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignLocked === true
  );
}

function normalizedZoom(value: number): number {
  return Math.max(MATRIX_EPSILON, Math.abs(value));
}

function pointDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
