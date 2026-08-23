import type { DesignDocument } from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { ProjectDesignFile } from "@/shared/desktop-api";

export interface ProjectAutosaveTarget {
  designFileId: string;
  documentId: string;
  projectId: string;
  runtime: EditorRuntime;
}

interface AutosaveState extends ProjectAutosaveTarget {
  inFlight: Promise<void> | null;
  requested: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  unsubscribe: () => void;
}

export class ProjectAutosaveCoordinator {
  readonly #delayMs: number;
  readonly #onError: (target: ProjectAutosaveTarget, error: unknown) => void;
  readonly #onSaved: (
    target: ProjectAutosaveTarget,
    saved: ProjectDesignFile,
  ) => void;
  readonly #save: (
    projectId: string,
    designFileId: string,
    document: DesignDocument,
  ) => Promise<ProjectDesignFile>;
  readonly #states = new Map<string, AutosaveState>();

  constructor(options: {
    delayMs?: number;
    onError?: (target: ProjectAutosaveTarget, error: unknown) => void;
    onSaved?: (target: ProjectAutosaveTarget, saved: ProjectDesignFile) => void;
    save: (
      projectId: string,
      designFileId: string,
      document: DesignDocument,
    ) => Promise<ProjectDesignFile>;
  }) {
    this.#delayMs = options.delayMs ?? 500;
    this.#onError = options.onError ?? (() => undefined);
    this.#onSaved = options.onSaved ?? (() => undefined);
    this.#save = options.save;
  }

  track(target: ProjectAutosaveTarget): void {
    if (
      target.runtime.getSnapshot().document.documentId !== target.documentId
    ) {
      throw new Error(
        `Autosave runtime document does not match target: ${target.documentId}`,
      );
    }
    const existing = this.#states.get(target.documentId);
    if (existing) {
      if (
        existing.runtime !== target.runtime ||
        existing.projectId !== target.projectId ||
        existing.designFileId !== target.designFileId
      ) {
        throw new Error(
          `Autosave document identity is already tracked: ${target.documentId}`,
        );
      }
      return;
    }
    const state: AutosaveState = {
      ...target,
      inFlight: null,
      requested: false,
      timer: null,
      unsubscribe: () => undefined,
    };
    state.unsubscribe = target.runtime.subscribe((event) => {
      if (event.type === "document.changed") this.#schedule(state);
    });
    this.#states.set(target.documentId, state);
  }

  hasPendingWork(): boolean {
    return [...this.#states.values()].some(
      (state) =>
        state.timer !== null ||
        state.inFlight !== null ||
        state.runtime.getSnapshot().state.dirty,
    );
  }

  flushDocument(documentId: string): Promise<void> {
    const state = this.#states.get(documentId);
    return state ? this.#flush(state) : Promise.resolve();
  }

  async flushAll(): Promise<void> {
    await Promise.all(
      [...this.#states.values()].map((state) => this.#flush(state)),
    );
  }

  dispose(): void {
    for (const state of this.#states.values()) {
      if (state.timer !== null) clearTimeout(state.timer);
      state.unsubscribe();
    }
    this.#states.clear();
  }

  #schedule(state: AutosaveState): void {
    state.requested = true;
    if (state.timer !== null) clearTimeout(state.timer);
    if (state.inFlight) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.#flush(state).catch(() => undefined);
    }, this.#delayMs);
  }

  #flush(state: AutosaveState): Promise<void> {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.requested = true;
    if (state.inFlight) return state.inFlight;
    const operation = this.#drain(state).finally(() => {
      if (state.inFlight === operation) state.inFlight = null;
    });
    state.inFlight = operation;
    return operation;
  }

  async #drain(state: AutosaveState): Promise<void> {
    try {
      while (state.requested || state.runtime.getSnapshot().state.dirty) {
        state.requested = false;
        const snapshot = state.runtime.getSnapshot();
        if (!snapshot.state.dirty) continue;
        const revision = snapshot.document.revision;
        const saved = await this.#save(
          state.projectId,
          state.designFileId,
          snapshot.document,
        );
        if (
          saved.descriptor.designFileId !== state.designFileId ||
          saved.descriptor.documentId !== state.documentId ||
          saved.document.documentId !== state.documentId ||
          saved.document.revision !== revision
        ) {
          throw new Error(
            `Autosave response does not match ${state.designFileId} revision ${revision}`,
          );
        }
        this.#onSaved(state, saved);
        const current = state.runtime.getSnapshot();
        if (
          current.document.documentId === snapshot.document.documentId &&
          current.document.revision === revision
        ) {
          state.runtime.checkpoint();
        } else {
          state.requested = true;
        }
      }
    } catch (error) {
      this.#onError(state, error);
      throw error;
    }
  }
}
