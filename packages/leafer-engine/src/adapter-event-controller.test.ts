import { describe, expect, it, vi } from "vitest";
import {
  LeaferAdapterEventController,
  type LeaferAdapterEventCallbacks,
  type LeaferAdapterEventTarget,
  type LeaferAdapterEventTypes,
} from "./adapter-event-controller.js";

const events: LeaferAdapterEventTypes = {
  dragStart: "drag.start",
  drag: "drag",
  dragEnd: "drag.end",
  editorSelect: "editor.select",
  beforeMove: "editor.before_move",
  beforeScale: "editor.before_scale",
  beforeRotate: "editor.before_rotate",
  beforeSkew: "editor.before_skew",
  move: "editor.move",
  scale: "editor.scale",
  rotate: "editor.rotate",
  skew: "editor.skew",
  beforeInnerOpen: "editor.before_inner_open",
  innerOpen: "editor.inner_open",
  beforeInnerClose: "editor.before_inner_close",
  innerClose: "editor.inner_close",
  pointerDown: "pointer.down",
  pointerMove: "pointer.move",
  pointerUp: "pointer.up",
  viewportMove: "viewport.move",
  viewportMoveEnd: "viewport.move_end",
  viewportZoom: "viewport.zoom",
  viewportZoomEnd: "viewport.zoom_end",
  viewportResize: "viewport.resize",
  renderChildStart: "render.child_start",
};

describe("LeaferAdapterEventController", () => {
  it("routes Leafer and DOM events through one mounted owner", () => {
    const app = new FakeLeaferTarget();
    const editor = new FakeLeaferTarget();
    const editBox = new FakeLeaferTarget();
    const keyboardTarget = new FakeDomTarget();
    const host = new FakeDomTarget();
    const callbacks = callbackSpies();
    new LeaferAdapterEventController({
      app,
      editor,
      editBox,
      host,
      keyboardTarget,
      events,
      callbacks,
    });

    editor.emit(events.editorSelect, { selected: true });
    editor.emit(events.beforeScale, {});
    editor.emit(events.scale, {});
    editBox.emit(events.dragEnd, { isCancel: true });
    app.emit(events.pointerMove, { x: 12, y: 20 });
    app.emit(events.viewportZoom, {});
    keyboardTarget.emit("keydown", keyboardEvent("keydown", "Q"));
    keyboardTarget.emit("blur", new Event("blur"));
    host.emit("contextlost", new Event("contextlost"));

    expect(callbacks.onSelection).toHaveBeenCalledOnce();
    expect(callbacks.onBeforeTransform).toHaveBeenCalledWith("resize");
    expect(callbacks.onTransformChanged).toHaveBeenCalledOnce();
    expect(callbacks.onEditBoxDragEnd).toHaveBeenCalledWith({ isCancel: true });
    expect(callbacks.onPointerMove).toHaveBeenCalledWith({ x: 12, y: 20 });
    expect(callbacks.onViewportChanged).toHaveBeenCalledOnce();
    expect(callbacks.onKeyDown).toHaveBeenCalledWith(
      expect.objectContaining({ code: "Q" }),
    );
    expect(callbacks.onWindowBlur).toHaveBeenCalledOnce();
    expect(callbacks.onContextLost).toHaveBeenCalledWith(expect.any(Event));
  });

  it("unbinds every resource exactly once and suppresses later callbacks", () => {
    const app = new FakeLeaferTarget();
    const editor = new FakeLeaferTarget();
    const editBox = new FakeLeaferTarget();
    const keyboardTarget = new FakeDomTarget();
    const host = new FakeDomTarget();
    const callbacks = callbackSpies();
    const controller = new LeaferAdapterEventController({
      app,
      editor,
      editBox,
      host,
      keyboardTarget,
      events,
      callbacks,
    });

    expect(
      app.listenerCount + editor.listenerCount + editBox.listenerCount,
    ).toBe(27);
    expect(keyboardTarget.listenerCount + host.listenerCount).toBe(4);

    controller.dispose();
    controller.dispose();

    expect(
      app.listenerCount + editor.listenerCount + editBox.listenerCount,
    ).toBe(0);
    expect(keyboardTarget.listenerCount + host.listenerCount).toBe(0);
    expect(app.offCalls + editor.offCalls + editBox.offCalls).toBe(27);
    expect(keyboardTarget.removeCalls + host.removeCalls).toBe(4);

    editor.emit(events.editorSelect, {});
    app.emit(events.viewportMove, {});
    keyboardTarget.emit("keyup", keyboardEvent("keyup"));
    expect(callbacks.onSelection).not.toHaveBeenCalled();
    expect(callbacks.onViewportChanged).not.toHaveBeenCalled();
    expect(callbacks.onKeyUp).not.toHaveBeenCalled();
  });
});

class FakeLeaferTarget implements LeaferAdapterEventTarget {
  readonly #listeners = new Map<string, Set<(event: unknown) => void>>();
  offCalls = 0;

  get listenerCount(): number {
    return [...this.#listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }

  on(type: string, listener: (event: unknown) => void): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  off(type: string, listener: (event: unknown) => void): void {
    this.offCalls += 1;
    this.#listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown): void {
    this.#listeners.get(type)?.forEach((listener) => listener(event));
  }
}

class FakeDomTarget {
  readonly #listeners = new Map<string, Set<EventListener>>();
  removeCalls = 0;

  get listenerCount(): number {
    return [...this.#listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (typeof listener !== "function") return;
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.removeCalls += 1;
    if (typeof listener === "function")
      this.#listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Event): void {
    this.#listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function callbackSpies(): LeaferAdapterEventCallbacks {
  return {
    onSelection: vi.fn(),
    onEditBoxDragStart: vi.fn(),
    onEditBoxDragEnd: vi.fn(),
    onBeforeTransform: vi.fn(),
    onTransformChanged: vi.fn(),
    onBeforeInnerOpen: vi.fn(),
    onInnerOpen: vi.fn(),
    onBeforeInnerClose: vi.fn(),
    onInnerClose: vi.fn(),
    onDragStart: vi.fn(),
    onDrag: vi.fn(),
    onDragEnd: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onViewportChanged: vi.fn(),
    onRenderChildStart: vi.fn(),
    onKeyDown: vi.fn(),
    onKeyUp: vi.fn(),
    onWindowBlur: vi.fn(),
    onContextLost: vi.fn(),
  };
}

function keyboardEvent(type: string, code = ""): Event {
  const event = new Event(type);
  Object.defineProperty(event, "code", { value: code });
  return event;
}
