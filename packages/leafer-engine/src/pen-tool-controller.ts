import { normalizeVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import type * as LeaferEditorModule from "leafer-editor";
import type { LeaferElementSpec, LeaferSceneProjection } from "./mapping.js";
import {
  createPenDraft,
  penDraftActivePoint,
  penDraftHasMaterial,
  type PenDraftMutationResult,
} from "./pen-tool.js";
import {
  appendPenPathPoint,
  dragPenPointer,
  escapePenPath,
  finishPenPathOnTarget,
  hoverPenPointer,
  restorePreviousPenDraft,
  startPenPath,
  syncPenHoverTarget,
  targetPenVertexId,
  type PenInteractionSession,
} from "./pen-tool-interaction.js";
import {
  createPenToolOverlay,
  destroyPenToolOverlay,
  updatePenToolOverlay,
  type PenToolOverlay,
} from "./pen-tool-overlay.js";
import { asLeaferEvent, eventClientPoint } from "./pointer-event.js";
import type {
  LeaferCreateVectorRequest,
  LeaferEngineSyncInput,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

interface PenToolSession extends PenInteractionSession {
  documentId: string;
  overlay: PenToolOverlay;
  pageId: string;
  parent: LeaferGroup;
  parentId: string | null;
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
      if (!projectionWillChange) this.#render(input.viewport.zoom);
      return;
    }
    if (projectionWillChange) this.#finishAfterProjectionSync = true;
    else this.#queueCommit();
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
    if (
      sync.projectionContinuityLost ||
      (revisionChanged && !contiguousRevision) ||
      this.#parentInvalid(sync, session)
    ) {
      this.cancel();
      return;
    }
    session.revision = sync.input.document.revision;
    this.#render(sync.input.viewport.zoom);
    if (this.#finishAfterProjectionSync) this.#queueCommit();
  }

  completeSync(): void {
    const pending = this.#pendingCommit;
    this.#pendingCommit = null;
    if (pending) this.#submit(pending);
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
    if (!this.#session) {
      this.#beginSession(pointer, input);
      return;
    }
    this.#continueSession(pointer, input);
  }

  pointerMove(event: unknown): void {
    const session = this.#session;
    const current = this.#options.current();
    const input = current.input;
    if (current.disposed || !session || !input || input.tool !== "pen") return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel) return;
    const rawLocal = pointer.getInnerPoint(session.parent);
    const result = session.drag
      ? dragPenPointer(
          session,
          rawLocal,
          eventClientPoint(pointer),
          pointer.shiftKey,
        )
      : (hoverPenPointer(
          session,
          rawLocal,
          pointer.shiftKey,
          input.viewport.zoom,
        ),
        null);
    this.#reportMutationFailure(result);
    this.#render(input.viewport.zoom);
  }

  pointerUp(event: unknown): void {
    const session = this.#session;
    if (!session?.drag) return;
    if (asLeaferEvent(event).isCancel) {
      this.#restorePreviousDraft(session);
      return;
    }
    this.pointerMove(event);
    const current = this.#session;
    if (!current) return;
    current.drag = null;
    syncPenHoverTarget(current, current.cursor, this.#zoom());
    this.#render(this.#zoom());
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const session = this.#session;
    if (!session) return false;
    if (event.code === "Enter") {
      stopKeyEvent(event);
      this.#commit();
      return true;
    }
    if (event.code === "Escape") {
      stopKeyEvent(event);
      this.#escape(session);
      return true;
    }
    if (event.code !== "Backspace" && event.code !== "Delete") return false;
    stopKeyEvent(event);
    this.#restorePreviousDraft(session);
    return true;
  }

  cancel(): boolean {
    this.#finishAfterProjectionSync = false;
    this.#pendingCommit = null;
    return this.#clearSession();
  }

  dispose(): void {
    this.cancel();
  }

  #beginSession(
    pointer: ReturnType<typeof asLeaferEvent>,
    input: LeaferEngineSyncInput,
  ): void {
    const parentId = this.#resolveParent(pointer.target);
    if (parentId === undefined) return;
    const parent = this.#parent(parentId);
    if (!parent) return;
    const local = pointer.getInnerPoint(parent);
    this.#session = {
      cursor: local,
      documentId: input.document.documentId,
      draft: createPenDraft(local),
      drag: { kind: "start", startClient: eventClientPoint(pointer) },
      history: [],
      overlay: createPenToolOverlay(this.#options.leafer, parent),
      pageId: input.pageId,
      parent,
      parentId,
      revision: input.document.revision,
    };
    this.#render(input.viewport.zoom);
  }

  #continueSession(
    pointer: ReturnType<typeof asLeaferEvent>,
    input: LeaferEngineSyncInput,
  ): void {
    const session = this.#session!;
    const rawLocal = pointer.getInnerPoint(session.parent);
    const targetVertexId = targetPenVertexId(
      session,
      rawLocal,
      input.viewport.zoom,
    );
    if (penDraftActivePoint(session.draft)) {
      const result = targetVertexId
        ? finishPenPathOnTarget(session, targetVertexId)
        : appendPenPathPoint(
            session,
            rawLocal,
            eventClientPoint(pointer),
            pointer.shiftKey,
            input.viewport.zoom,
          );
      this.#reportMutationFailure(result);
      this.#render(input.viewport.zoom);
      return;
    }
    startPenPath(session, rawLocal, targetVertexId, eventClientPoint(pointer));
    this.#render(input.viewport.zoom);
  }

  #escape(session: PenToolSession): void {
    const action = escapePenPath(session);
    if (action === "cancel") this.cancel();
    else if (action === "commit") this.#commit();
    else this.#render(this.#zoom());
  }

  #restorePreviousDraft(session: PenToolSession): void {
    if (!restorePreviousPenDraft(session)) this.cancel();
    else this.#render(this.#zoom());
  }

  #commit(): boolean {
    const pending = this.#takeCommit();
    return pending ? this.#submit(pending) : false;
  }

  #queueCommit(): void {
    this.#finishAfterProjectionSync = false;
    this.#pendingCommit = this.#takeCommit();
  }

  #takeCommit(): PendingPenCommit | null {
    const session = this.#session;
    if (!session) return null;
    const network = penDraftHasMaterial(session.draft)
      ? session.draft.network
      : null;
    this.#clearSession();
    if (!network) return null;
    const normalized = normalizeVectorNetwork(network);
    if (!normalized.ok || !normalized.offset) {
      const message = normalized.ok
        ? "Pen geometry could not be normalized"
        : normalized.issues.map(({ message: issue }) => issue).join("; ");
      this.#options.report(new Error(message));
      return null;
    }
    return {
      documentId: session.documentId,
      pageId: session.pageId,
      revision: session.revision,
      request: {
        closed:
          normalized.network.paths.length > 0 &&
          normalized.network.paths.every(({ closed }) => closed),
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

  #reportMutationFailure(result: PenDraftMutationResult | null): void {
    if (result && !result.ok && result.code !== "no-op") {
      this.#options.report(new Error(result.message));
    }
  }

  #render(zoom: number): void {
    const session = this.#session;
    if (!session) return;
    updatePenToolOverlay(
      this.#options.leafer,
      session.overlay,
      session.draft,
      penDraftActivePoint(session.draft) ? session.cursor : undefined,
      session.targetVertexId,
      zoom,
    );
  }

  #clearSession(): boolean {
    const session = this.#session;
    if (!session) return false;
    this.#session = null;
    destroyPenToolOverlay(session.overlay);
    return true;
  }

  #parentInvalid(
    sync: PenToolProjectionSync,
    session: PenToolSession,
  ): boolean {
    if (session.parentId === null) return false;
    const parent = sync.projection.elementsById.get(session.parentId);
    return (
      sync.changedNodeIds.has(session.parentId) ||
      !isCreationContainer(parent) ||
      isLockedSpec(parent)
    );
  }

  #parent(parentId: string | null): LeaferGroup | undefined {
    return parentId
      ? (this.#options.element(parentId) as LeaferGroup | undefined)
      : this.#options.root;
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

  #zoom(): number {
    return this.#options.current().input?.viewport.zoom ?? 1;
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

function stopKeyEvent(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}
