import { createWelcomeDocument } from "@opendesign/editor-runtime";
import type { DesignChangeSet } from "@opendesign/design-contracts";
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
  setCalls = 0;
  transformCalls = 0;
  forceUpdate = vi.fn();

  constructor(data?: Record<string, unknown>) {
    super();
    if (data) this.set(data);
  }

  set(data: Record<string, unknown>): void {
    this.setCalls += 1;
    Object.assign(this, data);
  }

  setTransform(transform: ReturnType<typeof identityMatrix>): void {
    this.transformCalls += 1;
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
  override forceUpdate = vi.fn();

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

    app.tree.emit("viewport.zoom");
    app.tree.emit("viewport.move");
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

    expect(selected.locked).toBe(true);
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
