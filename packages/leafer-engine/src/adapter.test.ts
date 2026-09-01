// @vitest-environment happy-dom

import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import type {
  DesignChangeSet,
  DesignDocument,
  DesignNode,
} from "@opendesign/design-contracts";
import { DESIGN_SCHEMA_VERSION } from "@opendesign/design-contracts";
import { componentProjectionId } from "@opendesign/component-service";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import { cutVectorPath } from "@opendesign/geometry-service/vector-edit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLeaferEngineAdapter } from "./adapter.js";
import {
  booleanResultElementId,
  vectorRegionElementId,
  vectorStrokeElementId,
} from "./mapping.js";
import {
  textRunFragmentElementId,
  type LeaferTextRunProjectionResolution,
} from "./text-run-projection.js";
import type {
  LeaferCreateRequest,
  LeaferCreateVectorRequest,
  LeaferEngineCallbacks,
  LeaferEngineSyncInput,
  LeaferGenerationSkeleton,
  LeaferGridChildSpanRequest,
  LeaferVectorEditRequest,
} from "./types.js";

const leaferHarness = vi.hoisted(() => ({
  app: null as FakeApp | null,
  appConfig: null as Record<string, unknown> | null,
  boxMatches: [] as FakeElement[],
  elements: [] as FakeElement[],
  failNextExport: false,
  failReconcileCount: 0,
  failReconcileSetCount: 0,
  windowListeners: new Map<string, Set<(event: KeyboardEvent) => void>>(),
  strokers: [] as FakeStroker[],
}));

class FakeEventTarget {
  readonly listeners = new Map<string, Set<(event?: unknown) => void>>();

  on(type: string, listener: (event?: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  off(type: string, listener: (event?: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event?: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

class FakeElement extends FakeEventTarget {
  readonly tag: string = "UI";
  id?: string;
  locked = false;
  parent: FakeGroup | undefined;
  localTransform = identityMatrix();
  opacity = 1;
  pageBounds?: { x: number; y: number; width: number; height: number };
  visible = true;
  width = 0;
  height = 0;
  hittable = true;
  x = 0;
  y = 0;
  setCalls = 0;
  strokeWidth = 0;
  transformCalls = 0;
  forceUpdate = vi.fn();
  leafer: FakeTree | undefined;
  export = vi.fn((_format: string, options?: { scale?: number }) => {
    if (leaferHarness.failNextExport) {
      leaferHarness.failNextExport = false;
      return Promise.resolve({
        data: new Blob(),
        error: new Error("Synthetic export failure"),
      });
    }
    const scale = options?.scale ?? 1;
    const bounds = this.getBounds();
    return Promise.resolve({
      data: new Blob([new Uint8Array([1, 2, 3])], {
        type: "image/jpeg",
      }),
      width: Math.max(1, Math.round(bounds.width * scale)),
      height: Math.max(1, Math.round(bounds.height * scale)),
    });
  });
  syncExport = vi.fn((_format: string, options?: { scale?: number }) => {
    const scale = options?.scale ?? 1;
    const bounds = this.getBounds();
    return {
      data: "data:image/jpeg;base64,AQID",
      width: Math.max(1, Math.round(bounds.width * scale)),
      height: Math.max(1, Math.round(bounds.height * scale)),
    };
  });
  updateLayout = vi.fn();
  destroy = vi.fn();

  constructor(data?: Record<string, unknown>) {
    super();
    leaferHarness.elements.push(this);
    if (data) this.set(data);
    if (!data || !Object.hasOwn(data, "width")) {
      this.width = undefined as unknown as number;
    }
    if (!data || !Object.hasOwn(data, "height")) {
      this.height = undefined as unknown as number;
    }
  }

  set(data: Record<string, unknown>): void {
    if (leaferHarness.failReconcileSetCount > 0) {
      leaferHarness.failReconcileSetCount -= 1;
      throw new Error("Synthetic reconcile failure");
    }
    this.setCalls += 1;
    Object.assign(this, data);
  }

  setTransform(transform: ReturnType<typeof identityMatrix>): void {
    if (leaferHarness.failReconcileSetCount > 0) {
      leaferHarness.failReconcileSetCount -= 1;
      throw new Error("Synthetic reconcile failure");
    }
    this.transformCalls += 1;
    this.localTransform = { ...transform };
  }

  getBounds(
    _boundsType?: string,
    coordinateType?: string,
  ): { x: number; y: number; width: number; height: number } {
    if (coordinateType === "page" && this.pageBounds) return this.pageBounds;
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(
      (child) => child !== this,
    );
    this.parent = undefined;
  }
}

class FakeGroup extends FakeElement {
  override readonly tag: string = "Group";
  children: FakeElement[] = [];

  addAt(child: FakeElement, index: number): void {
    if (leaferHarness.failReconcileCount > 0) {
      leaferHarness.failReconcileCount -= 1;
      throw new Error("Synthetic reconcile failure");
    }
    child.remove();
    child.parent = this;
    child.leafer = this.leafer;
    this.children.splice(index, 0, child);
  }

  add(child: FakeElement): void {
    this.addAt(child, this.children.length);
  }

  override getBounds(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    if (this.width > 0 && this.height > 0) return super.getBounds();
    if (this.children.length === 0) return super.getBounds();
    const left = Math.min(
      ...this.children.map((child) => child.localTransform.e),
    );
    const top = Math.min(
      ...this.children.map((child) => child.localTransform.f),
    );
    const right = Math.max(
      ...this.children.map(
        (child) => child.localTransform.e + Math.max(0, child.width),
      ),
    );
    const bottom = Math.max(
      ...this.children.map(
        (child) => child.localTransform.f + Math.max(0, child.height),
      ),
    );
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
}

class FakeFrame extends FakeGroup {
  override readonly tag: string = "Frame";
}

class FakeRect extends FakeElement {
  override readonly tag: string = "Rect";
}

class FakeEllipse extends FakeElement {
  override readonly tag: string = "Ellipse";
}

class FakePolygon extends FakeElement {
  override readonly tag: string = "Polygon";
}

class FakeStar extends FakeElement {
  override readonly tag: string = "Star";
}

class FakeArrow extends FakeElement {
  override readonly tag: string = "Arrow";
  points: number[] = [];
}

class FakeImage extends FakeElement {
  override readonly tag: string = "Image";
}

class FakePath extends FakeElement {
  override readonly tag: string = "Path";
  path: unknown = null;
}

class FakeText extends FakeElement {
  override readonly tag: string = "Text";
  text = "";

  constructor(data?: Record<string, unknown>) {
    super();
    if (data) this.set(data);
  }

  get boxBounds() {
    return {
      x: 0,
      y: 0,
      width: this.width || this.text.length * 12,
      height: this.height || 32,
    };
  }

  get __() {
    const charactersPerRow =
      typeof this.width === "number" && this.width > 0
        ? Math.max(1, Math.floor(this.width / 12))
        : Math.max(1, this.text.length);
    const rows = this.text.split("\n").flatMap((paragraph) => {
      const characters = Array.from(paragraph);
      const chunks = Array.from(
        {
          length: Math.max(1, Math.ceil(characters.length / charactersPerRow)),
        },
        (_, index) =>
          characters
            .slice(index * charactersPerRow, (index + 1) * charactersPerRow)
            .join(""),
      );
      return chunks.map((text, index) => ({
        paraEnd: index === chunks.length - 1,
        text,
      }));
    });
    return { __textDrawData: { rows } };
  }

  override getBounds(
    boundsType?: string,
    coordinateType?: string,
  ): { x: number; y: number; width: number; height: number } {
    if (boundsType === "box") return this.boxBounds;
    return super.getBounds(boundsType, coordinateType);
  }
}

class FakeStroker extends FakeElement {
  override readonly tag: string = "Stroker";
  target: FakeElement | FakeElement[] | null = null;
  update = vi.fn();

  setTarget(
    target: FakeElement | FakeElement[] | null,
    style?: Record<string, unknown>,
  ): void {
    if (style) this.set(style);
    this.target = target;
    this.update();
  }

  constructor() {
    super();
    leaferHarness.strokers.push(this);
  }
}

class FakeTree extends FakeGroup {
  override readonly tag: string = "Leafer";
  override forceUpdate = vi.fn();
  waitViewCompleted = vi.fn((callback: () => void) => callback());

  constructor() {
    super();
    this.leafer = this;
  }

  override setTransform(transform: ReturnType<typeof identityMatrix>): void {
    this.localTransform = { ...transform };
  }
}

class FakeEditor extends FakeEventTarget {
  readonly editBox = new FakeEventTarget() as FakeEventTarget & {
    dragging: boolean;
    gesturing: boolean;
  };
  readonly selector = { dragging: false };
  list: FakeElement[] = [];
  visible = true;
  hittable = true;
  innerEditing = false;
  editTarget: FakeElement | null = null;
  beforeEditInner:
    | ((request: {
        name?: string;
        target: FakeElement;
      }) => false | string | undefined)
    | undefined = undefined;
  hoverTarget: FakeElement | null = null;
  moving = false;
  resizing = false;
  rotating = false;
  skewing = false;
  update = vi.fn();
  children: FakeElement[] = [];
  enableTextDom = false;
  innerEditor: { editDom: HTMLDivElement } | null = null;

  constructor() {
    super();
    this.editBox.dragging = false;
    this.editBox.gesturing = false;
  }

  set target(target: FakeElement[] | null) {
    this.list = target ?? [];
  }

  hasItem(item: FakeElement): boolean {
    return this.list.includes(item);
  }

  removeItem(item: FakeElement): void {
    this.list = this.list.filter((candidate) => candidate !== item);
  }

  openInnerEditor(
    target?: FakeElement,
    nameOrSelect?: string | boolean,
    select?: boolean,
  ): void {
    let name = typeof nameOrSelect === "string" ? nameOrSelect : undefined;
    if (typeof nameOrSelect === "boolean" && select === undefined) {
      select = nameOrSelect;
    }
    target ??= this.list[0];
    if (!target) return;
    if (select) this.target = [target];
    const check = this.beforeEditInner?.({ target, ...(name ? { name } : {}) });
    if (check === false) return;
    if (typeof check === "string") name = check;
    this.innerEditing = true;
    this.editTarget = target;
    this.emit("inner.before-open", { editTarget: target, name });
    if (this.enableTextDom) {
      const editDom = document.createElement("div");
      editDom.contentEditable = "true";
      editDom.textContent = target instanceof FakeText ? target.text : "";
      document.body.appendChild(editDom);
      this.innerEditor = { editDom };
      this.emit("inner.open", {
        editTarget: target,
        innerEditor: this.innerEditor,
        name,
      });
    }
  }

  closeInnerEditor(): void {
    if (!this.innerEditing) return;
    this.innerEditing = false;
    const editTarget = this.editTarget;
    this.emit("inner.before-close", {
      editTarget,
      innerEditor: this.innerEditor,
    });
    this.editTarget = null;
    this.emit("inner.close", { editTarget, innerEditor: this.innerEditor });
    this.innerEditor?.editDom.remove();
    this.innerEditor = null;
  }

  add(child: FakeElement): void {
    this.children.push(child);
  }
}

class FakeApp extends FakeEventTarget {
  readonly tree = new FakeTree();
  readonly sky = new FakeGroup();
  readonly editor = new FakeEditor();
  readonly children: Array<FakeTree | FakeGroup> = [this.tree, this.sky];
  readonly presentationRoots: FakeTree[] = [];
  mode = "normal";
  destroy = vi.fn();

  constructor(config: Record<string, unknown>) {
    super();
    leaferHarness.app = this;
    leaferHarness.appConfig = config;
    const editor = config.editor as
      | {
          beforeEditInner?: FakeEditor["beforeEditInner"];
        }
      | undefined;
    this.editor.beforeEditInner = editor?.beforeEditInner;
  }

  add(root: FakeTree, index = this.children.length): void {
    const current = this.children.indexOf(root);
    if (current >= 0) this.children.splice(current, 1);
    else this.presentationRoots.push(root);
    this.children.splice(index, 0, root);
  }
}

vi.mock("leafer-editor", () => ({
  App: FakeApp,
  Arrow: FakeArrow,
  Bounds: class FakeBounds {
    constructor(
      readonly x: number,
      readonly y: number,
      readonly width: number,
      readonly height: number,
    ) {}
  },
  DragEvent: { START: "drag.start", DRAG: "drag.drag", END: "drag.end" },
  EditorEvent: { SELECT: "editor.select" },
  EditSelectHelper: {
    findByBounds: vi.fn(() => leaferHarness.boxMatches),
  },
  EditorMoveEvent: { BEFORE_MOVE: "editor.before-move", MOVE: "editor.move" },
  EditorRotateEvent: {
    BEFORE_ROTATE: "editor.before-rotate",
    ROTATE: "editor.rotate",
  },
  EditorScaleEvent: {
    BEFORE_SCALE: "editor.before-scale",
    SCALE: "editor.scale",
  },
  EditorSkewEvent: { BEFORE_SKEW: "editor.before-skew", SKEW: "editor.skew" },
  Ellipse: FakeEllipse,
  Frame: FakeFrame,
  Group: FakeGroup,
  Image: FakeImage,
  InnerEditorEvent: {
    BEFORE_OPEN: "inner.before-open",
    OPEN: "inner.open",
    BEFORE_CLOSE: "inner.before-close",
    CLOSE: "inner.close",
  },
  Leafer: FakeTree,
  MoveEvent: { MOVE: "viewport.move", END: "viewport.move-end" },
  Creator: {
    image: vi.fn(),
  },
  PaintImage: {
    recycleImage: vi.fn(() => ({})),
  },
  Path: FakePath,
  PointerEvent: {
    DOWN: "pointer.down",
    MOVE: "pointer.move",
    UP: "pointer.up",
  },
  Polygon: FakePolygon,
  Rect: FakeRect,
  RenderEvent: { CHILD_START: "render.child-start" },
  ResizeEvent: { RESIZE: "viewport.resize" },
  Text: FakeText,
  Star: FakeStar,
  Stroker: FakeStroker,
  UI: FakeElement,
  ZoomEvent: { ZOOM: "viewport.zoom", END: "viewport.zoom-end" },
}));

const animationFrames = new Map<number, FrameRequestCallback>();
let animationFrameSequence = 0;

describe("Leafer engine selection bounds synchronization", () => {
  beforeEach(() => {
    leaferHarness.app = null;
    leaferHarness.appConfig = null;
    leaferHarness.boxMatches = [];
    leaferHarness.elements = [];
    leaferHarness.failNextExport = false;
    leaferHarness.failReconcileCount = 0;
    leaferHarness.failReconcileSetCount = 0;
    leaferHarness.windowListeners.clear();
    leaferHarness.strokers = [];
    animationFrames.clear();
    animationFrameSequence = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++animationFrameSequence;
      animationFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      animationFrames.delete(id);
    });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(
        (type: string, listener: (event: KeyboardEvent) => void) => {
          const listeners =
            leaferHarness.windowListeners.get(type) ?? new Set();
          listeners.add(listener);
          leaferHarness.windowListeners.set(type, listeners);
        },
      ),
      cancelAnimationFrame: (id: number) => animationFrames.delete(id),
      getSelection: () => document.getSelection(),
      removeEventListener: vi.fn(
        (type: string, listener: (event: KeyboardEvent) => void) => {
          leaferHarness.windowListeners.get(type)?.delete(listener);
        },
      ),
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const id = ++animationFrameSequence;
        animationFrames.set(id, callback);
        return id;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses restrained cross-platform wheel zoom bounds", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );

    expect(leaferHarness.appConfig).toMatchObject({
      editor: {
        hover: false,
        selectedPathType: "box",
        selectedStyle: { strokeAlign: "inside" },
      },
      wheel: { zoomSpeed: 0.16 },
      zoom: { min: 0.1, max: 8 },
    });
    adapter.dispose();
  });

  it("clears an opaque Frame surface when the authoritative fills become empty", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const baseInput = createInput();
    const first = {
      ...baseInput,
      document: structuredClone(baseInput.document),
    };
    const parent = first.document.nodesById.frame_welcome;
    if (!parent || parent.kind !== "frame") throw new Error("Missing Frame");
    first.document.nodesById.transparent_region = {
      id: "transparent_region",
      kind: "frame",
      name: "Typography region",
      parentId: parent.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: parent.size.width, height: parent.size.height },
      exportSettings: [],
      opacity: 1,
      properties: {
        fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: false,
      },
      extensions: {},
    };
    parent.childIds.push("transparent_region");
    adapter.sync(first);
    const app = leaferHarness.app;
    const region = app && findElement(app.tree, "transparent_region");
    if (!region) throw new Error("Missing typography region");
    expect((region as FakeElement & { fill?: unknown }).fill).toEqual([
      { type: "solid", color: "#ffffff", opacity: 1, visible: true },
    ]);

    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const transparent = secondDocument.nodesById.transparent_region;
    if (!transparent || transparent.kind !== "frame") {
      throw new Error("Missing transparent typography region");
    }
    transparent.properties.fills = [];
    adapter.sync({
      ...first,
      changes: changedNodeSet(
        first.document,
        secondDocument,
        transparent.id,
        "properties",
      ),
      document: secondDocument,
    });
    expect((region as FakeElement & { fill?: unknown }).fill).toBe(
      "rgba(0, 0, 0, 0)",
    );
    adapter.dispose();
  });

  it("reorders selected Grid tracks from editor-sky controls through one semantic callback", async () => {
    const onGridTrackReorder = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridTrackReorder,
    });
    const input = withGridFixture(createInput());
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const hit = findElement(
      app.sky,
      "__opendesign_grid_track_hit__:frame_welcome:columns:0",
    );
    if (!hit) throw new Error("Missing Grid column track control");
    expect(findElement(app.tree, hit.id!)).toBeUndefined();

    app.emit("pointer.down", pointerEvent(80, -20, hit));
    app.emit("pointer.move", pointerEvent(1_175, 40, app.sky));
    app.emit("pointer.up", pointerEvent(1_175, 40, app.sky));

    expect(onGridTrackReorder).toHaveBeenCalledTimes(1);
    expect(onGridTrackReorder).toHaveBeenCalledWith({
      axis: "columns",
      frameId: "frame_welcome",
      fromIndices: [0],
      insertionIndex: 2,
    });
    adapter.dispose();
  });

  it("cancels Grid track drag on adjacent slots, Escape, or a stale revision", async () => {
    const onGridTrackReorder = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridTrackReorder,
    });
    const input = withGridFixture(createInput());
    adapter.sync(input);
    const app = leaferHarness.app;
    const hit =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:columns:0",
      );
    if (!app || !hit) throw new Error("Missing Grid column track control");

    app.emit("pointer.down", pointerEvent(80, -20, hit));
    app.emit("pointer.up", pointerEvent(140, -20, hit));
    expect(onGridTrackReorder).not.toHaveBeenCalled();

    app.emit("pointer.down", pointerEvent(80, -20, hit));
    app.emit("pointer.move", pointerEvent(1_175, 40, app.sky));
    emitWindowKey("Escape");
    app.emit("pointer.up", pointerEvent(1_175, 40, app.sky));
    expect(onGridTrackReorder).not.toHaveBeenCalled();

    app.emit("pointer.down", pointerEvent(80, -20, hit));
    const changed = structuredClone(input);
    changed.document.revision += 1;
    adapter.sync(changed);
    app.emit("pointer.up", pointerEvent(1_175, 40, app.sky));
    expect(onGridTrackReorder).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("selects a Grid track first and opens its exact sizing request on the next click", async () => {
    const onGridTrackInputRequest = vi.fn();
    const onGridTrackReorder = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridTrackInputRequest,
      onGridTrackReorder,
    });
    const input = withGridFixture(createInput());
    adapter.sync(input);
    const app = leaferHarness.app;
    const hit =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:columns:1",
      );
    if (!app || !hit) throw new Error("Missing Grid column track label");

    app.emit("pointer.down", pointerEvent(666, -20, hit));
    app.emit("pointer.up", pointerEvent(666, -20, hit));

    expect(onGridTrackReorder).not.toHaveBeenCalled();
    expect(onGridTrackInputRequest).not.toHaveBeenCalled();
    app.emit("pointer.down", pointerEvent(666, -20, hit));
    app.emit("pointer.up", pointerEvent(666, -20, hit));
    expect(onGridTrackInputRequest).toHaveBeenCalledOnce();
    expect(onGridTrackInputRequest).toHaveBeenCalledWith({
      axis: "columns",
      clientPoint: { x: 666, y: -20 },
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      tracks: [
        {
          index: 1,
          resolvedSize: 1_028,
          track: { type: "fill", value: 1 },
        },
      ],
    });
    adapter.dispose();
  });

  it("selects multiple Grid tracks with platform and range modifiers before opening one mixed input", async () => {
    const onGridTrackInputRequest = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridTrackInputRequest,
    });
    const input = withGridFixture(createInput());
    adapter.sync(input);
    const app = leaferHarness.app;
    const first =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:columns:0",
      );
    const second =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:columns:1",
      );
    const firstPill =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_pill__:frame_welcome:columns:0",
      );
    const secondPill =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_pill__:frame_welcome:columns:1",
      );
    if (!app || !first || !second || !firstPill || !secondPill)
      throw new Error("Missing Grid multi-selection controls");

    app.emit("pointer.down", pointerEvent(80, -20, first, { metaKey: true }));
    app.emit("pointer.up", pointerEvent(80, -20, first, { metaKey: true }));
    app.emit(
      "pointer.down",
      pointerEvent(666, -20, second, { shiftKey: true }),
    );
    app.emit("pointer.up", pointerEvent(666, -20, second, { shiftKey: true }));
    expect(onGridTrackInputRequest).not.toHaveBeenCalled();
    expect((firstPill as FakeElement & { stroke?: unknown }).stroke).toBe(
      "#ffffff",
    );
    expect((secondPill as FakeElement & { stroke?: unknown }).stroke).toBe(
      "#ffffff",
    );

    app.emit("pointer.down", pointerEvent(666, -20, second));
    app.emit("pointer.up", pointerEvent(666, -20, second));
    expect(onGridTrackInputRequest).toHaveBeenCalledWith({
      axis: "columns",
      clientPoint: { x: 666, y: -20 },
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      tracks: [
        {
          index: 0,
          resolvedSize: 120,
          track: { type: "fixed", value: 120 },
        },
        {
          index: 1,
          resolvedSize: 1_028,
          track: { type: "fill", value: 1 },
        },
      ],
    });
    const changed = structuredClone(input);
    changed.document.revision += 1;
    adapter.sync(changed);
    expect(
      (firstPill as FakeElement & { strokeWidth?: unknown }).strokeWidth,
    ).toBe(0);
    adapter.dispose();
  });

  it("routes Delete and Backspace for the selected Grid tracks without deleting the Frame", async () => {
    const onGridTrackDelete = vi.fn(() => true);
    const onOperations = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridTrackDelete,
      onOperations,
    });
    const input = withGridFixture(createInput());
    const frame = input.document.nodesById.frame_welcome;
    const grid =
      frame?.kind === "frame" ? frame.properties.autoLayout : undefined;
    if (!grid || grid.mode !== "grid") throw new Error("Missing Grid fixture");
    grid.columns.push({ type: "fixed", value: 80 });
    adapter.sync(input);
    const app = leaferHarness.app;
    const first =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:columns:0",
      );
    const second =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:columns:1",
      );
    if (!app || !first || !second)
      throw new Error("Missing Grid delete controls");

    app.emit("pointer.down", pointerEvent(80, -20, first));
    app.emit("pointer.up", pointerEvent(80, -20, first));
    const backspace = emitWindowKey("Backspace");

    expect(backspace.preventDefault).toHaveBeenCalledOnce();
    expect(backspace.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(onGridTrackDelete).toHaveBeenLastCalledWith({
      axis: "columns",
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      indices: [0],
    });

    app.emit("pointer.down", pointerEvent(620, -20, second, { metaKey: true }));
    app.emit("pointer.up", pointerEvent(620, -20, second, { metaKey: true }));
    const deleteKey = emitWindowKey("Delete");

    expect(deleteKey.preventDefault).toHaveBeenCalledOnce();
    expect(deleteKey.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(onGridTrackDelete).toHaveBeenLastCalledWith({
      axis: "columns",
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      indices: [0, 1],
    });
    expect(onOperations).not.toHaveBeenCalled();

    const changed = structuredClone(input);
    changed.document.revision += 1;
    adapter.sync(changed);
    emitWindowKey("Delete");
    expect(onGridTrackDelete).toHaveBeenCalledTimes(2);
    adapter.dispose();
  });

  it("does not expose invalid direct controls for generated automatic Grid rows", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const input = withGridFixture(createInput());
    const frame = input.document.nodesById.frame_welcome;
    const grid =
      frame?.kind === "frame" ? frame.properties.autoLayout : undefined;
    if (!grid || grid.mode !== "grid") throw new Error("Missing Grid fixture");
    grid.autoTracks = "rows";
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Missing Leafer app");

    expect(
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:rows:0",
      ),
    ).toBeUndefined();
    expect(
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:columns:0",
      ),
    ).toBeDefined();
    adapter.dispose();
  });

  it("virtualizes large Grid controls across pan while pinning an active drag", async () => {
    const input = withGridFixture(createInput());
    const frame = input.document.nodesById.frame_welcome;
    const grid =
      frame?.kind === "frame" ? frame.properties.autoLayout : undefined;
    if (frame?.kind !== "frame" || !grid || grid.mode !== "grid") {
      throw new Error("Missing large Grid fixture");
    }
    grid.columns = Array.from({ length: 1_024 }, () => ({
      type: "fixed" as const,
      value: 100,
    }));
    frame.size.width = 114_688;
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    adapter.sync(input);
    const app = leaferHarness.app;
    const prefix = "__opendesign_grid_track_hit__:frame_welcome:";
    const first =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:columns:0",
      );
    if (!app || !first) throw new Error("Missing first virtual Grid control");
    expect(findElementIds(app.sky, prefix).length).toBeLessThan(64);

    app.emit("pointer.down", pointerEvent(70, -20, first));
    const panned = {
      ...input,
      viewport: { ...input.viewport, panX: -56_000 },
    };
    adapter.sync(panned);
    expect(findElement(app.sky, first.id!)).toBe(first);
    expect(first.destroy).not.toHaveBeenCalled();
    expect(
      findElementIds(app.sky, prefix).some((id) => /:columns:5\d\d$/.test(id)),
    ).toBe(true);
    expect(findElementIds(app.sky, prefix).length).toBeLessThan(64);

    emitWindowKey("Escape");
    expect(findElement(app.sky, first.id!)).toBeUndefined();
    expect(first.destroy).toHaveBeenCalledOnce();
    adapter.dispose();
  });

  it("reorders the selected Grid track set through the existing semantic callback", async () => {
    const onGridTrackReorder = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridTrackReorder,
    });
    const input = withGridFixture(createInput());
    const frame = input.document.nodesById.frame_welcome;
    const grid =
      frame?.kind === "frame" ? frame.properties.autoLayout : undefined;
    if (!grid || grid.mode !== "grid") throw new Error("Missing Grid fixture");
    grid.columns.push({ type: "fixed", value: 80 });
    adapter.sync(input);
    const app = leaferHarness.app;
    const first =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:columns:0",
      );
    const second =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_hit__:frame_welcome:columns:1",
      );
    if (!app || !first || !second)
      throw new Error("Missing Grid multi-reorder controls");

    app.emit("pointer.down", pointerEvent(80, -20, first, { ctrlKey: true }));
    app.emit("pointer.up", pointerEvent(80, -20, first, { ctrlKey: true }));
    app.emit("pointer.down", pointerEvent(620, -20, second, { ctrlKey: true }));
    app.emit("pointer.up", pointerEvent(620, -20, second, { ctrlKey: true }));
    app.emit("pointer.down", pointerEvent(620, -20, second));
    app.emit("pointer.move", pointerEvent(1_175, 40, app.sky));
    app.emit("pointer.up", pointerEvent(1_175, 40, app.sky));

    expect(onGridTrackReorder).toHaveBeenCalledWith({
      axis: "columns",
      frameId: "frame_welcome",
      fromIndices: [0, 1],
      insertionIndex: 3,
    });
    adapter.dispose();
  });

  it("resizes a Grid track edge through one exact-revision semantic callback", async () => {
    const onGridTrackResize = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridTrackResize,
    });
    const input = withGridFixture(createInput());
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const hit = findElement(
      app.sky,
      "__opendesign_grid_track_resize_hit__:frame_welcome:columns:0",
    );
    if (!hit) throw new Error("Missing Grid column resize edge");
    expect(findElement(app.tree, hit.id!)).toBeUndefined();

    app.emit("pointer.down", pointerEvent(140, 80, hit));
    app.emit("pointer.move", pointerEvent(220, 80, app.sky));
    app.emit("pointer.up", pointerEvent(220, 80, app.sky));

    expect(onGridTrackResize).toHaveBeenCalledTimes(1);
    expect(onGridTrackResize).toHaveBeenCalledWith({
      axis: "columns",
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      index: 0,
      value: 200,
    });

    adapter.sync({
      ...input,
      viewport: { ...input.viewport, zoom: 2 },
    });
    expect(hit.width).toBe(4);
    const rowHit = findElement(
      app.sky,
      "__opendesign_grid_track_resize_hit__:frame_welcome:rows:0",
    );
    if (!rowHit) throw new Error("Missing Grid row resize edge");
    expect(rowHit.height).toBe(4);
    app.emit("pointer.down", pointerEvent(80, 116, rowHit));
    app.emit("pointer.move", pointerEvent(80, 166, app.sky));
    app.emit("pointer.up", pointerEvent(80, 166, app.sky));
    expect(onGridTrackResize).toHaveBeenCalledTimes(2);
    expect(onGridTrackResize).toHaveBeenLastCalledWith({
      axis: "rows",
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      index: 0,
      value: 150,
    });
    adapter.dispose();
  });

  it("does not resize a Grid track on click, Escape, pointer cancel, or stale revision", async () => {
    const onGridTrackResize = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridTrackResize,
    });
    const input = withGridFixture(createInput());
    adapter.sync(input);
    const app = leaferHarness.app;
    const hit =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_resize_hit__:frame_welcome:rows:0",
      );
    if (!app || !hit) throw new Error("Missing Grid row resize edge");

    app.emit("pointer.down", pointerEvent(80, 116, hit));
    app.emit("pointer.up", pointerEvent(80, 116, hit));
    expect(onGridTrackResize).not.toHaveBeenCalled();

    app.emit("pointer.down", pointerEvent(80, 116, hit));
    app.emit("pointer.move", pointerEvent(80, 180, app.sky));
    emitWindowKey("Escape");
    app.emit("pointer.up", pointerEvent(80, 180, app.sky));
    expect(onGridTrackResize).not.toHaveBeenCalled();

    app.emit("pointer.down", pointerEvent(80, 116, hit));
    app.emit("pointer.move", {
      ...pointerEvent(80, 180, app.sky),
      isCancel: true,
    });
    app.emit("pointer.up", pointerEvent(80, 180, app.sky));
    expect(onGridTrackResize).not.toHaveBeenCalled();

    app.emit("pointer.down", pointerEvent(80, 116, hit));
    const changed = structuredClone(input);
    changed.document.revision += 1;
    adapter.sync(changed);
    app.emit("pointer.up", pointerEvent(80, 180, app.sky));
    expect(onGridTrackResize).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("keeps rotated Grid track, cell, and span interactions in Frame-local coordinates", async () => {
    const onGridTrackResize = vi.fn(() => true);
    const onGridChildMove = vi.fn(() => true);
    const onGridChildSpan = vi.fn(() => true);
    const input = withGridChildFixture(createInput());
    const frame = input.document.nodesById.frame_welcome;
    const source = input.document.nodesById.feature_one;
    if (frame?.kind !== "frame" || !source) {
      throw new Error("Missing rotated Grid fixture");
    }
    frame.transform = [0, 1, -1, 0, 600, 40];
    source.layoutSizing = { horizontal: "fill", vertical: "fixed" };
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridChildMove,
      onGridChildSpan,
      onGridTrackResize,
    });
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const resizeHit =
      app &&
      findElement(
        app.sky,
        "__opendesign_grid_track_resize_hit__:frame_welcome:columns:0",
      );
    const child = app && findElement(app.tree, "feature_one");
    const drop = app && findElement(app.sky, "__opendesign_grid_child_drop__");
    if (!app || !resizeHit || !child || !drop || !resizeHit.parent) {
      throw new Error("Missing rotated Grid controls");
    }
    expect(resizeHit.parent.localTransform).toMatchObject({
      a: 0,
      b: 1,
      c: -1,
      d: 0,
      e: 600,
      f: 40,
    });
    expect((resizeHit as FakeElement & { cursor?: string }).cursor).toBe(
      "row-resize",
    );

    app.emit("pointer.down", pointerEvent(140, 80, resizeHit));
    app.emit("pointer.move", pointerEvent(220, 80, app.sky));
    app.emit("pointer.up", pointerEvent(220, 80, app.sky));
    expect(onGridTrackResize).toHaveBeenCalledWith({
      axis: "columns",
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      index: 0,
      value: 200,
    });

    app.editor.target = [child];
    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    child.localTransform.e = 700;
    app.editor.emit("editor.move");
    expect(drop.visible).toBe(true);
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");
    expect(onGridChildMove).toHaveBeenCalledWith({
      anchorNodeId: "feature_one",
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      nodeIds: ["feature_one"],
      target: { row: 0, column: 1 },
    });

    app.editor.moving = false;
    app.editor.resizing = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-scale");
    child.width = 1_180 - child.localTransform.e;
    app.editor.emit("editor.scale");
    expect(drop.visible).toBe(true);
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");
    expect(onGridChildSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: input.document.revision,
        frameId: "frame_welcome",
        nodeId: "feature_one",
        target: { row: 0, column: 0, rowSpan: 1, columnSpan: 2 },
      }),
    );
    adapter.dispose();
  });

  it("previews and commits a selected Grid child move as one exact-revision semantic request", async () => {
    const onGridChildMove = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridChildMove,
    });
    const input = withGridChildFixture(createInput());
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const child = app && findElement(app.tree, "feature_one");
    const drop = app && findElement(app.sky, "__opendesign_grid_child_drop__");
    if (!app || !child || !drop) throw new Error("Missing Grid child fixture");

    app.editor.target = [child];
    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    child.localTransform.e = 700;
    app.editor.emit("editor.move");

    expect(drop.visible).toBe(true);
    expect(drop.x).toBe(152);
    expect(drop.width).toBe(1_028);
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(drop.visible).toBe(false);
    expect(onGridChildMove).toHaveBeenCalledOnce();
    expect(onGridChildMove).toHaveBeenCalledWith({
      anchorNodeId: "feature_one",
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      nodeIds: ["feature_one"],
      target: { row: 0, column: 1 },
    });
    adapter.dispose();
  });

  it("cancels a Grid child move on Escape without leaking preview or transform writes", async () => {
    const onGridChildMove = vi.fn(() => true);
    const onOperations = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridChildMove,
      onOperations,
    });
    const input = withGridChildFixture(createInput());
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const child = app && findElement(app.tree, "feature_one");
    const drop = app && findElement(app.sky, "__opendesign_grid_child_drop__");
    if (!app || !child || !drop) throw new Error("Missing Grid child fixture");
    const authoritativeX = child.localTransform.e;

    app.editor.target = [child];
    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    child.localTransform.e = 700;
    app.editor.emit("editor.move");
    emitWindowKey("Escape");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(drop.visible).toBe(false);
    expect(child.localTransform.e).toBe(authoritativeX);
    expect(onGridChildMove).not.toHaveBeenCalled();
    expect(onOperations).not.toHaveBeenCalled();

    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    child.localTransform.e = 700;
    app.editor.emit("editor.move");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end", { isCancel: true });
    expect(drop.visible).toBe(false);
    expect(child.localTransform.e).toBe(authoritativeX);
    expect(onGridChildMove).not.toHaveBeenCalled();
    expect(onOperations).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("keeps a spanning Grid anchor in its origin cell during a slight drag", async () => {
    const onGridChildMove = vi.fn(() => true);
    const input = withGridChildFixture(createInput());
    const first = input.document.nodesById.feature_one;
    const second = input.document.nodesById.feature_two;
    if (!first?.gridPlacement || !second?.gridPlacement) {
      throw new Error("Missing spanning Grid fixture");
    }
    first.gridPlacement.columnSpan = 2;
    first.layoutSizing = { horizontal: "fill", vertical: "fixed" };
    second.gridPlacement = { ...second.gridPlacement, row: 1, column: 0 };
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridChildMove,
    });
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const child = app && findElement(app.tree, "feature_one");
    if (!app || !child) throw new Error("Missing spanning Grid child");
    const authoritativeX = child.localTransform.e;

    app.editor.target = [child];
    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    child.localTransform.e += 1;
    app.editor.emit("editor.move");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(onGridChildMove).not.toHaveBeenCalled();
    expect(child.localTransform.e).toBe(authoritativeX);
    adapter.dispose();
  });

  it("keeps ordinary Grid Frame movement active while its track editor is visible", async () => {
    const onOperations = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    const input = withGridFixture(createInput());
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const frame = app && findElement(app.tree, "frame_welcome");
    if (!app || !frame) throw new Error("Missing Grid Frame fixture");
    const before = { ...frame.localTransform };
    const targetX = frame.localTransform.e + 48;

    app.editor.target = [frame];
    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    frame.localTransform.e = targetX;
    app.editor.emit("editor.move");
    adapter.sync(input);
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(onOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "move",
        selectionNodeIds: ["frame_welcome"],
        operations: [
          expect.objectContaining({
            nodeId: "frame_welcome",
            transform: [
              before.a,
              before.b,
              before.c,
              before.d,
              targetX,
              before.f,
            ],
          }),
        ],
      }),
    );
    adapter.dispose();
  });

  it("snaps Fill Grid child resize to a semantic span while preserving a fixed counter-axis size", async () => {
    const onGridChildSpan = vi.fn(() => true);
    const input = withGridChildFixture(createInput());
    const source = input.document.nodesById.feature_one;
    if (!source) throw new Error("Missing Grid child source");
    source.layoutSizing = { horizontal: "fill", vertical: "fixed" };
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridChildSpan,
    });
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const child = app && findElement(app.tree, "feature_one");
    const drop = app && findElement(app.sky, "__opendesign_grid_child_drop__");
    if (!app || !child || !drop) throw new Error("Missing Grid span fixture");

    app.editor.target = [child];
    app.editor.resizing = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-scale");
    const resizedSize = {
      width: 1_180 - child.localTransform.e,
      height: Number(child.height) + 40,
    };
    child.width = resizedSize.width;
    child.height = resizedSize.height;
    app.editor.emit("editor.scale");

    expect(drop.visible).toBe(true);
    expect(drop.x).toBe(20);
    expect(drop.width).toBe(1_160);
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(drop.visible).toBe(false);
    expect(onGridChildSpan).toHaveBeenCalledWith({
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      nodeId: "feature_one",
      size: resizedSize,
      target: { row: 0, column: 0, rowSpan: 1, columnSpan: 2 },
    });

    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-scale");
    child.width = 1_180 - child.localTransform.e;
    app.editor.emit("editor.scale");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end", { isCancel: true });
    expect(drop.visible).toBe(false);
    expect(onGridChildSpan).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("keeps a fixed Grid child axis resizable when the Fill axis stays in the same span", async () => {
    const onGridChildSpan = vi.fn(() => true);
    const onOperations = vi.fn(() => true);
    const input = withGridChildFixture(createInput());
    const source = input.document.nodesById.feature_one;
    if (!source) throw new Error("Missing Grid child source");
    source.layoutSizing = { horizontal: "fill", vertical: "fixed" };
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridChildSpan,
      onOperations,
    });
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const child = app && findElement(app.tree, "feature_one");
    if (!app || !child) throw new Error("Missing Grid child fixture");
    const currentWidth = Number(child.width);
    const nextHeight = Number(child.height) + 40;

    app.editor.target = [child];
    app.editor.resizing = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-scale");
    child.height = nextHeight;
    app.editor.emit("editor.scale");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(onGridChildSpan).toHaveBeenCalledWith({
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      nodeId: "feature_one",
      size: { width: currentWidth, height: nextHeight },
      target: { row: 0, column: 0, rowSpan: 1, columnSpan: 1 },
    });
    expect(onOperations).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("does not commit the previous valid Grid span when the final resize target is invalid", async () => {
    const onGridChildSpan = vi.fn(() => true);
    const input = withGridChildFixture(createInput());
    const frame = input.document.nodesById.frame_welcome;
    const source = input.document.nodesById.feature_one;
    if (frame?.kind !== "frame" || !source) {
      throw new Error("Missing Grid fixture");
    }
    const grid = frame.properties.autoLayout;
    if (!grid || grid.mode !== "grid") throw new Error("Missing Grid");
    grid.itemsPositioning = "row-auto-flow";
    source.layoutSizing = { horizontal: "fill", vertical: "fixed" };
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridChildSpan,
    });
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const child = app && findElement(app.tree, "feature_one");
    const drop = app && findElement(app.sky, "__opendesign_grid_child_drop__");
    if (!app || !child || !drop) throw new Error("Missing Grid child fixture");

    app.editor.target = [child];
    app.editor.resizing = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-scale");
    child.width = 1_180 - child.localTransform.e;
    app.editor.emit("editor.scale");
    expect(drop.visible).toBe(true);

    child.localTransform.e = 152;
    child.width = 1_028;
    app.editor.emit("editor.scale");
    expect(drop.visible).toBe(false);
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(onGridChildSpan).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("uses transformed visual bounds when scale-based Grid children resize", async () => {
    const onGridChildSpan = vi.fn<
      (request: LeaferGridChildSpanRequest) => boolean
    >(() => true);
    const input = withGridChildFixture(createInput());
    const source = input.document.nodesById.feature_one;
    if (!source) throw new Error("Missing Grid child source");
    source.layoutSizing = { horizontal: "fill", vertical: "fixed" };
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridChildSpan,
    });
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const child = app && findElement(app.tree, "feature_one");
    if (!app || !child) throw new Error("Missing Grid child fixture");
    const baseWidth = Number(child.width);

    app.editor.target = [child];
    app.editor.resizing = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-scale");
    child.localTransform.a = 1_180 / baseWidth;
    app.editor.emit("editor.scale");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    const request = onGridChildSpan.mock.calls[0]?.[0];
    expect(request?.size?.width).toBeCloseTo(1_180, 3);
    expect(request?.target).toEqual({
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 2,
    });
    adapter.dispose();
  });

  it("preserves a Line fixed counter-axis resize through the Grid span semantic callback", async () => {
    const onGridChildSpan = vi.fn(() => true);
    const input = withGridLineFixture(createInput());
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onGridChildSpan,
    });
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const line = app && findElement(app.tree, "flow_line");
    if (!app || !(line instanceof FakeArrow)) {
      throw new Error("Missing Grid Line fixture");
    }

    app.editor.target = [line];
    app.editor.resizing = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-scale");
    line.points = [0, 0, 100, 40];
    app.editor.emit("editor.scale");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(onGridChildSpan).toHaveBeenCalledWith({
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      nodeId: "flow_line",
      size: { width: 100, height: 40 },
      target: { row: 0, column: 0, rowSpan: 1, columnSpan: 1 },
    });
    adapter.dispose();
  });

  it("commits selected Auto Layout padding and gap canvas drags as semantic exact-revision requests", async () => {
    const onAutoLayoutSpacingCommit = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onAutoLayoutSpacingCommit,
    });
    const input = withAutoLayoutSpacingFixture(createInput());
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const paddingHit = findElement(
      app.sky,
      "__opendesign_auto_layout_spacing_hit__:frame_welcome:padding-left",
    );
    const gapHit = findElement(
      app.sky,
      "__opendesign_auto_layout_spacing_hit__:frame_welcome:gap:flow:0",
    );
    if (!paddingHit || !gapHit) throw new Error("Missing spacing controls");
    expect(findElement(app.tree, paddingHit.id!)).toBeUndefined();

    app.emit(
      "pointer.down",
      pointerEvent(12, 80, paddingHit, { altKey: true, shiftKey: true }),
    );
    app.emit(
      "pointer.move",
      pointerEvent(28, 80, paddingHit, { altKey: true, shiftKey: true }),
    );
    app.emit(
      "pointer.up",
      pointerEvent(28, 80, paddingHit, { altKey: true, shiftKey: true }),
    );
    expect(onAutoLayoutSpacingCommit).toHaveBeenLastCalledWith({
      change: {
        kind: "padding",
        value: { top: 40, right: 40, bottom: 40, left: 40 },
      },
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
    });

    app.emit("pointer.down", pointerEvent(130, 50, gapHit));
    app.emit("pointer.move", pointerEvent(138, 50, gapHit, { shiftKey: true }));
    app.emit("pointer.up", pointerEvent(138, 50, gapHit, { shiftKey: true }));
    expect(onAutoLayoutSpacingCommit).toHaveBeenLastCalledWith({
      change: { kind: "gap", value: 20 },
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
    });
    expect(onAutoLayoutSpacingCommit).toHaveBeenCalledTimes(2);
    adapter.dispose();
  });

  it("previews and commits Smart Selection spacing through one semantic request", async () => {
    const onSmartSelectionSpacing = vi.fn(() => true);
    const input = withSmartSelectionFixture(createInput());
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onSmartSelectionSpacing,
    });
    adapter.sync(input);
    const app = leaferHarness.app;
    const hit =
      app &&
      findElement(
        app.sky,
        "__opendesign_smart_selection_gap__:smart-gap:horizontal:row-0:0",
      );
    const ring =
      app &&
      findElement(
        app.sky,
        "__opendesign_smart_selection_ring__:smart-ring:feature_one",
      );
    const second = app && findElement(app.tree, "feature_two");
    if (!app || !hit || !ring || !second) {
      throw new Error("Missing Smart Selection controls");
    }
    adapter.sync({
      ...input,
      selection: {
        ...input.selection,
        nodeIds: ["feature_three", "feature_one", "feature_two"],
      },
    });
    expect(
      findElement(
        app.sky,
        "__opendesign_smart_selection_gap__:smart-gap:horizontal:row-0:0",
      ),
    ).toBe(hit);
    expect(ring.opacity).toBe(0.72);
    const authoritativeX = second.localTransform.e;

    app.emit("pointer.move", pointerEvent(414, 454, app.sky));
    expect(ring.opacity).toBe(1);
    app.emit("pointer.down", pointerEvent(414, 454, hit));
    app.emit("pointer.move", pointerEvent(434, 454, app.sky));
    expect(second.localTransform.e).toBe(authoritativeX + 20);
    app.emit("pointer.up", pointerEvent(434, 454, app.sky));

    expect(second.localTransform.e).toBe(authoritativeX);
    expect(onSmartSelectionSpacing).toHaveBeenCalledWith({
      axis: "horizontal",
      documentId: input.document.documentId,
      expectedRevision: input.document.revision,
      nodeIds: ["feature_one", "feature_two", "feature_three"],
      pageId: input.pageId,
      spacing: 40,
    });
    adapter.dispose();
  });

  it("marks Smart Selection rings and reorders a one-dimensional selection with real preview", async () => {
    const onSmartSelectionReorder = vi.fn(() => true);
    const input = withSmartSelectionFixture(createInput());
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onSmartSelectionReorder,
    });
    adapter.sync(input);
    const app = leaferHarness.app;
    const firstRing =
      app &&
      findElement(
        app.sky,
        "__opendesign_smart_selection_ring__:smart-ring:feature_one",
      );
    const secondRing =
      app &&
      findElement(
        app.sky,
        "__opendesign_smart_selection_ring__:smart-ring:feature_two",
      );
    const insertion =
      app && findElement(app.sky, "__opendesign_smart_selection_insertion__");
    const first = app && findElement(app.tree, "feature_one");
    const second = app && findElement(app.tree, "feature_two");
    const third = app && findElement(app.tree, "feature_three");
    if (
      !app ||
      !firstRing ||
      !secondRing ||
      !insertion ||
      !first ||
      !second ||
      !third
    ) {
      throw new Error("Missing Smart Selection reorder controls");
    }
    const before = [
      first.localTransform.e,
      second.localTransform.e,
      third.localTransform.e,
    ];

    app.emit("pointer.down", pointerEvent(274, 454, firstRing));
    app.emit("pointer.up", pointerEvent(274, 454, firstRing));
    expect(firstRing).toMatchObject({ fill: "#f24e8a" });
    expect(onSmartSelectionReorder).not.toHaveBeenCalled();

    app.emit(
      "pointer.down",
      pointerEvent(554, 454, secondRing, { shiftKey: true }),
    );
    app.emit(
      "pointer.up",
      pointerEvent(554, 454, secondRing, { shiftKey: true }),
    );
    expect(secondRing).toMatchObject({ fill: "#f24e8a" });

    app.emit("pointer.down", pointerEvent(274, 454, firstRing));
    app.emit("pointer.move", pointerEvent(1_000, 454, app.sky));
    expect(insertion.visible).toBe(true);
    expect(first.localTransform.e).toBe(before[0]! + 280);
    expect(second.localTransform.e).toBe(before[1]! + 280);
    expect(third.localTransform.e).toBe(before[2]! - 560);
    app.emit("pointer.up", pointerEvent(1_000, 454, app.sky));

    expect(first.localTransform.e).toBe(before[0]);
    expect(second.localTransform.e).toBe(before[1]);
    expect(third.localTransform.e).toBe(before[2]);
    expect(insertion.visible).toBe(false);
    expect(onSmartSelectionReorder).toHaveBeenCalledWith({
      documentId: input.document.documentId,
      expectedRevision: input.document.revision,
      insertionIndex: 1,
      kind: "linear",
      movedNodeIds: ["feature_one", "feature_two"],
      nodeIds: ["feature_one", "feature_two", "feature_three"],
      pageId: input.pageId,
    });

    app.emit("pointer.down", pointerEvent(274, 454, firstRing));
    app.emit("pointer.move", pointerEvent(1_000, 454, app.sky));
    const changed = structuredClone(input);
    changed.document.revision += 1;
    adapter.sync(changed);
    expect(first.localTransform.e).toBe(before[0]);
    expect(second.localTransform.e).toBe(before[1]);
    expect(third.localTransform.e).toBe(before[2]);
    expect(onSmartSelectionReorder).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("rearranges or swaps one layer in a two-dimensional Smart Selection", async () => {
    const onSmartSelectionReorder = vi.fn(() => true);
    const input = withSmartGridFixture(createInput());
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onSmartSelectionReorder,
    });
    adapter.sync(input);
    const app = leaferHarness.app;
    const ringA =
      app &&
      findElement(app.sky, "__opendesign_smart_selection_ring__:smart-ring:a");
    const itemA = app && findElement(app.tree, "a");
    const itemE = app && findElement(app.tree, "e");
    const target =
      app && findElement(app.sky, "__opendesign_smart_selection_insertion__");
    if (!app || !ringA || !itemA || !itemE || !target) {
      throw new Error("Missing two-dimensional Smart Selection controls");
    }
    const beforeA = { ...itemA.localTransform };
    const beforeE = { ...itemE.localTransform };

    app.emit("pointer.down", pointerEvent(159, 414, ringA));
    app.emit("pointer.move", pointerEvent(209, 484, app.sky));
    expect(target.visible).toBe(true);
    expect(itemA.localTransform.f).toBe(beforeA.f + 80);
    expect(itemE.localTransform.e).toBe(beforeE.e + 10);
    app.emit("pointer.up", pointerEvent(209, 484, app.sky));
    expect(itemA.localTransform).toEqual(beforeA);
    expect(itemE.localTransform).toEqual(beforeE);
    expect(onSmartSelectionReorder).toHaveBeenLastCalledWith({
      documentId: input.document.documentId,
      expectedRevision: input.document.revision,
      kind: "grid",
      mode: "insert",
      movedNodeId: "a",
      nodeIds: ["a", "b", "c", "d", "e", "f"],
      pageId: input.pageId,
      targetNodeId: "e",
    });

    app.emit("pointer.down", pointerEvent(159, 414, ringA));
    app.emit(
      "pointer.move",
      pointerEvent(209, 484, app.sky, { ctrlKey: true }),
    );
    app.emit("pointer.up", pointerEvent(209, 484, app.sky, { ctrlKey: true }));
    expect(onSmartSelectionReorder).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "grid", mode: "swap" }),
    );
    adapter.dispose();
  });

  it("restores Smart Selection previews on negative no-op, Escape, pointer cancel, or stale revision", async () => {
    const onSmartSelectionSpacing = vi.fn(() => true);
    const input = withSmartSelectionFixture(createInput());
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onSmartSelectionSpacing,
    });
    adapter.sync(input);
    const app = leaferHarness.app;
    const hit =
      app &&
      findElement(
        app.sky,
        "__opendesign_smart_selection_gap__:smart-gap:horizontal:row-0:0",
      );
    const second = app && findElement(app.tree, "feature_two");
    if (!app || !hit || !second) {
      throw new Error("Missing Smart Selection controls");
    }
    const authoritativeX = second.localTransform.e;

    app.emit("pointer.down", pointerEvent(414, 454, hit));
    app.emit("pointer.move", pointerEvent(384, 454, app.sky));
    expect(second.localTransform.e).toBe(authoritativeX - 30);
    emitWindowKey("Escape");
    expect(second.localTransform.e).toBe(authoritativeX);

    app.emit("pointer.down", pointerEvent(414, 454, hit));
    app.emit("pointer.move", pointerEvent(444, 454, app.sky));
    app.emit("pointer.up", {
      ...pointerEvent(444, 454, app.sky),
      isCancel: true,
    });
    expect(second.localTransform.e).toBe(authoritativeX);

    app.emit("pointer.down", pointerEvent(414, 454, hit));
    app.emit("pointer.move", pointerEvent(444, 454, app.sky));
    const changed = structuredClone(input);
    changed.document.revision += 1;
    adapter.sync(changed);
    expect(second.localTransform.e).toBe(authoritativeX);
    expect(onSmartSelectionSpacing).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("requests one numeric input for an Auto Layout spacing handle click", async () => {
    const onAutoLayoutSpacingCommit = vi.fn(() => true);
    const onAutoLayoutSpacingInputRequest = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onAutoLayoutSpacingCommit,
      onAutoLayoutSpacingInputRequest,
    });
    const input = withAutoLayoutSpacingFixture(createInput());
    adapter.sync(input);
    const app = leaferHarness.app;
    const hit =
      app &&
      findElement(
        app.sky,
        "__opendesign_auto_layout_spacing_hit__:frame_welcome:padding-left",
      );
    if (!app || !hit) throw new Error("Missing padding control");

    app.emit(
      "pointer.down",
      pointerEvent(12, 80, hit, { altKey: true, shiftKey: true }),
    );
    app.emit(
      "pointer.up",
      pointerEvent(12, 80, hit, { altKey: true, shiftKey: true }),
    );

    expect(onAutoLayoutSpacingInputRequest).toHaveBeenCalledOnce();
    expect(onAutoLayoutSpacingInputRequest).toHaveBeenCalledWith({
      clientPoint: { x: 12, y: 80 },
      expectedRevision: input.document.revision,
      frameId: "frame_welcome",
      kind: "padding-left",
      padding: { top: 16, right: 24, bottom: 20, left: 24 },
      paddingScope: "all",
      value: 24,
    });
    expect(onAutoLayoutSpacingCommit).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("cancels Auto Layout spacing drags on no-op, Escape, or a stale revision", async () => {
    const onAutoLayoutSpacingCommit = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onAutoLayoutSpacingCommit,
    });
    const input = withAutoLayoutSpacingFixture(createInput());
    adapter.sync(input);
    const app = leaferHarness.app;
    const hit =
      app &&
      findElement(
        app.sky,
        "__opendesign_auto_layout_spacing_hit__:frame_welcome:padding-left",
      );
    if (!app || !hit) throw new Error("Missing padding control");

    app.emit("pointer.down", pointerEvent(12, 80, hit));
    app.emit("pointer.up", pointerEvent(12, 80, hit));
    expect(onAutoLayoutSpacingCommit).not.toHaveBeenCalled();

    app.emit("pointer.down", pointerEvent(12, 80, hit));
    app.emit("pointer.move", pointerEvent(30, 80, hit));
    emitWindowKey("Escape");
    app.emit("pointer.up", pointerEvent(30, 80, hit));
    expect(onAutoLayoutSpacingCommit).not.toHaveBeenCalled();

    app.emit("pointer.down", pointerEvent(12, 80, hit));
    app.emit("pointer.move", pointerEvent(30, 80, hit));
    const changed = structuredClone(input);
    changed.document.revision += 1;
    adapter.sync(changed);
    app.emit("pointer.up", pointerEvent(30, 80, hit));
    expect(onAutoLayoutSpacingCommit).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("stages direct image crop movement and commits one crop placement", async () => {
    const onImageCropCommit = vi.fn<
      NonNullable<LeaferEngineCallbacks["onImageCropCommit"]>
    >(() => true);
    const onImageCropStateChange =
      vi.fn<NonNullable<LeaferEngineCallbacks["onImageCropStateChange"]>>();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onImageCropCommit,
      onImageCropStateChange,
    });
    const input = withImageFixture(createInput());
    input.selection = { nodeIds: ["hero_image"], anchorNodeId: "hero_image" };
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");

    expect(adapter.startImageCrop("hero_image")).toBe(true);
    expect(app.editor.visible).toBe(false);
    const initial = onImageCropStateChange.mock.calls.at(-1)?.[0];
    expect(initial?.nodeId).toBe("hero_image");
    expect(initial?.placement).toMatchObject({ mode: "crop", zoom: 1 });
    expect(adapter.updateImageCropZoom(2)).toBe(true);
    const hit = findElement(
      app.sky,
      "__opendesign_image_crop_hit__:hero_image",
    );
    if (!hit) throw new Error("Missing image crop hit area");
    app.emit("pointer.down", pointerEvent(100, 100, hit));
    app.emit("pointer.move", pointerEvent(130, 80, hit));
    app.emit("pointer.up", pointerEvent(130, 80, hit));

    const staged = onImageCropStateChange.mock.calls.at(-1)?.[0];
    expect(staged).toMatchObject({
      nodeId: "hero_image",
      placement: { mode: "crop", zoom: 2 },
    });
    expect(staged?.placement.focalPoint).not.toEqual({ x: 0.5, y: 0.5 });
    emitWindowKey("Enter");

    expect(onImageCropCommit).toHaveBeenCalledTimes(1);
    const committed = onImageCropCommit.mock.calls[0]?.[0];
    expect(committed?.nodeId).toBe("hero_image");
    expect(committed?.placement).toMatchObject({ mode: "crop", zoom: 2 });
    expect(onImageCropStateChange).toHaveBeenLastCalledWith(null);
    expect(app.editor.visible).toBe(true);
    adapter.dispose();
  });

  it("cancels image crop on Escape or stale revision without committing", async () => {
    const onImageCropCommit = vi.fn<
      NonNullable<LeaferEngineCallbacks["onImageCropCommit"]>
    >(() => true);
    const onImageCropStateChange =
      vi.fn<NonNullable<LeaferEngineCallbacks["onImageCropStateChange"]>>();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onImageCropCommit,
      onImageCropStateChange,
    });
    const input = withImageFixture(createInput());
    input.selection = { nodeIds: ["hero_image"], anchorNodeId: "hero_image" };
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    expect(adapter.startImageCrop("hero_image")).toBe(true);
    expect(adapter.updateImageCropZoom(3)).toBe(true);
    emitWindowKey("Escape");
    expect(onImageCropCommit).not.toHaveBeenCalled();
    expect(onImageCropStateChange).toHaveBeenLastCalledWith(null);
    expect(app.editor.visible).toBe(true);

    expect(adapter.startImageCrop("hero_image")).toBe(true);
    const changed = structuredClone(input.document);
    changed.revision += 1;
    adapter.sync({ ...input, document: changed });
    expect(onImageCropCommit).not.toHaveBeenCalled();
    expect(onImageCropStateChange).toHaveBeenLastCalledWith(null);
    expect(app.editor.visible).toBe(true);
    adapter.dispose();
  });

  it("maps synthetic Text hits to one authoritative selection and edit proxy", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const onSelectionChange = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
      onSelectionChange,
    });
    const input = createInput();
    input.selection = { nodeIds: [] };
    input.textRunProjection = textRunProjection(input);
    adapter.sync(input);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const proxy = findElement(app.tree, "title_welcome") as
      FakeText | undefined;
    const firstFragment = findElement(
      app.tree,
      textRunFragmentElementId("title_welcome", 0),
    ) as FakeText | undefined;
    const secondFragment = findElement(
      app.tree,
      textRunFragmentElementId("title_welcome", 1),
    ) as FakeText | undefined;
    if (!proxy || !firstFragment || !secondFragment) {
      throw new Error("Missing native Text run projection");
    }
    expect(findElement(app.tree, "feature_one")).toBeDefined();
    expect(proxy).toMatchObject({
      fill: "rgba(0, 0, 0, 0)",
      hittable: true,
    });
    expect(firstFragment).toMatchObject({
      editable: "single",
      fill: "#111827",
      hittable: true,
      visible: true,
    });

    app.editor.target = [firstFragment];
    app.editor.emit("editor.select");
    expect(app.editor.list).toEqual([proxy]);
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      ["title_welcome"],
      "title_welcome",
    );

    app.editor.openInnerEditor(firstFragment, true);
    await flushMicrotasks();
    expect(app.editor.innerEditing).toBe(true);
    expect(app.editor.editTarget).toBe(proxy);
    expect(app.editor.list).toEqual([proxy]);
    expect(proxy).not.toMatchObject({ fill: "rgba(0, 0, 0, 0)" });
    expect(proxy.text).toBe(
      (
        input.document.nodesById.title_welcome as Extract<
          DesignNode,
          { kind: "text" }
        >
      ).properties.content,
    );
    expect(firstFragment).toMatchObject({ hittable: false, visible: false });
    expect(secondFragment).toMatchObject({ hittable: false, visible: false });

    proxy.text = "Updated mixed-style title";
    app.editor.closeInnerEditor();
    expect(onOperations).toHaveBeenCalledTimes(1);
    const firstEdit = onOperations.mock.calls[0]?.[0];
    expect(firstEdit).toMatchObject({
      kind: "text",
      selectionNodeIds: ["title_welcome"],
    });
    expect(firstEdit?.operations[0]).toMatchObject({
      commandId: "leafer_text_title_welcome",
      nodeId: "title_welcome",
      content: "Updated mixed-style title",
      paragraphPatches: [],
      type: "commit_text_edit",
    });
    expect(proxy).not.toMatchObject({ fill: "rgba(0, 0, 0, 0)" });
    expect(firstFragment).toMatchObject({ hittable: false, visible: false });

    const document = structuredClone(input.document);
    document.revision += 1;
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.properties.content = "Updated mixed-style title";
    const next: LeaferEngineSyncInput = {
      ...input,
      document,
      selection: {
        nodeIds: [title.id],
        anchorNodeId: title.id,
      },
    };
    next.textRunProjection = textRunProjection(next);
    adapter.sync(next);
    flushAnimationFrames();

    expect(proxy).toMatchObject({ fill: "rgba(0, 0, 0, 0)" });
    expect(firstFragment).toMatchObject({ hittable: true, visible: true });
    expect(secondFragment).toMatchObject({ hittable: true, visible: true });
    expect(app.editor.list).toEqual([proxy]);

    const synchronousDocument = structuredClone(document);
    synchronousDocument.revision += 1;
    const synchronousTitle = synchronousDocument.nodesById.title_welcome;
    if (!synchronousTitle || synchronousTitle.kind !== "text") {
      throw new Error("Missing synchronous title");
    }
    synchronousTitle.properties.content = "Synchronous accepted title";
    const synchronousInput: LeaferEngineSyncInput = {
      ...next,
      document: synchronousDocument,
    };
    synchronousInput.textRunProjection = textRunProjection(synchronousInput);
    onOperations.mockImplementationOnce(() => {
      adapter.sync(synchronousInput);
      return true;
    });
    app.editor.openInnerEditor(firstFragment, true);
    await flushMicrotasks();
    proxy.text = synchronousTitle.properties.content;
    app.editor.closeInnerEditor();
    flushAnimationFrames();
    expect(proxy).toMatchObject({ fill: "rgba(0, 0, 0, 0)" });
    expect(firstFragment).toMatchObject({ hittable: true, visible: true });

    const plainDocument = structuredClone(synchronousDocument);
    plainDocument.revision += 1;
    const feature = plainDocument.nodesById.feature_one;
    if (!feature) throw new Error("Missing feature fixture");
    feature.opacity = 0.9;
    const plainInput = { ...next };
    delete plainInput.textRunProjection;
    adapter.sync({
      ...plainInput,
      changes: changedNodeSet(
        synchronousDocument,
        plainDocument,
        feature.id,
        "opacity",
      ),
      document: plainDocument,
    });
    flushAnimationFrames();
    expect(
      findElement(app.tree, textRunFragmentElementId("title_welcome", 0)),
    ).toBeUndefined();
    expect(proxy).not.toMatchObject({ fill: "rgba(0, 0, 0, 0)" });
    adapter.dispose();
  });

  it("captures and exports the exact mixed Text projection during direct editing", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const input = createInput();
    input.selection = {
      nodeIds: ["title_welcome"],
      anchorNodeId: "title_welcome",
    };
    input.textRunProjection = textRunProjection(input);
    adapter.sync(input);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const frame = findElement(app.tree, "frame_welcome");
    const proxy = findElement(app.tree, "title_welcome") as
      FakeText | undefined;
    const fragment = findElement(
      app.tree,
      textRunFragmentElementId("title_welcome", 0),
    ) as FakeText | undefined;
    if (!frame || !proxy || !fragment) {
      throw new Error("Missing mixed Text export fixture");
    }

    app.editor.openInnerEditor(fragment, true);
    await flushMicrotasks();
    expect(proxy).not.toMatchObject({ fill: "rgba(0, 0, 0, 0)" });
    expect(fragment).toMatchObject({ hittable: false, visible: false });

    await expect(
      adapter.capture({
        kind: "frame",
        pageId: input.pageId,
        nodeId: "frame_welcome",
      }),
    ).resolves.toMatchObject({ mimeType: "image/jpeg" });
    expect(frame.syncExport).not.toHaveBeenCalled();
    await expect(
      adapter.capture({ kind: "page", pageId: input.pageId }),
    ).resolves.toMatchObject({ mimeType: "image/jpeg" });
    expect(app.tree.syncExport).not.toHaveBeenCalled();

    await expect(
      adapter.exportRaster({
        version: 1,
        pageId: input.pageId,
        rootNodeId: "title_welcome",
        format: "png",
        size: { mode: "scale", value: 1 },
        background: { mode: "transparent" },
        resampling: "smooth",
      }),
    ).resolves.toMatchObject({ mimeType: "image/png" });
    expect(proxy.export).not.toHaveBeenCalled();
    await expect(
      adapter.exportRaster({
        version: 1,
        pageId: input.pageId,
        rootNodeId: "frame_welcome",
        format: "png",
        size: { mode: "scale", value: 1 },
        background: { mode: "transparent" },
        resampling: "smooth",
      }),
    ).resolves.toMatchObject({ mimeType: "image/png" });
    expect(frame.export).not.toHaveBeenCalled();

    const createdBeforeFailure = leaferHarness.elements.length;
    leaferHarness.failNextExport = true;
    await expect(
      adapter.exportRaster({
        version: 1,
        pageId: input.pageId,
        rootNodeId: "title_welcome",
        format: "png",
        size: { mode: "scale", value: 1 },
        background: { mode: "transparent" },
        resampling: "smooth",
      }),
    ).rejects.toThrow("Synthetic export failure");
    expect(
      leaferHarness.elements[createdBeforeFailure]?.destroy,
    ).toHaveBeenCalledTimes(1);
    expect(proxy).not.toMatchObject({ fill: "rgba(0, 0, 0, 0)" });
    expect(fragment).toMatchObject({ hittable: false, visible: false });

    emitWindowKey("Escape");
    app.editor.closeInnerEditor();
    adapter.dispose();
  });

  it("authors an automatic list in the real edit root and commits one semantic operation", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    const input = createInput();
    const designDocument = structuredClone(input.document);
    const title = designDocument.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.properties.content = "";
    title.properties.runs = [];
    title.properties.paragraphRuns = [];
    adapter.sync({
      ...input,
      document: designDocument,
      selection: { nodeIds: [title.id], anchorNodeId: title.id },
    });

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, title.id) as FakeText | undefined;
    if (!element) throw new Error("Missing Text edit target");
    app.editor.enableTextDom = true;
    app.editor.openInnerEditor(element, true);
    const root = app.editor.innerEditor?.editDom;
    if (!root) throw new Error("Missing Text edit DOM");

    root.textContent = "- ";
    setDomCaret(root, 2);
    root.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: " ",
        inputType: "insertText",
      }),
    );
    expect(root.textContent).toBe("");
    expect(element.text).toBe("");

    root.textContent = "Alpha";
    setDomCaret(root, 5);
    root.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "a",
        inputType: "insertText",
      }),
    );
    app.editor.closeInnerEditor();

    expect(onOperations).toHaveBeenCalledTimes(1);
    expect(onOperations.mock.calls[0]?.[0]).toMatchObject({
      kind: "text",
      selectionNodeIds: [title.id],
      operations: [
        {
          type: "commit_text_edit",
          nodeId: title.id,
          content: "Alpha",
          paragraphPatches: [
            {
              start: 0,
              end: 5,
              style: {
                listOptions: { type: "unordered" },
                indentation: 1,
              },
            },
          ],
        },
      ],
    });
    adapter.dispose();
  });

  it("stages collapsed-caret typography and materializes it only after real input", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const onTextRangeSelectionChange =
      vi.fn<NonNullable<LeaferEngineCallbacks["onTextRangeSelectionChange"]>>();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
      onTextRangeSelectionChange,
    });
    const input = createInput();
    const designDocument = structuredClone(input.document);
    const title = designDocument.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.properties.content = "AB";
    title.properties.runs = [];
    title.properties.paragraphRuns = [];
    adapter.sync({
      ...input,
      document: designDocument,
      selection: { nodeIds: [title.id], anchorNodeId: title.id },
    });

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, title.id) as FakeText | undefined;
    if (!element) throw new Error("Missing Text edit target");
    app.editor.enableTextDom = true;
    app.editor.openInnerEditor(element, true);
    const root = app.editor.innerEditor?.editDom;
    if (!root) throw new Error("Missing Text edit DOM");
    setDomCaret(root, 1);
    document.dispatchEvent(new Event("selectionchange"));

    expect(
      adapter.updateTextEditingStyle({
        fontWeight: 700,
        fills: [{ type: "solid", color: "#ff3366", opacity: 1 }],
      }),
    ).toBe(true);
    expect(onOperations).not.toHaveBeenCalled();
    const published = onTextRangeSelectionChange.mock.calls.at(-1)?.[0];
    if (!published?.editing) throw new Error("Missing editing selection");
    expect(published).toMatchObject({
      nodeId: title.id,
      start: 1,
      end: 1,
    });
    expect(published.editing.characterStyle).toMatchObject({
      fontWeight: 700,
      fills: [{ type: "solid", color: "#ff3366", opacity: 1 }],
    });

    const marker = root.querySelector<HTMLSpanElement>(
      "[data-opendesign-typing-style]",
    );
    if (!marker?.firstChild) throw new Error("Missing typing style marker");
    expect(root.textContent).toBe("A\u200BB");
    marker.firstChild.textContent = "\u200BX";
    setDomCaret(root, 3);
    root.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "X",
        inputType: "insertText",
      }),
    );
    expect(root.querySelector("[data-opendesign-typing-style]")).toBe(marker);
    expect(root.textContent?.replaceAll("\u200B", "")).toBe("AXB");
    expect(marker.textContent).toBe("\u200BX");
    expect(marker.style.fontWeight).toBe("700");

    marker.firstChild.textContent = "\u200BXY";
    setDomCaret(root, 4);
    root.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "Y",
        inputType: "insertText",
      }),
    );
    expect(root.querySelector("[data-opendesign-typing-style]")).toBe(marker);
    app.editor.closeInnerEditor();

    expect(onOperations).toHaveBeenCalledTimes(1);
    expect(onOperations.mock.calls[0]?.[0]).toMatchObject({
      operations: [
        {
          type: "commit_text_edit",
          nodeId: title.id,
          content: "AXYB",
          paragraphPatches: [],
          runs: [
            { start: 0, end: 1 },
            {
              start: 1,
              end: 3,
              style: {
                fontWeight: 700,
                fills: [{ type: "solid", color: "#ff3366", opacity: 1 }],
              },
            },
            { start: 3, end: 4 },
          ],
        },
      ],
    });
    adapter.dispose();
  });

  it("stages range typography in place and commits it without changing content", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    const input = createInput();
    const designDocument = structuredClone(input.document);
    const title = designDocument.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.properties.content = "AB";
    title.properties.runs = [];
    title.properties.paragraphRuns = [];
    adapter.sync({ ...input, document: designDocument });

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, title.id) as FakeText | undefined;
    if (!element) throw new Error("Missing Text edit target");
    app.editor.enableTextDom = true;
    app.editor.openInnerEditor(element, true);
    const root = app.editor.innerEditor?.editDom;
    if (!root) throw new Error("Missing Text edit DOM");
    setDomSelection(root, 0, 1);
    document.dispatchEvent(new Event("selectionchange"));
    const untouched = root.lastChild;

    expect(adapter.updateTextEditingStyle({ fontWeight: 700 })).toBe(true);
    expect(root.lastChild).toBe(untouched);
    expect(root.textContent).toBe("AB");
    app.editor.closeInnerEditor();

    expect(onOperations).toHaveBeenCalledTimes(1);
    expect(onOperations.mock.calls[0]?.[0]).toMatchObject({
      operations: [
        {
          type: "commit_text_edit",
          content: "AB",
          runs: [
            { start: 0, end: 1, style: { fontWeight: 700 } },
            { start: 1, end: 2 },
          ],
        },
      ],
    });
    adapter.dispose();
  });

  it("keeps inspector focus, clears an unused typing override on caret move, and cancels cleanly", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    const input = createInput();
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, "title_welcome") as
      FakeText | undefined;
    if (!element) throw new Error("Missing Text edit target");
    app.editor.enableTextDom = true;
    app.editor.openInnerEditor(element, true);
    const root = app.editor.innerEditor?.editDom;
    if (!root) throw new Error("Missing Text edit DOM");
    setDomCaret(root, 1);
    document.dispatchEvent(new Event("selectionchange"));

    const inspectorInput = document.createElement("input");
    document.body.appendChild(inspectorInput);
    inspectorInput.focus();
    expect(adapter.updateTextEditingStyle({ fontWeight: 700 })).toBe(true);
    expect(document.activeElement).toBe(inspectorInput);
    expect(root.querySelector("[data-opendesign-typing-style]")).not.toBeNull();

    inspectorInput.remove();
    setDomCaret(root, 0);
    document.dispatchEvent(new Event("selectionchange"));
    expect(root.querySelector("[data-opendesign-typing-style]")).toBeNull();
    expect(root.textContent).not.toContain("\u200B");

    expect(adapter.updateTextEditingStyle({ fontWeight: 800 })).toBe(true);
    expect(root.querySelector("[data-opendesign-typing-style]")).not.toBeNull();
    emitWindowKey("Escape");
    app.editor.closeInnerEditor();
    expect(onOperations).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("preserves the typing marker throughout IME composition", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const input = createInput();
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, "title_welcome") as
      FakeText | undefined;
    if (!element) throw new Error("Missing Text edit target");
    app.editor.enableTextDom = true;
    app.editor.openInnerEditor(element, true);
    const root = app.editor.innerEditor?.editDom;
    if (!root) throw new Error("Missing Text edit DOM");
    setDomCaret(root, 1);
    document.dispatchEvent(new Event("selectionchange"));
    adapter.updateTextEditingStyle({ fontWeight: 700 });
    const marker = root.querySelector<HTMLSpanElement>(
      "[data-opendesign-typing-style]",
    );
    if (!marker?.firstChild) throw new Error("Missing typing style marker");

    root.dispatchEvent(new CompositionEvent("compositionstart"));
    marker.firstChild.textContent = "\u200B漢";
    setDomCaret(root, 3);
    root.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "漢",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
    expect(root.querySelector("[data-opendesign-typing-style]")).toBe(marker);
    root.dispatchEvent(new CompositionEvent("compositionend"));
    expect(root.querySelector("[data-opendesign-typing-style]")).toBe(marker);
    app.editor.closeInnerEditor();
    adapter.dispose();
  });

  it("routes Tab list indentation through the editing session instead of moving focus", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    const input = createInput();
    const document = structuredClone(input.document);
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.properties.content = "One\nTwo";
    title.properties.runs = [];
    title.properties.paragraphRuns = [
      {
        start: 0,
        end: 7,
        style: {
          listOptions: { type: "ordered" },
          indentation: 1,
          listSpacing: 0,
          paragraphIndent: 0,
          paragraphSpacing: 0,
        },
      },
    ];
    adapter.sync({
      ...input,
      document,
      selection: { nodeIds: [title.id], anchorNodeId: title.id },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, title.id) as FakeText | undefined;
    if (!element) throw new Error("Missing Text edit target");
    app.editor.enableTextDom = true;
    app.editor.openInnerEditor(element, true);
    const root = app.editor.innerEditor?.editDom;
    if (!root) throw new Error("Missing Text edit DOM");
    setDomCaret(root, 4);

    const key = emitTextEditWindowKey(root, { code: "Tab", key: "Tab" });
    expect(key.preventDefault).toHaveBeenCalledTimes(1);
    expect(key.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    app.editor.closeInnerEditor();
    expect(onOperations.mock.calls[0]?.[0]).toMatchObject({
      operations: [
        {
          type: "commit_text_edit",
          content: "One\nTwo",
          paragraphPatches: [{ start: 4, end: 7, style: { indentation: 2 } }],
        },
      ],
    });
    adapter.dispose();
  });

  it("restores creation characters on immediate Undo and skips auto-list during composition", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    const input = createInput();
    const document = structuredClone(input.document);
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.properties.content = "";
    title.properties.runs = [];
    title.properties.paragraphRuns = [];
    adapter.sync({ ...input, document });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, title.id) as FakeText | undefined;
    if (!element) throw new Error("Missing Text edit target");
    app.editor.enableTextDom = true;
    app.editor.openInnerEditor(element, true);
    let root = app.editor.innerEditor?.editDom;
    if (!root) throw new Error("Missing Text edit DOM");
    root.textContent = "- ";
    setDomCaret(root, 2);
    root.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: " ",
        inputType: "insertText",
      }),
    );
    const undo = emitTextEditWindowKey(root, {
      code: "KeyZ",
      ctrlKey: true,
      key: "z",
    });
    expect(undo.preventDefault).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe("- ");
    app.editor.closeInnerEditor();
    expect(onOperations.mock.calls[0]?.[0]).toMatchObject({
      operations: [
        {
          type: "commit_text_edit",
          content: "- ",
          paragraphPatches: [],
        },
      ],
    });

    onOperations.mockClear();
    app.editor.openInnerEditor(element, true);
    root = app.editor.innerEditor?.editDom;
    if (!root) throw new Error("Missing reopened Text edit DOM");
    root.dispatchEvent(new CompositionEvent("compositionstart"));
    root.textContent = "* ";
    setDomCaret(root, 2);
    root.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: " ",
        inputType: "insertText",
        isComposing: true,
      }),
    );
    root.dispatchEvent(new CompositionEvent("compositionend"));
    expect(root.textContent).toBe("* ");
    app.editor.closeInnerEditor();
    expect(onOperations.mock.calls[0]?.[0]).toMatchObject({
      operations: [
        {
          type: "commit_text_edit",
          content: "* ",
          paragraphPatches: [],
        },
      ],
    });
    adapter.dispose();
  });

  it("detaches stale edit roots and selection listeners across close, reopen, and dispose", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const onTextRangeSelectionChange =
      vi.fn<NonNullable<LeaferEngineCallbacks["onTextRangeSelectionChange"]>>();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
      onTextRangeSelectionChange,
    });
    const input = createInput();
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, "title_welcome") as
      FakeText | undefined;
    if (!element) throw new Error("Missing Text edit target");
    const original = element.text;
    app.editor.enableTextDom = true;
    app.editor.openInnerEditor(element, true);
    const firstRoot = app.editor.innerEditor?.editDom;
    if (!firstRoot) throw new Error("Missing first Text edit DOM");
    app.editor.closeInnerEditor();

    const callsAfterClose = onTextRangeSelectionChange.mock.calls.length;
    firstRoot.textContent = "Late stale input";
    firstRoot.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "t",
        inputType: "insertText",
      }),
    );
    document.dispatchEvent(new Event("selectionchange"));
    expect(element.text).toBe(original);
    expect(onOperations).not.toHaveBeenCalled();
    expect(onTextRangeSelectionChange).toHaveBeenCalledTimes(callsAfterClose);

    app.editor.openInnerEditor(element, true);
    const secondRoot = app.editor.innerEditor?.editDom;
    if (!secondRoot) throw new Error("Missing second Text edit DOM");
    expect(secondRoot).not.toBe(firstRoot);
    setDomCaret(secondRoot, 1);
    document.dispatchEvent(new Event("selectionchange"));
    expect(onTextRangeSelectionChange.mock.calls.at(-1)?.[0]).toMatchObject({
      nodeId: "title_welcome",
      start: 1,
      end: 1,
    });

    adapter.dispose();
    const callsAfterDispose = onTextRangeSelectionChange.mock.calls.length;
    document.dispatchEvent(new Event("selectionchange"));
    expect(onTextRangeSelectionChange).toHaveBeenCalledTimes(callsAfterDispose);
  });

  it("restores mixed Text projection on Escape and blocks inherited-locked editing", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    const input = createInput();
    input.selection = { nodeIds: [] };
    input.textRunProjection = textRunProjection(input);
    adapter.sync(input);

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const proxy = findElement(app.tree, "title_welcome") as
      FakeText | undefined;
    const fragment = findElement(
      app.tree,
      textRunFragmentElementId("title_welcome", 0),
    ) as FakeText | undefined;
    if (!proxy || !fragment) throw new Error("Missing Text run fixture");

    app.editor.openInnerEditor(fragment, true);
    await flushMicrotasks();
    proxy.text = "Cancelled content";
    emitWindowKey("Escape");
    app.editor.closeInnerEditor();
    flushAnimationFrames();
    expect(onOperations).not.toHaveBeenCalled();
    expect(proxy).toMatchObject({ fill: "rgba(0, 0, 0, 0)" });
    expect(fragment).toMatchObject({ hittable: true, visible: true });

    const lockedDocument = structuredClone(input.document);
    lockedDocument.revision += 1;
    const title = lockedDocument.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.locked = true;
    const lockedInput: LeaferEngineSyncInput = {
      ...input,
      changes: changedNodeSet(
        input.document,
        lockedDocument,
        title.id,
        "locked",
      ),
      document: lockedDocument,
    };
    lockedInput.textRunProjection = textRunProjection(lockedInput);
    adapter.sync(lockedInput);
    const lockedFragment = findElement(
      app.tree,
      textRunFragmentElementId("title_welcome", 0),
    );
    if (!lockedFragment) throw new Error("Missing locked Text fragment");
    app.editor.openInnerEditor(lockedFragment, true);
    await flushMicrotasks();
    expect(app.editor.innerEditing).toBe(false);
    expect(onOperations).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("closes rich Text editing on Page identity changes and clears dispose state", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    const input = createInput();
    input.selection = { nodeIds: [] };
    input.textRunProjection = textRunProjection(input);
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const fragment = findElement(
      app.tree,
      textRunFragmentElementId("title_welcome", 0),
    );
    if (!fragment) throw new Error("Missing Text fragment");

    app.editor.openInnerEditor(fragment, true);
    await flushMicrotasks();
    expect(app.editor.innerEditing).toBe(true);

    const document = structuredClone(input.document);
    document.revision += 1;
    document.pageOrder.push("page_other");
    document.pagesById.page_other = {
      extensions: {},
      id: "page_other",
      name: "Other",
      rootNodeIds: [],
    };
    adapter.sync({
      document,
      pageId: "page_other",
      selection: { nodeIds: [] },
      tool: "select",
      viewport: input.viewport,
    });
    expect(app.editor.innerEditing).toBe(false);
    expect(onOperations).not.toHaveBeenCalled();

    const back: LeaferEngineSyncInput = {
      document,
      pageId: input.pageId,
      selection: { nodeIds: [] },
      tool: "select",
      viewport: input.viewport,
    };
    back.textRunProjection = textRunProjection(back);
    adapter.sync(back);
    const restoredFragment = findElement(
      app.tree,
      textRunFragmentElementId("title_welcome", 0),
    );
    if (!restoredFragment) throw new Error("Missing restored Text fragment");
    app.editor.openInnerEditor(restoredFragment, true);
    await flushMicrotasks();
    expect(app.editor.innerEditing).toBe(true);
    adapter.dispose();
    app.editor.closeInnerEditor();
    expect(app.destroy).toHaveBeenCalledTimes(1);
    expect(onOperations).not.toHaveBeenCalled();
  });

  it("closes a text session when an unrelated exact revision lands", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    const first = createInput();
    first.selection = { nodeIds: [] };
    first.textRunProjection = textRunProjection(first);
    adapter.sync(first);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const fragment = findElement(
      app.tree,
      textRunFragmentElementId("title_welcome", 0),
    );
    if (!fragment) throw new Error("Missing Text fragment");

    app.editor.openInnerEditor(fragment, true);
    await flushMicrotasks();
    const proxy = findElement(app.tree, "title_welcome") as
      FakeText | undefined;
    if (!proxy) throw new Error("Missing Text proxy");
    proxy.text = "Stale local edit";

    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const sibling = secondDocument.nodesById.feature_two;
    if (!sibling) throw new Error("Missing sibling fixture");
    sibling.opacity = 0.5;
    const second: LeaferEngineSyncInput = {
      ...first,
      document: secondDocument,
      changes: changedNodeSet(first.document, secondDocument, "feature_two"),
    };
    second.textRunProjection = textRunProjection(second);
    adapter.sync(second);
    expect(app.editor.innerEditing).toBe(false);
    expect(onOperations).not.toHaveBeenCalled();
    expect(proxy.text).toBe(
      (
        secondDocument.nodesById.title_welcome as Extract<
          DesignNode,
          { kind: "text" }
        >
      ).properties.content,
    );
    adapter.dispose();
  });

  it("restores full text while editing and reprojects ending truncation after close", async () => {
    const onOperations = vi.fn<LeaferEngineCallbacks["onOperations"]>(
      () => true,
    );
    const callbacks = { ...createCallbacks(), onOperations };
    const adapter = await createLeaferEngineAdapter(createHost(), callbacks);
    const input = createInput();
    const document = structuredClone(input.document);
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.size = { width: 72, height: 64 };
    Object.assign(title.properties, {
      content: "Alpha beta gamma delta",
      maxLines: 1,
      textOverflow: "clip",
      textResize: "fixed",
      textTruncation: "ending",
      textWrap: "word",
    });
    adapter.sync({
      ...input,
      document,
      selection: { nodeIds: [title.id], anchorNodeId: title.id },
    });

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, title.id) as FakeText | undefined;
    if (!element) throw new Error("Missing projected title");
    expect(element.text).not.toBe(title.properties.content);
    expect(element.text).toMatch(/\.\.\.$/);
    expect({ width: element.width, height: element.height }).toEqual(
      title.size,
    );

    app.editor.target = [element];
    app.editor.emit("inner.before-open");
    expect(element.text).toBe(title.properties.content);
    app.editor.emit("inner.close");
    expect(element.text).not.toBe(title.properties.content);
    expect(element.text).toMatch(/\.\.\.$/);

    app.editor.emit("inner.before-open");
    element.text = "Updated complete authored text";
    app.editor.emit("inner.close");
    expect(onOperations).toHaveBeenCalledTimes(1);
    const request = onOperations.mock.calls[0]?.[0];
    expect(request?.kind).toBe("text");
    const operation = request?.operations[0];
    expect(operation).toMatchObject({ nodeId: title.id });
    if (!operation || operation.type !== "commit_text_edit") {
      throw new Error("Expected a text property update");
    }
    expect(operation).toMatchObject({
      content: "Updated complete authored text",
      paragraphPatches: [],
    });
    adapter.dispose();
  });

  it("exports a deterministic Frame image without using the viewport", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const input = createInput();
    adapter.sync({
      ...input,
      viewport: {
        ...input.viewport,
        panX: -8_000,
        panY: 4_000,
        zoom: 0.25,
      },
    });

    const result = await adapter.capture({
      kind: "frame",
      pageId: "page_welcome",
      nodeId: "frame_welcome",
    });

    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const frame = findElement(app.tree, "frame_welcome");
    expect(frame?.syncExport).toHaveBeenCalledWith(
      "jpg",
      expect.objectContaining({
        pixelRatio: 1,
        quality: 0.88,
      }),
    );
    expect(frame?.export).not.toHaveBeenCalled();
    const pageResult = await adapter.capture({
      kind: "page",
      pageId: "page_welcome",
    });
    expect(pageResult.width).toBeGreaterThan(0);
    expect(pageResult.height).toBeGreaterThan(0);
    expect(app.tree.syncExport).toHaveBeenCalledWith(
      "jpg",
      expect.objectContaining({ pixelRatio: 1 }),
    );
    await expect(
      adapter.capture({
        kind: "frame",
        pageId: "page_welcome",
        nodeId: "missing_frame",
      }),
    ).rejects.toThrow("Leafer capture Frame is unavailable");
    adapter.dispose();
  });

  it("projects selected Frame layout guides in the non-exported editor sky", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    const document = structuredClone(first.document);
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    frame.properties.layoutGuides = [
      {
        id: "grid_160",
        type: "grid",
        size: 160,
        color: "#3366ff",
        opacity: 0.25,
      },
    ];
    adapter.sync({
      ...first,
      document,
      layoutGuideFrameId: frame.id,
      selection: { nodeIds: [frame.id], anchorNodeId: frame.id },
    });

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const layer = app.sky.children[1] as FakeGroup | undefined;
    const guide = layer?.children[0] as FakePath | undefined;
    expect(layer).toMatchObject({
      editable: false,
      hitChildren: false,
      hittable: false,
      visible: true,
    });
    expect(guide).toMatchObject({
      editable: false,
      hittable: false,
      opacity: 0.25,
      stroke: "#3366ff",
      strokeWidth: 1,
      localTransform: { a: 1, b: 0, c: 0, d: 1, e: 80, f: 64 },
    });
    expect(String(guide?.path)).toContain("M 160 0 L 160 720");
    expect(String(guide?.path)).toContain("M 0 160 L 1120 160");
    expect(app.tree.children).not.toContain(layer);

    await adapter.capture({
      kind: "frame",
      pageId: "page_welcome",
      nodeId: frame.id,
    });
    expect(guide?.export).not.toHaveBeenCalled();
    expect(guide?.syncExport).not.toHaveBeenCalled();

    app.tree.localTransform = {
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: -20,
      f: 30,
    };
    app.emit("viewport.move");
    expect(guide?.strokeWidth).toBe(2);
    expect(guide?.localTransform).toEqual({
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: 20,
      f: 62,
    });

    app.sky.localTransform = { ...app.tree.localTransform };
    app.emit("render.child-start");
    expect(guide?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 80,
      f: 64,
    });

    const moved = structuredClone(document);
    moved.revision += 1;
    const movedFrame = moved.nodesById.frame_welcome;
    if (!movedFrame || movedFrame.kind !== "frame")
      throw new Error("Missing moved frame");
    movedFrame.transform = [1, 0, 0, 1, 120, 96];
    movedFrame.size = { width: 640, height: 480 };
    adapter.sync({
      ...first,
      document: moved,
      layoutGuideFrameId: movedFrame.id,
      selection: { nodeIds: [movedFrame.id], anchorNodeId: movedFrame.id },
      viewport: { ...first.viewport, panX: -20, panY: 30, zoom: 0.5 },
    });
    expect(guide?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 120,
      f: 96,
    });
    expect(String(guide?.path)).toContain("M 160 0 L 160 480");

    adapter.sync({ ...first, document: moved });
    expect(layer?.visible).toBe(false);
    expect(layer?.children).toEqual([]);
    adapter.dispose();
  });

  it("projects fixed and stretch Columns/Rows as clipped non-interactive areas", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    const document = structuredClone(first.document);
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    frame.properties.layoutGuides = [
      {
        id: "columns_stretch",
        type: "columns",
        alignment: "stretch",
        count: 4,
        gutter: 20,
        margin: 40,
        color: "#ff5a5f",
        opacity: 0.1,
      },
      {
        id: "rows_end",
        type: "rows",
        alignment: "end",
        count: 2,
        sectionSize: 80,
        gutter: 16,
        offset: 32,
        color: "#3366ff",
        opacity: 0.08,
      },
    ];
    adapter.sync({
      ...first,
      document,
      layoutGuideFrameId: frame.id,
      selection: { nodeIds: [frame.id], anchorNodeId: frame.id },
    });

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const layer = app.sky.children[1] as FakeGroup | undefined;
    const columns = layer?.children[0] as FakePath | undefined;
    const rows = layer?.children[1] as FakePath | undefined;
    expect(columns).toMatchObject({
      editable: false,
      fill: "#ff5a5f",
      hittable: false,
      opacity: 0.1,
      strokeWidth: 0,
    });
    expect(String(columns?.path)).toContain("M 40 0 H 285 V 720 H 40 Z");
    expect(String(columns?.path)).toContain("M 835 0 H 1080 V 720 H 835 Z");
    expect(rows).toMatchObject({
      fill: "#3366ff",
      opacity: 0.08,
      strokeWidth: 0,
    });
    expect(String(rows?.path)).toContain("M 0 512 H 1120 V 592 H 0 Z");
    expect(String(rows?.path)).toContain("M 0 608 H 1120 V 688 H 0 Z");

    const resized = structuredClone(document);
    resized.revision += 1;
    const resizedFrame = resized.nodesById.frame_welcome;
    if (!resizedFrame || resizedFrame.kind !== "frame")
      throw new Error("Missing resized frame");
    resizedFrame.size = { width: 720, height: 480 };
    adapter.sync({
      ...first,
      document: resized,
      layoutGuideFrameId: resizedFrame.id,
      selection: {
        nodeIds: [resizedFrame.id],
        anchorNodeId: resizedFrame.id,
      },
    });
    expect(String(columns?.path)).toContain("M 40 0 H 185 V 480 H 40 Z");
    expect(String(columns?.path)).toContain("M 535 0 H 680 V 480 H 535 Z");
    expect(String(rows?.path)).toContain("M 0 272 H 720 V 352 H 0 Z");

    await adapter.capture({
      kind: "frame",
      pageId: "page_welcome",
      nodeId: resizedFrame.id,
    });
    expect(columns?.export).not.toHaveBeenCalled();
    expect(rows?.syncExport).not.toHaveBeenCalled();

    const switched = structuredClone(resized);
    switched.revision += 1;
    const switchedFrame = switched.nodesById.frame_welcome;
    if (!switchedFrame || switchedFrame.kind !== "frame")
      throw new Error("Missing switched frame");
    switchedFrame.properties.layoutGuides = [
      {
        id: "columns_stretch",
        type: "grid",
        size: 160,
        color: "#22c55e",
        opacity: 0.2,
      },
    ];
    adapter.sync({
      ...first,
      document: switched,
      layoutGuideFrameId: switchedFrame.id,
      selection: {
        nodeIds: [switchedFrame.id],
        anchorNodeId: switchedFrame.id,
      },
    });
    expect(columns).toMatchObject({
      fill: "rgba(0, 0, 0, 0)",
      stroke: "#22c55e",
      strokeWidth: 1,
    });
    expect(layer?.children).toEqual([columns]);
    adapter.dispose();
  });

  it("projects empty Component Slots as non-exported editor overlays", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = componentInput();
    const document = structuredClone(first.document);
    const main = document.nodesById.button_main;
    const label = document.nodesById.button_label;
    if (main?.kind !== "frame" || label?.kind !== "text") {
      throw new Error("Missing Component Slot fixture");
    }
    main.childIds = ["button_slot"];
    document.nodesById.button_slot = {
      ...structuredClone(main),
      childIds: [],
      id: "button_slot",
      kind: "slot",
      name: "Content",
      parentId: main.id,
      properties: {
        ...structuredClone(main.properties),
        sourceSlotId: null,
      },
      size: { width: 100, height: 28 },
      transform: [1, 0, 0, 1, 10, 8],
    };
    document.componentsById.button!.componentPropertyDefinitions = {
      "Content#button:content": {
        type: "SLOT",
        defaultValue: "button_slot",
        slotSettings: { displayEmptyByDefault: true },
      },
    };
    adapter.sync({ ...first, document });

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const layer = app.sky.children[2] as FakeGroup | undefined;
    const indicator = layer?.children[0] as FakePath | undefined;
    expect(layer).toMatchObject({
      editable: false,
      hitChildren: false,
      hittable: false,
      visible: true,
    });
    expect(indicator).toMatchObject({
      dashPattern: [5, 4],
      editable: false,
      fill: "rgba(0, 0, 0, 0)",
      hittable: false,
      localTransform: { a: 1, b: 0, c: 0, d: 1, e: 90, f: 68 },
      stroke: "#d946ef",
      strokeWidth: 1.25,
    });
    expect(String(indicator?.path)).toBe("M 0 0 H 100 V 28 H 0 Z");

    app.tree.localTransform = {
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: -20,
      f: 30,
    };
    app.emit("viewport.move");
    expect(indicator).toMatchObject({
      dashPattern: [10, 8],
      localTransform: { a: 0.5, b: 0, c: 0, d: 0.5, e: 25, f: 64 },
      strokeWidth: 2.5,
    });
    app.sky.localTransform = { ...app.tree.localTransform };
    app.emit("render.child-start");
    expect(indicator?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 90,
      f: 68,
    });

    await adapter.capture({ kind: "page", pageId: "instances" });
    expect(indicator?.export).not.toHaveBeenCalled();
    expect(indicator?.syncExport).not.toHaveBeenCalled();

    const filled = structuredClone(document);
    filled.revision += 1;
    const slot = filled.nodesById.button_slot;
    const filledLabel = filled.nodesById.button_label;
    if (slot?.kind !== "slot" || filledLabel?.kind !== "text") {
      throw new Error("Missing filled Component Slot fixture");
    }
    slot.childIds = [filledLabel.id];
    filledLabel.parentId = slot.id;
    adapter.sync({ ...first, document: filled });
    expect(layer?.children).toEqual([]);
    expect(layer?.visible).toBe(false);
    adapter.dispose();
  });

  it("exports a delivery raster with explicit format, size, background, quality, and resampling", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    adapter.sync(createInput());

    const result = await adapter.exportRaster({
      version: 1,
      pageId: "page_welcome",
      rootNodeId: "frame_welcome",
      format: "webp",
      size: { mode: "width", value: 600 },
      background: { mode: "color", color: "#112233" },
      quality: 0.82,
      resampling: "pixelated",
    });

    expect(result).toMatchObject({
      mimeType: "image/webp",
      width: 600,
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const frame = findElement(app.tree, "frame_welcome");
    expect(frame?.export).toHaveBeenCalledWith(
      "webp",
      expect.objectContaining({
        blob: true,
        fill: "#112233",
        pixelRatio: 1,
        quality: 0.82,
        smooth: false,
      }),
    );
    await expect(
      adapter.exportRaster({
        version: 1,
        pageId: "page_welcome",
        rootNodeId: "missing",
        format: "png",
        size: { mode: "scale", value: 1 },
        background: { mode: "transparent" },
        resampling: "smooth",
      }),
    ).rejects.toThrow("Leafer raster export layer is unavailable");
    adapter.dispose();
  });

  it("exports a Slice by cropping the surrounding scene to its bounds", async () => {
    const input = createInput();
    input.document = structuredClone(input.document);
    input.document.nodesById.slice_1 = {
      id: "slice_1",
      kind: "slice",
      name: "Slice",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 40, 40],
      size: { width: 320, height: 180 },
      exportSettings: [],
      opacity: 1,
      properties: {},
      extensions: {},
    };
    input.document.pagesById.page_welcome!.rootNodeIds.push("slice_1");
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    adapter.sync(input);
    await adapter.exportRaster({
      version: 1,
      pageId: "page_welcome",
      rootNodeId: "slice_1",
      format: "png",
      size: { mode: "scale", value: 1 },
      background: { mode: "transparent" },
      resampling: "smooth",
    });
    const app = leaferHarness.app;
    const slice = app && findElement(app.tree, "slice_1");
    expect(slice?.export).toHaveBeenCalledWith(
      "png",
      expect.objectContaining({ slice: true }),
    );
    adapter.dispose();
  });

  it("exports resolved component pixels and deduplicates internal instance selection", async () => {
    const onSelectionChange = vi.fn();
    const onOperations = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
      onSelectionChange,
    });
    adapter.sync(componentInput());
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const root = findElement(app.tree, "button_instance");
    const projected = root instanceof FakeGroup ? root.children : [];
    expect(root).toBeInstanceOf(FakeFrame);
    expect(projected.length).toBe(2);

    app.editor.target = projected;
    app.editor.emit("editor.select");
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      ["button_instance"],
      "button_instance",
    );

    const background = findElement(
      app.tree,
      componentProjectionId("button_instance", ["button_bg"]),
    );
    if (!background) throw new Error("Missing projected component background");
    app.editor.target = [background];
    app.editor.emit("editor.select");
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      ["button_instance"],
      "button_instance",
      {
        instanceId: "button_instance",
        sourcePath: ["button_bg"],
      },
    );
    expect(app.editor.list).toEqual([background]);

    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    background.localTransform.e += 24;
    app.editor.emit("editor.move");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");
    expect(onOperations).not.toHaveBeenCalled();
    expect(background.localTransform.e).toBe(0);

    await expect(
      adapter.exportRaster({
        version: 1,
        pageId: "instances",
        rootNodeId: "button_instance",
        format: "png",
        size: { mode: "scale", value: 1 },
        background: { mode: "transparent" },
        resampling: "smooth",
      }),
    ).resolves.toMatchObject({ mimeType: "image/png" });
    expect(root?.export).toHaveBeenCalled();
    adapter.dispose();
  });

  it("presents an accepted typed plan as a disposable world-space skeleton", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    const skeleton: LeaferGenerationSkeleton = {
      id: "run_plan:tool_plan",
      artboard: {
        frameId: "poster_artboard",
        height: 1_000,
        pending: true,
        transform: [1, 0, 0, 1, 1_240, 80],
        width: 800,
      },
      regions: [
        {
          height: 560,
          id: "poster_hero",
          name: "Hero visual",
          role: "graphic" as const,
          width: 704,
          x: 48,
          y: 80,
        },
        {
          height: 200,
          id: "poster_title",
          name: "Launch typography",
          role: "typography" as const,
          width: 704,
          x: 48,
          y: 688,
        },
      ],
    };
    adapter.sync({ ...first, generationSkeleton: skeleton });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    expect(app.children).toEqual([app.tree, app.sky]);
    const layer = app.sky.children[0] as FakeGroup | undefined;
    const artboard = layer?.children[0] as FakeGroup | undefined;
    expect(layer).toMatchObject({
      visible: true,
      localTransform: identityMatrix(),
    });
    expect(artboard?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 1_240,
      f: 80,
    });
    expect(artboard?.children.map((child) => child.tag)).toEqual([
      "Rect",
      "Rect",
      "Text",
      "Rect",
      "Text",
    ]);
    expect(
      artboard?.children
        .filter((child) => child.tag === "Text")
        .map((child) => (child as FakeText).text),
    ).toEqual(["Hero visual", "Launch typography"]);

    app.tree.localTransform = {
      a: 0.8,
      b: 0,
      c: 0,
      d: 0.8,
      e: -96,
      f: 72,
    };
    app.emit("viewport.move");
    expect(layer?.localTransform).toEqual({
      a: 0.8,
      b: 0,
      c: 0,
      d: 0.8,
      e: -96,
      f: 72,
    });
    expect(artboard?.children[0]?.strokeWidth).toBeCloseTo(1.4375);

    adapter.sync({
      ...first,
      generationSkeleton: skeleton,
      viewport: { ...first.viewport, panX: -200, panY: 40, zoom: 0.5 },
    });
    expect(layer?.localTransform).toEqual({
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: -200,
      f: 40,
    });
    expect(artboard?.children[0]?.strokeWidth).toBeCloseTo(2.3);

    adapter.sync({
      ...first,
      generationSkeleton: {
        ...skeleton,
        artboard: {
          ...skeleton.artboard,
          transform: [1, 0, 0, 1, 1_480, 240],
        },
      },
      viewport: { ...first.viewport, panX: -200, panY: 40, zoom: 0.5 },
    });
    const movedArtboard = layer?.children[0] as FakeGroup | undefined;
    expect(movedArtboard?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 1_480,
      f: 240,
    });

    adapter.sync({
      ...first,
      generationSkeleton: {
        ...skeleton,
        artboard: {
          ...skeleton.artboard,
          pending: false,
          transform: [1, 0, 0, 1, 1_480, 240],
        },
        regions: [skeleton.regions[1]!],
      },
    });
    const updatedArtboard = layer?.children[0] as FakeGroup | undefined;
    expect(updatedArtboard?.children.map((child) => child.tag)).toEqual([
      "Rect",
      "Text",
    ]);

    adapter.finishGenerationPresentation();
    expect(layer?.visible).toBe(false);
    expect(layer?.children).toEqual([]);
    adapter.sync({ ...first, generationSkeleton: skeleton });
    expect(layer?.visible).toBe(false);

    adapter.sync({
      ...first,
      generationSkeleton: { ...skeleton, id: "run_next:tool_plan" },
    });
    expect(layer?.visible).toBe(true);
    adapter.dispose();
  });

  it("keeps generation presentation aligned when the editor sky follows the viewport", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    const skeleton: LeaferGenerationSkeleton = {
      id: "run_plan:tool_plan:target_home",
      artboard: {
        frameId: "home_artboard",
        height: 900,
        pending: true,
        transform: [1, 0, 0, 1, 1_240, 80],
        width: 420,
      },
      regions: [
        {
          height: 120,
          id: "home_header",
          name: "Header",
          role: "structure",
          width: 372,
          x: 24,
          y: 24,
        },
      ],
    };
    const activity = {
      id: "run_plan:tool_apply:requested",
      label: "AI · Building the design",
      phase: "building" as const,
      target: { x: 1_450, y: 240 },
    };
    adapter.sync({
      ...first,
      generationActivity: activity,
      generationSkeleton: skeleton,
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const presentationRoot = app.sky;
    const skeletonLayer = presentationRoot?.children[0] as
      FakeGroup | undefined;
    const activityLayer = presentationRoot?.children[3] as
      FakeGroup | undefined;

    const viewport = {
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: -300,
      f: 40,
    };
    app.tree.localTransform = { ...viewport };
    if (presentationRoot) presentationRoot.localTransform = { ...viewport };
    app.sky.localTransform = { ...viewport };
    app.emit("viewport.move");

    expect(skeletonLayer?.localTransform).toEqual(identityMatrix());
    expect(activityLayer?.localTransform).toEqual({
      a: 2,
      b: 0,
      c: 0,
      d: 2,
      e: 1_450,
      f: 240,
    });
    expect(skeletonLayer?.children[0]?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 1_240,
      f: 80,
    });

    adapter.dispose();
  });

  it("does not double-apply continuous viewport movement when the presentation plane settles later", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    const skeleton: LeaferGenerationSkeleton = {
      id: "run_plan:tool_plan:target_home",
      artboard: {
        frameId: "home_artboard",
        height: 900,
        pending: true,
        transform: [1, 0, 0, 1, 1_240, 80],
        width: 420,
      },
      regions: [
        {
          height: 120,
          id: "home_header",
          name: "Header",
          role: "structure",
          width: 372,
          x: 24,
          y: 24,
        },
      ],
    };
    adapter.sync({
      ...first,
      generationActivity: {
        id: "run_plan:tool_apply:requested",
        label: "AI · Building the design",
        phase: "building",
        target: { x: 1_450, y: 240 },
      },
      generationSkeleton: skeleton,
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const presentationRoot = app.sky;
    const skeletonLayer = presentationRoot?.children[0] as
      FakeGroup | undefined;
    const activityLayer = presentationRoot?.children[3] as
      FakeGroup | undefined;
    const viewport = {
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: -300,
      f: 40,
    };

    // Production Leafer can emit MoveEvent.MOVE after the tree has moved but
    // before the built-in editor sky observes the settled transform.
    app.tree.localTransform = { ...viewport };
    app.emit("viewport.move");
    expect(skeletonLayer?.localTransform).toEqual(viewport);
    expect(activityLayer?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 425,
      f: 160,
    });

    // Keep dragging before the queued reconciliation frame. The editor sky is
    // still on the previous viewport, so its child receives only the relative
    // delta needed to match the current document tree.
    if (presentationRoot) presentationRoot.localTransform = { ...viewport };
    const continuedViewport = {
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: -520,
      f: -60,
    };
    app.tree.localTransform = { ...continuedViewport };
    app.emit("viewport.move");
    expect(skeletonLayer?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: -440,
      f: -200,
    });
    expect(activityLayer?.localTransform).toEqual({
      a: 2,
      b: 0,
      c: 0,
      d: 2,
      e: 1_010,
      f: 40,
    });

    if (presentationRoot) {
      presentationRoot.localTransform = { ...continuedViewport };
    }
    flushAnimationFrames();

    expect(skeletonLayer?.localTransform).toEqual(identityMatrix());
    expect(activityLayer?.localTransform).toEqual({
      a: 2,
      b: 0,
      c: 0,
      d: 2,
      e: 1_450,
      f: 240,
    });
    expect(skeletonLayer?.children[0]?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 1_240,
      f: 80,
    });

    adapter.dispose();
  });

  it("reconciles the editor sky after the final viewport event", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    adapter.sync({
      ...first,
      generationActivity: {
        id: "run_plan:tool_apply:requested",
        label: "AI · Building the design",
        phase: "building",
        target: { x: 1_450, y: 240 },
      },
      generationSkeleton: {
        id: "run_plan:tool_plan:target_home",
        artboard: {
          frameId: "home_artboard",
          height: 900,
          pending: true,
          transform: [1, 0, 0, 1, 1_240, 80],
          width: 420,
        },
        regions: [
          {
            height: 120,
            id: "home_header",
            name: "Header",
            role: "structure",
            width: 372,
            x: 24,
            y: 24,
          },
        ],
      },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const presentationRoot = app.sky;
    const skeletonLayer = presentationRoot?.children[0] as
      FakeGroup | undefined;
    const activityLayer = presentationRoot?.children[3] as
      FakeGroup | undefined;
    const viewport = {
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: -300,
      f: 40,
    };

    // The document tree moves first and the ordinary viewport callback
    // compensates against the editor sky's previous identity.
    app.tree.localTransform = { ...viewport };
    app.emit("viewport.move");
    expect(skeletonLayer?.localTransform).toEqual(viewport);

    // Production Leafer may then advance the editor sky without another
    // MoveEvent reaching the adapter. Rendering this stale child transform
    // would apply pan/zoom twice, which is the packaged-app regression.
    if (presentationRoot) presentationRoot.localTransform = { ...viewport };
    app.emit("render.child-start");
    expect(skeletonLayer?.localTransform).toEqual(identityMatrix());
    expect(activityLayer?.localTransform).toEqual({
      a: 2,
      b: 0,
      c: 0,
      d: 2,
      e: 1_450,
      f: 240,
    });

    const skeletonTransformCalls = skeletonLayer?.transformCalls;
    const activityTransformCalls = activityLayer?.transformCalls;
    app.emit("render.child-start");
    expect(skeletonLayer?.transformCalls).toBe(skeletonTransformCalls);
    expect(activityLayer?.transformCalls).toBe(activityTransformCalls);

    adapter.dispose();
  });

  it("shows a non-interactive Agent cursor for trusted semantic activity", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    const activity = {
      id: "run_plan:tool_plan:accepted",
      label: "AI · Structuring the layout",
      phase: "structuring" as const,
      target: { x: 400, y: 300 },
    };
    adapter.sync({ ...first, generationActivity: activity });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const layer = app.sky.children[3] as FakeGroup | undefined;
    expect(layer).toMatchObject({
      visible: true,
      localTransform: { a: 1, b: 0, c: 0, d: 1, e: 400, f: 300 },
    });
    expect(layer?.children.map((child) => child.tag)).toEqual([
      "Path",
      "Rect",
      "Text",
    ]);
    expect((layer?.children[2] as FakeText | undefined)?.text).toBe(
      "AI · Structuring the layout",
    );

    app.tree.localTransform = {
      a: 0.8,
      b: 0,
      c: 0,
      d: 0.8,
      e: -96,
      f: 72,
    };
    app.emit("viewport.move");
    expect(layer?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 224,
      f: 312,
    });

    adapter.sync({
      ...first,
      generationActivity: activity,
      viewport: { ...first.viewport, panX: -200, panY: 40, zoom: 0.5 },
    });
    expect(layer?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 190,
    });

    adapter.sync({
      ...first,
      generationActivity: {
        ...activity,
        id: "run_plan:tool_apply:requested",
        label: "AI · Building the design",
        phase: "building",
        target: { x: 800, y: 600 },
      },
      viewport: { ...first.viewport, panX: -200, panY: 40, zoom: 0.5 },
    });
    flushAnimationFramesAt(0);
    expect(layer?.localTransform.e).toBe(0);
    flushAnimationFramesAt(180);
    expect(layer?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 200,
      f: 340,
    });

    adapter.sync({
      ...first,
      generationActivity: {
        ...activity,
        id: "run_plan:tool_review:requested",
        label: "AI · Reviewing the rendered result",
        phase: "reviewing",
        target: { x: 240, y: 160 },
      },
      reducedMotion: true,
    });
    expect(layer?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 240,
      f: 160,
    });

    adapter.finishGenerationPresentation();
    expect(layer?.visible).toBe(false);
    adapter.sync({ ...first, generationActivity: activity });
    expect(layer?.visible).toBe(true);
    adapter.finishGenerationPresentation();
    adapter.sync({ ...first, generationActivity: activity });
    expect(layer?.visible).toBe(false);
    adapter.sync({
      ...first,
      generationActivity: { ...activity, id: "run_next:tool_plan:accepted" },
    });
    expect(layer?.visible).toBe(true);
    adapter.dispose();
  });

  it("reveals committed Agent nodes as disposable wireframe and fade presentation", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();

    const runtime = new EditorRuntime(first.document);
    const frame = first.document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    const applied = runtime.apply({
      transactionId: "transaction_agent_reveal",
      documentId: first.document.documentId,
      baseRevision: first.document.revision,
      actor: { type: "agent", id: "agent_conversation" },
      label: "Add a generated card",
      commands: [
        {
          commandId: "insert_generated_card",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: frame.id,
          index: frame.childIds.length,
          node: {
            id: "generated_card",
            kind: "rectangle",
            name: "Generated card",
            parentId: frame.id,
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 760, 80],
            size: { width: 180, height: 120 },
            exportSettings: [],
            opacity: 0.8,
            properties: {
              fills: [{ type: "solid", color: "#6574ff", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
              cornerRadius: 12,
            },
            extensions: {},
          },
        },
      ],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    adapter.sync({
      ...first,
      document: runtime.getSnapshot().document,
      changes: applied.changes,
      generationActivity: {
        id: "run_reveal:tool_apply:requested",
        label: "AI · Building the design",
        phase: "building",
        target: { x: 100, y: 100 },
      },
      generationReveal: {
        focusPoints: { generated_card: { x: 900, y: 500 } },
        id: "event_agent_reveal",
        nodeIds: ["generated_card"],
        startedAt: 1_000,
      },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const card = findElement(app.tree, "generated_card");
    const activityLayer = app.sky.children[3] as FakeGroup | undefined;
    const stroker = leaferHarness.strokers[0];
    expect(card?.opacity).toBe(0);
    expect(stroker).toBeDefined();

    flushAnimationFramesAt(1_080);
    expect(card?.opacity).toBe(0);
    expect(stroker?.target).toBe(card);
    expect(stroker?.opacity).toBe(1);

    flushAnimationFramesAt(1_300);
    expect(card?.opacity).toBeGreaterThan(0);
    expect(card?.opacity).toBeLessThan(0.8);
    flushAnimationFramesAt(1_480);
    expect(activityLayer?.localTransform).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 900,
      f: 500,
    });

    adapter.finishGenerationPresentation();
    expect(card?.opacity).toBe(0.8);
    expect(stroker?.target).toBeNull();
    adapter.dispose();
  });

  it("skips reveal motion when the operating system requests reduced motion", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();
    const runtime = new EditorRuntime(first.document);
    const frame = first.document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    const applied = runtime.apply({
      transactionId: "transaction_reduced_motion",
      documentId: first.document.documentId,
      baseRevision: first.document.revision,
      actor: { type: "agent", id: "agent_conversation" },
      label: "Add without motion",
      commands: [
        {
          commandId: "insert_reduced_motion_card",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: frame.id,
          index: frame.childIds.length,
          node: {
            id: "reduced_motion_card",
            kind: "rectangle",
            name: "Reduced motion card",
            parentId: frame.id,
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 760, 80],
            size: { width: 180, height: 120 },
            exportSettings: [],
            opacity: 1,
            properties: {
              fills: [{ type: "solid", color: "#6574ff", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
              cornerRadius: 12,
            },
            extensions: {},
          },
        },
      ],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    adapter.sync({
      ...first,
      document: runtime.getSnapshot().document,
      changes: applied.changes,
      generationActivity: {
        id: "run_reduced:tool_apply:requested",
        label: "AI · Building the design",
        phase: "building",
        target: { x: 100, y: 100 },
      },
      generationReveal: {
        focusPoints: { reduced_motion_card: { x: 900, y: 500 } },
        id: "event_reduced_motion",
        nodeIds: ["reduced_motion_card"],
        startedAt: 1_000,
      },
      reducedMotion: true,
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    expect(findElement(app.tree, "reduced_motion_card")?.opacity).toBe(1);
    expect(leaferHarness.strokers[0]?.target).toBeNull();
    expect(
      (app.sky.children[3] as FakeGroup | undefined)?.localTransform,
    ).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 900, f: 500 });
    adapter.sync({
      ...first,
      document: runtime.getSnapshot().document,
      changes: applied.changes,
      generationReveal: {
        id: "event_reduced_motion",
        nodeIds: ["reduced_motion_card"],
        startedAt: 1_000,
      },
      reducedMotion: false,
    });
    flushAnimationFramesAt(1_080);
    expect(findElement(app.tree, "reduced_motion_card")?.opacity).toBe(1);
    expect(leaferHarness.strokers[0]?.target).toBeNull();
    adapter.dispose();
  });

  it("tweens changed Agent properties while keeping selection bounds synchronized", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, "feature_one");
    if (!element) throw new Error("Missing selected fixture");
    app.editor.update.mockClear();
    element.forceUpdate.mockClear();

    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const node = secondDocument.nodesById.feature_one;
    if (!node || node.kind !== "rectangle") {
      throw new Error("Missing rectangle fixture");
    }
    const previousX = node.transform[4];
    const previousWidth = node.size.width;
    node.transform = [1, 0, 0, 1, previousX + 240, node.transform[5] + 80];
    node.size = { width: previousWidth + 160, height: node.size.height + 40 };
    node.opacity = 0.6;
    node.properties.fills = [{ type: "solid", color: "#ff3366", opacity: 1 }];
    adapter.sync({
      ...first,
      changes: changedNodeSet(first.document, secondDocument, "feature_one"),
      document: secondDocument,
      generationReveal: {
        id: "event_agent_tween",
        nodeIds: [],
        startedAt: 1_000,
        tweenNodeIds: ["feature_one"],
      },
    });

    expect(element.localTransform.e).toBe(previousX);
    expect(element.width).toBe(previousWidth);
    expect(app.editor.update).toHaveBeenCalledTimes(1);
    flushAnimationFramesAt(1_150);
    expect(element.localTransform.e).toBeGreaterThan(previousX);
    expect(element.localTransform.e).toBeLessThan(node.transform[4]);
    expect(element.width).toBeGreaterThan(previousWidth);
    expect(element.width).toBeLessThan(node.size.width);
    expect(element.opacity).toBeGreaterThan(0);
    expect(element.opacity).toBeLessThan(1);
    expect(element.forceUpdate).toHaveBeenCalledWith("bounds");

    adapter.sync({
      ...first,
      changes: changedNodeSet(first.document, secondDocument, "feature_one"),
      document: secondDocument,
      generationReveal: {
        id: "event_agent_tween",
        nodeIds: [],
        startedAt: 1_000,
        tweenNodeIds: ["feature_one"],
      },
      viewport: { ...first.viewport, panX: 24, panY: -18, zoom: 1.2 },
    });
    flushAnimationFramesAt(1_300);
    expect(element.localTransform.e).toBe(node.transform[4]);
    expect(element.width).toBe(node.size.width);
    expect(element.opacity).toBe(node.opacity);
    adapter.dispose();
  });

  it("retargets a later Agent revision from the current visual value", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, "feature_one");
    if (!element) throw new Error("Missing selected fixture");

    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const secondNode = secondDocument.nodesById.feature_one;
    if (!secondNode) throw new Error("Missing selected fixture node");
    secondNode.transform = [1, 0, 0, 1, 400, 120];
    adapter.sync({
      ...first,
      changes: changedNodeSet(
        first.document,
        secondDocument,
        "feature_one",
        "transform",
      ),
      document: secondDocument,
      generationReveal: {
        id: "event_tween_first",
        nodeIds: [],
        startedAt: 1_000,
        tweenNodeIds: ["feature_one"],
      },
    });
    flushAnimationFramesAt(1_120);
    const intermediateX = element.localTransform.e;
    expect(intermediateX).toBeLessThan(400);

    const thirdDocument = structuredClone(secondDocument);
    thirdDocument.revision += 1;
    const thirdNode = thirdDocument.nodesById.feature_one;
    if (!thirdNode) throw new Error("Missing selected fixture node");
    thirdNode.transform = [1, 0, 0, 1, 640, 180];
    adapter.sync({
      ...first,
      changes: changedNodeSet(
        secondDocument,
        thirdDocument,
        "feature_one",
        "transform",
      ),
      document: thirdDocument,
      generationReveal: {
        id: "event_tween_second",
        nodeIds: [],
        startedAt: 1_120,
        tweenNodeIds: ["feature_one"],
      },
    });
    expect(element.localTransform.e).toBeCloseTo(intermediateX);
    flushAnimationFramesAt(1_270);
    expect(element.localTransform.e).toBeGreaterThan(intermediateX);
    expect(element.localTransform.e).toBeLessThan(640);
    flushAnimationFramesAt(1_420);
    expect(element.localTransform.e).toBe(640);
    adapter.dispose();
  });

  it("leaves offscreen Agent updates at their authoritative final value", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, "feature_two");
    if (!element) throw new Error("Missing sibling fixture");
    element.pageBounds = { x: 4_000, y: 4_000, width: 200, height: 120 };
    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const node = secondDocument.nodesById.feature_two;
    if (!node) throw new Error("Missing sibling fixture node");
    node.transform = [1, 0, 0, 1, 820, 420];
    adapter.sync({
      ...first,
      changes: changedNodeSet(
        first.document,
        secondDocument,
        "feature_two",
        "transform",
      ),
      document: secondDocument,
      generationReveal: {
        id: "event_tween_offscreen",
        nodeIds: [],
        startedAt: 1_000,
        tweenNodeIds: ["feature_two"],
      },
    });
    expect(element.localTransform.e).toBe(820);
    flushAnimationFramesAt(1_100);
    expect(element.localTransform.e).toBe(820);
    adapter.dispose();
  });

  it("finishes tween state before capture, direct manipulation, or reduced motion", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, "feature_one");
    if (!element) throw new Error("Missing selected fixture");
    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const node = secondDocument.nodesById.feature_one;
    if (!node) throw new Error("Missing selected fixture node");
    node.transform = [1, 0, 0, 1, 520, 180];
    const changed = changedNodeSet(
      first.document,
      secondDocument,
      "feature_one",
      "transform",
    );
    const animated = {
      ...first,
      changes: changed,
      document: secondDocument,
      generationReveal: {
        id: "event_tween_finish",
        nodeIds: [],
        startedAt: 1_000,
        tweenNodeIds: ["feature_one"],
      },
    } satisfies LeaferEngineSyncInput;
    adapter.sync(animated);
    flushAnimationFramesAt(1_100);
    expect(element.localTransform.e).toBeLessThan(520);
    await adapter.capture({ kind: "page", pageId: "page_welcome" });
    expect(element.localTransform.e).toBe(520);

    const thirdDocument = structuredClone(secondDocument);
    thirdDocument.revision += 1;
    const thirdNode = thirdDocument.nodesById.feature_one;
    if (!thirdNode) throw new Error("Missing selected fixture node");
    thirdNode.transform = [1, 0, 0, 1, 620, 210];
    adapter.sync({
      ...first,
      changes: changedNodeSet(
        secondDocument,
        thirdDocument,
        "feature_one",
        "transform",
      ),
      document: thirdDocument,
      generationReveal: {
        id: "event_tween_direct",
        nodeIds: [],
        startedAt: 1_100,
        tweenNodeIds: ["feature_one"],
      },
    });
    flushAnimationFramesAt(1_200);
    expect(element.localTransform.e).toBeLessThan(620);
    app.editor.editBox.emit("drag.start");
    expect(element.localTransform.e).toBe(620);
    app.editor.editBox.emit("drag.end");

    const fourthDocument = structuredClone(thirdDocument);
    fourthDocument.revision += 1;
    const fourthNode = fourthDocument.nodesById.feature_one;
    if (!fourthNode) throw new Error("Missing selected fixture node");
    fourthNode.transform = [1, 0, 0, 1, 700, 220];
    adapter.sync({
      ...first,
      changes: changedNodeSet(
        thirdDocument,
        fourthDocument,
        "feature_one",
        "transform",
      ),
      document: fourthDocument,
      generationReveal: {
        id: "event_tween_reduced",
        nodeIds: [],
        startedAt: 1_200,
        tweenNodeIds: ["feature_one"],
      },
      reducedMotion: true,
    });
    expect(element.localTransform.e).toBe(700);
    adapter.dispose();
  });

  it("recovers a failed tween frame to the final projection and reports the error", async () => {
    const onError = vi.fn();
    const callbacks = { ...createCallbacks(), onError };
    const adapter = await createLeaferEngineAdapter(createHost(), callbacks);
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, "feature_two");
    if (!element) throw new Error("Missing sibling fixture");
    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const node = secondDocument.nodesById.feature_two;
    if (!node) throw new Error("Missing sibling fixture node");
    node.transform = [1, 0, 0, 1, 740, 160];
    adapter.sync({
      ...first,
      changes: changedNodeSet(
        first.document,
        secondDocument,
        "feature_two",
        "transform",
      ),
      document: secondDocument,
      generationReveal: {
        id: "event_tween_frame_error",
        nodeIds: [],
        startedAt: 1_000,
        tweenNodeIds: ["feature_two"],
      },
    });
    const set = element.set.bind(element);
    let failNextFrame = true;
    element.set = (data) => {
      if (failNextFrame) {
        failNextFrame = false;
        throw new Error("Tween paint failed");
      }
      set(data);
    };
    flushAnimationFramesAt(1_150);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Tween paint failed" }),
    );
    expect(element.localTransform.e).toBe(740);
    adapter.dispose();
  });

  it("restores an active tween before adapter disposal", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, "feature_two");
    if (!element) throw new Error("Missing sibling fixture");
    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const node = secondDocument.nodesById.feature_two;
    if (!node) throw new Error("Missing sibling fixture node");
    node.transform = [1, 0, 0, 1, 780, 220];
    adapter.sync({
      ...first,
      changes: changedNodeSet(
        first.document,
        secondDocument,
        "feature_two",
        "transform",
      ),
      document: secondDocument,
      generationReveal: {
        id: "event_tween_dispose",
        nodeIds: [],
        startedAt: 1_000,
        tweenNodeIds: ["feature_two"],
      },
    });
    flushAnimationFramesAt(1_100);
    expect(element.localTransform.e).toBeLessThan(780);
    const skeletonLayer = app.sky.children[0];
    const activityLayer = app.sky.children.find(
      (child): child is FakeGroup =>
        child instanceof FakeGroup &&
        child.children.some((candidate) => candidate instanceof FakeText) &&
        child.children.some((candidate) => candidate instanceof FakePath),
    );
    const revealStroker = leaferHarness.strokers[0];
    if (!skeletonLayer || !activityLayer || !revealStroker) {
      throw new Error("Missing generation presentation resources");
    }
    adapter.dispose();
    expect(element.localTransform.e).toBe(780);
    expect(skeletonLayer.destroy).toHaveBeenCalledTimes(1);
    expect(activityLayer.destroy).toHaveBeenCalledTimes(1);
    expect(revealStroker.destroy).toHaveBeenCalledTimes(1);
  });

  it("refreshes an unchanged selection after revisions and viewport gestures", async () => {
    const host = createHost();
    const adapter = await createLeaferEngineAdapter(host, createCallbacks());
    const first = createInput();

    adapter.sync(first);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const selectedElement = app.editor.list[0];
    expect(selectedElement?.id).toBe("feature_one");
    expect(app.editor.update).toHaveBeenCalledTimes(1);
    selectedElement?.forceUpdate.mockClear();
    app.tree.forceUpdate.mockClear();

    const nextDocument = structuredClone(first.document);
    nextDocument.revision = first.document.revision + 1;
    const node = nextDocument.nodesById.feature_one;
    if (!node) throw new Error("Missing selected fixture node");
    node.size = { width: 420, height: 180 };

    adapter.sync({ ...first, document: nextDocument });
    expect(app.editor.list[0]).toBe(selectedElement);
    flushAnimationFrames();

    expect(app.tree.forceUpdate).not.toHaveBeenCalled();
    expect(selectedElement?.forceUpdate).toHaveBeenCalledWith("bounds");
    expect(app.editor.update).toHaveBeenCalledTimes(2);

    app.emit("viewport.zoom");
    app.emit("viewport.move");
    expect(animationFrames).toHaveLength(2);
    flushAnimationFrames();

    expect(app.editor.update).toHaveBeenCalledTimes(3);
    adapter.dispose();
  });

  it("updates only changed elements and refreshes bounds only when selection geometry depends on them", async () => {
    const host = createHost();
    const adapter = await createLeaferEngineAdapter(host, createCallbacks());
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const selected = findElement(app.tree, "feature_one");
    const sibling = findElement(app.tree, "feature_two");
    if (!selected || !sibling) throw new Error("Missing projected fixtures");
    const selectedSetCalls = selected.setCalls;
    const siblingSetCalls = sibling.setCalls;
    selected.forceUpdate.mockClear();
    app.tree.forceUpdate.mockClear();
    app.editor.update.mockClear();

    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const secondNode = secondDocument.nodesById.feature_two;
    if (!secondNode) throw new Error("Missing sibling fixture");
    secondNode.opacity = 0.5;
    adapter.sync({
      ...first,
      document: secondDocument,
      changes: changedNodeSet(first.document, secondDocument, "feature_two"),
    });
    flushAnimationFrames();

    expect(selected.setCalls).toBe(selectedSetCalls);
    expect(sibling.setCalls).toBe(siblingSetCalls + 1);
    expect(app.tree.forceUpdate).not.toHaveBeenCalled();
    expect(selected.forceUpdate).not.toHaveBeenCalled();
    expect(app.editor.update).not.toHaveBeenCalled();

    app.tree.forceUpdate.mockClear();
    app.editor.update.mockClear();
    const thirdDocument = structuredClone(secondDocument);
    thirdDocument.revision += 1;
    const thirdNode = thirdDocument.nodesById.feature_one;
    if (!thirdNode) throw new Error("Missing selected fixture");
    thirdNode.size = { width: 410, height: 170 };
    adapter.sync({
      ...first,
      document: thirdDocument,
      changes: changedNodeSet(secondDocument, thirdDocument, "feature_one"),
    });
    flushAnimationFrames();

    expect(selected.setCalls).toBe(selectedSetCalls + 1);
    expect(sibling.setCalls).toBe(siblingSetCalls + 1);
    expect(app.tree.forceUpdate).not.toHaveBeenCalled();
    expect(selected.forceUpdate).toHaveBeenCalledTimes(1);
    expect(selected.forceUpdate).toHaveBeenCalledWith("bounds");
    expect(app.editor.update).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("instantiates visible Leafer paths with OpenDesign appearance data", async () => {
    const host = createHost();
    const adapter = await createLeaferEngineAdapter(host, createCallbacks());
    const initialInput = createInput();
    const document = structuredClone(initialInput.document);
    const input = { ...initialInput, document };
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    const mascotPath =
      "M 80 4 C 126 4 154 46 148 108 C 143 171 118 214 80 216 C 42 214 17 171 12 108 C 6 46 34 4 80 4 Z";
    document.nodesById.mascot_path = {
      id: "mascot_path",
      name: "Mascot silhouette",
      parentId: frame.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 24, 32],
      size: { width: 160, height: 220 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "path",
      properties: {
        path: mascotPath,
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [{ type: "solid", color: "#ffffff", opacity: 0.8 }],
        strokeWidth: 3,
        fillRule: "evenodd",
      },
    };
    frame.childIds.push("mascot_path");

    adapter.sync(input);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const path = findElement(app.tree, "mascot_path");
    expect(path).toBeInstanceOf(FakePath);
    expect(path).toMatchObject({
      path: mascotPath,
      fill: [{ type: "solid", color: "#111827", opacity: 1 }],
      stroke: [{ type: "solid", color: "#ffffff", opacity: 0.8 }],
      strokeWidth: 3,
      windingRule: "evenodd",
    });
    adapter.dispose();
  });

  it("loads PathKit only for Boolean pages and maps synthetic hits to the source Boolean", async () => {
    let resolveProvider:
      ((provider: VectorGeometryProvider) => void) | undefined;
    const providerPromise = new Promise<VectorGeometryProvider>((resolve) => {
      resolveProvider = resolve;
    });
    const loader = vi.fn(() => providerPromise);
    const onSelectionChange = vi.fn();
    const callbacks = { ...createCallbacks(), onSelectionChange };
    const adapter = await createLeaferEngineAdapter(createHost(), callbacks, {
      loadVectorGeometryProvider: loader,
    });
    const ordinary = createInput();
    adapter.sync(ordinary);
    expect(loader).not.toHaveBeenCalled();

    const booleanInput = withBooleanFixture(ordinary);
    adapter.sync(booleanInput);
    expect(loader).toHaveBeenCalledTimes(1);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const resultId = booleanResultElementId("boolean_mark");
    expect(findElement(app.tree, resultId)).toBeUndefined();

    resolveProvider?.(fakeVectorGeometryProvider());
    await flushMicrotasks();
    flushAnimationFrames();

    const group = findElement(app.tree, "boolean_mark");
    const result = findElement(app.tree, resultId);
    const base = findElement(app.tree, "boolean_base");
    const cutout = findElement(app.tree, "boolean_cutout");
    expect(group).toBeInstanceOf(FakeGroup);
    expect(result).toBeInstanceOf(FakePath);
    expect((group as FakeGroup).children.map((child) => child.id)).toEqual([
      resultId,
      "boolean_base",
      "boolean_cutout",
    ]);
    expect(result).toMatchObject({
      editable: false,
      fill: [{ type: "solid", color: "#111827", opacity: 1 }],
      visible: true,
    });
    expect(base).toMatchObject({ visible: false });
    expect(cutout).toMatchObject({ visible: false });

    app.editor.target = [result!];
    app.editor.emit("editor.select");
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      ["boolean_mark"],
      "boolean_mark",
    );
    adapter.dispose();
  });

  it("projects only Boolean operand outlines in edit scope and writes transforms to the source operand", async () => {
    const onOperations = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      { ...createCallbacks(), onOperations },
      {
        loadVectorGeometryProvider: () =>
          Promise.resolve(fakeVectorGeometryProvider()),
      },
    );
    const input = withBooleanFixture(createInput());
    adapter.sync(input);
    await flushMicrotasks();
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const base = findElement(app.tree, "boolean_base");
    const cutout = findElement(app.tree, "boolean_cutout");
    const result = findElement(
      app.tree,
      booleanResultElementId("boolean_mark"),
    );
    const unrelated = findElement(app.tree, "feature_two");
    if (!base || !cutout || !(result instanceof FakePath) || !unrelated) {
      throw new Error("Missing Boolean edit fixtures");
    }
    const resultSetCalls = result.setCalls;
    const unrelatedSetCalls = unrelated.setCalls;

    adapter.sync({
      ...input,
      booleanEditScope: {
        booleanId: "boolean_mark",
        readOnly: false,
        selectedOperandIds: ["boolean_base"],
      },
      selection: { nodeIds: ["boolean_base"], anchorNodeId: "boolean_base" },
    });
    flushAnimationFrames();

    expect(base).toMatchObject({
      fill: null,
      hittable: true,
      opacity: 1,
      stroke: "#4f7fff",
      visible: true,
    });
    expect(cutout).toMatchObject({
      fill: null,
      hittable: true,
      stroke: "#4f7fff",
      visible: true,
    });
    expect(result.setCalls).toBe(resultSetCalls);
    expect(unrelated.setCalls).toBe(unrelatedSetCalls);
    expect(app.editor.list).toEqual([base]);

    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    const resultPathBeforeMove = result.path;
    base.localTransform.e = 18;
    app.editor.emit("editor.move");
    flushAnimationFrames();
    expect(result.path).not.toBe(resultPathBeforeMove);
    expect(result.setCalls).toBe(resultSetCalls + 1);
    expect(unrelated.setCalls).toBe(unrelatedSetCalls);
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");
    expect(onOperations).toHaveBeenCalledWith({
      kind: "move",
      selectionNodeIds: ["boolean_base"],
      operations: [
        expect.objectContaining({
          nodeId: "boolean_base",
          transform: [1, 0, 0, 1, 18, 0],
          type: "update_properties",
        }),
      ],
    });
    const previewResultSetCalls = result.setCalls;

    adapter.sync(input);
    flushAnimationFrames();
    expect(base).toMatchObject({
      fill: [{ type: "solid", color: "#ef4444", opacity: 1 }],
      visible: false,
    });
    expect(result.setCalls).toBe(previewResultSetCalls);
    expect(unrelated.setCalls).toBe(unrelatedSetCalls);
    expect(app.editor.list).toEqual([findElement(app.tree, "boolean_mark")]);
    adapter.dispose();
  });

  it("keeps locked Boolean operands selectable in edit scope without submitting direct manipulation", async () => {
    const onOperations = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      { ...createCallbacks(), onOperations },
      {
        loadVectorGeometryProvider: () =>
          Promise.resolve(fakeVectorGeometryProvider()),
      },
    );
    const input = withBooleanFixture(createInput());
    const document = structuredClone(input.document);
    const boolean = document.nodesById.boolean_mark;
    if (!boolean || boolean.kind !== "boolean") {
      throw new Error("Missing Boolean fixture");
    }
    boolean.locked = true;
    adapter.sync({
      ...input,
      booleanEditScope: {
        booleanId: boolean.id,
        readOnly: true,
        selectedOperandIds: ["boolean_base"],
      },
      document,
      selection: { nodeIds: ["boolean_base"], anchorNodeId: "boolean_base" },
    });
    await flushMicrotasks();
    flushAnimationFrames();

    const app = leaferHarness.app;
    const base = app && findElement(app.tree, "boolean_base");
    if (!app || !base) throw new Error("Missing locked operand projection");
    expect(base).toMatchObject({
      locked: false,
      stroke: "#4f7fff",
      visible: true,
    });
    expect(app.editor.list).toEqual([base]);

    app.editor.moving = true;
    base.localTransform.e = 64;
    app.editor.emit("editor.before-move");
    app.editor.emit("editor.move");
    expect(base.localTransform.e).toBe(0);
    expect(onOperations).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("recomputes only an affected Boolean result after contiguous changes", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
      {
        loadVectorGeometryProvider: () =>
          Promise.resolve(fakeVectorGeometryProvider()),
      },
    );
    const first = withBooleanFixture(createInput());
    adapter.sync(first);
    await flushMicrotasks();
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const result = findElement(
      app.tree,
      booleanResultElementId("boolean_mark"),
    );
    const unrelated = findElement(app.tree, "feature_two");
    if (!result || !unrelated) throw new Error("Missing projected fixtures");
    const resultSetCalls = result.setCalls;
    const unrelatedSetCalls = unrelated.setCalls;

    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const feature = secondDocument.nodesById.feature_two;
    if (!feature) throw new Error("Missing unrelated feature");
    feature.opacity = 0.5;
    adapter.sync({
      ...first,
      document: secondDocument,
      changes: changedNodeSet(first.document, secondDocument, "feature_two"),
    });
    flushAnimationFrames();
    expect(result.setCalls).toBe(resultSetCalls);
    expect(unrelated.setCalls).toBe(unrelatedSetCalls + 1);

    const thirdDocument = structuredClone(secondDocument);
    thirdDocument.revision += 1;
    const cutout = thirdDocument.nodesById.boolean_cutout;
    if (!cutout) throw new Error("Missing Boolean cutout");
    cutout.transform = [1, 0, 0, 1, 44, 36];
    adapter.sync({
      ...first,
      document: thirdDocument,
      changes: changedNodeSet(
        secondDocument,
        thirdDocument,
        "boolean_cutout",
        "transform",
      ),
    });
    flushAnimationFrames();
    expect(result.setCalls).toBe(resultSetCalls + 1);
    expect(unrelated.setCalls).toBe(unrelatedSetCalls + 1);

    const fourthDocument = structuredClone(thirdDocument);
    fourthDocument.revision += 1;
    const frame = fourthDocument.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    frame.childIds = frame.childIds.filter(
      (nodeId) => nodeId !== "boolean_mark",
    );
    delete fourthDocument.nodesById.boolean_mark;
    delete fourthDocument.nodesById.boolean_base;
    delete fourthDocument.nodesById.boolean_cutout;
    adapter.sync({
      ...first,
      document: fourthDocument,
      changes: {
        addedNodeIds: [],
        changedNodeIds: [frame.id],
        changes: [],
        documentId: fourthDocument.documentId,
        fromRevision: thirdDocument.revision,
        removedNodeIds: ["boolean_mark", "boolean_base", "boolean_cutout"],
        toRevision: fourthDocument.revision,
      },
    });
    flushAnimationFrames();
    expect(
      findElement(app.tree, booleanResultElementId("boolean_mark")),
    ).toBeUndefined();
    expect(findElement(app.tree, "boolean_mark")).toBeUndefined();
    adapter.dispose();
  });

  it("surfaces lazy geometry load failures and ignores providers that arrive after dispose", async () => {
    const loadError = new Error("WASM unavailable");
    const onError = vi.fn();
    const onWarning = vi.fn();
    const onWarningsChange = vi.fn();
    const loader = vi
      .fn<() => Promise<VectorGeometryProvider>>()
      .mockRejectedValueOnce(loadError)
      .mockResolvedValueOnce(fakeVectorGeometryProvider());
    const failedAdapter = await createLeaferEngineAdapter(
      createHost(),
      { ...createCallbacks(), onError, onWarning, onWarningsChange },
      { loadVectorGeometryProvider: loader },
    );
    failedAdapter.sync(withBooleanFixture(createInput()));
    await flushMicrotasks();
    expect(onError).not.toHaveBeenCalled();
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "boolean-geometry-provider-failed",
        nodeId: "boolean_mark",
      }),
    );
    expect(onWarningsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ code: "boolean-geometry-provider-failed" }),
    ]);
    expect(failedAdapter.retryBooleanGeometry()).toBe(true);
    await flushMicrotasks();
    flushAnimationFrames();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(onWarningsChange).toHaveBeenLastCalledWith([]);
    expect(
      findElement(
        leaferHarness.app!.tree,
        booleanResultElementId("boolean_mark"),
      ),
    ).toBeInstanceOf(FakePath);
    expect(failedAdapter.retryBooleanGeometry()).toBe(false);
    failedAdapter.dispose();

    let resolveProvider:
      ((provider: VectorGeometryProvider) => void) | undefined;
    const pending = new Promise<VectorGeometryProvider>((resolve) => {
      resolveProvider = resolve;
    });
    const lateError = vi.fn();
    const disposedAdapter = await createLeaferEngineAdapter(
      createHost(),
      { ...createCallbacks(), onError: lateError },
      { loadVectorGeometryProvider: () => pending },
    );
    disposedAdapter.sync(withBooleanFixture(createInput()));
    disposedAdapter.dispose();
    resolveProvider?.(fakeVectorGeometryProvider());
    await flushMicrotasks();
    expect(lateError).not.toHaveBeenCalled();
  });

  it("ends capture waiting for geometry when the adapter is disposed", async () => {
    const pending = new Promise<VectorGeometryProvider>(() => undefined);
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
      { loadVectorGeometryProvider: () => pending },
    );
    const input = withBooleanFixture(createInput());
    adapter.sync(input);

    const capture = adapter.capture({ kind: "page", pageId: input.pageId });
    adapter.dispose();

    await expect(capture).rejects.toThrow(
      "Leafer capture target changed during rendering",
    );
  });

  it("retries an asynchronous Boolean projection after reconcile fails", async () => {
    const onError = vi.fn();
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      { ...createCallbacks(), onError },
      {
        loadVectorGeometryProvider: () =>
          Promise.resolve(fakeVectorGeometryProvider()),
      },
    );
    const input = withBooleanFixture(createInput());
    adapter.sync(input);
    leaferHarness.failReconcileSetCount = 1;
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Synthetic reconcile failure" }),
    );
    expect(adapter.retryBooleanGeometry()).toBe(true);
    await flushMicrotasks();
    flushAnimationFrames();
    expect(
      findElement(
        leaferHarness.app!.tree,
        booleanResultElementId("boolean_mark"),
      ),
    ).toBeInstanceOf(FakePath);
    adapter.dispose();
  });

  it("does not publish an asynchronous projection from a stale committed base", async () => {
    let resolveProvider:
      ((provider: VectorGeometryProvider) => void) | undefined;
    const provider = new Promise<VectorGeometryProvider>((resolve) => {
      resolveProvider = resolve;
    });
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
      { loadVectorGeometryProvider: () => provider },
    );
    const first = withBooleanFixture(createInput());
    adapter.sync(first);
    const source = first.document.nodesById.feature_one;
    if (!source || source.kind !== "rectangle") {
      throw new Error("Missing stale-base replacement source");
    }
    const document = structuredClone(first.document);
    document.revision += 1;
    const replacement = {
      ...structuredClone(source),
      kind: "ellipse" as const,
    };
    document.nodesById[replacement.id] = replacement;
    const next = {
      ...first,
      changes: changedNodeSet(first.document, document, replacement.id, "kind"),
      document,
    };

    leaferHarness.failReconcileCount = 2;
    adapter.sync(next);
    resolveProvider?.(fakeVectorGeometryProvider());
    await flushMicrotasks();

    adapter.sync(next);
    expect(findElement(leaferHarness.app!.tree, replacement.id)).toBeInstanceOf(
      FakeEllipse,
    );
    expect(
      findElement(
        leaferHarness.app!.tree,
        booleanResultElementId("boolean_mark"),
      ),
    ).toBeInstanceOf(FakePath);
    adapter.dispose();
  });

  it("isolates warning observers from scene reconciliation", async () => {
    const observerError = new Error("Warning observer failed");
    const onError = vi.fn();
    const onWarning = vi.fn(() => {
      throw observerError;
    });
    const onWarningsChange = vi.fn(() => {
      throw observerError;
    });
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      { ...createCallbacks(), onError, onWarning, onWarningsChange },
      {
        loadVectorGeometryProvider: () =>
          Promise.reject(new Error("Geometry unavailable")),
      },
    );
    const input = withBooleanFixture(createInput());

    adapter.sync(input);
    await flushMicrotasks();

    expect(findElement(leaferHarness.app!.tree, "boolean_mark")).toBeInstanceOf(
      FakeGroup,
    );
    expect(onWarning).toHaveBeenCalled();
    expect(onWarningsChange).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(observerError);
    adapter.dispose();
  });

  it("forces a full retry when the same revision failed to reconcile", async () => {
    const onError = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onError,
    });
    const first = createInput();
    adapter.sync(first);
    const source = first.document.nodesById.feature_one;
    if (!source || source.kind !== "rectangle") {
      throw new Error("Missing replacement source");
    }
    const document = structuredClone(first.document);
    document.revision += 1;
    const replacement = {
      ...structuredClone(source),
      kind: "ellipse" as const,
    };
    document.nodesById[replacement.id] = replacement;
    const next = {
      ...first,
      changes: changedNodeSet(first.document, document, replacement.id, "kind"),
      document,
    };

    leaferHarness.failReconcileCount = 2;
    adapter.sync(next);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Synthetic reconcile failure" }),
    );

    adapter.sync(next);
    expect(findElement(leaferHarness.app!.tree, replacement.id)).toBeInstanceOf(
      FakeEllipse,
    );
    adapter.dispose();
  });

  it("contains Boolean preview reconcile errors and restores the authoritative scene", async () => {
    const onError = vi.fn();
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      { ...createCallbacks(), onError },
      {
        loadVectorGeometryProvider: () =>
          Promise.resolve(fakeVectorGeometryProvider()),
      },
    );
    const input = withBooleanFixture(createInput());
    const editing = {
      ...input,
      booleanEditScope: {
        booleanId: "boolean_mark",
        readOnly: false,
        selectedOperandIds: ["boolean_base"],
      },
      selection: { nodeIds: ["boolean_base"], anchorNodeId: "boolean_base" },
    };
    adapter.sync(input);
    await flushMicrotasks();
    adapter.sync(editing);
    flushAnimationFrames();
    const app = leaferHarness.app!;
    const base = findElement(app.tree, "boolean_base");
    if (!base) throw new Error("Missing Boolean operand");
    app.editor.target = [base];
    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    base.localTransform.e = 24;
    leaferHarness.failReconcileSetCount = 1;

    expect(() => app.editor.emit("editor.move")).not.toThrow();
    flushAnimationFrames();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Synthetic reconcile failure" }),
    );
    expect(findElement(app.tree, "boolean_base")?.localTransform.e).toBe(0);
    adapter.dispose();
  });

  it("does not cancel a direct manipulation when a contiguous revision changes an unrelated node", async () => {
    const onOperations = vi.fn(() => true);
    const host = createHost();
    const adapter = await createLeaferEngineAdapter(host, {
      ...createCallbacks(),
      onOperations,
    });
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const selected = findElement(app.tree, "feature_one");
    if (!selected) throw new Error("Missing selected fixture");
    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    selected.localTransform.e = 36;
    app.editor.emit("editor.move");

    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const sibling = secondDocument.nodesById.feature_two;
    if (!sibling) throw new Error("Missing sibling fixture");
    sibling.opacity = 0.5;
    adapter.sync({
      ...first,
      document: secondDocument,
      changes: changedNodeSet(first.document, secondDocument, "feature_two"),
    });

    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");
    expect(onOperations).toHaveBeenCalledWith({
      kind: "move",
      selectionNodeIds: ["feature_one"],
      operations: [
        expect.objectContaining({
          type: "update_properties",
          nodeId: "feature_one",
          transform: [1, 0, 0, 1, 36, 0],
        }),
      ],
    });
    adapter.dispose();
  });

  it("commits one multi-selection direct manipulation and skips unchanged descendants", async () => {
    const onOperations = vi.fn(() => true);
    const input = createInput();
    input.selection = {
      nodeIds: ["feature_one", "feature_two"],
      anchorNodeId: "feature_two",
    };
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const first = app && findElement(app.tree, "feature_one");
    const second = app && findElement(app.tree, "feature_two");
    if (!app || !first || !second) throw new Error("Missing card fixtures");

    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    first.localTransform.e += 24;
    second.localTransform.e += 24;
    app.editor.emit("editor.move");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(onOperations).toHaveBeenCalledTimes(1);
    expect(onOperations).toHaveBeenCalledWith({
      kind: "move",
      selectionNodeIds: ["feature_one", "feature_two"],
      operations: [
        expect.objectContaining({
          nodeId: "feature_one",
          type: "update_properties",
        }),
        expect.objectContaining({
          nodeId: "feature_two",
          type: "update_properties",
        }),
      ],
    });
    adapter.dispose();
  });

  it("classifies rotate and skew gestures without committing a no-op", async () => {
    for (const fixture of [
      {
        beforeEvent: "editor.before-rotate",
        changedEvent: "editor.rotate",
        kind: "rotate" as const,
        prepare: (app: FakeApp) => {
          app.editor.rotating = true;
        },
        transform: { a: 0, b: 1, c: -1, d: 0 },
      },
      {
        beforeEvent: "editor.before-skew",
        changedEvent: "editor.skew",
        kind: "skew" as const,
        prepare: (app: FakeApp) => {
          app.editor.skewing = true;
        },
        transform: { a: 1, b: 0, c: 0.25, d: 1 },
      },
    ]) {
      const onOperations = vi.fn(() => true);
      const adapter = await createLeaferEngineAdapter(createHost(), {
        ...createCallbacks(),
        onOperations,
      });
      adapter.sync(createInput());
      flushAnimationFrames();
      const app = leaferHarness.app;
      const selected = app && findElement(app.tree, "feature_one");
      if (!app || !selected) throw new Error("Missing selected fixture");

      fixture.prepare(app);
      app.editor.editBox.dragging = true;
      app.editor.emit(fixture.beforeEvent);
      app.editor.emit(fixture.changedEvent);
      app.editor.editBox.dragging = false;
      app.editor.editBox.emit("drag.end");
      expect(onOperations).not.toHaveBeenCalled();

      app.editor.editBox.dragging = true;
      app.editor.emit(fixture.beforeEvent);
      Object.assign(selected.localTransform, fixture.transform);
      app.editor.emit(fixture.changedEvent);
      app.editor.editBox.dragging = false;
      app.editor.editBox.emit("drag.end");

      expect(onOperations).toHaveBeenCalledWith(
        expect.objectContaining({ kind: fixture.kind }),
      );
      adapter.dispose();
    }
  });

  it("restores a direct manipulation on Escape, scope change, rejection, and dispose", async () => {
    const onOperations = vi.fn(() => false);
    const input = createInput();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const selected = app && findElement(app.tree, "feature_one");
    if (!app || !selected) throw new Error("Missing selected fixture");

    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    selected.localTransform.e = 36;
    app.editor.emit("editor.move");
    const escape = emitWindowKey("Escape");
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
    expect(selected.localTransform.e).toBe(0);
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");
    expect(onOperations).not.toHaveBeenCalled();

    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    selected.localTransform.e = 48;
    app.editor.emit("editor.move");
    adapter.sync({ ...input, tool: "pen" });
    expect(selected.localTransform.e).toBe(0);
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");
    expect(onOperations).not.toHaveBeenCalled();

    adapter.sync(input);
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    selected.localTransform.e = 60;
    app.editor.emit("editor.move");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");
    expect(onOperations).toHaveBeenCalledTimes(1);
    expect(selected.localTransform.e).toBe(0);

    onOperations.mockClear();
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    selected.localTransform.e = 72;
    app.editor.emit("editor.move");
    adapter.dispose();
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");
    expect(onOperations).not.toHaveBeenCalled();
  });

  it("does not submit a direct manipulation after a non-contiguous revision", async () => {
    const onOperations = vi.fn(() => true);
    const input = createInput();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const selected = app && findElement(app.tree, "feature_one");
    if (!app || !selected) throw new Error("Missing selected fixture");

    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    selected.localTransform.e = 36;
    app.editor.emit("editor.move");
    const replacement = structuredClone(input.document);
    replacement.revision += 1;
    adapter.sync({ ...input, document: replacement });
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(onOperations).not.toHaveBeenCalled();
    expect(selected.localTransform.e).toBe(0);
    adapter.dispose();
  });

  it("keeps Auto Width text measured while moving and emits explicit bounds when resized", async () => {
    const onOperations = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    const first = createInput();
    const input = { ...first, document: structuredClone(first.document) };
    const text = input.document.nodesById.title_welcome;
    if (!text || text.kind !== "text") throw new Error("Missing text");
    Object.assign(text.properties, {
      textResize: "auto-width",
      textWrap: "none",
      textOverflow: "visible",
    });
    text.size = { width: text.properties.content.length * 12, height: 32 };
    input.selection = { nodeIds: [text.id], anchorNodeId: text.id };
    adapter.sync(input);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const element = findElement(app.tree, text.id);
    if (!element) throw new Error("Missing text element");
    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    element.localTransform.e += 24;
    app.editor.emit("editor.move");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(onOperations).toHaveBeenLastCalledWith({
      kind: "move",
      selectionNodeIds: [text.id],
      operations: [
        {
          commandId: `leafer_transform_${text.id}`,
          type: "update_properties",
          nodeId: text.id,
          transform: [1, 0, 0, 1, text.transform[4] + 24, text.transform[5]],
        },
      ],
    });

    onOperations.mockClear();
    app.editor.moving = false;
    app.editor.resizing = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-scale");
    element.width = 420;
    element.height = 96;
    app.editor.emit("editor.scale");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(onOperations).toHaveBeenLastCalledWith({
      kind: "resize",
      selectionNodeIds: [text.id],
      operations: [
        expect.objectContaining({
          commandId: `leafer_transform_${text.id}`,
          type: "update_properties",
          nodeId: text.id,
          size: { width: 420, height: 96 },
        }),
      ],
    });
    adapter.dispose();
  });

  it("keeps an inherited-locked element selectable while rejecting its transform", async () => {
    const onOperations = vi.fn(() => true);
    const onSelectionChange = vi.fn();
    const host = createHost();
    const adapter = await createLeaferEngineAdapter(host, {
      ...createCallbacks(),
      onOperations,
      onSelectionChange,
    });
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const selected = findElement(app.tree, "feature_one");
    if (!selected) throw new Error("Missing selected fixture");
    app.editor.moving = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-move");
    selected.localTransform.e = 36;
    app.editor.emit("editor.move");

    const lockedDocument = structuredClone(first.document);
    lockedDocument.revision += 1;
    const lockedFrame = lockedDocument.nodesById.frame_welcome;
    if (!lockedFrame) throw new Error("Missing frame fixture");
    lockedFrame.locked = true;
    adapter.sync({
      ...first,
      document: lockedDocument,
      changes: changedNodeSet(
        first.document,
        lockedDocument,
        "frame_welcome",
        "locked",
      ),
    });

    expect(selected.locked).toBe(false);
    expect(app.editor.list).toEqual([selected]);
    app.editor.emit("editor.select");
    expect(onSelectionChange).toHaveBeenCalledWith(
      ["feature_one"],
      "feature_one",
    );
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");
    expect(onOperations).not.toHaveBeenCalled();

    selected.localTransform.e = 72;
    app.editor.emit("editor.before-move");
    app.editor.emit("editor.move");
    expect(selected.localTransform.e).toBe(0);
    expect(onOperations).not.toHaveBeenCalled();

    const unlockedDocument = structuredClone(lockedDocument);
    unlockedDocument.revision += 1;
    const unlockedFrame = unlockedDocument.nodesById.frame_welcome;
    if (!unlockedFrame) throw new Error("Missing frame fixture");
    unlockedFrame.locked = false;
    adapter.sync({
      ...first,
      document: unlockedDocument,
      changes: changedNodeSet(
        lockedDocument,
        unlockedDocument,
        "frame_welcome",
        "locked",
      ),
    });

    expect(selected.locked).toBe(false);
    expect(app.editor.list).toEqual([selected]);
    adapter.dispose();
  });

  it("clears stale hover chrome when a hovered layer becomes locked", async () => {
    const host = createHost();
    const adapter = await createLeaferEngineAdapter(host, createCallbacks());
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const frame = findElement(app.tree, "frame_welcome");
    if (!frame) throw new Error("Missing frame fixture");
    app.editor.hoverTarget = frame;

    const lockedDocument = structuredClone(first.document);
    lockedDocument.revision += 1;
    const lockedFrame = lockedDocument.nodesById.frame_welcome;
    if (!lockedFrame) throw new Error("Missing frame fixture");
    lockedFrame.locked = true;
    adapter.sync({
      ...first,
      document: lockedDocument,
      changes: changedNodeSet(
        first.document,
        lockedDocument,
        "frame_welcome",
        "locked",
      ),
    });

    expect(app.editor.hoverTarget).toBeNull();
    adapter.dispose();
  });

  it("projects Layers-panel hover as an independent full-path canvas outline", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const input = createInput();
    adapter.sync({
      ...input,
      layerHoverTarget: { nodeId: "feature_two" },
    });
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const hovered = findElement(app.tree, "feature_two");
    const hoverStroker = leaferHarness.strokers[1];
    expect(hoverStroker?.target).toBe(hovered);
    expect(hoverStroker).toMatchObject({
      hittable: false,
      opacity: 1,
      strokePathType: "render-path",
      strokeWidth: 1,
    });

    adapter.sync({
      ...input,
      layerHoverTarget: { nodeId: "feature_two" },
      selection: { nodeIds: ["feature_two"], anchorNodeId: "feature_two" },
    });
    expect(hoverStroker?.target).toBeNull();

    adapter.sync({
      ...input,
      layerHoverTarget: { nodeId: "feature_two" },
      tool: "rectangle",
    });
    expect(hoverStroker?.target).toBeNull();

    const hiddenDocument = structuredClone(input.document);
    hiddenDocument.revision += 1;
    const hidden = hiddenDocument.nodesById.feature_two;
    if (!hidden) throw new Error("Missing hover fixture");
    hidden.visible = false;
    adapter.sync({
      ...input,
      document: hiddenDocument,
      layerHoverTarget: { nodeId: "feature_two" },
    });
    expect(hoverStroker?.target).toBeNull();
    adapter.dispose();
  });

  it("resolves Layers-panel hover for a component-derived layer", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const input = componentInput();
    adapter.sync({
      ...input,
      layerHoverTarget: {
        nodeId: "button_instance",
        componentTarget: {
          instanceId: "button_instance",
          sourcePath: ["button_bg"],
        },
      },
    });
    flushAnimationFrames();

    const app = leaferHarness.app;
    const projected =
      app &&
      findElement(
        app.tree,
        componentProjectionId("button_instance", ["button_bg"]),
      );
    expect(leaferHarness.strokers[1]?.target).toBe(projected);
    adapter.dispose();
  });

  it("hides selection and hover chrome while the Pen tool owns the canvas", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const input = createInput();
    adapter.sync(input);
    flushAnimationFrames();
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const selected = findElement(app.tree, "feature_one");
    if (!selected) throw new Error("Missing selected fixture");
    app.editor.hoverTarget = selected;

    adapter.sync({ ...input, tool: "pen" });

    expect(app.editor.visible).toBe(false);
    expect(app.editor.hittable).toBe(false);
    expect(app.editor.hoverTarget).toBeNull();
    expect(app.editor.list).toEqual([selected]);

    adapter.sync(input);
    expect(app.editor.visible).toBe(true);
    expect(app.editor.hittable).toBe(true);
    expect(app.editor.list).toEqual([selected]);
    adapter.dispose();
  });

  it("recomputes box selection from the pointer-up bounds", async () => {
    const host = createHost();
    const adapter = await createLeaferEngineAdapter(host, createCallbacks());
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const firstCard = findElement(app.tree, "feature_one");
    const secondCard = findElement(app.tree, "feature_two");
    if (!firstCard || !secondCard) throw new Error("Missing card fixtures");
    leaferHarness.boxMatches = [firstCard, secondCard];
    app.editor.selector.dragging = true;
    app.emit("drag.start", boxDragEvent(20, 20));
    app.editor.selector.dragging = false;
    app.emit("drag.end", boxDragEvent(640, 360));

    expect(app.editor.list).toEqual([firstCard, secondCard]);
    adapter.dispose();
  });

  it("toggles the frozen selection snapshot with a Shift box selection", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    adapter.sync(createInput());
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const firstCard = findElement(app.tree, "feature_one");
    const secondCard = findElement(app.tree, "feature_two");
    if (!firstCard || !secondCard) throw new Error("Missing card fixtures");
    expect(app.editor.list.map((element) => element.id)).toEqual([
      "feature_one",
    ]);
    leaferHarness.boxMatches = [firstCard, secondCard];
    app.editor.selector.dragging = true;
    app.emit("drag.start", boxDragEvent(20, 20, { shiftKey: true }));
    app.editor.selector.dragging = false;
    app.emit("drag.end", boxDragEvent(640, 360, { shiftKey: true }));

    expect(app.editor.list).toEqual([secondCard]);
    adapter.dispose();
  });

  it("cancels Box Select on Escape, short drag, tool change, stale scope, and dispose", async () => {
    const input = createInput();
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    adapter.sync(input);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const secondCard = findElement(app.tree, "feature_two");
    if (!secondCard) throw new Error("Missing card fixture");
    leaferHarness.boxMatches = [secondCard];

    app.editor.selector.dragging = true;
    app.emit("drag.start", boxDragEvent(20, 20));
    app.editor.selector.dragging = false;
    app.editor.target = [secondCard];
    const escape = emitWindowKey("Escape");
    app.emit("drag.end", boxDragEvent(640, 360));
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
    expect(app.editor.list.map((element) => element.id)).toEqual([
      "feature_one",
    ]);

    app.editor.selector.dragging = true;
    app.emit("drag.start", boxDragEvent(20, 20));
    app.editor.selector.dragging = false;
    app.editor.target = [secondCard];
    app.emit("drag.end", { ...boxDragEvent(640, 360), isCancel: true });
    expect(app.editor.list.map((element) => element.id)).toEqual([
      "feature_one",
    ]);

    app.editor.selector.dragging = true;
    app.emit("drag.start", boxDragEvent(20, 20));
    app.editor.selector.dragging = false;
    app.emit("drag.end", boxDragEvent(22, 22));
    expect(app.editor.list.map((element) => element.id)).toEqual([
      "feature_one",
    ]);

    app.editor.selector.dragging = true;
    app.emit("drag.start", boxDragEvent(20, 20));
    app.editor.selector.dragging = false;
    adapter.sync({ ...input, tool: "pen" });
    app.emit("drag.end", boxDragEvent(640, 360));
    expect(app.editor.list.map((element) => element.id)).toEqual([
      "feature_one",
    ]);

    adapter.sync(input);
    app.editor.selector.dragging = true;
    app.emit("drag.start", boxDragEvent(20, 20));
    app.editor.selector.dragging = false;
    const replacementDocument = structuredClone(input.document);
    replacementDocument.documentId = "box_select_replacement";
    adapter.sync({ ...input, document: replacementDocument });
    app.emit("drag.end", boxDragEvent(640, 360));
    expect(app.editor.list.map((element) => element.id)).toEqual([
      "feature_one",
    ]);

    app.editor.selector.dragging = true;
    app.emit("drag.start", boxDragEvent(20, 20));
    app.editor.selector.dragging = false;
    adapter.dispose();
    app.emit("drag.end", boxDragEvent(640, 360));
    expect(app.editor.list.map((element) => element.id)).toEqual([
      "feature_one",
    ]);
  });

  it("adds and removes an unrelated root without replaying the existing scene", async () => {
    const host = createHost();
    const adapter = await createLeaferEngineAdapter(host, createCallbacks());
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();

    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const selected = findElement(app.tree, "feature_one");
    const source = first.document.nodesById.feature_two;
    if (!selected || !source) throw new Error("Missing projected fixtures");
    const selectedSetCalls = selected.setCalls;
    selected.forceUpdate.mockClear();
    app.tree.forceUpdate.mockClear();
    app.editor.update.mockClear();

    const secondDocument = structuredClone(first.document);
    secondDocument.revision += 1;
    const added = {
      ...structuredClone(source),
      id: "agent_root",
      name: "Agent root",
      parentId: null,
      transform: [1, 0, 0, 1, 1200, 80] as typeof source.transform,
    };
    secondDocument.nodesById[added.id] = added;
    secondDocument.pagesById.page_welcome?.rootNodeIds.push(added.id);
    adapter.sync({
      ...first,
      document: secondDocument,
      changes: {
        documentId: secondDocument.documentId,
        fromRevision: first.document.revision,
        toRevision: secondDocument.revision,
        addedNodeIds: [added.id],
        changedNodeIds: [],
        removedNodeIds: [],
        changes: [
          {
            type: "added",
            nodeId: added.id,
            after: added,
            changedFields: [],
          },
        ],
      },
    });
    flushAnimationFrames();

    expect(findElement(app.tree, added.id)?.parent).toBe(app.tree);
    expect(selected.setCalls).toBe(selectedSetCalls);
    expect(selected.forceUpdate).not.toHaveBeenCalled();
    expect(app.tree.forceUpdate).not.toHaveBeenCalled();
    expect(app.editor.update).not.toHaveBeenCalled();

    const thirdDocument = structuredClone(secondDocument);
    thirdDocument.revision += 1;
    thirdDocument.pagesById.page_welcome!.rootNodeIds =
      thirdDocument.pagesById.page_welcome!.rootNodeIds.filter(
        (nodeId) => nodeId !== added.id,
      );
    delete thirdDocument.nodesById[added.id];
    adapter.sync({
      ...first,
      document: thirdDocument,
      changes: {
        documentId: thirdDocument.documentId,
        fromRevision: secondDocument.revision,
        toRevision: thirdDocument.revision,
        addedNodeIds: [],
        changedNodeIds: [],
        removedNodeIds: [added.id],
        changes: [
          {
            type: "removed",
            nodeId: added.id,
            before: added,
            changedFields: [],
          },
        ],
      },
    });
    flushAnimationFrames();

    expect(findElement(app.tree, added.id)).toBeUndefined();
    expect(selected.setCalls).toBe(selectedSetCalls);
    expect(app.tree.forceUpdate).not.toHaveBeenCalled();
    expect(app.editor.update).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("replaces a changed Leafer tag and reparents the stable projection identity", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const first = createInput();
    adapter.sync(first);
    flushAnimationFrames();
    const app = leaferHarness.app;
    const original = app && findElement(app.tree, "feature_one");
    const source = first.document.nodesById.feature_one;
    const frame = first.document.nodesById.frame_welcome;
    if (
      !app ||
      !(original instanceof FakeRect) ||
      source?.kind !== "rectangle" ||
      frame?.kind !== "frame"
    ) {
      throw new Error("Missing reconcile replacement fixture");
    }

    const document = structuredClone(first.document);
    document.revision += 1;
    const nextFrame = document.nodesById.frame_welcome;
    if (nextFrame?.kind !== "frame") throw new Error("Missing next Frame");
    const replacement = {
      ...structuredClone(source),
      kind: "ellipse" as const,
      name: "Reparented ellipse",
      parentId: null,
    };
    document.nodesById[replacement.id] = replacement;
    nextFrame.childIds = nextFrame.childIds.filter(
      (nodeId) => nodeId !== replacement.id,
    );
    document.pagesById.page_welcome?.rootNodeIds.push(replacement.id);
    adapter.sync({
      ...first,
      document,
      changes: {
        documentId: document.documentId,
        fromRevision: first.document.revision,
        toRevision: document.revision,
        addedNodeIds: [],
        changedNodeIds: [replacement.id, nextFrame.id],
        removedNodeIds: [],
        changes: [
          {
            type: "updated",
            nodeId: replacement.id,
            before: source,
            after: replacement,
            changedFields: ["kind", "name", "parentId"],
          },
          {
            type: "updated",
            nodeId: nextFrame.id,
            before: frame,
            after: nextFrame,
            changedFields: ["childIds"],
          },
        ],
      },
    });
    flushAnimationFrames();

    const projected = findElement(app.tree, replacement.id);
    expect(projected).toBeInstanceOf(FakeEllipse);
    expect(projected).not.toBe(original);
    expect(projected?.parent).toBe(app.tree);
    expect(original.destroy).toHaveBeenCalledTimes(1);
    expect(app.editor.list).toEqual([projected]);
    adapter.dispose();
  });

  it("creates directed Line and Arrow requests without losing reverse drag direction", async () => {
    const onCreate = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreate,
    });
    adapter.sync({
      ...createInput(),
      tool: "arrow",
      selection: { nodeIds: [] },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");

    app.emit("drag.start", boxDragEvent(100, 40));
    app.emit("drag.drag", boxDragEvent(20, 100));
    app.emit("drag.end", boxDragEvent(20, 100));

    expect(onCreate).toHaveBeenCalledWith({
      dragged: true,
      end: { x: 0, y: 1 },
      height: 60,
      pageId: "page_welcome",
      parentId: null,
      start: { x: 1, y: 0 },
      tool: "arrow",
      width: 80,
      x: 20,
      y: 40,
    });
    adapter.dispose();
  });

  it("constrains Line creation to 45-degree increments and draws from center with Alt", async () => {
    const onCreate = vi.fn(
      (request: LeaferCreateRequest) => request.tool === "line",
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreate,
    });
    adapter.sync({
      ...createInput(),
      tool: "line",
      selection: { nodeIds: [] },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");

    app.emit("drag.start", boxDragEvent(100, 100));
    app.emit(
      "drag.drag",
      boxDragEvent(140, 110, { altKey: true, shiftKey: true }),
    );
    app.emit(
      "drag.end",
      boxDragEvent(140, 110, { altKey: true, shiftKey: true }),
    );

    const request = onCreate.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      dragged: true,
      end: { x: 1, y: 0.5 },
      height: 0,
      pageId: "page_welcome",
      parentId: null,
      start: { x: 0, y: 0.5 },
      tool: "line",
      y: 100,
    });
    expect(request?.x).toBeCloseTo(58.7689, 4);
    expect(request?.width).toBeCloseTo(82.4621, 4);
    adapter.dispose();
  });

  it("creates a deterministic default Line when the user clicks without dragging", async () => {
    const onCreate = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreate,
    });
    adapter.sync({
      ...createInput(),
      tool: "line",
      selection: { nodeIds: [] },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");

    app.emit("drag.start", boxDragEvent(120, 90));
    app.emit("drag.end", boxDragEvent(120, 90));

    expect(onCreate).toHaveBeenCalledWith({
      dragged: false,
      end: { x: 1, y: 0.5 },
      height: 0,
      pageId: "page_welcome",
      parentId: null,
      start: { x: 0, y: 0.5 },
      tool: "line",
      width: 160,
      x: 120,
      y: 90,
    });
    adapter.dispose();
  });

  it("creates native Polygon and Star requests with square and center modifiers", async () => {
    const onCreate = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreate,
    });
    adapter.sync({
      ...createInput(),
      tool: "polygon",
      selection: { nodeIds: [] },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");

    app.emit("drag.start", boxDragEvent(100, 100));
    app.emit(
      "drag.drag",
      boxDragEvent(140, 120, { altKey: true, shiftKey: true }),
    );
    app.emit(
      "drag.end",
      boxDragEvent(140, 120, { altKey: true, shiftKey: true }),
    );
    expect(onCreate).toHaveBeenLastCalledWith({
      dragged: true,
      height: 80,
      pageId: "page_welcome",
      parentId: null,
      tool: "polygon",
      width: 80,
      x: 60,
      y: 60,
    });

    adapter.sync({
      ...createInput(),
      tool: "star",
      selection: { nodeIds: [] },
    });
    app.emit("drag.start", boxDragEvent(20, 30));
    app.emit("drag.drag", boxDragEvent(90, 80));
    app.emit("drag.end", boxDragEvent(90, 80));
    expect(onCreate).toHaveBeenLastCalledWith({
      dragged: true,
      height: 50,
      pageId: "page_welcome",
      parentId: null,
      tool: "star",
      width: 70,
      x: 20,
      y: 30,
    });
    adapter.dispose();
  });

  it("cancels Box Draw on Escape, tool switch, stale revision, and dispose", async () => {
    const onCreate = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreate,
    });
    const input = {
      ...createInput(),
      tool: "rectangle" as const,
      selection: { nodeIds: [] },
    };
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");

    app.emit("drag.start", boxDragEvent(20, 20));
    app.emit("drag.drag", boxDragEvent(80, 60));
    const escape = emitWindowKey("Escape");
    app.emit("drag.end", boxDragEvent(80, 60));
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();

    app.emit("drag.start", boxDragEvent(30, 30));
    app.emit("drag.drag", boxDragEvent(90, 70));
    const ellipseInput = { ...input, tool: "ellipse" as const };
    adapter.sync(ellipseInput);
    app.emit("drag.end", boxDragEvent(90, 70));
    expect(onCreate).not.toHaveBeenCalled();

    app.emit("drag.start", boxDragEvent(40, 40));
    app.emit("drag.drag", boxDragEvent(100, 80));
    const staleDocument = structuredClone(input.document);
    staleDocument.revision += 1;
    adapter.sync({ ...ellipseInput, document: staleDocument });
    app.emit("drag.end", boxDragEvent(100, 80));
    expect(onCreate).not.toHaveBeenCalled();

    app.emit("drag.start", boxDragEvent(50, 50));
    app.emit("drag.drag", boxDragEvent(110, 90));
    const preview = leaferHarness.elements.at(-1);
    adapter.dispose();
    expect(preview?.destroy).toHaveBeenCalledTimes(1);
    app.emit("drag.end", boxDragEvent(110, 90));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("cancels Box Draw when its stable parent changes during the gesture", async () => {
    const onCreate = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreate,
    });
    const input = {
      ...createInput(),
      tool: "rectangle" as const,
      selection: { nodeIds: [] },
    };
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const frame = findElement(app.tree, "frame_welcome");
    if (!frame) throw new Error("Missing parent Frame");

    app.emit("drag.start", { ...boxDragEvent(20, 20), target: frame });
    app.emit("drag.drag", { ...boxDragEvent(80, 60), target: frame });
    const changedDocument = structuredClone(input.document);
    changedDocument.revision += 1;
    const changedFrame = changedDocument.nodesById.frame_welcome;
    if (!changedFrame) throw new Error("Missing changed parent Frame");
    changedFrame.transform = [1, 0, 0, 1, 40, 30];
    adapter.sync({
      ...input,
      changes: changedNodeSet(
        input.document,
        changedDocument,
        "frame_welcome",
        "transform",
      ),
      document: changedDocument,
    });
    app.emit("drag.end", { ...boxDragEvent(80, 60), target: frame });

    expect(onCreate).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("restores the authoritative projection when Box Draw creation is rejected", async () => {
    const onCreate = vi.fn(() => false);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreate,
    });
    adapter.sync({
      ...createInput(),
      tool: "rectangle",
      selection: { nodeIds: [] },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const projected = findElement(app.tree, "feature_one");
    if (!projected) throw new Error("Missing projected fixture");
    const setCalls = projected.setCalls;

    app.emit("drag.start", boxDragEvent(20, 30));
    app.emit("drag.drag", boxDragEvent(90, 80));
    app.emit("drag.end", boxDragEvent(90, 80));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(projected.setCalls).toBeGreaterThan(setCalls);
    adapter.dispose();
  });

  it("authors an open cubic Pen contour and submits one normalized vector request", async () => {
    const onCreateVector = vi.fn<
      (request: LeaferCreateVectorRequest) => boolean
    >(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreateVector,
    });
    adapter.sync({
      ...createInput(),
      tool: "pen",
      selection: { nodeIds: [] },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");

    app.emit("pointer.down", boxDragEvent(20, 30));
    app.emit("pointer.move", boxDragEvent(50, 40));
    app.emit("pointer.up", boxDragEvent(50, 40));
    app.emit("pointer.down", boxDragEvent(120, 90));
    app.emit("pointer.move", boxDragEvent(140, 60));
    app.emit("pointer.up", boxDragEvent(140, 60));
    emitWindowKey("Enter");

    expect(onCreateVector).toHaveBeenCalledTimes(1);
    expect(onCreateVector).toHaveBeenCalledWith(
      expect.objectContaining({
        closed: false,
        pageId: "page_welcome",
        parentId: null,
        width: 100,
        x: 20,
        y: 30,
        network: {
          vertices: [
            { handleMode: "mirrored", id: "vertex_1", x: 0, y: 0 },
            {
              handleMode: "mirrored",
              id: "vertex_2",
              x: 100,
              y: 60,
            },
          ],
          segments: [
            {
              id: "segment_1",
              startVertexId: "vertex_1",
              endVertexId: "vertex_2",
              tangentStart: { x: 30, y: 10 },
              tangentEnd: { x: -20, y: 30 },
            },
          ],
          paths: [
            {
              id: "path_1",
              closed: false,
              segments: [{ segmentId: "segment_1", reversed: false }],
            },
          ],
          regions: [],
        },
      }),
    );
    expect(onCreateVector.mock.calls[0]?.[0].height).toBeGreaterThan(60);
    adapter.dispose();
  });

  it("closes a Pen contour by clicking the first anchor", async () => {
    const onCreateVector = vi.fn<
      (request: LeaferCreateVectorRequest) => boolean
    >(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreateVector,
    });
    adapter.sync({
      ...createInput(),
      tool: "pen",
      selection: { nodeIds: [] },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");

    clickPenPoint(app, 0, 0);
    clickPenPoint(app, 100, 0);
    clickPenPoint(app, 50, 100);
    app.emit("pointer.move", boxDragEvent(2, 2));
    app.emit("pointer.down", boxDragEvent(2, 2));

    expect(onCreateVector).toHaveBeenCalledTimes(1);
    const request = onCreateVector.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      closed: true,
      height: 100,
      pageId: "page_welcome",
      parentId: null,
      width: 100,
      x: 0,
      y: 0,
    });
    expect(request?.network.segments).toContainEqual({
      id: "segment_3",
      startVertexId: "vertex_3",
      endVertexId: "vertex_1",
    });
    expect(request?.network.paths[0]?.closed).toBe(true);
    expect(request?.network.regions[0]?.id).toBe("region_1");
    adapter.dispose();
  });

  it("removes Pen points with Backspace and cancels a one-point contour", async () => {
    const onCreateVector = vi.fn<
      (request: LeaferCreateVectorRequest) => boolean
    >(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreateVector,
    });
    adapter.sync({
      ...createInput(),
      tool: "pen",
      selection: { nodeIds: [] },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");

    clickPenPoint(app, 10, 10);
    clickPenPoint(app, 80, 40);
    emitWindowKey("Backspace");
    emitWindowKey("Escape");

    expect(onCreateVector).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("finishes an open Pen contour when the user switches tools", async () => {
    const onCreateVector = vi.fn<
      (request: LeaferCreateVectorRequest) => boolean
    >(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreateVector,
    });
    const input = {
      ...createInput(),
      tool: "pen" as const,
      selection: { nodeIds: [] },
    };
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    clickPenPoint(app, 10, 10);
    clickPenPoint(app, 80, 40);

    adapter.sync({ ...input, tool: "select" });

    expect(onCreateVector).toHaveBeenCalledTimes(1);
    expect(onCreateVector).toHaveBeenCalledWith(
      expect.objectContaining({ closed: false }),
    );
    adapter.dispose();
  });

  it("does not commit a Pen draft across Page or document identity changes", async () => {
    const onCreateVector = vi.fn<
      (request: LeaferCreateVectorRequest) => boolean
    >(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreateVector,
    });
    const input = {
      ...createInput(),
      tool: "pen" as const,
      selection: { nodeIds: [] },
    };
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    clickPenPoint(app, 10, 10);
    clickPenPoint(app, 80, 40);

    const secondPageDocument = structuredClone(input.document);
    const sourcePage = secondPageDocument.pagesById.page_welcome;
    if (!sourcePage) throw new Error("Missing source Page");
    secondPageDocument.pagesById.page_second = {
      ...structuredClone(sourcePage),
      id: "page_second",
      name: "Second Page",
      rootNodeIds: [],
    };
    secondPageDocument.pageOrder.push("page_second");
    const secondPageInput = {
      ...input,
      document: secondPageDocument,
      pageId: "page_second",
      tool: "select" as const,
    };
    adapter.sync(secondPageInput);
    expect(onCreateVector).not.toHaveBeenCalled();

    adapter.sync({ ...secondPageInput, tool: "pen" });
    clickPenPoint(app, 20, 20);
    clickPenPoint(app, 90, 50);
    const replacementDocument = structuredClone(secondPageDocument);
    replacementDocument.documentId = "document_replacement";
    adapter.sync({
      ...secondPageInput,
      document: replacementDocument,
      tool: "select",
    });

    expect(onCreateVector).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("cancels a Pen draft when its stable parent changes", async () => {
    const onCreateVector = vi.fn<
      (request: LeaferCreateVectorRequest) => boolean
    >(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreateVector,
    });
    const input = {
      ...createInput(),
      tool: "pen" as const,
      selection: { nodeIds: [] },
    };
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const frame = findElement(app.tree, "frame_welcome");
    if (!frame) throw new Error("Missing parent Frame");
    for (const [x, y] of [
      [10, 10],
      [80, 40],
    ] as const) {
      const event = { ...boxDragEvent(x, y), target: frame };
      app.emit("pointer.down", event);
      app.emit("pointer.up", event);
    }

    const changedDocument = structuredClone(input.document);
    changedDocument.revision += 1;
    const changedFrame = changedDocument.nodesById.frame_welcome;
    if (!changedFrame) throw new Error("Missing changed parent Frame");
    changedFrame.transform = [1, 0, 0, 1, 40, 30];
    adapter.sync({
      ...input,
      changes: changedNodeSet(
        input.document,
        changedDocument,
        "frame_welcome",
        "transform",
      ),
      document: changedDocument,
    });
    emitWindowKey("Escape");

    expect(onCreateVector).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("restores the authoritative projection when Pen creation is rejected", async () => {
    const onCreateVector = vi.fn<
      (request: LeaferCreateVectorRequest) => boolean
    >(() => false);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onCreateVector,
    });
    adapter.sync({
      ...createInput(),
      tool: "pen",
      selection: { nodeIds: [] },
    });
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const projected = findElement(app.tree, "feature_one");
    if (!projected) throw new Error("Missing projected fixture");
    const setCalls = projected.setCalls;
    clickPenPoint(app, 10, 10);
    clickPenPoint(app, 80, 40);

    emitWindowKey("Escape");

    expect(onCreateVector).toHaveBeenCalledTimes(1);
    expect(projected.setCalls).toBeGreaterThan(setCalls);
    adapter.dispose();
  });

  it("keeps Pen chrome screen-sized across zoom and cleans it on dispose", async () => {
    const adapter = await createLeaferEngineAdapter(
      createHost(),
      createCallbacks(),
    );
    const input = {
      ...createInput(),
      tool: "pen" as const,
      selection: { nodeIds: [] },
    };
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Fake Leafer App was not created");
    const firstPreviewIndex = leaferHarness.elements.length;
    clickPenPoint(app, 10, 10);
    const previewGroup = leaferHarness.elements[firstPreviewIndex];
    const anchor = leaferHarness.elements.at(-1);
    expect(anchor?.width).toBe(7);

    adapter.sync({
      ...input,
      viewport: { ...input.viewport, zoom: 2 },
    });
    expect(anchor?.width).toBe(3.5);

    adapter.dispose();
    expect(previewGroup?.destroy).toHaveBeenCalledTimes(1);
  });

  it("enters vector edit with mutually exclusive chrome and commits a vertex drag once", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const onVectorEditSelectionChange = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
      onVectorEditSelectionChange,
    });
    adapter.sync(withVectorEditFixture(createInput()));
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !path?.parent) throw new Error("Missing editable vector");
    const overlay = path.parent.children.at(-1);
    if (!(overlay instanceof FakeGroup))
      throw new Error("Missing vector overlay");
    const anchors = overlay.children.filter(
      (child): child is FakeEllipse => child instanceof FakeEllipse,
    );
    expect(anchors).toHaveLength(3);
    expect(app.editor.visible).toBe(false);
    expect(app.editor.hittable).toBe(false);
    expect(app.editor.hoverTarget).toBeNull();

    app.emit("pointer.down", pointerEvent(0, 0, anchors[0]!));
    app.emit("pointer.move", pointerEvent(24, 12, anchors[0]!));
    app.emit("pointer.up", pointerEvent(24, 12, anchors[0]!));

    expect(onVectorEditSelectionChange).toHaveBeenCalledWith("editable_curve", {
      segmentIds: [],
      vertexIds: ["vertex_a"],
    });
    expect(onVectorEdit).toHaveBeenCalledTimes(1);
    const request = onVectorEdit.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      deleteNode: false,
      edits: [{ nodeId: "editable_curve" }],
    });
    if (!request || request.deleteNode) {
      throw new Error("Expected a vector network update");
    }
    expect(request.edits[0]!.network.vertices).toContainEqual(
      expect.objectContaining({ id: "vertex_a", x: 24, y: 12 }),
    );
    adapter.dispose();
  });

  it("cancels stale Vector previews before rebuilding scope and disposes every overlay", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
    });
    const input = withVectorEditFixture(createInput(), ["vertex_a"]);
    adapter.sync(input);
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !(path instanceof FakePath) || !path.parent) {
      throw new Error("Missing editable Vector fixture");
    }
    const authoritativePath = path.path;
    const firstOverlay = path.parent.children.at(-1);
    if (!(firstOverlay instanceof FakeGroup)) {
      throw new Error("Missing first Vector overlay");
    }
    const firstAnchor = firstOverlay.children.find(
      (child): child is FakeEllipse => child instanceof FakeEllipse,
    );
    if (!firstAnchor) throw new Error("Missing first Vector anchor");

    app.emit("pointer.down", pointerEvent(0, 0, firstAnchor));
    app.emit("pointer.move", pointerEvent(30, 20, firstAnchor));
    expect(path.path).not.toBe(authoritativePath);

    const noncontiguous = structuredClone(input);
    noncontiguous.document.revision += 2;
    delete noncontiguous.changes;
    adapter.sync(noncontiguous);
    expect(onVectorEdit).not.toHaveBeenCalled();
    expect(path.path).toBe(authoritativePath);
    expect(firstOverlay.destroy).toHaveBeenCalledTimes(1);

    const rebuiltOverlay = path.parent.children.at(-1);
    if (!(rebuiltOverlay instanceof FakeGroup)) {
      throw new Error("Missing rebuilt Vector overlay");
    }
    expect(rebuiltOverlay).not.toBe(firstOverlay);
    app.emit("pointer.up", pointerEvent(30, 20, firstAnchor));
    expect(onVectorEdit).not.toHaveBeenCalled();

    adapter.dispose();
    expect(rebuiltOverlay.destroy).toHaveBeenCalledTimes(1);
    app.emit("pointer.down", pointerEvent(0, 0, firstAnchor));
    app.emit("pointer.move", pointerEvent(20, 10, firstAnchor));
    app.emit("pointer.up", pointerEvent(20, 10, firstAnchor));
    expect(onVectorEdit).not.toHaveBeenCalled();
  });

  it("lassos vector points and paths as session-only selection across one edit scope", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const onVectorEditSelectionChange = vi.fn();
    const input = withVectorEditFixture(createInput());
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
      onVectorEditSelectionChange,
    });
    adapter.sync({
      ...input,
      vectorEditScope: { ...input.vectorEditScope!, tool: "lasso" },
    });
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !path?.parent) throw new Error("Missing editable vector");
    const overlay = path.parent.children.at(-1);
    if (!(overlay instanceof FakeGroup)) {
      throw new Error("Missing vector overlay");
    }

    app.emit("pointer.down", pointerEvent(-10, -10, app.tree));
    app.emit("pointer.move", pointerEvent(70, -10, app.tree));
    app.emit("pointer.move", pointerEvent(70, 40, app.tree));
    app.emit("pointer.move", pointerEvent(-10, 40, app.tree));
    const lasso = overlay.children.find(
      (child): child is FakePath =>
        child instanceof FakePath &&
        child.visible &&
        String(child.path).endsWith("Z"),
    );
    expect(lasso?.path).toContain("L 70 40");
    app.emit("pointer.up", pointerEvent(-10, -10, app.tree));

    expect(onVectorEditSelectionChange).toHaveBeenLastCalledWith(
      "editable_curve",
      {
        segmentIds: ["segment_ab"],
        vertexIds: ["vertex_a", "vertex_b"],
      },
    );
    expect(onVectorEdit).not.toHaveBeenCalled();
    expect(lasso?.visible).toBe(false);

    app.emit(
      "pointer.down",
      pointerEvent(50, -10, app.tree, { shiftKey: true }),
    );
    app.emit("pointer.move", pointerEvent(130, -10, app.tree));
    app.emit("pointer.move", pointerEvent(130, 40, app.tree));
    app.emit("pointer.move", pointerEvent(50, 40, app.tree));
    app.emit("pointer.up", pointerEvent(50, -10, app.tree));
    expect(onVectorEditSelectionChange).toHaveBeenLastCalledWith(
      "editable_curve",
      {
        segmentIds: ["segment_ab", "segment_bc"],
        vertexIds: ["vertex_a", "vertex_c"],
      },
    );
    adapter.dispose();
  });

  it("selects one stable path segment directly in vector Move mode", async () => {
    const onVectorEditSelectionChange = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEditSelectionChange,
    });
    adapter.sync(withVectorEditFixture(createInput()));
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !path) throw new Error("Missing editable vector");

    app.emit("pointer.down", pointerEvent(30, 15, path));

    expect(onVectorEditSelectionChange).toHaveBeenCalledWith("editable_curve", {
      segmentIds: ["segment_ab"],
      vertexIds: [],
    });
    adapter.dispose();
  });

  it("resizes and rotates multiple vector points with one commit per gesture", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const input = withVectorEditFixture(createInput(), [
      "vertex_a",
      "vertex_b",
    ]);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
    });
    adapter.sync(input);
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !path?.parent) throw new Error("Missing editable vector");
    const overlay = app.sky.children.find(
      (child): child is FakeGroup =>
        child instanceof FakeGroup &&
        child.children.some(
          (control) =>
            control instanceof FakeRect &&
            (control as FakeRect & { cursor?: string }).cursor ===
              "nwse-resize",
        ),
    );
    if (!overlay) throw new Error("Missing vector selection overlay");
    const resizeHandles = overlay.children.filter(
      (child): child is FakeRect =>
        child instanceof FakeRect &&
        (child as FakeRect & { cursor?: string }).cursor === "nwse-resize",
    );
    const southEast = resizeHandles.sort(
      (left, right) => right.x + right.y - (left.x + left.y),
    )[0];
    if (!southEast) throw new Error("Missing vector resize handle");
    const resizeStart = {
      x: southEast.x + southEast.width / 2,
      y: southEast.y + southEast.height / 2,
    };
    app.emit(
      "pointer.down",
      pointerEvent(resizeStart.x, resizeStart.y, southEast),
    );
    app.emit(
      "pointer.move",
      pointerEvent(resizeStart.x + 60, resizeStart.y + 30, southEast),
    );
    expect(onVectorEdit).not.toHaveBeenCalled();
    app.emit(
      "pointer.up",
      pointerEvent(resizeStart.x + 60, resizeStart.y + 30, southEast),
    );
    expect(onVectorEdit).toHaveBeenCalledTimes(1);
    const resized = onVectorEdit.mock.calls[0]?.[0];
    if (!resized || resized.deleteNode) {
      throw new Error("Expected resized vector network");
    }
    const sourceNode = input.document.nodesById.editable_curve;
    if (
      !sourceNode ||
      sourceNode.kind !== "vector" ||
      !("network" in sourceNode.properties)
    ) {
      throw new Error("Missing source vector network");
    }
    expect(resized.edits).toHaveLength(1);
    expect(resized.edits[0]!.network).not.toEqual(
      sourceNode.properties.network,
    );

    const resizedInput = structuredClone(input);
    const resizedNode = resizedInput.document.nodesById.editable_curve;
    if (
      !resizedNode ||
      resizedNode.kind !== "vector" ||
      !("network" in resizedNode.properties)
    ) {
      throw new Error("Missing resized vector fixture");
    }
    resizedNode.properties.network = resized.edits[0]!.network;
    adapter.sync(resizedInput);
    onVectorEdit.mockClear();
    const refreshedOverlay = app.sky.children.find(
      (child): child is FakeGroup =>
        child instanceof FakeGroup &&
        child.children.some(
          (control) =>
            control instanceof FakeEllipse &&
            (control as FakeEllipse & { cursor?: string }).cursor ===
              "crosshair",
        ),
    );
    if (!refreshedOverlay) throw new Error("Missing refreshed vector overlay");
    const rotate = refreshedOverlay.children.find(
      (child): child is FakeEllipse =>
        child instanceof FakeEllipse &&
        (child as FakeEllipse & { cursor?: string }).cursor === "crosshair",
    );
    if (!rotate) throw new Error("Missing vector rotation target");
    const rotateStart = {
      x: rotate.x + rotate.width / 2,
      y: rotate.y + rotate.height / 2,
    };
    app.emit(
      "pointer.down",
      pointerEvent(rotateStart.x, rotateStart.y, rotate),
    );
    app.emit(
      "pointer.move",
      pointerEvent(rotateStart.x + 40, rotateStart.y + 30, rotate),
    );
    app.emit(
      "pointer.up",
      pointerEvent(rotateStart.x + 40, rotateStart.y + 30, rotate),
    );
    expect(onVectorEdit).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("uses one document-space transform box and one batch commit across Vector layers", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const base = withMultiVectorEditFixture(createInput());
    const input: LeaferEngineSyncInput = {
      ...base,
      vectorEditScope: {
        ...base.vectorEditScope!,
        nodes: [
          {
            ...base.vectorEditScope!.nodes[0]!,
            selectedVertexIds: ["vertex_a"],
          },
          {
            ...base.vectorEditScope!.nodes[1]!,
            selectedVertexIds: ["vertex_c"],
          },
        ],
      },
    };
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
    });
    adapter.sync(input);
    const app = leaferHarness.app;
    if (!app) throw new Error("Missing Leafer app");
    const overlay = app.sky.children.find(
      (child): child is FakeGroup =>
        child instanceof FakeGroup &&
        child.children.some(
          (control) =>
            control instanceof FakeRect &&
            (control as FakeRect & { cursor?: string }).cursor ===
              "nwse-resize",
        ),
    );
    if (!overlay) throw new Error("Missing shared Vector selection overlay");
    const visibleBox = overlay.children.find(
      (child): child is FakeRect =>
        child instanceof FakeRect &&
        child.visible &&
        typeof (child as FakeRect & { stroke?: unknown }).stroke === "string" &&
        child.width > 250,
    );
    expect(visibleBox).toBeDefined();
    const southEast = overlay.children
      .filter(
        (child): child is FakeRect =>
          child instanceof FakeRect &&
          (child as FakeRect & { cursor?: string }).cursor === "nwse-resize",
      )
      .sort((left, right) => right.x + right.y - (left.x + left.y))[0];
    if (!southEast) throw new Error("Missing shared resize handle");
    const start = {
      x: southEast.x + southEast.width / 2,
      y: southEast.y + southEast.height / 2,
    };
    app.emit("pointer.down", pointerEvent(start.x, start.y, southEast));
    app.emit(
      "pointer.move",
      pointerEvent(start.x + 80, start.y + 40, southEast),
    );
    app.emit("pointer.up", pointerEvent(start.x + 80, start.y + 40, southEast));
    expect(onVectorEdit).toHaveBeenCalledTimes(1);
    const request = onVectorEdit.mock.calls[0]?.[0];
    if (!request || request.deleteNode) {
      throw new Error("Expected a batch Vector update");
    }
    expect(request.edits.map((edit) => edit.nodeId)).toEqual([
      "editable_curve",
      "editable_curve_second",
    ]);
    adapter.dispose();
  });

  it("repositions a resize with Space and resumes without a preview jump", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const input = withVectorEditFixture(createInput(), [
      "vertex_a",
      "vertex_b",
    ]);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
    });
    adapter.sync(input);
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !(path instanceof FakePath)) {
      throw new Error("Missing editable Vector path");
    }
    const overlay = app.sky.children.find(
      (child): child is FakeGroup =>
        child instanceof FakeGroup &&
        child.children.some(
          (control) =>
            control instanceof FakeRect &&
            (control as FakeRect & { cursor?: string }).cursor ===
              "nwse-resize",
        ),
    );
    const southEast = overlay?.children
      .filter(
        (child): child is FakeRect =>
          child instanceof FakeRect &&
          (child as FakeRect & { cursor?: string }).cursor === "nwse-resize",
      )
      .sort((left, right) => right.x + right.y - (left.x + left.y))[0];
    if (!southEast) throw new Error("Missing shared resize handle");
    const start = {
      x: southEast.x + southEast.width / 2,
      y: southEast.y + southEast.height / 2,
    };
    app.emit("pointer.down", pointerEvent(start.x, start.y, southEast));
    app.emit(
      "pointer.move",
      pointerEvent(start.x + 40, start.y + 20, southEast),
    );
    const spaceDown = emitWindowKey("Space");
    app.emit(
      "pointer.move",
      pointerEvent(start.x + 70, start.y + 50, southEast),
    );
    const repositionedPath = path.path;
    const spaceUp = emitWindowKeyUp("Space");
    expect(path.path).toBe(repositionedPath);
    app.emit(
      "pointer.move",
      pointerEvent(start.x + 80, start.y + 60, southEast),
    );
    expect(path.path).not.toBe(repositionedPath);
    app.emit("pointer.up", pointerEvent(start.x + 80, start.y + 60, southEast));
    expect(spaceDown.preventDefault).toHaveBeenCalledTimes(1);
    expect(spaceUp.preventDefault).toHaveBeenCalledTimes(1);
    expect(onVectorEdit).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("forwards Cut path hits through the semantic callback and keeps editing the new endpoints", async () => {
    const authoritative =
      withVectorEditFixture(createInput()).document.nodesById.editable_curve;
    if (
      !authoritative ||
      authoritative.kind !== "vector" ||
      !("network" in authoritative.properties)
    ) {
      throw new Error("Missing editable vector network");
    }
    let network = structuredClone(authoritative.properties.network);
    const onVectorCut = vi.fn<
      NonNullable<LeaferEngineCallbacks["onVectorCut"]>
    >((request) => {
      const result = cutVectorPath(network, request.pathId, request.at);
      if (!result.ok) return { ok: false };
      network = result.network;
      return {
        ok: true,
        network,
        selectedVertexIds: result.cutVertexIds,
      };
    });
    const onVectorEditSelectionChange = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorCut,
      onVectorEditSelectionChange,
    });
    const input = withVectorEditFixture(createInput());
    adapter.sync({
      ...input,
      vectorEditScope: { ...input.vectorEditScope!, tool: "cut" },
    });
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !path?.parent) throw new Error("Missing editable vector");
    const overlay = path.parent.children.at(-1);
    if (!(overlay instanceof FakeGroup)) {
      throw new Error("Missing vector overlay");
    }
    const hitPath = overlay.children.filter(
      (child): child is FakePath => child instanceof FakePath,
    )[0];
    if (!hitPath) throw new Error("Missing Cut hit path");
    expect((hitPath as FakePath & { hittable: boolean }).hittable).toBe(true);

    app.emit("pointer.down", pointerEvent(30, 15, hitPath));
    expect(onVectorCut).not.toHaveBeenCalled();
    app.emit("pointer.up", pointerEvent(30, 15, hitPath));

    expect(onVectorCut).toHaveBeenCalledWith({
      at: {
        kind: "segment",
        segmentId: "segment_ab",
        t: 0.5,
      },
      nodeId: "editable_curve",
      pathId: "path_open",
    });
    expect(onVectorEditSelectionChange).toHaveBeenCalledWith("editable_curve", {
      segmentIds: [],
      vertexIds: ["vertex_edit_1", "vertex_edit_2"],
    });
    expect(network.paths).toHaveLength(2);
    expect(
      overlay.children.filter(
        (child): child is FakeEllipse => child instanceof FakeEllipse,
      ),
    ).toHaveLength(5);
    onVectorCut.mockClear();
    adapter.sync({
      ...input,
      vectorEditScope: {
        ...input.vectorEditScope!,
        nodes: input.vectorEditScope!.nodes.map((item) => ({
          ...item,
          readOnly: true,
        })),
        tool: "cut",
      },
    });
    expect((hitPath as FakePath & { hittable: boolean }).hittable).toBe(false);
    app.emit("pointer.down", pointerEvent(30, 15, hitPath));
    expect(onVectorCut).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("previews a document-space drag Cut, cancels with Escape, and submits only on pointer up", async () => {
    const onVectorLineCut = vi.fn(() => ({
      ok: true as const,
      resultNodeIds: ["editable_curve", "vector_cut_result"] as const,
    }));
    const onVectorEditExit = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEditExit,
      onVectorLineCut,
    });
    const input = withVectorEditFixture(createInput());
    adapter.sync({
      ...input,
      vectorEditScope: { ...input.vectorEditScope!, tool: "cut" },
    });
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !path?.parent) throw new Error("Missing editable vector");
    const overlay = path.parent.children.at(-1);
    if (!(overlay instanceof FakeGroup)) {
      throw new Error("Missing vector overlay");
    }
    const guide = overlay.children
      .filter((child): child is FakePath => child instanceof FakePath)
      .at(-1);
    if (!guide) throw new Error("Missing Cut guide");

    app.emit("pointer.down", pointerEvent(-20, 15, app.tree));
    app.emit("pointer.move", pointerEvent(140, 15, app.tree));
    expect((guide as FakePath & { visible: boolean }).visible).toBe(true);
    expect(guide.path).toBe("M -20 15 L 140 15");
    expect(onVectorLineCut).not.toHaveBeenCalled();

    emitWindowKey("Escape");
    expect((guide as FakePath & { visible: boolean }).visible).toBe(false);
    expect(onVectorLineCut).not.toHaveBeenCalled();
    expect(onVectorEditExit).not.toHaveBeenCalled();

    app.emit("pointer.down", pointerEvent(-20, 18, app.tree));
    app.emit("pointer.move", pointerEvent(140, 18, app.tree));
    expect((guide as FakePath & { visible: boolean }).visible).toBe(true);
    adapter.sync({
      ...input,
      vectorEditScope: {
        ...input.vectorEditScope!,
        nodes: input.vectorEditScope!.nodes.map((item) => ({
          ...item,
          readOnly: true,
        })),
        tool: "cut",
      },
    });
    expect((guide as FakePath & { visible: boolean }).visible).toBe(false);
    expect(onVectorLineCut).not.toHaveBeenCalled();

    adapter.sync({
      ...input,
      vectorEditScope: { ...input.vectorEditScope!, tool: "cut" },
    });
    app.emit("pointer.down", pointerEvent(-20, 19, app.tree));
    app.emit("pointer.move", pointerEvent(140, 19, app.tree));
    app.emit("pointer.up", {
      ...pointerEvent(140, 19, app.tree),
      isCancel: true,
    });
    expect((guide as FakePath & { visible: boolean }).visible).toBe(false);
    expect(onVectorLineCut).not.toHaveBeenCalled();

    app.emit("pointer.down", pointerEvent(-20, 20, app.tree));
    app.emit("pointer.move", pointerEvent(140, 20, app.tree));
    app.emit("pointer.up", pointerEvent(140, 20, app.tree));
    expect(onVectorLineCut).toHaveBeenCalledWith({
      end: { x: 140, y: 20 },
      nodeIds: ["editable_curve"],
      start: { x: -20, y: 20 },
    });
    expect((guide as FakePath & { visible: boolean }).visible).toBe(false);
    expect(onVectorEditExit).toHaveBeenCalledTimes(1);

    onVectorEditExit.mockClear();
    adapter.sync({
      ...input,
      vectorEditScope: { ...input.vectorEditScope!, tool: "cut" },
    });
    emitWindowKey("Escape");
    expect(onVectorEditExit).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("keeps an in-progress Cut in document space while the viewport pans and zooms", async () => {
    const onVectorLineCut = vi.fn(() => ({
      ok: true as const,
      resultNodeIds: ["editable_curve", "vector_cut_result"] as const,
    }));
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorLineCut,
    });
    const input = withVectorEditFixture(createInput());
    adapter.sync({
      ...input,
      vectorEditScope: { ...input.vectorEditScope!, tool: "cut" },
    });
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !path?.parent) throw new Error("Missing editable vector");
    const overlay = path.parent.children.at(-1);
    if (!(overlay instanceof FakeGroup)) {
      throw new Error("Missing vector overlay");
    }
    const guide = overlay.children
      .filter((child): child is FakePath => child instanceof FakePath)
      .at(-1);
    if (!guide) throw new Error("Missing Cut guide");

    const documentPoint = { x: -20, y: 20 };
    const start = pointerEvent(-20, 20, app.tree);
    start.getInnerPoint = (target?: unknown) =>
      target === app.tree ? documentPoint : { x: -20, y: 20 };
    app.emit("pointer.down", start);

    const movedDocumentPoint = { x: 140, y: 20 };
    const move = pointerEvent(140, 20, app.tree);
    move.getInnerPoint = (target?: unknown) =>
      target === app.tree ? movedDocumentPoint : { x: 140, y: 20 };
    app.emit("pointer.move", move);
    expect(guide.path).toBe("M -20 20 L 140 20");

    app.tree.localTransform = { a: 2, b: 0, c: 0, d: 2, e: 320, f: -180 };
    app.emit("viewport.zoom");
    app.emit("viewport.move");
    expect(onVectorLineCut).not.toHaveBeenCalled();
    expect(guide.path).toBe("M -20 20 L 140 20");

    const end = pointerEvent(640, -140, app.tree);
    end.getInnerPoint = (target?: unknown) =>
      target === app.tree ? movedDocumentPoint : { x: 140, y: 20 };
    app.emit("pointer.up", end);
    expect(onVectorLineCut).toHaveBeenCalledWith({
      end: movedDocumentPoint,
      nodeIds: ["editable_curve"],
      start: documentPoint,
    });
    expect((guide as FakePath & { visible: boolean }).visible).toBe(false);
    adapter.dispose();
  });

  it("previews Bend on the disposable overlay and commits one editable cubic", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const onVectorEditSelectionChange = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
      onVectorEditSelectionChange,
    });
    const input = withVectorEditFixture(createInput());
    adapter.sync({
      ...input,
      vectorEditScope: { ...input.vectorEditScope!, tool: "bend" },
    });
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !path?.parent) throw new Error("Missing editable vector");
    const overlay = path.parent.children.at(-1);
    if (!(overlay instanceof FakeGroup)) {
      throw new Error("Missing vector overlay");
    }
    const hitPath = overlay.children.filter(
      (child): child is FakePath => child instanceof FakePath,
    )[0];
    if (!hitPath) throw new Error("Missing Bend hit path");

    const editablePath = path as FakePath;
    const before = editablePath.path;
    app.emit("pointer.down", pointerEvent(30, 15, hitPath));
    app.emit("pointer.move", pointerEvent(30, 45, hitPath));
    expect(editablePath.path).not.toBe(before);
    expect(onVectorEdit).not.toHaveBeenCalled();
    emitWindowKey("Escape");
    expect(editablePath.path).toBe(before);
    expect(onVectorEdit).not.toHaveBeenCalled();

    app.emit("pointer.down", pointerEvent(30, 15, hitPath));
    app.emit("pointer.move", pointerEvent(30, 45, hitPath));
    app.emit("pointer.up", pointerEvent(30, 45, hitPath));
    expect(onVectorEdit).toHaveBeenCalledTimes(1);
    const request = onVectorEdit.mock.calls[0]?.[0];
    if (!request || request.deleteNode) throw new Error("Missing Bend edit");
    expect(request.edits[0]!.network.segments[0]).toMatchObject({
      tangentStart: { x: 20, y: 50 },
      tangentEnd: { x: -20, y: 30 },
    });
    expect(onVectorEditSelectionChange).toHaveBeenCalledWith("editable_curve", {
      segmentIds: ["segment_ab"],
      vertexIds: ["vertex_a", "vertex_b"],
    });
    adapter.dispose();
  });

  it("paints and clears one projected Vector region without mutating projection children", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
    });
    const input = withClosedVectorEditFixture(createInput());
    adapter.sync({
      ...input,
      vectorEditScope: {
        ...input.vectorEditScope!,
        paint: [{ type: "solid", color: "#22c55e", opacity: 1 }],
        tool: "paint",
      },
    });
    const app = leaferHarness.app;
    const region =
      app &&
      findElement(
        app.tree,
        vectorRegionElementId("editable_curve", "region_curve"),
      );
    if (!app || !region) throw new Error("Missing projected Vector region");

    adapter.sync({
      ...input,
      vectorEditScope: {
        ...input.vectorEditScope!,
        fillStyleId: "brand-accent",
        tool: "paint",
      },
    });
    app.emit("pointer.down", pointerEvent(30, 15, region));
    const style = onVectorEdit.mock.calls[0]?.[0];
    if (!style || style.deleteNode)
      throw new Error("Missing region Style edit");
    expect(style.edits[0]?.network.regions[0]).toMatchObject({
      fillStyleId: "brand-accent",
    });
    expect(style.edits[0]?.network.regions[0]).not.toHaveProperty("fills");

    onVectorEdit.mockClear();
    adapter.sync({
      ...input,
      vectorEditScope: {
        ...input.vectorEditScope!,
        paint: [{ type: "solid", color: "#22c55e", opacity: 1 }],
        tool: "paint",
      },
    });
    app.emit("pointer.down", pointerEvent(30, 15, region));
    expect(onVectorEdit).toHaveBeenCalledTimes(1);
    const paint = onVectorEdit.mock.calls[0]?.[0];
    if (!paint || paint.deleteNode)
      throw new Error("Missing region Paint edit");
    expect(paint.edits[0]?.network.regions[0]?.fills).toEqual([
      { type: "solid", color: "#22c55e", opacity: 1 },
    ]);

    onVectorEdit.mockClear();
    app.emit("pointer.down", {
      ...pointerEvent(30, 15, region),
      altKey: true,
    });
    const clear = onVectorEdit.mock.calls[0]?.[0];
    if (!clear || clear.deleteNode)
      throw new Error("Missing region clear edit");
    expect(clear.edits[0]?.network.regions[0]?.fills).toEqual([]);
    onVectorEdit.mockClear();
    adapter.sync({
      ...input,
      vectorEditScope: {
        ...input.vectorEditScope!,
        nodes: input.vectorEditScope!.nodes.map((node) => ({
          ...node,
          readOnly: true,
        })),
        paint: [{ type: "solid", color: "#22c55e", opacity: 1 }],
        tool: "paint",
      },
    });
    app.emit("pointer.down", pointerEvent(30, 15, region));
    expect(onVectorEdit).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("keeps multiple Vector layers in one edit scope and submits one shared line Cut", async () => {
    const onVectorEditActiveNodeChange = vi.fn();
    const onVectorEditScopeChange = vi.fn();
    const onVectorEditSelectionChange = vi.fn();
    const onVectorLineCut = vi.fn(() => ({
      ok: true as const,
      resultNodeIds: [
        "editable_curve",
        "editable_curve_cut",
        "editable_curve_second",
        "editable_curve_second_cut",
      ],
    }));
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEditActiveNodeChange,
      onVectorEditScopeChange,
      onVectorEditSelectionChange,
      onVectorLineCut,
    });
    const input = withMultiVectorEditFixture(createInput());
    adapter.sync({
      ...input,
      selection: {
        nodeIds: ["editable_curve"],
        anchorNodeId: "editable_curve",
      },
      vectorEditScope: {
        activeNodeId: "editable_curve",
        nodes: [input.vectorEditScope!.nodes[0]!],
        tool: "move",
      },
    });
    const app = leaferHarness.app;
    const firstPath =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    const secondPath =
      app &&
      findElement(app.tree, vectorStrokeElementId("editable_curve_second"));
    if (!app || !firstPath?.parent || !secondPath?.parent) {
      throw new Error("Missing multi-Vector fixture");
    }
    app.emit(
      "pointer.down",
      pointerEvent(0, 0, secondPath, { shiftKey: true }),
    );
    expect(onVectorEditScopeChange).toHaveBeenCalledWith({
      mode: "add",
      nodeId: "editable_curve_second",
    });

    adapter.sync(input);
    app.emit("pointer.down", pointerEvent(0, 0, secondPath, { ctrlKey: true }));
    expect(onVectorEditScopeChange).toHaveBeenLastCalledWith({
      mode: "toggle",
      nodeId: "editable_curve_second",
    });
    const overlays = [firstPath.parent, secondPath.parent].flatMap((parent) =>
      parent.children.filter(
        (child): child is FakeGroup =>
          child instanceof FakeGroup &&
          child.children.filter(
            (control): control is FakeEllipse => control instanceof FakeEllipse,
          ).length === 3,
      ),
    );
    expect(overlays).toHaveLength(2);
    const secondAnchor = overlays[1]?.children.find(
      (child): child is FakeEllipse => child instanceof FakeEllipse,
    );
    if (!secondAnchor) throw new Error("Missing second Vector anchor");

    app.emit("pointer.down", pointerEvent(0, 0, secondAnchor));
    app.emit("pointer.up", pointerEvent(0, 0, secondAnchor));
    expect(onVectorEditActiveNodeChange).toHaveBeenCalledWith(
      "editable_curve_second",
    );
    expect(onVectorEditSelectionChange).toHaveBeenCalledWith(
      "editable_curve_second",
      { segmentIds: [], vertexIds: ["vertex_a"] },
    );

    adapter.sync({
      ...input,
      vectorEditScope: { ...input.vectorEditScope!, tool: "cut" },
    });
    app.emit("pointer.down", pointerEvent(-20, 20, app.tree));
    app.emit("pointer.move", pointerEvent(300, 20, app.tree));
    app.emit("pointer.up", pointerEvent(300, 20, app.tree));
    expect(onVectorLineCut).toHaveBeenCalledWith({
      end: { x: 300, y: 20 },
      nodeIds: ["editable_curve", "editable_curve_second"],
      start: { x: -20, y: 20 },
    });
    adapter.dispose();
  });

  it("edits mirrored vector handles and point modes through the same callback", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
    });
    const input = withVectorEditFixture(createInput(), ["vertex_b"], true);
    adapter.sync(input);
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    if (!app || !path?.parent) throw new Error("Missing editable vector");
    const overlay = path.parent.children.at(-1);
    if (!(overlay instanceof FakeGroup))
      throw new Error("Missing vector overlay");
    const controls = overlay.children.filter(
      (child): child is FakeEllipse => child instanceof FakeEllipse,
    );
    const handles = controls.slice(3);
    expect(handles).toHaveLength(2);

    app.emit("pointer.down", pointerEvent(40, 20, handles[0]!));
    app.emit("pointer.move", pointerEvent(30, 24, handles[0]!));
    app.emit("pointer.up", pointerEvent(30, 24, handles[0]!));

    expect(onVectorEdit).toHaveBeenCalledTimes(1);
    const request = onVectorEdit.mock.calls[0]?.[0];
    if (!request || request.deleteNode) throw new Error("Missing vector edit");
    const segmentAb = request.edits[0]!.network.segments.find(
      (segment) => segment.id === "segment_ab",
    );
    const segmentBc = request.edits[0]!.network.segments.find(
      (segment) => segment.id === "segment_bc",
    );
    expect(segmentAb?.tangentEnd).toEqual({ x: -30, y: -6 });
    expect(segmentBc?.tangentStart).toEqual({ x: 30, y: 6 });

    onVectorEdit.mockClear();
    expect(adapter.setVectorPointMode("corner")).toBe(true);
    expect(onVectorEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        deleteNode: false,
        edits: [expect.objectContaining({ nodeId: "editable_curve" })],
      }),
    );
    const cornerRequest = onVectorEdit.mock.calls[0]?.[0];
    if (!cornerRequest || cornerRequest.deleteNode) {
      throw new Error("Missing corner vector edit");
    }
    expect(
      cornerRequest.edits[0]!.network.segments[0]?.tangentEnd,
    ).toBeUndefined();
    expect(
      cornerRequest.edits[0]!.network.segments[1]?.tangentStart,
    ).toBeUndefined();
    adapter.dispose();
  });

  it("deletes selected vector vertices and exits when the contour becomes invalid", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const onVectorEditExit = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
      onVectorEditExit,
    });
    adapter.sync(
      withVectorEditFixture(createInput(), ["vertex_a", "vertex_b"]),
    );

    emitWindowKey("Delete");

    expect(onVectorEdit).toHaveBeenCalledWith({
      deleteNode: true,
      nodeId: "editable_curve",
    });
    expect(onVectorEditExit).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("keeps branch point movement and Delete available while ambiguous topology controls stay disabled", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
    });
    const input = withVectorEditFixture(createInput(), ["vertex_b"]);
    input.vectorEditScope!.nodes[0]!.topologyEditable = false;
    adapter.sync(input);
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    const overlay = path?.parent?.children.at(-1);
    if (!app || !(overlay instanceof FakeGroup)) {
      throw new Error("Missing branch vector overlay");
    }
    const anchors = overlay.children.filter(
      (child): child is FakeEllipse => child instanceof FakeEllipse,
    );
    app.emit("pointer.down", pointerEvent(60, 30, anchors[1]!));
    app.emit("pointer.move", pointerEvent(72, 38, anchors[1]!));
    app.emit("pointer.up", pointerEvent(72, 38, anchors[1]!));
    expect(onVectorEdit).toHaveBeenCalledTimes(1);

    onVectorEdit.mockClear();
    expect(adapter.setVectorPointMode("smooth")).toBe(false);
    emitWindowKey("Delete");
    const vertexDeletion = onVectorEdit.mock.calls[0]?.[0];
    if (!vertexDeletion || vertexDeletion.deleteNode) {
      throw new Error("Missing branch vertex Delete edit");
    }
    expect(vertexDeletion.edits[0]!.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [{ segmentId: "segment_edit_1", reversed: false }],
      },
    ]);

    onVectorEdit.mockClear();
    input.vectorEditScope = {
      ...input.vectorEditScope!,
      nodes: input.vectorEditScope!.nodes.map((item) => ({
        ...item,
        selectedSegmentIds: ["segment_ab"],
        selectedVertexIds: [],
      })),
    };
    adapter.sync(input);
    emitWindowKey("Delete");
    const deletion = onVectorEdit.mock.calls[0]?.[0];
    if (!deletion || deletion.deleteNode) {
      throw new Error("Missing branch segment Delete edit");
    }
    expect(deletion.edits[0]!.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [{ segmentId: "segment_bc", reversed: false }],
      },
    ]);
    adapter.dispose();
  });

  it("cuts a shared junction on the explicit active path", async () => {
    const input = withVectorEditFixture(createInput(), ["vertex_b"]);
    const vector = input.document.nodesById.editable_curve;
    if (
      !vector ||
      vector.kind !== "vector" ||
      !("network" in vector.properties)
    ) {
      throw new Error("Missing branch Cut fixture");
    }
    vector.properties.network.vertices.push({
      id: "vertex_branch",
      x: 60,
      y: 90,
    });
    vector.properties.network.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_b",
      endVertexId: "vertex_branch",
    });
    vector.properties.network.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: false }],
    });
    let network = structuredClone(vector.properties.network);
    const onVectorCut = vi.fn<
      NonNullable<LeaferEngineCallbacks["onVectorCut"]>
    >((request) => {
      const result = cutVectorPath(network, request.pathId, request.at);
      if (!result.ok) return { ok: false };
      network = result.network;
      return {
        ok: true,
        network,
        selectedVertexIds: result.cutVertexIds,
      };
    });
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorCut,
    });
    input.vectorEditScope = {
      ...input.vectorEditScope!,
      nodes: input.vectorEditScope!.nodes.map((item) => ({
        ...item,
        activePathId: "path_open",
        selectedSegmentIds: ["segment_ab"],
        topologyEditable: false,
      })),
      tool: "cut",
    };
    adapter.sync(input);
    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    const overlay = path?.parent?.children.at(-1);
    if (!app || !(overlay instanceof FakeGroup)) {
      throw new Error("Missing branch Cut overlay");
    }
    const anchors = overlay.children.filter(
      (child): child is FakeEllipse => child instanceof FakeEllipse,
    );
    app.emit("pointer.down", pointerEvent(60, 30, anchors[1]!));
    app.emit("pointer.up", pointerEvent(60, 30, anchors[1]!));
    expect(onVectorCut).toHaveBeenCalledWith({
      at: { kind: "vertex", vertexId: "vertex_b" },
      nodeId: "editable_curve",
      pathId: "path_open",
    });
    expect(network.paths.map(({ id }) => id)).toEqual([
      "path_open",
      "path_edit_1",
      "path_branch",
    ]);
    adapter.dispose();
  });

  it("moves an existing branch-junction handle without enabling topology mutations", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
    });
    const input = withVectorEditFixture(createInput(), ["vertex_b"], true);
    const vector = input.document.nodesById.editable_curve;
    if (
      !vector ||
      vector.kind !== "vector" ||
      !("network" in vector.properties)
    ) {
      throw new Error("Missing editable Vector fixture");
    }
    vector.properties.network.vertices.push({
      id: "vertex_branch",
      x: 60,
      y: 90,
    });
    vector.properties.network.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_b",
      endVertexId: "vertex_branch",
      tangentStart: { x: 0, y: 20 },
    });
    vector.properties.network.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: false }],
    });
    input.vectorEditScope!.nodes[0]!.topologyEditable = false;
    adapter.sync(input);

    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    const overlay = path?.parent?.children.at(-1);
    if (!app || !(overlay instanceof FakeGroup)) {
      throw new Error("Missing branch vector overlay");
    }
    const controls = overlay.children.filter(
      (child): child is FakeEllipse => child instanceof FakeEllipse,
    );
    const branchHandle = controls.at(-1);
    if (!branchHandle) throw new Error("Missing branch junction handle");

    app.emit("pointer.down", pointerEvent(60, 50, branchHandle));
    app.emit("pointer.move", pointerEvent(68, 56, branchHandle));
    app.emit("pointer.up", pointerEvent(68, 56, branchHandle));

    const request = onVectorEdit.mock.calls[0]?.[0];
    if (!request || request.deleteNode) {
      throw new Error("Missing branch handle edit");
    }
    expect(
      request.edits[0]!.network.segments.find(
        ({ id }) => id === "segment_branch",
      )?.tangentStart,
    ).toEqual({ x: 8, y: 26 });
    expect(adapter.setVectorPointMode("smooth")).toBe(false);
    adapter.dispose();
  });

  it("supports explicit segment and drag line Cut in a branch network", async () => {
    const input = withVectorEditFixture(createInput(), [], true);
    const vector = input.document.nodesById.editable_curve;
    if (
      !vector ||
      vector.kind !== "vector" ||
      !("network" in vector.properties)
    ) {
      throw new Error("Missing editable Vector fixture");
    }
    vector.properties.network.vertices.push({
      id: "vertex_branch",
      x: 60,
      y: 90,
    });
    vector.properties.network.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_b",
      endVertexId: "vertex_branch",
    });
    vector.properties.network.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: false }],
    });
    const cut = cutVectorPath(vector.properties.network, "path_branch", {
      kind: "segment",
      segmentId: "segment_branch",
      t: 0.5,
    });
    if (!cut.ok) throw new Error(cut.message);
    const onVectorCut = vi.fn<
      NonNullable<LeaferEngineCallbacks["onVectorCut"]>
    >(() => ({
      ok: true,
      network: cut.network,
      selectedVertexIds: cut.cutVertexIds,
    }));
    const onVectorLineCut = vi.fn<
      NonNullable<LeaferEngineCallbacks["onVectorLineCut"]>
    >(() => ({ ok: false }));
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorCut,
      onVectorLineCut,
    });
    input.vectorEditScope = {
      ...input.vectorEditScope!,
      nodes: input.vectorEditScope!.nodes.map((item) => ({
        ...item,
        topologyEditable: false,
      })),
      tool: "cut",
    };
    adapter.sync(input);

    const app = leaferHarness.app;
    const path =
      app && findElement(app.tree, vectorStrokeElementId("editable_curve"));
    const overlay = path?.parent?.children.at(-1);
    if (!app || !(overlay instanceof FakeGroup)) {
      throw new Error("Missing branch Cut overlay");
    }
    const hitPath = overlay.children.filter(
      (child): child is FakePath => child instanceof FakePath,
    )[0];
    if (!hitPath) throw new Error("Missing branch Cut hit path");
    expect((hitPath as FakePath & { hittable: boolean }).hittable).toBe(true);

    app.emit("pointer.down", pointerEvent(60, 60, hitPath));
    app.emit("pointer.up", pointerEvent(60, 60, hitPath));
    expect(onVectorCut).toHaveBeenCalledWith({
      at: { kind: "segment", segmentId: "segment_branch", t: 0.5 },
      nodeId: "editable_curve",
      pathId: "path_branch",
    });

    onVectorCut.mockClear();
    app.emit("pointer.down", pointerEvent(60, 60, hitPath));
    app.emit("pointer.move", pointerEvent(100, 80, hitPath));
    app.emit("pointer.up", pointerEvent(100, 80, hitPath));
    expect(onVectorCut).not.toHaveBeenCalled();
    expect(onVectorLineCut).toHaveBeenCalledWith({
      end: { x: 100, y: 80 },
      nodeIds: ["editable_curve"],
      start: { x: 60, y: 60 },
    });
    adapter.dispose();
  });

  it("deletes selected vector path segments without converting them to points", async () => {
    const onVectorEdit = vi.fn<(request: LeaferVectorEditRequest) => boolean>(
      () => true,
    );
    const onVectorEditSelectionChange = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onVectorEdit,
      onVectorEditSelectionChange,
    });
    adapter.sync(
      withVectorEditFixture(createInput(), [], false, ["segment_ab"]),
    );

    emitWindowKey("Delete");

    const request = onVectorEdit.mock.calls[0]?.[0];
    if (!request || request.deleteNode) {
      throw new Error("Expected a retained Vector path");
    }
    expect(request.edits[0]!.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [{ segmentId: "segment_bc", reversed: false }],
      },
    ]);
    expect(
      request.edits[0]!.network.vertices.map((vertex) => vertex.id),
    ).toEqual(["vertex_b", "vertex_c"]);
    expect(onVectorEditSelectionChange).toHaveBeenCalledWith("editable_curve", {
      segmentIds: [],
      vertexIds: [],
    });
    adapter.dispose();
  });

  it("persists Leafer LineEditTool endpoint drags as one canonical transaction", async () => {
    const onOperations = vi.fn(() => true);
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
      onOperations,
    });
    adapter.sync(withLineFixture(createInput()));
    flushAnimationFrames();
    const app = leaferHarness.app;
    const line = app && findElement(app.tree, "flow_line");
    if (!app || !(line instanceof FakeArrow)) {
      throw new Error("Missing Line projection");
    }

    app.editor.resizing = true;
    app.editor.editBox.dragging = true;
    app.editor.emit("editor.before-scale");
    line.points = [-20, 0, 130, 60];
    app.editor.emit("editor.scale");
    app.editor.editBox.dragging = false;
    app.editor.editBox.emit("drag.end");

    expect(onOperations).toHaveBeenCalledWith({
      kind: "resize",
      selectionNodeIds: ["flow_line"],
      operations: [
        {
          commandId: "leafer_transform_flow_line",
          type: "update_properties",
          nodeId: "flow_line",
          transform: [1, 0, 0, 1, 0, 30],
          size: { width: 150, height: 60 },
          properties: {
            start: { x: 0, y: 0 },
            end: { x: 1, y: 1 },
          },
        },
      ],
    });
    adapter.dispose();
  });
});

function createInput(): LeaferEngineSyncInput {
  return {
    document: createWelcomeDocument(),
    pageId: "page_welcome",
    selection: { nodeIds: ["feature_one"], anchorNodeId: "feature_one" },
    tool: "select",
    viewport: { panX: 0, panY: 0, zoom: 1, width: 1024, height: 768 },
  };
}

function withImageFixture(input: LeaferEngineSyncInput): LeaferEngineSyncInput {
  const document = structuredClone(input.document);
  document.assetsById.hero_asset = {
    id: "hero_asset",
    kind: "image",
    name: "Hero source",
    mimeType: "image/png",
    source: { type: "data", value: "AQID" },
    size: { width: 800, height: 600 },
    extensions: {},
  };
  document.nodesById.hero_image = {
    id: "hero_image",
    kind: "image",
    name: "Hero image",
    parentId: "frame_welcome",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 120, 180],
    size: { width: 320, height: 240 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    properties: {
      assetId: "hero_asset",
      placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
      altText: "",
      cornerRadius: 0,
    },
  };
  document.nodesById.frame_welcome?.childIds.push("hero_image");
  return { ...input, document };
}

function withGridFixture(input: LeaferEngineSyncInput): LeaferEngineSyncInput {
  const document = structuredClone(input.document);
  const frame = document.nodesById.frame_welcome;
  if (frame?.kind !== "frame") throw new Error("Missing welcome Frame");
  frame.size = { width: 1_200, height: 240 };
  frame.childIds = ["feature_one", "feature_two"];
  frame.properties.autoLayout = {
    mode: "grid",
    padding: { top: 16, right: 20, bottom: 16, left: 20 },
    rowGap: 8,
    columnGap: 12,
    rows: [
      { type: "fixed", value: 100 },
      { type: "fixed", value: 100 },
    ],
    columns: [
      { type: "fixed", value: 120 },
      { type: "fill", value: 1 },
    ],
    itemsPositioning: "row-auto-flow",
  };
  return {
    ...input,
    document,
    gridEditorFrameId: frame.id,
    selection: { nodeIds: [frame.id], anchorNodeId: frame.id },
    tool: "select",
  };
}

function withGridChildFixture(
  input: LeaferEngineSyncInput,
): LeaferEngineSyncInput {
  const fixture = withGridFixture(input);
  const document = structuredClone(fixture.document);
  const frame = document.nodesById.frame_welcome;
  if (frame?.kind !== "frame") throw new Error("Missing welcome Frame");
  const grid = frame.properties.autoLayout;
  if (!grid || grid.mode !== "grid") throw new Error("Missing Grid fixture");
  grid.itemsPositioning = "manual";
  const first = document.nodesById.feature_one;
  const second = document.nodesById.feature_two;
  if (!first || !second) throw new Error("Missing Grid child fixtures");
  first.parentId = frame.id;
  second.parentId = frame.id;
  first.gridPlacement = {
    row: 0,
    column: 0,
    rowSpan: 1,
    columnSpan: 1,
    horizontalAlign: "auto",
    verticalAlign: "auto",
  };
  second.gridPlacement = {
    ...first.gridPlacement,
    column: 1,
  };
  return {
    ...fixture,
    document,
    gridEditorFrameId: frame.id,
    selection: { nodeIds: [first.id], anchorNodeId: first.id },
  };
}

function withGridLineFixture(
  input: LeaferEngineSyncInput,
): LeaferEngineSyncInput {
  const fixture = withLineFixture(input);
  const document = structuredClone(fixture.document);
  const frame = document.nodesById.frame_welcome;
  const line = document.nodesById.flow_line;
  if (frame?.kind !== "frame" || line?.kind !== "line") {
    throw new Error("Missing Grid Line fixture");
  }
  frame.size = { width: 100, height: 100 };
  frame.childIds = [line.id];
  frame.properties.autoLayout = {
    mode: "grid",
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    rowGap: 0,
    columnGap: 0,
    rows: [{ type: "fixed", value: 100 }],
    columns: [{ type: "fixed", value: 100 }],
    itemsPositioning: "row-auto-flow",
  };
  line.transform = [1, 0, 0, 1, 0, 0];
  line.size = { width: 100, height: 0 };
  line.gridPlacement = {
    row: 0,
    column: 0,
    rowSpan: 1,
    columnSpan: 1,
    horizontalAlign: "auto",
    verticalAlign: "auto",
  };
  line.layoutSizing = { horizontal: "fill", vertical: "fixed" };
  return {
    ...fixture,
    document,
    gridEditorFrameId: frame.id,
    selection: { nodeIds: [line.id], anchorNodeId: line.id },
    tool: "select",
  };
}

function withSmartSelectionFixture(
  input: LeaferEngineSyncInput,
): LeaferEngineSyncInput {
  const document = structuredClone(input.document);
  document.nodesById.feature_one!.transform = [1, 0, 0, 1, 0, 0];
  document.nodesById.feature_two!.transform = [1, 0, 0, 1, 280, 0];
  document.nodesById.feature_three!.transform = [1, 0, 0, 1, 560, 0];
  document.nodesById.feature_one!.size = { width: 260, height: 100 };
  document.nodesById.feature_two!.size = { width: 260, height: 80 };
  document.nodesById.feature_three!.size = { width: 260, height: 120 };
  document.nodesById.feature_group!.size = { width: 820, height: 120 };
  return {
    ...input,
    document,
    selection: {
      nodeIds: ["feature_one", "feature_two", "feature_three"],
      anchorNodeId: "feature_three",
    },
    tool: "select",
  };
}

function withSmartGridFixture(
  input: LeaferEngineSyncInput,
): LeaferEngineSyncInput {
  const document = structuredClone(input.document);
  const group = document.nodesById.feature_group;
  const template = document.nodesById.feature_one;
  if (group?.kind !== "group" || !template) throw new Error("Missing group");
  const placements = [
    ["a", 0, 0, 30, 20],
    ["b", 50, 0, 40, 30],
    ["c", 110, 0, 20, 25],
    ["d", 0, 70, 20, 40],
    ["e", 50, 70, 30, 20],
    ["f", 110, 70, 50, 35],
  ] as const;
  for (const [id, x, y, width, height] of placements) {
    document.nodesById[id] = {
      ...structuredClone(template),
      id,
      name: id,
      transform: [1, 0, 0, 1, x, y],
      size: { width, height },
    };
  }
  group.childIds = placements.map(([id]) => id);
  group.size = { width: 160, height: 110 };
  delete document.nodesById.feature_one;
  delete document.nodesById.feature_two;
  delete document.nodesById.feature_three;
  return {
    ...input,
    document,
    selection: { nodeIds: placements.map(([id]) => id), anchorNodeId: "f" },
    tool: "select",
  };
}

function withAutoLayoutSpacingFixture(
  input: LeaferEngineSyncInput,
): LeaferEngineSyncInput {
  const document = structuredClone(input.document);
  const frame = document.nodesById.frame_welcome;
  if (frame?.kind !== "frame") throw new Error("Missing welcome Frame");
  frame.size = { width: 600, height: 260 };
  frame.childIds = ["feature_one", "feature_two", "feature_three"];
  frame.properties.autoLayout = {
    mode: "horizontal",
    padding: { top: 16, right: 24, bottom: 20, left: 24 },
    gap: 12,
    primaryAlignment: "start",
    counterAlignment: "start",
  };
  frame.childIds.forEach((childId, index) => {
    const child = document.nodesById[childId];
    if (!child) throw new Error(`Missing ${childId}`);
    child.size = { width: 100, height: 60 };
    child.transform = [1, 0, 0, 1, 24 + index * 112, 20];
  });
  return {
    ...input,
    autoLayoutSpacingFrameId: frame.id,
    document,
    selection: { nodeIds: [frame.id], anchorNodeId: frame.id },
    tool: "select",
  };
}

function textRunProjection(
  input: LeaferEngineSyncInput,
  nodeId = "title_welcome",
): LeaferTextRunProjectionResolution {
  const node = input.document.nodesById[nodeId];
  if (!node || node.kind !== "text") throw new Error("Missing Text fixture");
  const content = node.properties.content;
  const split = Math.max(1, Math.floor(content.length / 2));
  return {
    documentId: input.document.documentId,
    pageId: input.pageId,
    revision: input.document.revision,
    resultsByNodeId: new Map([
      [
        nodeId,
        {
          nodeId,
          fragments: [
            {
              data: {
                fill: "#111827",
                fontFamily: "Inter",
                fontSize: 32,
                fontWeight: 700,
              },
              start: 0,
              end: split,
              text: content.slice(0, split),
              x: 0,
              y: 0,
              width: split * 18,
              height: 40,
            },
            {
              data: {
                fill: "#7c3aed",
                fontFamily: "Inter",
                fontSize: 32,
                fontWeight: 500,
              },
              start: split,
              end: content.length,
              text: content.slice(split),
              x: split * 18,
              y: 0,
              width: (content.length - split) * 18,
              height: 40,
            },
          ],
        },
      ],
    ]),
  };
}

function componentInput(): LeaferEngineSyncInput {
  const main: Extract<DesignNode, { kind: "frame" }> = {
    id: "button_main",
    name: "Button",
    parentId: null,
    childIds: ["button_bg", "button_label"],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 120, height: 44 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "frame",
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 10,
      clipsContent: false,
    },
  };
  const background: Extract<DesignNode, { kind: "rectangle" }> = {
    id: "button_bg",
    name: "Background",
    parentId: "button_main",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 120, height: 44 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "rectangle",
    properties: {
      fills: [{ type: "solid", color: "#2563eb", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 10,
    },
  };
  const label: Extract<DesignNode, { kind: "text" }> = {
    id: "button_label",
    name: "Label",
    parentId: "button_main",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 20, 10],
    size: { width: 80, height: 24 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "text",
    properties: {
      content: "Continue",
      fontFamily: "Inter",
      fontStyleName: null,
      fontSize: 14,
      fontWeight: 500,
      fontSlant: "normal",
      lineHeight: 20,
      letterSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      textCase: "original",
      textDecoration: "none",
      textDecorationStyle: null,
      textDecorationOffset: null,
      textDecorationThickness: null,
      textDecorationColor: null,
      textDecorationSkipInk: null,
      textAlignHorizontal: "center",
      textAlignVertical: "center",
      textResize: "fixed",
      textWrap: "word",
      textOverflow: "visible",
      textTruncation: "disabled",
      maxLines: null,
      fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
  };
  const instance: Extract<DesignNode, { kind: "instance" }> = {
    id: "button_instance",
    name: "Button instance",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 80, 60],
    size: { width: 120, height: 44 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "instance",
    properties: {
      componentId: "button",
      componentProperties: {},
      overrides: [],
    },
  };
  const document: DesignDocument = {
    format: "dev.opendesign.document",
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "component-raster",
    revision: 1,
    pageOrder: ["main", "instances"],
    pagesById: {
      main: {
        id: "main",
        name: "Components",
        rootNodeIds: ["button_main"],
        extensions: {},
      },
      instances: {
        id: "instances",
        name: "Screen",
        rootNodeIds: ["button_instance"],
        extensions: {},
      },
    },
    nodesById: {
      button_main: main,
      button_bg: background,
      button_label: label,
      button_instance: instance,
    },
    componentsById: {
      button: {
        id: "button",
        name: "Button",
        rootNodeId: "button_main",
        componentPropertyOrder: [],
        componentPropertyDefinitions: {},
        variantProperties: {},
        extensions: {},
      },
    },
    variantSetsById: {},
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    libraryStylesById: {},
    libraryVariableCollectionsById: {},
    libraryVariablesById: {},
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
    interactionsById: {},
    assetsById: {},
    imageAssetDerivationOrder: [],
    imageAssetDerivationsById: {},
    extensions: {},
  };
  return {
    document,
    pageId: "instances",
    selection: { nodeIds: [] },
    tool: "select",
    viewport: { panX: 0, panY: 0, zoom: 1, width: 1024, height: 768 },
  };
}

function withBooleanFixture(
  input: LeaferEngineSyncInput,
): LeaferEngineSyncInput {
  const document = structuredClone(input.document);
  document.revision += 1;
  const frame = document.nodesById.frame_welcome;
  if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
  document.nodesById.boolean_mark = {
    childIds: ["boolean_base", "boolean_cutout"],
    extensions: {},
    id: "boolean_mark",
    kind: "boolean",
    locked: false,
    name: "Boolean mark",
    exportSettings: [],
    opacity: 1,
    parentId: frame.id,
    properties: {
      fills: [{ type: "solid", color: "#111827", opacity: 1 }],
      operation: "subtract",
      strokes: [],
      strokeWidth: 0,
    },
    size: { width: 120, height: 120 },
    transform: [1, 0, 0, 1, 840, 72],
    visible: true,
  };
  document.nodesById.boolean_base = {
    childIds: [],
    extensions: {},
    id: "boolean_base",
    kind: "path",
    locked: false,
    name: "Base",
    exportSettings: [],
    opacity: 1,
    parentId: "boolean_mark",
    properties: {
      fills: [{ type: "solid", color: "#ef4444", opacity: 1 }],
      path: "M0 0H120V120H0Z",
      strokes: [],
      strokeWidth: 0,
    },
    size: { width: 120, height: 120 },
    transform: [1, 0, 0, 1, 0, 0],
    visible: true,
  };
  document.nodesById.boolean_cutout = {
    childIds: [],
    extensions: {},
    id: "boolean_cutout",
    kind: "path",
    locked: false,
    name: "Cutout",
    exportSettings: [],
    opacity: 1,
    parentId: "boolean_mark",
    properties: {
      fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
      path: "M0 0H60V60H0Z",
      strokes: [],
      strokeWidth: 0,
    },
    size: { width: 60, height: 60 },
    transform: [1, 0, 0, 1, 30, 30],
    visible: true,
  };
  frame.childIds.push("boolean_mark");
  return {
    ...input,
    document,
    selection: { nodeIds: ["boolean_mark"], anchorNodeId: "boolean_mark" },
  };
}

function withLineFixture(input: LeaferEngineSyncInput): LeaferEngineSyncInput {
  const document = structuredClone(input.document);
  const frame = document.nodesById.frame_welcome;
  if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
  document.nodesById.flow_line = {
    id: "flow_line",
    name: "Flow line",
    parentId: frame.id,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 20, 30],
    size: { width: 100, height: 0 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "line",
    properties: {
      fills: [],
      strokes: [{ type: "solid", color: "#111827", opacity: 1 }],
      strokeWidth: 2,
      strokeAlign: "center",
      strokeCap: "round",
      strokeJoin: "round",
      dashPattern: [],
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
      startEndpoint: "none",
      endEndpoint: "line-arrow",
    },
  };
  frame.childIds.push("flow_line");
  return {
    ...input,
    document,
    selection: { nodeIds: ["flow_line"], anchorNodeId: "flow_line" },
  };
}

function withVectorEditFixture(
  input: LeaferEngineSyncInput,
  selectedVertexIds: readonly string[] = [],
  mirrored = false,
  selectedSegmentIds: readonly string[] = [],
): LeaferEngineSyncInput {
  const document = structuredClone(input.document);
  const frame = document.nodesById.frame_welcome;
  if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
  document.nodesById.editable_curve = {
    id: "editable_curve",
    name: "Editable curve",
    parentId: frame.id,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 40, 60],
    size: { width: 120, height: 30 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "vector",
    properties: {
      network: {
        vertices: [
          { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
          {
            id: "vertex_b",
            x: 60,
            y: 30,
            handleMode: mirrored ? "mirrored" : "corner",
          },
          { id: "vertex_c", x: 120, y: 0, handleMode: "corner" },
        ],
        segments: [
          {
            id: "segment_ab",
            startVertexId: "vertex_a",
            endVertexId: "vertex_b",
            ...(mirrored ? { tangentEnd: { x: -20, y: 0 } } : {}),
          },
          {
            id: "segment_bc",
            startVertexId: "vertex_b",
            endVertexId: "vertex_c",
            ...(mirrored ? { tangentStart: { x: 20, y: 0 } } : {}),
          },
        ],
        paths: [
          {
            id: "path_open",
            closed: false,
            segments: [
              { segmentId: "segment_ab", reversed: false },
              { segmentId: "segment_bc", reversed: false },
            ],
          },
        ],
        regions: [],
      },
      fillRule: "nonzero",
      fills: [],
      strokes: [{ type: "solid", color: "#151515", opacity: 1 }],
      strokeWidth: 2,
    },
  };
  frame.childIds.push("editable_curve");
  return {
    ...input,
    document,
    selection: {
      nodeIds: ["editable_curve"],
      anchorNodeId: "editable_curve",
    },
    vectorEditScope: {
      activeNodeId: "editable_curve",
      nodes: [
        {
          nodeId: "editable_curve",
          readOnly: false,
          selectedSegmentIds,
          selectedVertexIds,
          topologyEditable: true,
        },
      ],
      tool: "move",
    },
  };
}

function withClosedVectorEditFixture(
  input: LeaferEngineSyncInput,
): LeaferEngineSyncInput {
  const fixture = withVectorEditFixture(input);
  const document = structuredClone(fixture.document);
  const vector = document.nodesById.editable_curve;
  if (
    !vector ||
    vector.kind !== "vector" ||
    !("network" in vector.properties)
  ) {
    throw new Error("Missing editable Vector fixture");
  }
  vector.properties.network.segments.push({
    id: "segment_ca",
    startVertexId: "vertex_c",
    endVertexId: "vertex_a",
  });
  const path = vector.properties.network.paths[0];
  if (!path) throw new Error("Missing editable Vector path");
  path.closed = true;
  path.segments.push({ segmentId: "segment_ca", reversed: false });
  vector.properties.network.regions = [
    {
      id: "region_curve",
      windingRule: "nonzero",
      loops: [{ pathId: path.id, reversed: false }],
    },
  ];
  return { ...fixture, document };
}

function withMultiVectorEditFixture(
  input: LeaferEngineSyncInput,
): LeaferEngineSyncInput {
  const single = withVectorEditFixture(input);
  const document = structuredClone(single.document);
  const frame = document.nodesById.frame_welcome;
  const first = document.nodesById.editable_curve;
  if (!frame || frame.kind !== "frame" || !first) {
    throw new Error("Missing editable Vector fixture");
  }
  const second = structuredClone(first);
  second.id = "editable_curve_second";
  second.name = "Second editable curve";
  second.transform = [1, 0, 0, 1, 220, 60];
  document.nodesById[second.id] = second;
  frame.childIds.push(second.id);
  return {
    ...single,
    document,
    selection: {
      nodeIds: [first.id, second.id],
      anchorNodeId: second.id,
    },
    vectorEditScope: {
      activeNodeId: first.id,
      nodes: [
        {
          nodeId: first.id,
          readOnly: false,
          selectedSegmentIds: [],
          selectedVertexIds: [],
          topologyEditable: true,
        },
        {
          nodeId: second.id,
          readOnly: false,
          selectedSegmentIds: [],
          selectedVertexIds: [],
          topologyEditable: true,
        },
      ],
      tool: "move",
    },
  };
}

function fakeVectorGeometryProvider(): VectorGeometryProvider {
  const result = (
    path: string,
    fillRule: "nonzero" | "evenodd" = "nonzero",
  ) => ({
    bounds: path.length === 0 ? null : { x: 0, y: 0, width: 120, height: 120 },
    empty: path.length === 0,
    fillRule,
    ok: true as const,
    path,
    provider: "skia-pathkit" as const,
    providerVersion: "1.0.0" as const,
  });
  return {
    id: "skia-pathkit",
    version: "1.0.0",
    combine: (paths, operation) =>
      result(
        `${operation}(${paths.map((item) => item.path).join("|")})`,
        paths[0]?.fillRule ?? "nonzero",
      ),
    dash: (path, options) =>
      result(
        `dash(${options.on},${options.off},${options.phase},${path.path})`,
        path.fillRule ?? "nonzero",
      ),
    normalize: (path) => result(path.path, path.fillRule ?? "nonzero"),
    outlineStroke: (path, options) =>
      result(
        `stroke(${options.width},${path.path})`,
        path.fillRule ?? "nonzero",
      ),
    transform: (path, transform) =>
      result(
        `transform(${transform.join(",")},${path.path})`,
        path.fillRule ?? "nonzero",
      ),
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function createCallbacks(): LeaferEngineCallbacks {
  return {
    onCreate: vi.fn(() => true),
    onCreateVector: vi.fn(() => true),
    onError: vi.fn(),
    onOperations: vi.fn(() => true),
    onSelectionChange: vi.fn(),
    onViewportChange: vi.fn(),
  };
}

function createHost(): HTMLElement {
  return {
    addEventListener: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({ width: 1024, height: 768 })),
    removeEventListener: vi.fn(),
  } as unknown as HTMLElement;
}

function boxDragEvent(
  x: number,
  y: number,
  modifiers: { altKey?: boolean; shiftKey?: boolean } = {},
) {
  return {
    altKey: modifiers.altKey ?? false,
    clientX: x,
    clientY: y,
    getInnerPoint: (coordinates?: unknown) => {
      void coordinates;
      return { x, y };
    },
    shiftKey: modifiers.shiftKey ?? false,
    target: {},
  };
}

function pointerEvent(
  x: number,
  y: number,
  target: FakeElement,
  modifiers: {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  } = {},
) {
  return {
    altKey: modifiers.altKey ?? false,
    clientX: x,
    clientY: y,
    ctrlKey: modifiers.ctrlKey ?? false,
    getInnerPoint: () => ({ x, y }),
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    target,
  };
}

function clickPenPoint(app: FakeApp, x: number, y: number): void {
  const event = boxDragEvent(x, y);
  app.emit("pointer.down", event);
  app.emit("pointer.up", event);
}

function emitWindowKey(code: string): {
  preventDefault: ReturnType<typeof vi.fn>;
  stopImmediatePropagation: ReturnType<typeof vi.fn>;
} {
  const event = {
    code,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as KeyboardEvent;
  leaferHarness.windowListeners
    .get("keydown")
    ?.forEach((listener) => listener(event));
  return event as unknown as {
    preventDefault: ReturnType<typeof vi.fn>;
    stopImmediatePropagation: ReturnType<typeof vi.fn>;
  };
}

function emitWindowKeyUp(code: string): {
  preventDefault: ReturnType<typeof vi.fn>;
  stopImmediatePropagation: ReturnType<typeof vi.fn>;
} {
  const event = {
    code,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as KeyboardEvent;
  leaferHarness.windowListeners
    .get("keyup")
    ?.forEach((listener) => listener(event));
  return event as unknown as {
    preventDefault: ReturnType<typeof vi.fn>;
    stopImmediatePropagation: ReturnType<typeof vi.fn>;
  };
}

function emitTextEditWindowKey(
  target: Node,
  options: {
    code: string;
    ctrlKey?: boolean;
    key: string;
    metaKey?: boolean;
    shiftKey?: boolean;
  },
) {
  const event = {
    altKey: false,
    code: options.code,
    ctrlKey: options.ctrlKey ?? false,
    isComposing: false,
    key: options.key,
    metaKey: options.metaKey ?? false,
    preventDefault: vi.fn(),
    shiftKey: options.shiftKey ?? false,
    stopImmediatePropagation: vi.fn(),
    target,
  };
  leaferHarness.windowListeners
    .get("keydown")
    ?.forEach((listener) => listener(event as unknown as KeyboardEvent));
  return event;
}

function setDomCaret(root: HTMLElement, offset: number): void {
  setDomSelection(root, offset, offset);
}

function setDomSelection(root: HTMLElement, start: number, end: number): void {
  const startPoint = testDomPoint(root, start);
  const endPoint = testDomPoint(root, end);
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function testDomPoint(
  root: HTMLElement,
  offset: number,
): { node: Node; offset: number } {
  let remaining = offset;
  let point: { node: Node; offset: number } | null = null;
  const visit = (node: Node): void => {
    if (point) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) point = { node, offset: remaining };
      else remaining -= length;
      return;
    }
    if (node instanceof HTMLBRElement) {
      if (remaining === 0) {
        const parent = node.parentNode;
        if (parent) {
          point = {
            node: parent,
            offset: [...parent.childNodes].indexOf(node),
          };
        }
      } else {
        remaining -= 1;
      }
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
  return point ?? { node: root, offset: root.childNodes.length };
}

function flushAnimationFrames(): void {
  while (animationFrames.size > 0) {
    const pending = [...animationFrames.entries()];
    animationFrames.clear();
    pending.forEach(([id, callback]) => callback(id));
  }
}

function flushAnimationFramesAt(timestamp: number): void {
  const pending = [...animationFrames.values()];
  animationFrames.clear();
  pending.forEach((callback) => callback(timestamp));
}

function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function findElement(group: FakeGroup, id: string): FakeElement | undefined {
  for (const child of group.children) {
    if (child.id === id) return child;
    if (child instanceof FakeGroup) {
      const nested = findElement(child, id);
      if (nested) return nested;
    }
  }
  return undefined;
}

function findElementIds(group: FakeGroup, prefix: string): string[] {
  const ids: string[] = [];
  for (const child of group.children) {
    if (child.id?.startsWith(prefix)) ids.push(child.id);
    if (child instanceof FakeGroup) ids.push(...findElementIds(child, prefix));
  }
  return ids;
}

function changedNodeSet(
  beforeDocument: LeaferEngineSyncInput["document"],
  afterDocument: LeaferEngineSyncInput["document"],
  nodeId: string,
  changedField = "properties",
): DesignChangeSet {
  const before = beforeDocument.nodesById[nodeId];
  const after = afterDocument.nodesById[nodeId];
  if (!before || !after) throw new Error(`Missing changed node ${nodeId}`);
  return {
    documentId: afterDocument.documentId,
    fromRevision: beforeDocument.revision,
    toRevision: afterDocument.revision,
    addedNodeIds: [],
    changedNodeIds: [nodeId],
    removedNodeIds: [],
    changes: [
      {
        type: "updated",
        nodeId,
        before,
        after,
        changedFields: [changedField],
      },
    ],
  };
}
