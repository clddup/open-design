import type { Point } from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import { asLeaferEvent, eventClientPoint } from "./pointer-event.js";
import type { LeaferEngineSyncInput } from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferApp = InstanceType<LeaferModule["App"]>;
type LeaferEditor = InstanceType<LeaferModule["Editor"]>;
type LeaferElement = InstanceType<LeaferModule["UI"]>;

interface BoxSelectSession {
  additiveNodeIds: Set<string>;
  documentId: string;
  initialNodeIds: readonly string[];
  pageId: string;
  revision: number;
  startClient: Point;
  startLocal: Point;
}

interface BoxSelectControllerOptions {
  app: LeaferApp;
  current: () => {
    disposed: boolean;
    input: LeaferEngineSyncInput | null;
  };
  editor: LeaferEditor;
  element: (nodeId: string) => LeaferElement | undefined;
  leafer: LeaferModule;
  nodeId: (element: LeaferElement) => string | undefined;
  scheduleEditorRefresh: () => void;
}

interface BoxSelectProjectionSync {
  input: LeaferEngineSyncInput;
  projectionContinuityLost: boolean;
}

const MIN_BOX_SELECT_DISTANCE = 4;

export class BoxSelectController {
  readonly #options: BoxSelectControllerOptions;
  #session: BoxSelectSession | null = null;

  constructor(options: BoxSelectControllerOptions) {
    this.#options = options;
  }

  syncInput(input: LeaferEngineSyncInput): void {
    const session = this.#session;
    if (
      session &&
      (session.documentId !== input.document.documentId ||
        session.pageId !== input.pageId ||
        input.tool !== "select")
    ) {
      this.cancel();
    }
  }

  syncProjection(sync: BoxSelectProjectionSync): void {
    const session = this.#session;
    if (!session) return;
    const revisionChanged = session.revision !== sync.input.document.revision;
    const contiguousRevision =
      revisionChanged &&
      sync.input.changes?.documentId === session.documentId &&
      sync.input.changes.fromRevision === session.revision &&
      sync.input.changes.toRevision === sync.input.document.revision;
    if (
      sync.projectionContinuityLost ||
      (revisionChanged && !contiguousRevision)
    ) {
      this.cancel();
      return;
    }
    session.revision = sync.input.document.revision;
  }

  start(event: unknown): void {
    const current = this.#options.current();
    const input = current.input;
    if (
      current.disposed ||
      !input ||
      input.tool !== "select" ||
      !this.#options.editor.selector.dragging ||
      this.#session
    ) {
      return;
    }
    const drag = asLeaferEvent(event);
    if (drag.isCancel || drag.right || drag.middle) return;
    const initialNodeIds = this.#options.editor.list.flatMap((element) => {
      const nodeId = this.#options.nodeId(element as LeaferElement);
      return nodeId ? [nodeId] : [];
    });
    this.#session = {
      additiveNodeIds: new Set(drag.shiftKey ? initialNodeIds : []),
      documentId: input.document.documentId,
      initialNodeIds,
      pageId: input.pageId,
      revision: input.document.revision,
      startClient: eventClientPoint(drag),
      startLocal: drag.getInnerPoint(this.#options.editor.selector),
    };
  }

  finish(event: unknown): void {
    const session = this.#session;
    this.#session = null;
    if (!session) return;
    const current = this.#options.current();
    const input = current.input;
    if (
      current.disposed ||
      !input ||
      input.tool !== "select" ||
      input.document.documentId !== session.documentId ||
      input.pageId !== session.pageId ||
      input.document.revision !== session.revision
    ) {
      return;
    }
    const drag = asLeaferEvent(event);
    const client = eventClientPoint(drag);
    if (drag.isCancel) {
      this.#restoreSelection(session.initialNodeIds);
      return;
    }
    if (pointDistance(client, session.startClient) < MIN_BOX_SELECT_DISTANCE) {
      return;
    }
    const endLocal = drag.getInnerPoint(this.#options.editor.selector);
    const rect = rectFromPoints(session.startLocal, endLocal);
    const bounds = new this.#options.leafer.Bounds(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    );
    const selectedNodeIds = new Set(
      this.#options.leafer.EditSelectHelper.findByBounds(
        this.#options.app as unknown as LeaferElement,
        bounds,
        "hit",
      ).flatMap((element) => {
        const nodeId = this.#options.nodeId(element as LeaferElement);
        return nodeId ? [nodeId] : [];
      }),
    );
    const targetNodeIds = new Set(session.additiveNodeIds);
    for (const nodeId of selectedNodeIds) {
      if (targetNodeIds.has(nodeId)) targetNodeIds.delete(nodeId);
      else targetNodeIds.add(nodeId);
    }
    const target = [...targetNodeIds].flatMap((nodeId) => {
      const element = this.#options.element(nodeId);
      return element ? [element] : [];
    });
    const currentSelection = this.#options.editor.list;
    if (
      currentSelection.length === target.length &&
      currentSelection.every((element, index) => element === target[index])
    ) {
      return;
    }
    this.#options.editor.target =
      target.length === 0 ? (null as never) : target;
    this.#options.scheduleEditorRefresh();
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.#session || event.code !== "Escape") return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const session = this.#session;
    this.#session = null;
    this.#restoreSelection(session.initialNodeIds);
    return true;
  }

  cancel(): boolean {
    if (!this.#session) return false;
    this.#session = null;
    return true;
  }

  dispose(): void {
    this.cancel();
  }

  #restoreSelection(nodeIds: readonly string[]): void {
    const target = nodeIds.flatMap((nodeId) => {
      const element = this.#options.element(nodeId);
      return element ? [element] : [];
    });
    const current = this.#options.editor.list;
    if (
      current.length === target.length &&
      current.every((element, index) => element === target[index])
    ) {
      return;
    }
    this.#options.editor.target =
      target.length === 0 ? (null as never) : target;
    this.#options.scheduleEditorRefresh();
  }
}

function pointDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function rectFromPoints(
  start: Point,
  end: Point,
): { height: number; width: number; x: number; y: number } {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
  };
}
