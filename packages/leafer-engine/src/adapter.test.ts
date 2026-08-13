import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import type {
  DesignChangeSet,
  DesignDocument,
  DesignNode,
} from "@opendesign/design-contracts";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import { cutVectorPath } from "@opendesign/geometry-service/vector-edit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLeaferEngineAdapter } from "./adapter.js";
import { booleanResultElementId } from "./mapping.js";
import type {
  LeaferCreateRequest,
  LeaferCreateVectorRequest,
  LeaferEngineCallbacks,
  LeaferEngineSyncInput,
  LeaferGenerationSkeleton,
  LeaferVectorEditRequest,
} from "./types.js";

const leaferHarness = vi.hoisted(() => ({
  app: null as FakeApp | null,
  appConfig: null as Record<string, unknown> | null,
  boxMatches: [] as FakeElement[],
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
  x = 0;
  y = 0;
  setCalls = 0;
  strokeWidth = 0;
  transformCalls = 0;
  forceUpdate = vi.fn();
  leafer: FakeTree | undefined;
  export = vi.fn((_format: string, options?: { scale?: number }) => {
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

  constructor(data?: Record<string, unknown>) {
    super();
    if (data) this.set(data);
    if (!data || !Object.hasOwn(data, "width")) {
      this.width = undefined as unknown as number;
    }
    if (!data || !Object.hasOwn(data, "height")) {
      this.height = undefined as unknown as number;
    }
  }

  set(data: Record<string, unknown>): void {
    this.setCalls += 1;
    Object.assign(this, data);
  }

  setTransform(transform: ReturnType<typeof identityMatrix>): void {
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

  destroy(): void {}
}

class FakeGroup extends FakeElement {
  override readonly tag: string = "Group";
  children: FakeElement[] = [];

  addAt(child: FakeElement, index: number): void {
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
  hoverTarget: FakeElement | null = null;
  moving = false;
  resizing = false;
  rotating = false;
  skewing = false;
  update = vi.fn();
  children: FakeElement[] = [];

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

  closeInnerEditor(): void {
    this.innerEditing = false;
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
  InnerEditorEvent: { BEFORE_OPEN: "inner.before-open", CLOSE: "inner.close" },
  Leafer: FakeTree,
  MoveEvent: { MOVE: "viewport.move", END: "viewport.move-end" },
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

  it("exports resolved component pixels and deduplicates internal instance selection", async () => {
    const onSelectionChange = vi.fn();
    const adapter = await createLeaferEngineAdapter(createHost(), {
      ...createCallbacks(),
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
    const activityLayer = presentationRoot?.children[1] as
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
    const activityLayer = presentationRoot?.children[1] as
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
    const activityLayer = presentationRoot?.children[1] as
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
    const layer = app.sky.children[1] as FakeGroup | undefined;
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
    const activityLayer = app.sky.children[1] as FakeGroup | undefined;
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
      (app.sky.children[1] as FakeGroup | undefined)?.localTransform,
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
    adapter.dispose();
    expect(element.localTransform.e).toBe(780);
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
    const path = app && findElement(app.tree, "editable_curve");
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

    expect(onVectorEditSelectionChange).toHaveBeenCalledWith("editable_curve", [
      "vertex_a",
    ]);
    expect(onVectorEdit).toHaveBeenCalledTimes(1);
    const request = onVectorEdit.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      deleteNode: false,
      nodeId: "editable_curve",
    });
    if (!request || request.deleteNode) {
      throw new Error("Expected a vector network update");
    }
    expect(request.network.vertices).toContainEqual(
      expect.objectContaining({ id: "vertex_a", x: 24, y: 12 }),
    );
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
    const path = app && findElement(app.tree, "editable_curve");
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
    expect(onVectorEditSelectionChange).toHaveBeenCalledWith("editable_curve", [
      "vertex_edit_1",
      "vertex_edit_2",
    ]);
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
    const path = app && findElement(app.tree, "editable_curve");
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
    const path = app && findElement(app.tree, "editable_curve");
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
    const firstPath = app && findElement(app.tree, "editable_curve");
    const secondPath = app && findElement(app.tree, "editable_curve_second");
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
    const overlays = firstPath.parent.children.filter(
      (child): child is FakeGroup =>
        child instanceof FakeGroup &&
        child.children.filter(
          (control): control is FakeEllipse => control instanceof FakeEllipse,
        ).length === 3,
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
      ["vertex_a"],
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
    const path = app && findElement(app.tree, "editable_curve");
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
    const segmentAb = request.network.segments.find(
      (segment) => segment.id === "segment_ab",
    );
    const segmentBc = request.network.segments.find(
      (segment) => segment.id === "segment_bc",
    );
    expect(segmentAb?.tangentEnd).toEqual({ x: -30, y: -6 });
    expect(segmentBc?.tangentStart).toEqual({ x: 30, y: 6 });

    onVectorEdit.mockClear();
    expect(adapter.setVectorPointMode("corner")).toBe(true);
    expect(onVectorEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        deleteNode: false,
        nodeId: "editable_curve",
      }),
    );
    const cornerRequest = onVectorEdit.mock.calls[0]?.[0];
    if (!cornerRequest || cornerRequest.deleteNode) {
      throw new Error("Missing corner vector edit");
    }
    expect(cornerRequest.network.segments[0]?.tangentEnd).toBeUndefined();
    expect(cornerRequest.network.segments[1]?.tangentStart).toBeUndefined();
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
    opacity: 1,
    extensions: {},
    kind: "text",
    properties: {
      content: "Continue",
      fontFamily: "Inter",
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 20,
      letterSpacing: 0,
      textAlignHorizontal: "center",
      textAlignVertical: "center",
      textResize: "fixed",
      textWrap: "word",
      textOverflow: "visible",
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
    opacity: 1,
    extensions: {},
    kind: "instance",
    properties: { componentId: "button", overrides: [] },
  };
  const document: DesignDocument = {
    format: "dev.opendesign.document",
    schemaVersion: "1.15.0",
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
        extensions: {},
      },
    },
    variantSetsById: {},
    tokenCollectionsById: {},
    tokensById: {},
    interactionsById: {},
    assetsById: {},
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
          selectedVertexIds,
        },
      ],
      tool: "move",
    },
  };
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
          selectedVertexIds: [],
        },
        {
          nodeId: second.id,
          readOnly: false,
          selectedVertexIds: [],
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
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
) {
  return {
    altKey: false,
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

function emitWindowKey(code: string): void {
  const event = {
    code,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as KeyboardEvent;
  leaferHarness.windowListeners
    .get("keydown")
    ?.forEach((listener) => listener(event));
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
