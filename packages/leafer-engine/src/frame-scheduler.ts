export interface EditorRefreshRequest {
  nodeBounds?: Iterable<string>;
  treeBounds?: boolean;
}

type FrameSchedulerOptions = {
  isDisposed(): boolean;
  onEditorRefresh(request: {
    nodeBounds: readonly string[];
    treeBounds: boolean;
  }): void;
  onViewportFrame(): void;
};

/** Owns coalesced Leafer viewport/editor animation-frame resources. */
export class LeaferFrameScheduler {
  readonly #options: FrameSchedulerOptions;
  #disposed = false;
  #viewportFrame: number | null = null;
  #editorFrame: number | null = null;
  #editorRefreshNeedsTreeBounds = false;
  readonly #editorRefreshNodeBounds = new Set<string>();

  constructor(options: FrameSchedulerOptions) {
    this.#options = options;
  }

  scheduleViewport(): void {
    if (
      this.#disposed ||
      this.#options.isDisposed() ||
      this.#viewportFrame !== null
    )
      return;
    this.#viewportFrame = requestAnimationFrame(() => {
      this.#viewportFrame = null;
      if (!this.#disposed && !this.#options.isDisposed()) {
        this.#options.onViewportFrame();
      }
    });
  }

  scheduleEditorRefresh(request: EditorRefreshRequest = {}): void {
    if (this.#disposed || this.#options.isDisposed()) return;
    this.#editorRefreshNeedsTreeBounds ||= request.treeBounds === true;
    if (request.nodeBounds) {
      for (const nodeId of request.nodeBounds) {
        this.#editorRefreshNodeBounds.add(nodeId);
      }
    }
    if (this.#editorFrame !== null) return;
    this.#editorFrame = requestAnimationFrame(() => {
      this.#editorFrame = null;
      if (this.#disposed || this.#options.isDisposed()) return;
      const treeBounds = this.#editorRefreshNeedsTreeBounds;
      const nodeBounds = [...this.#editorRefreshNodeBounds];
      this.#editorRefreshNeedsTreeBounds = false;
      this.#editorRefreshNodeBounds.clear();
      this.#options.onEditorRefresh({ nodeBounds, treeBounds });
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#viewportFrame !== null) cancelAnimationFrame(this.#viewportFrame);
    if (this.#editorFrame !== null) cancelAnimationFrame(this.#editorFrame);
    this.#viewportFrame = null;
    this.#editorFrame = null;
    this.#editorRefreshNeedsTreeBounds = false;
    this.#editorRefreshNodeBounds.clear();
  }
}
