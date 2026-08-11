import type { DesignDocument } from "@opendesign/design-contracts";
import { EditorRuntime } from "@opendesign/editor-runtime";

export interface WorkspaceFileIdentity {
  projectId: string;
  designFileId: string;
  name: string;
}

export interface WorkspaceFileSnapshot extends WorkspaceFileIdentity {
  key: string;
  documentId: string;
  activePageId: string;
  activeFrameId?: string;
  retainedByRunIds: readonly string[];
}

export interface WorkspaceDocumentRuntime extends WorkspaceFileIdentity {
  activePageId: string;
  runtime: EditorRuntime;
}

export interface WorkspaceSnapshot {
  version: number;
  activeFileKey: string;
  activeProjectId: string;
  activeDesignFileId: string;
  openFileKeys: readonly string[];
  files: Readonly<Record<string, WorkspaceFileSnapshot>>;
}

type WorkspaceListener = () => void;

interface WorkspaceFileRecord extends WorkspaceFileIdentity {
  runtime: EditorRuntime;
  activePageId: string;
  activeFrameId?: string;
  retainedByRunIds: Set<string>;
  pageOrder: string[];
  unsubscribeRuntime: () => void;
}

export function workspaceFileKey(
  projectId: string,
  designFileId: string,
): string {
  return JSON.stringify([projectId, designFileId]);
}

export class WorkspaceRuntime {
  readonly #files = new Map<string, WorkspaceFileRecord>();
  readonly #listeners = new Set<WorkspaceListener>();
  #activeFileKey: string;
  #version = 0;
  #snapshot: WorkspaceSnapshot;

  constructor(initial: WorkspaceFileIdentity & { document: DesignDocument }) {
    const runtime = new EditorRuntime(initial.document);
    const key = workspaceFileKey(initial.projectId, initial.designFileId);
    const record: WorkspaceFileRecord = {
      projectId: initial.projectId,
      designFileId: initial.designFileId,
      name: initial.name,
      runtime,
      activePageId: requireFirstPage(runtime, initial.designFileId),
      retainedByRunIds: new Set(),
      pageOrder: [...runtime.getSnapshot().document.pageOrder],
      unsubscribeRuntime: () => undefined,
    };
    this.#bindRuntime(record);
    this.#files.set(key, record);
    this.#activeFileKey = key;
    this.#snapshot = this.#createSnapshot();
  }

  getSnapshot = (): WorkspaceSnapshot => this.#snapshot;

  subscribe = (listener: WorkspaceListener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getActiveRuntime(): EditorRuntime {
    return this.#activeFile().runtime;
  }

  getRuntime(projectId: string, designFileId: string): EditorRuntime | null {
    return (
      this.#files.get(workspaceFileKey(projectId, designFileId))?.runtime ??
      null
    );
  }

  getRuntimeByDocumentId(documentId: string): WorkspaceDocumentRuntime | null {
    for (const file of this.#files.values()) {
      if (file.runtime.getSnapshot().document.documentId === documentId) {
        return {
          projectId: file.projectId,
          designFileId: file.designFileId,
          name: file.name,
          activePageId: file.activePageId,
          runtime: file.runtime,
        };
      }
    }
    return null;
  }

  openFile(
    identity: WorkspaceFileIdentity,
    document: DesignDocument,
  ): EditorRuntime {
    const key = workspaceFileKey(identity.projectId, identity.designFileId);
    const existing = this.#files.get(key);
    if (existing) {
      if (
        existing.runtime.getSnapshot().document.documentId !==
        document.documentId
      ) {
        throw new Error(
          `Design file identity is already registered: ${identity.designFileId}`,
        );
      }
      this.#activeFileKey = key;
      existing.name = identity.name;
      this.#refresh();
      return existing.runtime;
    }

    this.#assertDocumentIdentityAvailable(document.documentId, key);

    const runtime = new EditorRuntime(document);
    const record: WorkspaceFileRecord = {
      ...identity,
      runtime,
      activePageId: requireFirstPage(runtime, identity.designFileId),
      retainedByRunIds: new Set(),
      pageOrder: [...runtime.getSnapshot().document.pageOrder],
      unsubscribeRuntime: () => undefined,
    };
    this.#bindRuntime(record);
    this.#files.set(key, record);
    this.#activeFileKey = key;
    this.#refresh();
    return runtime;
  }

  replaceActiveFile(
    identity: WorkspaceFileIdentity,
    document: DesignDocument,
  ): EditorRuntime {
    const active = this.#activeFile();
    if (active.retainedByRunIds.size > 0) {
      throw new Error("Cannot replace a design file used by background runs");
    }
    const runtime = new EditorRuntime(document);
    const key = workspaceFileKey(identity.projectId, identity.designFileId);
    if (key !== this.#activeFileKey && this.#files.has(key)) {
      throw new Error(
        `Design file identity is already registered: ${identity.designFileId}`,
      );
    }
    this.#assertDocumentIdentityAvailable(document.documentId, key);
    active.unsubscribeRuntime();
    this.#files.delete(this.#activeFileKey);
    const record: WorkspaceFileRecord = {
      ...identity,
      runtime,
      activePageId: requireFirstPage(runtime, identity.designFileId),
      retainedByRunIds: new Set(),
      pageOrder: [...runtime.getSnapshot().document.pageOrder],
      unsubscribeRuntime: () => undefined,
    };
    this.#bindRuntime(record);
    this.#files.set(key, record);
    this.#activeFileKey = key;
    this.#refresh();
    return runtime;
  }

  renameFile(projectId: string, designFileId: string, name: string): void {
    const file = this.#requireFile(projectId, designFileId);
    if (file.name === name) return;
    file.name = name;
    this.#refresh();
  }

  activateFile(projectId: string, designFileId: string): void {
    const key = workspaceFileKey(projectId, designFileId);
    if (!this.#files.has(key)) {
      throw new Error(`Design file is not open: ${designFileId}`);
    }
    if (key === this.#activeFileKey) return;
    this.#activeFileKey = key;
    this.#refresh();
  }

  activatePage(pageId: string): void {
    const file = this.#activeFile();
    if (
      !Object.prototype.hasOwnProperty.call(
        file.runtime.getSnapshot().document.pagesById,
        pageId,
      )
    ) {
      throw new Error(`Page is not part of the active design file: ${pageId}`);
    }
    if (pageId === file.activePageId && file.activeFrameId === undefined)
      return;
    file.activePageId = pageId;
    file.activeFrameId = undefined;
    const current = file.runtime.getSnapshot().state.selection.nodeIds;
    const pageNodes = collectPageNodeIds(
      file.runtime.getSnapshot().document,
      pageId,
    );
    if (current.some((nodeId) => !pageNodes.has(nodeId))) {
      file.runtime.setSelection([]);
    }
    this.#refresh();
  }

  activateFrame(frameId?: string): void {
    const file = this.#activeFile();
    if (frameId !== undefined) {
      const document = file.runtime.getSnapshot().document;
      const node = document.nodesById[frameId];
      if (node?.kind !== "frame") {
        throw new Error(
          `Frame is not part of the active design file: ${frameId}`,
        );
      }
      const pageNodes = collectPageNodeIds(document, file.activePageId);
      if (!pageNodes.has(frameId)) {
        throw new Error(`Frame is not part of the active page: ${frameId}`);
      }
    }
    if (file.activeFrameId === frameId) return;
    file.activeFrameId = frameId;
    this.#refresh();
  }

  closeFile(projectId: string, designFileId: string): boolean {
    const key = workspaceFileKey(projectId, designFileId);
    const file = this.#files.get(key);
    if (!file || file.retainedByRunIds.size > 0 || this.#files.size === 1) {
      return false;
    }
    file.unsubscribeRuntime();
    this.#files.delete(key);
    if (this.#activeFileKey === key) {
      const next = this.#files.keys().next().value;
      if (typeof next !== "string") return false;
      this.#activeFileKey = next;
    }
    this.#refresh();
    return true;
  }

  retainFileForRun(
    projectId: string,
    designFileId: string,
    runId: string,
  ): void {
    const file = this.#requireFile(projectId, designFileId);
    if (file.retainedByRunIds.has(runId)) return;
    file.retainedByRunIds.add(runId);
    this.#refresh();
  }

  releaseFileForRun(
    projectId: string,
    designFileId: string,
    runId: string,
  ): void {
    const file = this.#requireFile(projectId, designFileId);
    if (!file.retainedByRunIds.delete(runId)) return;
    this.#refresh();
  }

  #activeFile(): WorkspaceFileRecord {
    const file = this.#files.get(this.#activeFileKey);
    if (!file) throw new Error("Active design file is missing");
    return file;
  }

  #requireFile(projectId: string, designFileId: string): WorkspaceFileRecord {
    const file = this.#files.get(workspaceFileKey(projectId, designFileId));
    if (!file) throw new Error(`Design file is not open: ${designFileId}`);
    return file;
  }

  #assertDocumentIdentityAvailable(
    documentId: string,
    targetKey: string,
  ): void {
    for (const [key, file] of this.#files) {
      if (
        key !== targetKey &&
        file.runtime.getSnapshot().document.documentId === documentId
      ) {
        throw new Error(`Design document is already open: ${documentId}`);
      }
    }
  }

  #bindRuntime(file: WorkspaceFileRecord): void {
    file.unsubscribeRuntime();
    file.unsubscribeRuntime = file.runtime.subscribe((event, snapshot) => {
      if (event.type !== "document.changed") return;
      const document = snapshot.document;
      const previousPageOrder = file.pageOrder;
      file.pageOrder = [...document.pageOrder];
      let workspaceChanged = false;
      if (
        !Object.prototype.hasOwnProperty.call(
          document.pagesById,
          file.activePageId,
        )
      ) {
        const previousIndex = previousPageOrder.indexOf(file.activePageId);
        const fallbackIndex = Math.min(
          Math.max(previousIndex, 0),
          document.pageOrder.length - 1,
        );
        const fallbackPageId = document.pageOrder[fallbackIndex];
        if (!fallbackPageId) {
          throw new Error(`Design file has no page: ${file.designFileId}`);
        }
        file.activePageId = fallbackPageId;
        workspaceChanged = true;
      }

      const pageNodeIds = collectPageNodeIds(document, file.activePageId);
      if (
        file.activeFrameId !== undefined &&
        !pageNodeIds.has(file.activeFrameId)
      ) {
        file.activeFrameId = undefined;
        workspaceChanged = true;
      }
      const selectedNodeIds = snapshot.state.selection.nodeIds;
      if (selectedNodeIds.some((nodeId) => !pageNodeIds.has(nodeId))) {
        file.runtime.setSelection(
          selectedNodeIds.filter((nodeId) => pageNodeIds.has(nodeId)),
        );
      }
      if (workspaceChanged) this.#refresh();
    });
  }

  #refresh(): void {
    this.#version += 1;
    this.#snapshot = this.#createSnapshot();
    for (const listener of this.#listeners) listener();
  }

  #createSnapshot(): WorkspaceSnapshot {
    const active = this.#activeFile();
    return Object.freeze({
      version: this.#version,
      activeFileKey: this.#activeFileKey,
      activeProjectId: active.projectId,
      activeDesignFileId: active.designFileId,
      openFileKeys: Object.freeze([...this.#files.keys()]),
      files: Object.freeze(
        Object.fromEntries(
          [...this.#files].map(([key, file]) => [
            key,
            Object.freeze({
              key,
              projectId: file.projectId,
              designFileId: file.designFileId,
              name: file.name,
              documentId: file.runtime.getSnapshot().document.documentId,
              activePageId: file.activePageId,
              ...(file.activeFrameId === undefined
                ? {}
                : { activeFrameId: file.activeFrameId }),
              retainedByRunIds: Object.freeze([...file.retainedByRunIds]),
            }),
          ]),
        ),
      ),
    });
  }
}

function requireFirstPage(
  runtime: EditorRuntime,
  designFileId: string,
): string {
  const pageId = runtime.getSnapshot().document.pageOrder[0];
  if (!pageId) throw new Error(`Design file has no page: ${designFileId}`);
  return pageId;
}

function collectPageNodeIds(
  document: DesignDocument,
  pageId: string,
): Set<string> {
  const ids = new Set<string>();
  const visit = (nodeId: string) => {
    if (ids.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;
    ids.add(nodeId);
    for (const childId of node.childIds) visit(childId);
  };
  for (const nodeId of document.pagesById[pageId]?.rootNodeIds ?? []) {
    visit(nodeId);
  }
  return ids;
}
