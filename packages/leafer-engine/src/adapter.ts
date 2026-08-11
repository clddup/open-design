import type {
  DesignChangeSet,
  DesignDocument,
  DesignOperation,
  Transform,
  ViewportState,
} from "@opendesign/design-contracts";
import { normalizeLineEndpoints } from "@opendesign/design-contracts";
import {
  BOOLEAN_GEOMETRY_RESOLVER_VERSION,
  createBooleanGeometryResolver,
  type BooleanGeometryResolution,
  type BooleanGeometryResolver,
} from "@opendesign/geometry-service/boolean-resolver";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import type * as LeaferEditorModule from "leafer-editor";
import {
  LEAFER_EDITOR_SELECTION_COLOR,
  projectBooleanEditScope,
  projectDesignPage,
  projectDesignPageIncrementally,
  projectResolvedBooleanGeometry,
  type LeaferElementSpec,
  type LeaferElementTag,
  type LeaferSceneProjection,
} from "./mapping.js";
import type {
  LeaferCanvasTool,
  LeaferCreateRequest,
  LeaferEngineAdapter,
  LeaferEngineCallbacks,
  LeaferEngineOptions,
  LeaferEngineSyncInput,
  LeaferOperationKind,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferApp = InstanceType<LeaferModule["App"]>;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;
type LeaferEditor = InstanceType<LeaferModule["Editor"]>;

interface ElementState {
  linePoints?: readonly [number, number, number, number];
  size: { height: number; width: number };
  text?: string;
  transform: Transform;
}

interface TransformSession {
  before: Map<string, ElementState>;
  changed: boolean;
  kind: LeaferOperationKind;
}

interface DrawSession {
  dragged: boolean;
  parentId: string | null;
  preview: LeaferElement;
  lineStart?: { x: number; y: number };
  lineEnd?: { x: number; y: number };
  start: { x: number; y: number };
  startClient: { x: number; y: number };
  tool: Exclude<LeaferCanvasTool, "select">;
}

interface BoxSelectSession {
  additiveNodeIds: Set<string>;
  start: { x: number; y: number };
  startClient: { x: number; y: number };
}

const MATRIX_EPSILON = 0.000_001;
const MIN_DRAW_DISTANCE = 4;
const MIN_VIEWPORT_ZOOM = 0.1;
const MAX_VIEWPORT_ZOOM = 8;
const WHEEL_ZOOM_SPEED = 0.16;

export async function createLeaferEngineAdapter(
  host: HTMLElement,
  callbacks: LeaferEngineCallbacks,
  options: LeaferEngineOptions = {},
): Promise<LeaferEngineAdapter> {
  const leafer = await import("leafer-editor");
  return new WebLeaferEngineAdapter(host, callbacks, leafer, options);
}

class WebLeaferEngineAdapter implements LeaferEngineAdapter {
  readonly #app: LeaferApp;
  readonly #callbacks: LeaferEngineCallbacks;
  readonly #host: HTMLElement;
  readonly #leafer: LeaferModule;
  readonly #editor: LeaferEditor;
  readonly #elements = new Map<string, LeaferElement>();
  readonly #loadVectorGeometryProvider: () => Promise<VectorGeometryProvider>;
  #baseProjection: LeaferSceneProjection | null = null;
  #booleanNodeIds = new Set<string>();
  #booleanResolver: BooleanGeometryResolver | null = null;
  #booleanPreviewFrame: number | null = null;
  #geometryLoadError: Error | null = null;
  #geometryLoadGeneration = 0;
  #geometryLoadPromise: Promise<void> | null = null;
  #disposed = false;
  #boxSelect: BoxSelectSession | null = null;
  #draw: DrawSession | null = null;
  #input: LeaferEngineSyncInput | null = null;
  #projection: LeaferSceneProjection | null = null;
  #synchronizing = false;
  #textBefore: { nodeId: string; text: string } | null = null;
  #cancelTextEdit = false;
  #transform: TransformSession | null = null;
  #viewportFrame: number | null = null;
  #editorFrame: number | null = null;
  #editorRefreshNeedsTreeBounds = false;
  readonly #editorRefreshNodeBounds = new Set<string>();

  constructor(
    host: HTMLElement,
    callbacks: LeaferEngineCallbacks,
    leafer: LeaferModule,
    options: LeaferEngineOptions,
  ) {
    this.#host = host;
    this.#callbacks = callbacks;
    this.#leafer = leafer;
    this.#loadVectorGeometryProvider =
      options.loadVectorGeometryProvider ?? loadBrowserVectorGeometryProvider;
    this.#app = new leafer.App({
      view: host,
      type: "design",
      wheel: {
        zoomSpeed: WHEEL_ZOOM_SPEED,
      },
      zoom: {
        min: MIN_VIEWPORT_ZOOM,
        max: MAX_VIEWPORT_ZOOM,
      },
      editor: {
        editSize: "size",
        multipleSelect: true,
        boxSelect: "hit",
        hover: true,
        moveable: true,
        resizeable: true,
        rotateable: true,
        skewable: true,
        openInner: "double",
        stroke: LEAFER_EDITOR_SELECTION_COLOR,
        strokeWidth: 1.5,
        pointFill: "#ffffff",
        pointSize: 7,
        pointRadius: 2,
      },
    });
    this.#editor = this.#app.editor as LeaferEditor;
    this.#listen();
  }

  sync(input: LeaferEngineSyncInput): void {
    if (this.#disposed) return;
    const previous = this.#input;
    this.#input = input;
    const identityChanged =
      !previous ||
      previous.document.documentId !== input.document.documentId ||
      previous.pageId !== input.pageId;
    const sceneChanged =
      identityChanged ||
      previous?.document.revision !== input.document.revision;
    const editScopeChanged = !sameBooleanEditScope(
      previous?.booleanEditScope,
      input.booleanEditScope,
    );
    if (sceneChanged || editScopeChanged) this.#cancelBooleanPreview();

    this.#synchronizing = true;
    try {
      if (sceneChanged) {
        const contiguousChanges =
          !identityChanged &&
          previous &&
          input.changes?.documentId === input.document.documentId &&
          input.changes.fromRevision === previous.document.revision &&
          input.changes.toRevision === input.document.revision;
        const changedNodeIds = input.changes
          ? changeSetNodeIds(input.changes)
          : new Set<string>();
        const baseProjection =
          previous && this.#baseProjection && input.changes
            ? projectDesignPageIncrementally(
                this.#baseProjection,
                input.document,
                input.pageId,
                input.changes,
              )
            : projectDesignPage(input.document, input.pageId);
        this.#baseProjection = baseProjection;
        const projection = this.#projectScene(
          baseProjection,
          undefined,
          editScopeChanged
            ? changedBooleanEditScopeIds(previous, input)
            : undefined,
        );
        const invalidatesInteraction = (nodeId: string) =>
          changedNodeIds.has(nodeId) ||
          (projection.affectedNodeIds?.has(nodeId) === true &&
            isLockedSpec(projection.elementsById.get(nodeId)));
        if (identityChanged) this.#editor.visible = false;
        if (
          identityChanged ||
          !contiguousChanges ||
          (this.#draw?.parentId !== undefined &&
            this.#draw?.parentId !== null &&
            invalidatesInteraction(this.#draw.parentId))
        ) {
          this.#boxSelect = null;
          this.#cancelDraw();
        }
        if (
          identityChanged ||
          !contiguousChanges ||
          (this.#transform &&
            [...this.#transform.before.keys()].some((nodeId) =>
              invalidatesInteraction(nodeId),
            ))
        ) {
          this.#transform = null;
        }
        if (
          this.#editor.innerEditing &&
          (identityChanged ||
            !contiguousChanges ||
            (this.#textBefore &&
              invalidatesInteraction(this.#textBefore.nodeId)))
        ) {
          this.#editor.closeInnerEditor();
        }
        const hoveredNodeId = this.#editor.hoverTarget
          ? this.#nodeId(this.#editor.hoverTarget as LeaferElement)
          : undefined;
        if (
          this.#editor.hoverTarget &&
          (identityChanged ||
            !contiguousChanges ||
            (hoveredNodeId !== undefined &&
              invalidatesInteraction(hoveredNodeId)))
        ) {
          this.#editor.hoverTarget = null as never;
        }
        this.#reconcile(projection);
      } else if (editScopeChanged && this.#baseProjection) {
        this.#reconcile(
          this.#projectScene(
            this.#baseProjection,
            undefined,
            changedBooleanEditScopeIds(previous, input),
            true,
          ),
        );
      }
      this.#syncTool(input.tool);
      this.#syncViewport(input.viewport);
      this.#syncSelection(input.selection.nodeIds);
    } catch (error) {
      this.#report(error);
    } finally {
      this.#synchronizing = false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#geometryLoadGeneration += 1;
    this.#geometryLoadPromise = null;
    this.#booleanResolver?.clear();
    this.#booleanResolver = null;
    this.#baseProjection = null;
    this.#booleanNodeIds.clear();
    this.#boxSelect = null;
    this.#cancelDraw();
    if (this.#viewportFrame !== null) cancelAnimationFrame(this.#viewportFrame);
    if (this.#editorFrame !== null) cancelAnimationFrame(this.#editorFrame);
    this.#cancelBooleanPreview();
    this.#viewportFrame = null;
    this.#editorFrame = null;
    this.#editorRefreshNeedsTreeBounds = false;
    this.#editorRefreshNodeBounds.clear();
    window.removeEventListener("keydown", this.#onWindowKeyDown, true);
    this.#host.removeEventListener("contextlost", this.#onContextLost, true);
    this.#app.destroy();
    this.#elements.clear();
  }

  retryBooleanGeometry(): boolean {
    if (
      this.#disposed ||
      !this.#geometryLoadError ||
      this.#booleanNodeIds.size === 0
    ) {
      return false;
    }
    this.#geometryLoadError = null;
    this.#geometryLoadPromise = null;
    this.#refreshBooleanGeometry();
    return true;
  }

  #listen(): void {
    const {
      DragEvent,
      EditorEvent,
      EditorMoveEvent,
      EditorRotateEvent,
      EditorScaleEvent,
      EditorSkewEvent,
      InnerEditorEvent,
      MoveEvent,
      ResizeEvent,
      ZoomEvent,
    } = this.#leafer;

    this.#editor.on(EditorEvent.SELECT, () => this.#emitSelection());
    this.#editor.editBox.on(DragEvent.START, () => this.#beginTransform());
    this.#editor.editBox.on(DragEvent.END, () => this.#finishTransform());

    const beforeTransform = () => this.#beginTransform();
    const changed = () => this.#markTransformChanged();
    this.#editor.on(EditorMoveEvent.BEFORE_MOVE, beforeTransform);
    this.#editor.on(EditorScaleEvent.BEFORE_SCALE, beforeTransform);
    this.#editor.on(EditorRotateEvent.BEFORE_ROTATE, beforeTransform);
    this.#editor.on(EditorSkewEvent.BEFORE_SKEW, beforeTransform);
    this.#editor.on(EditorMoveEvent.MOVE, changed);
    this.#editor.on(EditorScaleEvent.SCALE, changed);
    this.#editor.on(EditorRotateEvent.ROTATE, changed);
    this.#editor.on(EditorSkewEvent.SKEW, changed);

    this.#editor.on(InnerEditorEvent.BEFORE_OPEN, () => {
      const element = this.#editor.list[0];
      const nodeId = element && this.#nodeId(element as LeaferElement);
      if (nodeId && this.#input?.document.nodesById[nodeId]?.kind === "text") {
        this.#textBefore = {
          nodeId,
          text: readElementText(element as LeaferElement),
        };
        this.#cancelTextEdit = false;
      }
    });
    this.#editor.on(InnerEditorEvent.CLOSE, () => this.#finishTextEdit());

    this.#app.on(DragEvent.START, (event: unknown) => {
      this.#startBoxSelect(event);
      this.#startDraw(event);
    });
    this.#app.on(DragEvent.DRAG, (event: unknown) => this.#updateDraw(event));
    this.#app.on(DragEvent.END, (event: unknown) => {
      this.#finishBoxSelect(event);
      this.#finishDraw(event);
    });

    const viewportChanged = () => {
      this.#scheduleViewport();
      this.#scheduleEditorRefresh();
    };
    this.#app.tree.on(MoveEvent.MOVE, viewportChanged);
    this.#app.tree.on(MoveEvent.END, viewportChanged);
    this.#app.tree.on(ZoomEvent.ZOOM, viewportChanged);
    this.#app.tree.on(ZoomEvent.END, viewportChanged);
    this.#app.on(ResizeEvent.RESIZE, viewportChanged);

    window.addEventListener("keydown", this.#onWindowKeyDown, true);
    this.#host.addEventListener("contextlost", this.#onContextLost, true);
  }

  #reconcile(
    projection: LeaferSceneProjection,
    options: { reapplyAll?: boolean } = {},
  ): void {
    const previous = this.#projection;
    const changedNodeIds = new Set<string>();
    const parentsToAttach = new Set<string | null>();
    const reapplyAll = options.reapplyAll === true;
    projection.warnings.forEach((warning) =>
      this.#callbacks.onWarning?.(warning),
    );
    this.#callbacks.onWarningsChange?.(projection.warnings);

    const candidateNodeIds =
      projection.affectedNodeIds ?? this.#elements.keys();
    for (const nodeId of candidateNodeIds) {
      const element = this.#elements.get(nodeId);
      if (!element) continue;
      if (projection.elementsById.has(nodeId)) continue;
      changedNodeIds.add(nodeId);
      parentsToAttach.add(previous?.elementsById.get(nodeId)?.parentId ?? null);
      if (this.#editor.hasItem(element)) this.#editor.removeItem(element);
      element.remove();
      element.destroy();
      this.#elements.delete(nodeId);
    }

    const candidateSpecs: LeaferElementSpec[] = [];
    if (projection.affectedNodeIds) {
      projection.affectedNodeIds.forEach((nodeId) => {
        const spec = projection.elementsById.get(nodeId);
        if (spec) candidateSpecs.push(spec);
      });
    } else {
      candidateSpecs.push(...projection.elementsById.values());
    }
    for (const spec of candidateSpecs) {
      const previousSpec = previous?.elementsById.get(spec.id);
      let existing = this.#elements.get(spec.id);
      let replaced = false;
      if (existing && this.#tag(existing) !== spec.tag) {
        if (this.#editor.hasItem(existing)) this.#editor.removeItem(existing);
        existing.remove();
        existing.destroy();
        this.#elements.delete(spec.id);
        existing = undefined;
        replaced = true;
      }
      const created = existing === undefined;
      const element = existing ?? this.#createElement(spec.tag);
      this.#elements.set(spec.id, element);
      const dataChanged =
        reapplyAll ||
        created ||
        !sameProjectionValue(previousSpec?.data, spec.data);
      const transformChanged =
        reapplyAll ||
        created ||
        !previousSpec ||
        !sameTransform(previousSpec.transform, spec.transform);
      const parentChanged =
        !previousSpec || previousSpec.parentId !== spec.parentId;
      const childrenChanged =
        !previousSpec || !sameStringList(previousSpec.childIds, spec.childIds);
      if (dataChanged) element.set(spec.data);
      if (transformChanged) element.setTransform(toMatrix(spec.transform));
      if (dataChanged || transformChanged || parentChanged || replaced) {
        changedNodeIds.add(spec.id);
      }
      if (parentChanged || created || replaced) {
        parentsToAttach.add(previousSpec?.parentId ?? null);
        parentsToAttach.add(spec.parentId);
      }
      if (childrenChanged || created || replaced || reapplyAll) {
        parentsToAttach.add(spec.id);
      }
    }

    const attachChildren = (
      parent: LeaferGroup,
      childIds: readonly string[],
    ) => {
      childIds.forEach((childId, index) => {
        const child = this.#elements.get(childId);
        if (!child) return;
        if (child.parent !== parent || parent.children[index] !== child) {
          parent.addAt(child, index);
        }
      });
    };
    if (
      reapplyAll ||
      !previous ||
      !sameStringList(previous.rootIds, projection.rootIds)
    ) {
      parentsToAttach.add(null);
    }
    this.#projection = projection;
    for (const parentId of parentsToAttach) {
      if (parentId === null) {
        attachChildren(
          this.#app.tree as unknown as LeaferGroup,
          projection.rootIds,
        );
        continue;
      }
      const spec = projection.elementsById.get(parentId);
      const element = this.#elements.get(parentId);
      if (spec && element && "children" in element) {
        attachChildren(element as LeaferGroup, spec.childIds);
      }
    }
    if (reapplyAll || !previous) {
      this.#scheduleEditorRefresh({ treeBounds: true });
    } else {
      const selectionBounds = this.#selectionBoundsAffected(
        changedNodeIds,
        previous,
        projection,
      );
      if (selectionBounds.size > 0) {
        this.#scheduleEditorRefresh({ nodeBounds: selectionBounds });
      }
    }
  }

  #projectBooleanGeometry(
    base: LeaferSceneProjection,
    forceBooleanIds?: ReadonlySet<string>,
  ): LeaferSceneProjection {
    const currentBooleanIds = collectBooleanNodeIds(base);
    const removedBooleanIds = new Set(
      [...this.#booleanNodeIds].filter(
        (nodeId) => !currentBooleanIds.has(nodeId),
      ),
    );
    this.#booleanNodeIds = currentBooleanIds;
    const document = this.#input?.document;
    if (!document) return base;
    if (currentBooleanIds.size === 0) {
      return removedBooleanIds.size === 0
        ? base
        : projectResolvedBooleanGeometry(
            base,
            document,
            emptyBooleanResolution(base.pageId),
            { removedBooleanNodeIds: removedBooleanIds },
          );
    }

    if (!this.#booleanResolver) {
      if (this.#geometryLoadError) {
        const incremental =
          base.affectedNodeIds !== undefined || forceBooleanIds !== undefined;
        return projectResolvedBooleanGeometry(
          base,
          document,
          failedBooleanResolution(
            base.pageId,
            currentBooleanIds,
            this.#geometryLoadError,
          ),
          incremental
            ? {
                affectedBooleanNodeIds:
                  forceBooleanIds ?? new Set(currentBooleanIds),
                removedBooleanNodeIds: removedBooleanIds,
              }
            : {},
        );
      }
      this.#ensureVectorGeometryProvider();
      return base;
    }

    const resolution = this.#booleanResolver.resolve(document, base.pageId);
    const incremental =
      base.affectedNodeIds !== undefined || forceBooleanIds !== undefined;
    return projectResolvedBooleanGeometry(
      base,
      document,
      resolution,
      incremental
        ? {
            affectedBooleanNodeIds: new Set([
              ...resolution.computedNodeIds,
              ...(forceBooleanIds ?? []),
            ]),
            removedBooleanNodeIds: removedBooleanIds,
          }
        : {},
    );
  }

  #projectScene(
    base: LeaferSceneProjection,
    forceBooleanIds?: ReadonlySet<string>,
    affectedEditScopeBooleanIds?: ReadonlySet<string>,
    forceEditScopeAffected = false,
  ): LeaferSceneProjection {
    const projection = this.#projectBooleanGeometry(base, forceBooleanIds);
    const document = this.#input?.document;
    if (!document) return projection;
    return projectBooleanEditScope(
      projection,
      document,
      this.#input?.booleanEditScope,
      affectedEditScopeBooleanIds
        ? {
            affectedBooleanNodeIds: affectedEditScopeBooleanIds,
            forceAffected: forceEditScopeAffected,
          }
        : {},
    );
  }

  #ensureVectorGeometryProvider(): void {
    if (
      this.#disposed ||
      this.#geometryLoadPromise ||
      this.#booleanResolver ||
      this.#geometryLoadError
    ) {
      return;
    }
    const generation = ++this.#geometryLoadGeneration;
    this.#geometryLoadPromise = this.#loadVectorGeometryProvider().then(
      (provider) => {
        if (this.#disposed || generation !== this.#geometryLoadGeneration) {
          return;
        }
        this.#booleanResolver = createBooleanGeometryResolver(provider);
        this.#geometryLoadError = null;
        this.#geometryLoadPromise = null;
        this.#refreshBooleanGeometry();
      },
      (error: unknown) => {
        if (this.#disposed || generation !== this.#geometryLoadGeneration) {
          return;
        }
        this.#geometryLoadError =
          error instanceof Error
            ? error
            : new Error("PathKit geometry provider failed to load");
        this.#geometryLoadPromise = null;
        this.#refreshBooleanGeometry();
      },
    );
  }

  #refreshBooleanGeometry(): void {
    const base = this.#baseProjection;
    const input = this.#input;
    if (!base || !input || this.#disposed) return;
    this.#synchronizing = true;
    try {
      const projection = this.#projectScene(
        base,
        new Set(this.#booleanNodeIds),
      );
      this.#reconcile(projection);
      this.#syncSelection(input.selection.nodeIds);
    } catch (error) {
      this.#report(error);
    } finally {
      this.#synchronizing = false;
    }
  }

  #selectionBoundsAffected(
    changedNodeIds: ReadonlySet<string>,
    previous: LeaferSceneProjection,
    projection: LeaferSceneProjection,
  ): Set<string> {
    const selection = this.#input?.selection.nodeIds;
    if (!selection || changedNodeIds.size === 0 || selection.length === 0)
      return new Set();
    const affectedSelection = new Set<string>();
    const selectedNodeIds = new Set(selection);
    for (const selectedNodeId of selectedNodeIds) {
      if (
        lineage(selectedNodeId, previous).some((nodeId) =>
          changedNodeIds.has(nodeId),
        ) ||
        lineage(selectedNodeId, projection).some((nodeId) =>
          changedNodeIds.has(nodeId),
        )
      ) {
        affectedSelection.add(selectedNodeId);
      }
    }
    for (const changedNodeId of changedNodeIds) {
      for (const nodeId of [
        ...lineage(changedNodeId, previous),
        ...lineage(changedNodeId, projection),
      ]) {
        if (selectedNodeIds.has(nodeId)) affectedSelection.add(nodeId);
      }
    }
    return affectedSelection;
  }

  #createElement(tag: LeaferElementTag): LeaferElement {
    const Constructor = this.#leafer[tag] as new (
      data?: Record<string, unknown>,
    ) => LeaferElement;
    return new Constructor();
  }

  #tag(element: LeaferElement): string {
    return (element as LeaferElement & { tag?: string }).tag ?? "";
  }

  #syncTool(tool: LeaferCanvasTool): void {
    const drawing = tool !== "select";
    const mode = drawing ? "draw" : "normal";
    if (this.#app.mode !== mode) this.#app.mode = mode;
    if (this.#editor.visible !== !drawing) this.#editor.visible = !drawing;
    if (this.#editor.hittable !== !drawing) this.#editor.hittable = !drawing;
    if (drawing) this.#editor.hoverTarget = null as never;
  }

  #syncViewport(viewport: ViewportState): void {
    const current = this.#app.tree.localTransform;
    if (
      nearlyEqual(current.a, viewport.zoom) &&
      nearlyEqual(current.d, viewport.zoom) &&
      nearlyEqual(current.e, viewport.panX) &&
      nearlyEqual(current.f, viewport.panY) &&
      nearlyEqual(current.b, 0) &&
      nearlyEqual(current.c, 0)
    ) {
      return;
    }
    this.#app.tree.setTransform({
      a: viewport.zoom,
      b: 0,
      c: 0,
      d: viewport.zoom,
      e: viewport.panX,
      f: viewport.panY,
    });
    this.#scheduleEditorRefresh();
  }

  #syncSelection(nodeIds: readonly string[]): void {
    const target = nodeIds.flatMap((nodeId) => {
      const element = this.#elements.get(nodeId);
      return element ? [element] : [];
    });
    const current = this.#editor.list;
    if (
      current.length === target.length &&
      current.every((element, index) => element === target[index])
    ) {
      return;
    }
    this.#editor.target = target.length === 0 ? (null as never) : target;
    this.#scheduleEditorRefresh();
  }

  #emitSelection(): void {
    if (this.#synchronizing || this.#disposed) return;
    const nodeIds = this.#editor.list.flatMap((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return nodeId ? [nodeId] : [];
    });
    this.#callbacks.onSelectionChange(nodeIds, nodeIds.at(-1));
  }

  #beginTransform(): void {
    if (this.#synchronizing || this.#transform || this.#disposed) return;
    if (this.#selectionHasLockedElement()) return;
    const nodeIds = this.#selectedSubtreeIds();
    if (nodeIds.length === 0) return;
    this.#transform = {
      before: this.#capture(nodeIds),
      changed: false,
      kind: this.#currentTransformKind(),
    };
  }

  #markTransformChanged(): void {
    if (this.#synchronizing || this.#disposed) return;
    this.#beginTransform();
    if (!this.#transform) {
      if (this.#selectionHasLockedElement()) this.#restoreProjection();
      return;
    }
    this.#transform.changed = true;
    this.#scheduleBooleanPreview();
    if (!this.#editor.editBox.dragging && !this.#editor.editBox.gesturing) {
      queueMicrotask(() => this.#finishTransform());
    }
  }

  #finishTransform(): void {
    const session = this.#transform;
    if (!session || this.#synchronizing || this.#disposed) return;
    this.#transform = null;
    if (!session.changed) return;
    const operations = this.#operationsFrom(session.before);
    if (operations.length === 0) return;
    const accepted = this.#callbacks.onOperations({
      kind: session.kind,
      operations,
    });
    if (!accepted) this.#restoreProjection();
  }

  #scheduleBooleanPreview(): void {
    if (
      this.#disposed ||
      this.#booleanPreviewFrame !== null ||
      !this.#input?.booleanEditScope ||
      this.#input.booleanEditScope.readOnly ||
      !this.#booleanResolver ||
      !this.#baseProjection ||
      !this.#transform
    ) {
      return;
    }
    this.#booleanPreviewFrame = requestAnimationFrame(() => {
      this.#booleanPreviewFrame = null;
      this.#previewBooleanTransform();
    });
  }

  #previewBooleanTransform(): void {
    const input = this.#input;
    const base = this.#baseProjection;
    const resolver = this.#booleanResolver;
    const transform = this.#transform;
    if (
      !input?.booleanEditScope ||
      input.booleanEditScope.readOnly ||
      !base ||
      !resolver ||
      !transform ||
      this.#disposed
    ) {
      return;
    }
    const nodesById: DesignDocument["nodesById"] = {
      ...input.document.nodesById,
    };
    for (const nodeId of transform.before.keys()) {
      const node = input.document.nodesById[nodeId];
      const element = this.#elements.get(nodeId);
      if (!node || !element) continue;
      const current = this.#readElementState(element);
      nodesById[nodeId] = {
        ...node,
        transform: current.transform,
        ...(node.kind === "group" ||
        node.kind === "boolean" ||
        node.kind === "instance"
          ? {}
          : { size: current.size }),
      };
    }
    const previewDocument: DesignDocument = {
      ...input.document,
      nodesById,
    };
    try {
      const resolution = resolver.resolve(previewDocument, input.pageId);
      const projection = projectResolvedBooleanGeometry(
        base,
        previewDocument,
        resolution,
        {
          affectedBooleanNodeIds: new Set([
            ...resolution.computedNodeIds,
            input.booleanEditScope.booleanId,
          ]),
        },
      );
      this.#synchronizing = true;
      this.#reconcile(
        projectBooleanEditScope(
          projection,
          previewDocument,
          input.booleanEditScope,
        ),
      );
      this.#syncSelection(input.selection.nodeIds);
    } catch (error) {
      this.#report(error);
    } finally {
      this.#synchronizing = false;
    }
  }

  #cancelBooleanPreview(): void {
    if (this.#booleanPreviewFrame === null) return;
    cancelAnimationFrame(this.#booleanPreviewFrame);
    this.#booleanPreviewFrame = null;
  }

  #capture(nodeIds: readonly string[]): Map<string, ElementState> {
    const captured = new Map<string, ElementState>();
    nodeIds.forEach((nodeId) => {
      const element = this.#elements.get(nodeId);
      if (!element) return;
      captured.set(nodeId, this.#readElementState(element));
    });
    return captured;
  }

  #operationsFrom(
    before: ReadonlyMap<string, ElementState>,
  ): DesignOperation[] {
    const document = this.#input?.document;
    if (!document) return [];
    const operations: DesignOperation[] = [];
    for (const [nodeId, previous] of before) {
      const node = document.nodesById[nodeId];
      const element = this.#elements.get(nodeId);
      const spec = this.#projection?.elementsById.get(nodeId);
      if (!node || !element || isLockedSpec(spec)) continue;
      const current = this.#readElementState(element);
      const linePointsChanged =
        node.kind === "line" &&
        previous.linePoints !== undefined &&
        current.linePoints !== undefined &&
        !sameNumberList(previous.linePoints, current.linePoints);
      let nextTransform = current.transform;
      let nextSize = node.kind === "line" ? node.size : current.size;
      let lineProperties:
        | { start: { x: number; y: number }; end: { x: number; y: number } }
        | undefined;
      if (linePointsChanged && current.linePoints) {
        const geometry = normalizeLineEndpoints(
          { x: current.linePoints[0], y: current.linePoints[1] },
          { x: current.linePoints[2], y: current.linePoints[3] },
        );
        nextTransform = translateLocalTransform(
          current.transform,
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
        ...(transformChanged ? { transform: nextTransform } : {}),
        ...(sizeChanged ? { size: nextSize } : {}),
        ...(lineProperties ? { properties: lineProperties } : {}),
      });
    }
    return operations;
  }

  #readElementState(element: LeaferElement): ElementState {
    const matrix = element.localTransform;
    const tag = this.#tag(element);
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
        width: normalizeNumber(Number(element.width) || 0),
        height: normalizeNumber(Number(element.height) || 0),
      },
      ...(linePoints ? { linePoints } : {}),
      ...(tag === "Text" ? { text: readElementText(element) } : {}),
    };
  }

  #selectedSubtreeIds(): string[] {
    const projection = this.#projection;
    if (!projection) return [];
    const selected = this.#editor.list.flatMap((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return nodeId ? [nodeId] : [];
    });
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
    selected.forEach(visit);
    return result;
  }

  #currentTransformKind(): LeaferOperationKind {
    if (this.#editor.resizing) return "resize";
    if (this.#editor.rotating) return "rotate";
    if (this.#editor.skewing) return "skew";
    if (this.#editor.moving) return "move";
    return "transform";
  }

  #selectionHasLockedElement(): boolean {
    return this.#editor.list.some((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return (
        nodeId !== undefined &&
        isLockedSpec(this.#projection?.elementsById.get(nodeId))
      );
    });
  }

  #finishTextEdit(): void {
    const before = this.#textBefore;
    this.#textBefore = null;
    if (!before || this.#synchronizing || this.#disposed) return;
    const element = this.#elements.get(before.nodeId);
    const node = this.#input?.document.nodesById[before.nodeId];
    const spec = this.#projection?.elementsById.get(before.nodeId);
    if (!element || !node || node.kind !== "text" || isLockedSpec(spec)) return;
    const content = readElementText(element);
    if (this.#cancelTextEdit) {
      (element as LeaferElement & { text: string }).text = before.text;
      this.#cancelTextEdit = false;
      return;
    }
    if (content === before.text) return;
    const accepted = this.#callbacks.onOperations({
      kind: "text",
      operations: [
        {
          commandId: `leafer_text_${before.nodeId}`,
          type: "update_properties",
          nodeId: before.nodeId,
          properties: { ...node.properties, content },
        },
      ],
    });
    if (!accepted) this.#restoreProjection();
  }

  #startBoxSelect(event: unknown): void {
    const input = this.#input;
    if (
      !input ||
      input.tool !== "select" ||
      !this.#editor.selector.dragging ||
      this.#disposed
    ) {
      return;
    }
    const drag = asLeaferEvent(event);
    this.#boxSelect = {
      additiveNodeIds: new Set(
        drag.shiftKey
          ? this.#editor.list.flatMap((element) => {
              const nodeId = this.#nodeId(element as LeaferElement);
              return nodeId ? [nodeId] : [];
            })
          : [],
      ),
      start: drag.getInnerPoint(this.#editor.selector),
      startClient: { x: drag.clientX, y: drag.clientY },
    };
  }

  #finishBoxSelect(event: unknown): void {
    const session = this.#boxSelect;
    this.#boxSelect = null;
    if (!session || this.#disposed) return;
    const drag = asLeaferEvent(event);
    if (
      drag.isCancel ||
      Math.hypot(
        drag.clientX - session.startClient.x,
        drag.clientY - session.startClient.y,
      ) < MIN_DRAW_DISTANCE
    ) {
      return;
    }
    const end = drag.getInnerPoint(this.#editor.selector);
    const rect = rectFromPoints(session.start, end, false, false);
    const bounds = new this.#leafer.Bounds(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    );
    const selected = this.#leafer.EditSelectHelper.findByBounds(
      this.#app as unknown as LeaferElement,
      bounds,
      "hit",
    ).flatMap((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return nodeId ? [{ element: element as LeaferElement, nodeId }] : [];
    });
    const selectedNodeIds = new Set(selected.map(({ nodeId }) => nodeId));
    const targetNodeIds = new Set(session.additiveNodeIds);
    for (const nodeId of selectedNodeIds) {
      if (targetNodeIds.has(nodeId)) targetNodeIds.delete(nodeId);
      else targetNodeIds.add(nodeId);
    }
    const target = [...targetNodeIds].flatMap((nodeId) => {
      const element = this.#elements.get(nodeId);
      return element ? [element] : [];
    });
    const current = this.#editor.list;
    if (
      current.length !== target.length ||
      current.some((element, index) => element !== target[index])
    ) {
      this.#editor.target = target.length === 0 ? (null as never) : target;
      this.#scheduleEditorRefresh();
    }
  }

  #startDraw(event: unknown): void {
    const input = this.#input;
    if (!input || input.tool === "select" || this.#draw || this.#disposed)
      return;
    const drag = asLeaferEvent(event);
    const parentId = this.#resolveDrawParent(drag.target, input.tool);
    if (parentId === undefined) return;
    const parent = parentId
      ? (this.#elements.get(parentId) as LeaferGroup | undefined)
      : (this.#app.tree as unknown as LeaferGroup);
    if (!parent) return;
    const start = drag.getInnerPoint(parent);
    const preview = this.#createDrawPreview(input.tool);
    const lineTool = input.tool === "line" || input.tool === "arrow";
    preview.set(
      lineTool
        ? { x: 0, y: 0, points: [start.x, start.y, start.x + 1, start.y] }
        : { x: start.x, y: start.y, width: 1, height: 1 },
    );
    parent.add(preview);
    this.#draw = {
      dragged: false,
      parentId,
      preview,
      ...(lineTool ? { lineStart: start, lineEnd: start } : {}),
      start,
      startClient: { x: drag.clientX, y: drag.clientY },
      tool: input.tool,
    };
  }

  #updateDraw(event: unknown): void {
    const session = this.#draw;
    if (!session) return;
    const drag = asLeaferEvent(event);
    const parent = session.parentId
      ? (this.#elements.get(session.parentId) as LeaferGroup | undefined)
      : (this.#app.tree as unknown as LeaferGroup);
    if (!parent) return;
    const point = drag.getInnerPoint(parent);
    const lineTool = session.tool === "line" || session.tool === "arrow";
    session.dragged =
      Math.hypot(
        drag.clientX - session.startClient.x,
        drag.clientY - session.startClient.y,
      ) >= MIN_DRAW_DISTANCE;
    if (lineTool) {
      const endpoints = lineEndpointsFromDrag(
        session.start,
        point,
        drag.shiftKey,
        drag.altKey,
      );
      session.lineStart = endpoints.start;
      session.lineEnd = endpoints.end;
      session.preview.set({
        x: 0,
        y: 0,
        points: [
          endpoints.start.x,
          endpoints.start.y,
          endpoints.end.x,
          endpoints.end.y,
        ],
      });
    } else {
      session.preview.set(
        rectFromPoints(session.start, point, drag.shiftKey, drag.altKey),
      );
    }
  }

  #finishDraw(event: unknown): void {
    const session = this.#draw;
    const input = this.#input;
    if (!session || !input) return;
    const drag = asLeaferEvent(event);
    const lineTool = session.tool === "line" || session.tool === "arrow";
    const rawLineStart = session.lineStart ?? session.start;
    const rawLineEnd = session.dragged
      ? (session.lineEnd ?? session.start)
      : { x: session.start.x + 160, y: session.start.y };
    const lineGeometry = lineTool
      ? normalizeLineEndpoints(rawLineStart, rawLineEnd)
      : undefined;
    const rect = lineGeometry?.bounds ?? {
      x: Number(session.preview.x) || session.start.x,
      y: Number(session.preview.y) || session.start.y,
      width: Number(session.preview.width) || 1,
      height: Number(session.preview.height) || 1,
    };
    this.#cancelDraw();
    if (drag.isCancel) return;
    const request: LeaferCreateRequest = {
      dragged: session.dragged,
      height: rect.height,
      pageId: input.pageId,
      parentId: session.parentId,
      ...(lineGeometry
        ? { start: lineGeometry.start, end: lineGeometry.end }
        : {}),
      tool: session.tool,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    };
    const accepted = this.#callbacks.onCreate(request);
    if (!accepted) this.#restoreProjection();
  }

  #createDrawPreview(tool: Exclude<LeaferCanvasTool, "select">): LeaferElement {
    if (tool === "line" || tool === "arrow") {
      return new this.#leafer.Arrow({
        editable: false,
        hittable: false,
        stroke: "#4f7fff",
        strokeWidth: 2,
        startArrow: "none",
        endArrow: tool === "arrow" ? "angle" : "none",
      });
    }
    const data = {
      editable: false,
      hittable: false,
      fill: [{ type: "solid", color: "#4f7fff", opacity: 0.12 }],
      stroke: "#4f7fff",
      strokeWidth: 1,
      ...(tool === "frame" ? { dashPattern: [5, 4] } : {}),
    };
    return tool === "ellipse"
      ? new this.#leafer.Ellipse(data)
      : new this.#leafer.Rect(data);
  }

  #resolveDrawParent(
    target: unknown,
    tool: Exclude<LeaferCanvasTool, "select">,
  ): string | null | undefined {
    if (tool === "frame") return null;
    let element = isElement(target) ? target : undefined;
    while (element) {
      const nodeId = this.#nodeId(element);
      const spec = nodeId
        ? this.#projection?.elementsById.get(nodeId)
        : undefined;
      if (isLockedSpec(spec)) return undefined;
      if (spec && (spec.kind === "frame" || spec.kind === "group")) {
        return spec.id;
      }
      element = isElement(element.parent) ? element.parent : undefined;
    }
    return null;
  }

  #cancelDraw(): void {
    if (!this.#draw) return;
    this.#draw.preview.remove();
    this.#draw.preview.destroy();
    this.#draw = null;
  }

  #scheduleViewport(): void {
    if (this.#synchronizing || this.#disposed || this.#viewportFrame !== null) {
      return;
    }
    this.#viewportFrame = requestAnimationFrame(() => {
      this.#viewportFrame = null;
      this.#emitViewport();
    });
  }

  #scheduleEditorRefresh(
    options: {
      nodeBounds?: Iterable<string>;
      treeBounds?: boolean;
    } = {},
  ): void {
    this.#editorRefreshNeedsTreeBounds ||= options.treeBounds === true;
    if (options.nodeBounds) {
      for (const nodeId of options.nodeBounds) {
        this.#editorRefreshNodeBounds.add(nodeId);
      }
    }
    if (this.#disposed || this.#editorFrame !== null) return;
    this.#editorFrame = requestAnimationFrame(() => {
      this.#editorFrame = null;
      if (this.#disposed) return;
      try {
        const refreshTreeBounds = this.#editorRefreshNeedsTreeBounds;
        const refreshNodeBounds = [...this.#editorRefreshNodeBounds];
        this.#editorRefreshNeedsTreeBounds = false;
        this.#editorRefreshNodeBounds.clear();
        if (refreshTreeBounds) {
          this.#app.tree.forceUpdate("bounds");
        } else {
          refreshNodeBounds.forEach((nodeId) =>
            this.#elements.get(nodeId)?.forceUpdate("bounds"),
          );
        }
        this.#editor.update();
      } catch (error) {
        this.#report(error);
      }
    });
  }

  #emitViewport(): void {
    const input = this.#input;
    if (!input) return;
    const matrix = this.#app.tree.localTransform;
    const bounds = this.#host.getBoundingClientRect();
    const viewport: ViewportState = {
      panX: normalizeNumber(matrix.e),
      panY: normalizeNumber(matrix.f),
      zoom: Math.max(MATRIX_EPSILON, normalizeNumber(Math.abs(matrix.a))),
      width: Math.max(0, bounds.width),
      height: Math.max(0, bounds.height),
    };
    if (sameViewport(viewport, input.viewport)) return;
    this.#callbacks.onViewportChange(viewport);
  }

  #restoreProjection(): void {
    if (!this.#input) return;
    this.#synchronizing = true;
    try {
      const base = projectDesignPage(this.#input.document, this.#input.pageId);
      this.#baseProjection = base;
      this.#reconcile(this.#projectScene(base), {
        reapplyAll: true,
      });
      this.#syncViewport(this.#input.viewport);
      this.#syncSelection(this.#input.selection.nodeIds);
    } finally {
      this.#synchronizing = false;
    }
  }

  #nodeId(element: LeaferElement): string | undefined {
    const projectionId = this.#projectionId(element);
    if (!projectionId) return undefined;
    const metadata =
      this.#projection?.elementsById.get(projectionId)?.data.data;
    if (typeof metadata !== "object" || metadata === null) return projectionId;
    const nodeId = (metadata as Record<string, unknown>).opendesignNodeId;
    return typeof nodeId === "string" ? nodeId : projectionId;
  }

  #projectionId(element: LeaferElement): string | undefined {
    const id = element.id;
    return typeof id === "string" && this.#elements.get(id) === element
      ? id
      : undefined;
  }

  #onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape" && this.#draw) {
      this.#cancelDraw();
      return;
    }
    if (event.code === "Escape" && this.#editor.innerEditing) {
      this.#cancelTextEdit = true;
    }
  };

  #onContextLost = (event: Event) => {
    event.preventDefault();
    this.#callbacks.onError(new Error("Canvas context was lost"));
  };

  #report(error: unknown): void {
    this.#callbacks.onError(
      error instanceof Error ? error : new Error("Leafer rendering failed"),
    );
  }
}

async function loadBrowserVectorGeometryProvider(): Promise<VectorGeometryProvider> {
  const module =
    await import("@opendesign/geometry-service/browser-vector-path");
  return module.loadBrowserVectorGeometryProvider();
}

function sameBooleanEditScope(
  left: LeaferEngineSyncInput["booleanEditScope"],
  right: LeaferEngineSyncInput["booleanEditScope"],
): boolean {
  return (
    left?.booleanId === right?.booleanId &&
    left?.readOnly === right?.readOnly &&
    sameStringList(
      left?.selectedOperandIds ?? [],
      right?.selectedOperandIds ?? [],
    )
  );
}

function changedBooleanEditScopeIds(
  previous: LeaferEngineSyncInput | null | undefined,
  current: LeaferEngineSyncInput,
): Set<string> {
  return new Set(
    [
      previous?.booleanEditScope?.booleanId,
      current.booleanEditScope?.booleanId,
    ].filter((nodeId): nodeId is string => nodeId !== undefined),
  );
}

function collectBooleanNodeIds(projection: LeaferSceneProjection): Set<string> {
  return new Set(
    [...projection.elementsById.values()]
      .filter((spec) => spec.kind === "boolean")
      .map((spec) => spec.id),
  );
}

function failedBooleanResolution(
  pageId: string,
  nodeIds: ReadonlySet<string>,
  error: Error,
): BooleanGeometryResolution {
  return {
    computedNodeIds: [],
    issues: [...nodeIds].map((nodeId) => ({
      code: "provider-failure" as const,
      message: `Boolean geometry provider failed to load: ${error.message}`,
      nodeId,
    })),
    pageId,
    resolverVersion: BOOLEAN_GEOMETRY_RESOLVER_VERSION,
    resultsByNodeId: new Map(),
    reusedNodeIds: [],
  };
}

function emptyBooleanResolution(pageId: string): BooleanGeometryResolution {
  return {
    computedNodeIds: [],
    issues: [],
    pageId,
    resolverVersion: BOOLEAN_GEOMETRY_RESOLVER_VERSION,
    resultsByNodeId: new Map(),
    reusedNodeIds: [],
  };
}

function toMatrix(transform: Transform) {
  return {
    a: transform[0],
    b: transform[1],
    c: transform[2],
    d: transform[3],
    e: transform[4],
    f: transform[5],
  };
}

function changeSetNodeIds(changes: DesignChangeSet): Set<string> {
  return new Set([
    ...changes.addedNodeIds,
    ...changes.changedNodeIds,
    ...changes.removedNodeIds,
  ]);
}

function isLockedSpec(spec: LeaferElementSpec | undefined): boolean {
  const metadata = spec?.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignLocked === true
  );
}

function normalizeTransform(transform: Transform): Transform {
  return transform.map(normalizeNumber) as Transform;
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MATRIX_EPSILON;
}

function sameTransform(left: Transform, right: Transform): boolean {
  return left.every((value, index) => nearlyEqual(value, right[index] ?? 0));
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameProjectionValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameProjectionValue(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        sameProjectionValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function lineage(nodeId: string, projection: LeaferSceneProjection): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = nodeId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    result.push(currentId);
    currentId = projection.elementsById.get(currentId)?.parentId ?? null;
  }
  return result;
}

function sameViewport(left: ViewportState, right: ViewportState): boolean {
  return (
    nearlyEqual(left.panX, right.panX) &&
    nearlyEqual(left.panY, right.panY) &&
    nearlyEqual(left.zoom, right.zoom) &&
    nearlyEqual(left.width, right.width) &&
    nearlyEqual(left.height, right.height)
  );
}

function readElementText(element: LeaferElement): string {
  const text = (element as LeaferElement & { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function rectFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  constrain: boolean,
  fromCenter: boolean,
) {
  let width = end.x - start.x;
  let height = end.y - start.y;
  if (constrain) {
    const size = Math.max(Math.abs(width), Math.abs(height));
    width = Math.sign(width || 1) * size;
    height = Math.sign(height || 1) * size;
  }
  return {
    x: fromCenter
      ? start.x - Math.abs(width)
      : Math.min(start.x, start.x + width),
    y: fromCenter
      ? start.y - Math.abs(height)
      : Math.min(start.y, start.y + height),
    width: Math.max(1, Math.abs(width) * (fromCenter ? 2 : 1)),
    height: Math.max(1, Math.abs(height) * (fromCenter ? 2 : 1)),
  };
}

function lineEndpointsFromDrag(
  origin: { x: number; y: number },
  pointer: { x: number; y: number },
  constrain: boolean,
  fromCenter: boolean,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  let x = pointer.x - origin.x;
  let y = pointer.y - origin.y;
  if (constrain && (x !== 0 || y !== 0)) {
    const distance = Math.hypot(x, y);
    const angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
    x = Math.cos(angle) * distance;
    y = Math.sin(angle) * distance;
  }
  return fromCenter
    ? {
        start: { x: origin.x - x, y: origin.y - y },
        end: { x: origin.x + x, y: origin.y + y },
      }
    : { start: origin, end: { x: origin.x + x, y: origin.y + y } };
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

function translateLocalTransform(
  transform: Transform,
  x: number,
  y: number,
): Transform {
  return normalizeTransform([
    transform[0],
    transform[1],
    transform[2],
    transform[3],
    transform[0] * x + transform[2] * y + transform[4],
    transform[1] * x + transform[3] * y + transform[5],
  ]);
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

interface LeaferEventLike {
  altKey: boolean;
  clientX: number;
  clientY: number;
  getInnerPoint(relative: unknown): { x: number; y: number };
  isCancel?: boolean;
  shiftKey: boolean;
  target: unknown;
}

function asLeaferEvent(value: unknown): LeaferEventLike {
  return value as LeaferEventLike;
}

function isElement(value: unknown): value is LeaferElement {
  return (
    typeof value === "object" && value !== null && "localTransform" in value
  );
}
