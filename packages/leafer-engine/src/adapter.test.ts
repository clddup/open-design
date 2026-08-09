import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLeaferEngineAdapter } from "./adapter.js";
import type { LeaferEngineCallbacks, LeaferEngineSyncInput } from "./types.js";

const leaferHarness = vi.hoisted(() => ({
  app: null as FakeApp | null,
}));

class FakeEventTarget {
  readonly listeners = new Map<string, Set<() => void>>();

  on(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}

class FakeElement extends FakeEventTarget {
  readonly tag: string = "UI";
  id?: string;
  locked = false;
  parent: FakeGroup | undefined;
  localTransform = identityMatrix();
  width = 0;
  height = 0;

  constructor(data?: Record<string, unknown>) {
    super();
    if (data) this.set(data);
  }

  set(data: Record<string, unknown>): void {
    Object.assign(this, data);
  }

  setTransform(transform: ReturnType<typeof identityMatrix>): void {
    this.localTransform = { ...transform };
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
    this.children.splice(index, 0, child);
  }

  add(child: FakeElement): void {
    this.addAt(child, this.children.length);
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

class FakeImage extends FakeElement {
  override readonly tag: string = "Image";
}

class FakePath extends FakeElement {
  override readonly tag: string = "Path";
}

class FakeText extends FakeElement {
  override readonly tag: string = "Text";
  text = "";
}

class FakeTree extends FakeGroup {
  override readonly tag: string = "Leafer";
  forceUpdate = vi.fn();

  override setTransform(transform: ReturnType<typeof identityMatrix>): void {
    this.localTransform = { ...transform };
  }
}

class FakeEditor extends FakeEventTarget {
  readonly editBox = new FakeEventTarget() as FakeEventTarget & {
    dragging: boolean;
    gesturing: boolean;
  };
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
}

class FakeApp extends FakeEventTarget {
  readonly tree = new FakeTree();
  readonly editor = new FakeEditor();
  mode = "normal";
  destroy = vi.fn();

  constructor() {
    super();
    leaferHarness.app = this;
  }
}

vi.mock("leafer-editor", () => ({
  App: FakeApp,
  DragEvent: { START: "drag.start", DRAG: "drag.drag", END: "drag.end" },
  EditorEvent: { SELECT: "editor.select" },
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
  MoveEvent: { MOVE: "viewport.move", END: "viewport.move-end" },
  Path: FakePath,
  Rect: FakeRect,
  ResizeEvent: { RESIZE: "viewport.resize" },
  Text: FakeText,
  UI: FakeElement,
  ZoomEvent: { ZOOM: "viewport.zoom", END: "viewport.zoom-end" },
}));

const animationFrames = new Map<number, FrameRequestCallback>();
let animationFrameSequence = 0;

describe("Leafer engine selection bounds synchronization", () => {
  beforeEach(() => {
    leaferHarness.app = null;
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
      addEventListener: vi.fn(),
      cancelAnimationFrame: (id: number) => animationFrames.delete(id),
      removeEventListener: vi.fn(),
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

    const nextDocument = structuredClone(first.document);
    nextDocument.revision = first.document.revision + 1;
    const node = nextDocument.nodesById.feature_one;
    if (!node) throw new Error("Missing selected fixture node");
    node.size = { width: 420, height: 180 };

    adapter.sync({ ...first, document: nextDocument });
    expect(app.editor.list[0]).toBe(selectedElement);
    flushAnimationFrames();

    expect(app.tree.forceUpdate).toHaveBeenLastCalledWith("bounds");
    expect(app.editor.update).toHaveBeenCalledTimes(2);

    app.tree.emit("viewport.zoom");
    app.tree.emit("viewport.move");
    expect(animationFrames).toHaveLength(2);
    flushAnimationFrames();

    expect(app.editor.update).toHaveBeenCalledTimes(3);
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

function createCallbacks(): LeaferEngineCallbacks {
  return {
    onCreate: vi.fn(() => true),
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

function flushAnimationFrames(): void {
  while (animationFrames.size > 0) {
    const pending = [...animationFrames.entries()];
    animationFrames.clear();
    pending.forEach(([id, callback]) => callback(id));
  }
}

function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}
