import type {
  DesignOperation,
  Transform,
  ViewportState,
} from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import {
  projectDesignPage,
  type LeaferElementTag,
  type LeaferSceneProjection,
} from "./mapping.js";
import type {
  LeaferCanvasTool,
  LeaferCreateRequest,
  LeaferEngineAdapter,
  LeaferEngineCallbacks,
  LeaferEngineSyncInput,
  LeaferOperationKind,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferApp = InstanceType<LeaferModule["App"]>;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;
type LeaferEditor = InstanceType<LeaferModule["Editor"]>;

interface ElementState {
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
  start: { x: number; y: number };
  startClient: { x: number; y: number };
  tool: Exclude<LeaferCanvasTool, "select">;
}

const MATRIX_EPSILON = 0.000_001;
const MIN_DRAW_DISTANCE = 4;

export async function createLeaferEngineAdapter(
  host: HTMLElement,
  callbacks: LeaferEngineCallbacks,
): Promise<LeaferEngineAdapter> {
  const leafer = await import("leafer-editor");
  return new WebLeaferEngineAdapter(host, callbacks, leafer);
}

class WebLeaferEngineAdapter implements LeaferEngineAdapter {
  readonly #app: LeaferApp;
  readonly #callbacks: LeaferEngineCallbacks;
  readonly #host: HTMLElement;
  readonly #leafer: LeaferModule;
  readonly #editor: LeaferEditor;
  readonly #elements = new Map<string, LeaferElement>();
  #disposed = false;
  #draw: DrawSession | null = null;
  #input: LeaferEngineSyncInput | null = null;
  #projection: LeaferSceneProjection | null = null;
  #synchronizing = false;
  #textBefore: { nodeId: string; text: string } | null = null;
  #cancelTextEdit = false;
  #transform: TransformSession | null = null;
  #viewportFrame: number | null = null;
  #editorFrame: number | null = null;

  constructor(
    host: HTMLElement,
    callbacks: LeaferEngineCallbacks,
    leafer: LeaferModule,
  ) {
    this.#host = host;
    this.#callbacks = callbacks;
    this.#leafer = leafer;
    this.#app = new leafer.App({
      view: host,
      type: "design",
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
        stroke: "#4f7fff",
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
    const sceneChanged =
      !previous ||
      previous.document.documentId !== input.document.documentId ||
      previous.document.revision !== input.document.revision ||
      previous.pageId !== input.pageId;

    this.#synchronizing = true;
    try {
      if (sceneChanged) {
        this.#editor.visible = false;
        this.#cancelDraw();
        this.#transform = null;
        if (this.#editor.innerEditing) this.#editor.closeInnerEditor();
        this.#reconcile(projectDesignPage(input.document, input.pageId));
      }
      this.#syncTool(input.tool);
      this.#syncViewport(input.viewport);
      this.#syncSelection(input.selection.nodeIds);
      this.#scheduleEditorRefresh();
    } catch (error) {
      this.#report(error);
    } finally {
      this.#synchronizing = false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelDraw();
    if (this.#viewportFrame !== null) cancelAnimationFrame(this.#viewportFrame);
    if (this.#editorFrame !== null) cancelAnimationFrame(this.#editorFrame);
    this.#viewportFrame = null;
    this.#editorFrame = null;
    window.removeEventListener("keydown", this.#onWindowKeyDown, true);
    this.#host.removeEventListener("contextlost", this.#onContextLost, true);
    this.#app.destroy();
    this.#elements.clear();
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

    this.#app.on(DragEvent.START, (event: unknown) => this.#startDraw(event));
    this.#app.on(DragEvent.DRAG, (event: unknown) => this.#updateDraw(event));
    this.#app.on(DragEvent.END, (event: unknown) => this.#finishDraw(event));

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

  #reconcile(projection: LeaferSceneProjection): void {
    this.#projection = projection;
    projection.warnings.forEach((warning) =>
      this.#callbacks.onWarning?.(warning),
    );

    for (const [nodeId, element] of this.#elements) {
      if (projection.elementsById.has(nodeId)) continue;
      if (this.#editor.hasItem(element)) this.#editor.removeItem(element);
      element.remove();
      element.destroy();
      this.#elements.delete(nodeId);
    }

    for (const spec of projection.elementsById.values()) {
      const existing = this.#elements.get(spec.id);
      if (existing && this.#tag(existing) !== spec.tag) {
        if (this.#editor.hasItem(existing)) this.#editor.removeItem(existing);
        existing.remove();
        existing.destroy();
        this.#elements.delete(spec.id);
      }
      const element =
        this.#elements.get(spec.id) ?? this.#createElement(spec.tag);
      this.#elements.set(spec.id, element);
      element.set(spec.data);
      element.setTransform(toMatrix(spec.transform));
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
    for (const spec of projection.elementsById.values()) {
      const element = this.#elements.get(spec.id);
      if (element && "children" in element) {
        attachChildren(element as LeaferGroup, spec.childIds);
      }
    }
    attachChildren(
      this.#app.tree as unknown as LeaferGroup,
      projection.rootIds,
    );
    this.#app.tree.forceUpdate("bounds");
    this.#scheduleEditorRefresh();
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
    this.#app.mode = drawing ? "draw" : "normal";
    this.#editor.visible = !drawing;
    this.#editor.hittable = !drawing;
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
      return element && !element.locked ? [element] : [];
    });
    const current = this.#editor.list;
    if (
      current.length === target.length &&
      current.every((element, index) => element === target[index])
    ) {
      this.#scheduleEditorRefresh();
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
    if (!this.#transform) return;
    this.#transform.changed = true;
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
      if (!node || !element) continue;
      const current = this.#readElementState(element);
      const transformChanged = !sameTransform(
        previous.transform,
        current.transform,
      );
      const sizeChanged =
        node.kind !== "group" &&
        node.kind !== "instance" &&
        (!nearlyEqual(previous.size.width, current.size.width) ||
          !nearlyEqual(previous.size.height, current.size.height));
      if (!transformChanged && !sizeChanged) continue;
      operations.push({
        commandId: `leafer_transform_${nodeId}`,
        type: "update_properties",
        nodeId,
        ...(transformChanged ? { transform: current.transform } : {}),
        ...(sizeChanged ? { size: current.size } : {}),
      });
    }
    return operations;
  }

  #readElementState(element: LeaferElement): ElementState {
    const matrix = element.localTransform;
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
      ...(this.#tag(element) === "Text"
        ? { text: readElementText(element) }
        : {}),
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

  #finishTextEdit(): void {
    const before = this.#textBefore;
    this.#textBefore = null;
    if (!before || this.#synchronizing || this.#disposed) return;
    const element = this.#elements.get(before.nodeId);
    const node = this.#input?.document.nodesById[before.nodeId];
    if (!element || !node || node.kind !== "text") return;
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

  #startDraw(event: unknown): void {
    const input = this.#input;
    if (!input || input.tool === "select" || this.#draw || this.#disposed)
      return;
    const drag = asLeaferEvent(event);
    const parentId = this.#resolveDrawParent(drag.target, input.tool);
    const parent = parentId
      ? (this.#elements.get(parentId) as LeaferGroup | undefined)
      : (this.#app.tree as unknown as LeaferGroup);
    if (!parent) return;
    const start = drag.getInnerPoint(parent);
    const preview = this.#createDrawPreview(input.tool);
    preview.set({ x: start.x, y: start.y, width: 1, height: 1 });
    parent.add(preview);
    this.#draw = {
      dragged: false,
      parentId,
      preview,
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
    const rect = rectFromPoints(session.start, point, drag.shiftKey);
    session.dragged =
      Math.hypot(
        drag.clientX - session.startClient.x,
        drag.clientY - session.startClient.y,
      ) >= MIN_DRAW_DISTANCE;
    session.preview.set(rect);
  }

  #finishDraw(event: unknown): void {
    const session = this.#draw;
    const input = this.#input;
    if (!session || !input) return;
    const drag = asLeaferEvent(event);
    const rect = {
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
      tool: session.tool,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    };
    const accepted = this.#callbacks.onCreate(request);
    if (!accepted) this.#restoreProjection();
  }

  #createDrawPreview(tool: Exclude<LeaferCanvasTool, "select">): LeaferElement {
    const data = {
      editable: false,
      hittable: false,
      fill: [{ type: "solid", color: "#4f7fff", opacity: 0.12 }],
      stroke: "#4f7fff",
      strokeWidth: 1,
      dashPattern: tool === "frame" ? [5, 4] : undefined,
    };
    return tool === "ellipse"
      ? new this.#leafer.Ellipse(data)
      : new this.#leafer.Rect(data);
  }

  #resolveDrawParent(
    target: unknown,
    tool: Exclude<LeaferCanvasTool, "select">,
  ): string | null {
    if (tool === "frame") return null;
    let element = isElement(target) ? target : undefined;
    while (element) {
      const nodeId = this.#nodeId(element);
      const spec = nodeId && this.#projection?.elementsById.get(nodeId);
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

  #scheduleEditorRefresh(): void {
    if (this.#disposed || this.#editorFrame !== null) return;
    this.#editorFrame = requestAnimationFrame(() => {
      this.#editorFrame = null;
      if (this.#disposed) return;
      try {
        this.#app.tree.forceUpdate("bounds");
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
      this.#reconcile(
        projectDesignPage(this.#input.document, this.#input.pageId),
      );
      this.#syncViewport(this.#input.viewport);
      this.#syncSelection(this.#input.selection.nodeIds);
    } finally {
      this.#synchronizing = false;
    }
  }

  #nodeId(element: LeaferElement): string | undefined {
    const id = element.id;
    return typeof id === "string" && this.#elements.get(id) === element
      ? id
      : undefined;
  }

  #onWindowKeyDown = (event: KeyboardEvent) => {
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
) {
  let width = end.x - start.x;
  let height = end.y - start.y;
  if (constrain) {
    const size = Math.max(Math.abs(width), Math.abs(height));
    width = Math.sign(width || 1) * size;
    height = Math.sign(height || 1) * size;
  }
  return {
    x: Math.min(start.x, start.x + width),
    y: Math.min(start.y, start.y + height),
    width: Math.max(1, Math.abs(width)),
    height: Math.max(1, Math.abs(height)),
  };
}

interface LeaferEventLike {
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
