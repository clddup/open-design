import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import type {
  LeaferElementSpec,
  LeaferSceneProjection,
} from "./projection-types.js";
import {
  textRunEditProxyElementId,
  textRunFragmentElementIds,
} from "./text-run-projection.js";

type TextNode = Extract<DesignNode, { kind: "text" }>;

export interface TextRunEditElement {
  forceUpdate(boundsType?: string): void;
  set(data: Record<string, unknown>): void;
}

export interface TextRunEditCurrentState {
  baseProjection: LeaferSceneProjection | null;
  document: DesignDocument | null;
  projection: LeaferSceneProjection | null;
}

export interface TextRunEditControllerEnvironment<
  Element extends TextRunEditElement,
> {
  applySpecData(
    element: Element,
    spec: LeaferElementSpec,
    overrides?: Record<string, unknown>,
  ): void;
  current(): TextRunEditCurrentState;
  element(projectionId: string): Element | undefined;
  openProxy(projectionId: string): void;
  readText(element: Element): string;
  scheduleBounds(nodeId: string): void;
  writeText(element: Element, content: string): void;
}

export interface TextEditBefore {
  documentId: string;
  nodeId: string;
  revision: number;
  text: string;
}

export type TextEditFinishResult =
  | { kind: "none" }
  | { kind: "restore" }
  | {
      before: TextEditBefore;
      content: string;
      kind: "commit";
      node: TextNode;
    };

interface TextRunEditPresentation {
  documentId: string;
  fragmentIds: string[];
  nodeId: string;
  pendingCommit: boolean;
}

/**
 * Owns the short-lived interaction state that makes disposable native Text
 * fragments behave as one authoritative OpenDesign Text node. It never owns
 * document data and can only ask the Adapter to show, edit, or restore the
 * current exact-revision projection.
 */
export class TextRunEditController<Element extends TextRunEditElement> {
  readonly #environment: TextRunEditControllerEnvironment<Element>;
  #before: TextEditBefore | null = null;
  #cancelled = false;
  #pendingProxyId: string | null = null;
  #presentation: TextRunEditPresentation | null = null;

  constructor(environment: TextRunEditControllerEnvironment<Element>) {
    this.#environment = environment;
  }

  get activeNodeId(): string | null {
    return this.#before?.nodeId ?? null;
  }

  beforeEditInner(projectionId: string | undefined): false | undefined {
    const { projection } = this.#environment.current();
    if (!projection || !projectionId) return undefined;
    const proxyId = textRunEditProxyElementId(projection, projectionId);
    if (!proxyId) return undefined;
    if (isLockedSpec(projection.elementsById.get(proxyId))) return false;
    if (proxyId === projectionId) return undefined;
    if (this.#pendingProxyId === proxyId) return false;

    this.#pendingProxyId = proxyId;
    const requestedProjection = projection;
    queueMicrotask(() => {
      if (this.#pendingProxyId !== proxyId) return;
      this.#pendingProxyId = null;
      const current = this.#environment.current();
      if (
        current.projection !== requestedProjection ||
        textRunEditProxyElementId(requestedProjection, projectionId) !==
          proxyId ||
        !this.#environment.element(proxyId)
      ) {
        return;
      }
      this.#environment.openProxy(proxyId);
    });
    return false;
  }

  begin(nodeId: string): boolean {
    const current = this.#environment.current();
    const node = current.document?.nodesById[nodeId];
    const proxy = this.#environment.element(nodeId);
    const spec = current.projection?.elementsById.get(nodeId);
    if (
      !current.document ||
      !node ||
      node.kind !== "text" ||
      !proxy ||
      isLockedSpec(spec)
    ) {
      return false;
    }
    this.#beginPresentation(nodeId, current);
    this.#environment.writeText(proxy, node.properties.content);
    this.#before = {
      documentId: current.document.documentId,
      nodeId,
      revision: current.document.revision,
      text: node.properties.content,
    };
    this.#cancelled = false;
    return true;
  }

  cancel(): void {
    if (this.#before) this.#cancelled = true;
  }

  finish(options: {
    disposed: boolean;
    synchronizing: boolean;
  }): TextEditFinishResult {
    const before = this.#before;
    this.#before = null;
    if (!before || options.synchronizing || options.disposed) {
      this.#cancelled = false;
      if (options.synchronizing || options.disposed) this.#presentation = null;
      return { kind: "none" };
    }

    const current = this.#environment.current();
    const element = this.#environment.element(before.nodeId);
    const node = current.document?.nodesById[before.nodeId];
    const spec = current.projection?.elementsById.get(before.nodeId);
    if (
      !current.document ||
      current.document.documentId !== before.documentId ||
      !element ||
      !node ||
      node.kind !== "text" ||
      isLockedSpec(spec)
    ) {
      this.restorePresentation();
      return { kind: "restore" };
    }
    const content = this.#environment.readText(element);
    if (this.#cancelled || content === before.text) {
      this.#cancelled = false;
      this.restorePresentation();
      return { kind: "restore" };
    }
    this.#cancelled = false;
    return { before, content, kind: "commit", node };
  }

  completeCommit(
    result: Extract<TextEditFinishResult, { kind: "commit" }>,
    accepted: boolean,
  ): void {
    if (!accepted) {
      this.restorePresentation();
      return;
    }
    const current = this.#environment.current();
    if (
      this.#presentation &&
      current.document?.documentId === result.before.documentId &&
      current.document.revision === result.before.revision
    ) {
      this.#presentation.pendingCommit = true;
      this.syncPresentation();
    } else {
      // The Runtime may publish the accepted revision synchronously from the
      // onOperations callback. Reapply that new exact projection instead of
      // leaving its fragments hidden by the still-open presentation state.
      this.restorePresentation();
    }
  }

  handleProjectionChange(options: {
    documentChanged: boolean;
    identityChanged: boolean;
    projectionChanged: boolean;
  }): void {
    if (options.identityChanged) this.#pendingProxyId = null;
    if (
      this.#presentation?.pendingCommit &&
      (options.documentChanged || options.projectionChanged)
    ) {
      this.#presentation = null;
    }
  }

  syncPresentation(): void {
    const presentation = this.#presentation;
    const current = this.#environment.current();
    if (
      !presentation ||
      !current.document ||
      !current.projection ||
      !current.baseProjection
    ) {
      return;
    }
    const node = current.document.nodesById[presentation.nodeId];
    const proxy = this.#environment.element(presentation.nodeId);
    const baseSpec = current.baseProjection.elementsById.get(
      presentation.nodeId,
    );
    if (
      current.document.documentId !== presentation.documentId ||
      !node ||
      node.kind !== "text" ||
      !proxy ||
      !baseSpec ||
      baseSpec.kind !== "text" ||
      textRunEditProxyElementId(current.projection, presentation.nodeId) !==
        presentation.nodeId
    ) {
      this.#presentation = null;
      return;
    }

    presentation.fragmentIds = textRunFragmentElementIds(
      current.projection,
      presentation.nodeId,
    );
    this.#environment.applySpecData(proxy, baseSpec, {
      text: this.#environment.readText(proxy),
    });
    for (const fragmentId of presentation.fragmentIds) {
      this.#environment.element(fragmentId)?.set({
        hittable: false,
        visible: false,
      });
    }
    proxy.forceUpdate("bounds");
    this.#environment.scheduleBounds(presentation.nodeId);
  }

  restorePresentation(): void {
    const presentation = this.#presentation;
    this.#presentation = null;
    const { projection } = this.#environment.current();
    if (!presentation || !projection) return;
    for (const projectionId of [
      presentation.nodeId,
      ...presentation.fragmentIds,
    ]) {
      const element = this.#environment.element(projectionId);
      const spec = projection.elementsById.get(projectionId);
      if (element && spec) this.#environment.applySpecData(element, spec);
    }
    this.#environment.element(presentation.nodeId)?.forceUpdate("bounds");
    this.#environment.scheduleBounds(presentation.nodeId);
  }

  clear(): void {
    this.#before = null;
    this.#cancelled = false;
    this.#pendingProxyId = null;
    this.#presentation = null;
  }

  #beginPresentation(nodeId: string, current: TextRunEditCurrentState): void {
    if (
      !current.document ||
      !current.projection ||
      textRunEditProxyElementId(current.projection, nodeId) !== nodeId
    ) {
      this.#presentation = null;
      return;
    }
    this.#presentation = {
      documentId: current.document.documentId,
      fragmentIds: textRunFragmentElementIds(current.projection, nodeId),
      nodeId,
      pendingCommit: false,
    };
    this.syncPresentation();
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
