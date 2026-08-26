export type LeaferAdapterEventTypes = {
  dragStart: string;
  drag: string;
  dragEnd: string;
  editorSelect: string;
  beforeMove: string;
  beforeScale: string;
  beforeRotate: string;
  beforeSkew: string;
  move: string;
  scale: string;
  rotate: string;
  skew: string;
  beforeInnerOpen: string;
  innerOpen: string;
  beforeInnerClose: string;
  innerClose: string;
  pointerDown: string;
  pointerMove: string;
  pointerUp: string;
  viewportMove: string;
  viewportMoveEnd: string;
  viewportZoom: string;
  viewportZoomEnd: string;
  viewportResize: string;
  renderChildStart: string;
};

export type LeaferAdapterEventCallbacks = {
  onSelection: () => void;
  onEditBoxDragStart: () => void;
  onEditBoxDragEnd: (event: unknown) => void;
  onBeforeTransform: (mode: "move" | "resize" | "rotate" | "skew") => void;
  onTransformChanged: () => void;
  onBeforeInnerOpen: (event: unknown) => void;
  onInnerOpen: (event: unknown) => void;
  onBeforeInnerClose: () => void;
  onInnerClose: () => void;
  onDragStart: (event: unknown) => void;
  onDrag: (event: unknown) => void;
  onDragEnd: (event: unknown) => void;
  onPointerDown: (event: unknown) => void;
  onPointerMove: (event: unknown) => void;
  onPointerUp: (event: unknown) => void;
  onViewportChanged: () => void;
  onRenderChildStart: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp: (event: KeyboardEvent) => void;
  onContextLost: (event: Event) => void;
};

type LeaferListener = (event: unknown) => void;

export interface LeaferAdapterEventTarget {
  on(type: string, listener: LeaferListener): void;
  off(type: string, listener: LeaferListener): void;
}

type DomListenerTarget = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

export class LeaferAdapterEventController {
  readonly #leaferBindings: Array<{
    target: LeaferAdapterEventTarget;
    type: string;
    listener: LeaferListener;
  }> = [];
  readonly #domBindings: Array<{
    target: DomListenerTarget;
    type: string;
    listener: EventListener;
    capture: boolean;
  }> = [];
  #disposed = false;

  constructor(options: {
    app: LeaferAdapterEventTarget;
    editor: LeaferAdapterEventTarget;
    editBox: LeaferAdapterEventTarget;
    host: DomListenerTarget;
    keyboardTarget: DomListenerTarget;
    events: LeaferAdapterEventTypes;
    callbacks: LeaferAdapterEventCallbacks;
  }) {
    const { callbacks, events } = options;
    this.#bindLeafer(options.editor, events.editorSelect, () =>
      callbacks.onSelection(),
    );
    this.#bindLeafer(options.editBox, events.dragStart, () =>
      callbacks.onEditBoxDragStart(),
    );
    this.#bindLeafer(options.editBox, events.dragEnd, (event) =>
      callbacks.onEditBoxDragEnd(event),
    );

    this.#bindLeafer(options.editor, events.beforeMove, () =>
      callbacks.onBeforeTransform("move"),
    );
    this.#bindLeafer(options.editor, events.beforeScale, () =>
      callbacks.onBeforeTransform("resize"),
    );
    this.#bindLeafer(options.editor, events.beforeRotate, () =>
      callbacks.onBeforeTransform("rotate"),
    );
    this.#bindLeafer(options.editor, events.beforeSkew, () =>
      callbacks.onBeforeTransform("skew"),
    );
    for (const type of [
      events.move,
      events.scale,
      events.rotate,
      events.skew,
    ]) {
      this.#bindLeafer(options.editor, type, () =>
        callbacks.onTransformChanged(),
      );
    }

    this.#bindLeafer(options.editor, events.beforeInnerOpen, (event) =>
      callbacks.onBeforeInnerOpen(event),
    );
    this.#bindLeafer(options.editor, events.innerOpen, (event) =>
      callbacks.onInnerOpen(event),
    );
    this.#bindLeafer(options.editor, events.beforeInnerClose, () =>
      callbacks.onBeforeInnerClose(),
    );
    this.#bindLeafer(options.editor, events.innerClose, () =>
      callbacks.onInnerClose(),
    );

    this.#bindLeafer(options.app, events.dragStart, (event) =>
      callbacks.onDragStart(event),
    );
    this.#bindLeafer(options.app, events.drag, (event) =>
      callbacks.onDrag(event),
    );
    this.#bindLeafer(options.app, events.dragEnd, (event) =>
      callbacks.onDragEnd(event),
    );
    this.#bindLeafer(options.app, events.pointerDown, (event) =>
      callbacks.onPointerDown(event),
    );
    this.#bindLeafer(options.app, events.pointerMove, (event) =>
      callbacks.onPointerMove(event),
    );
    this.#bindLeafer(options.app, events.pointerUp, (event) =>
      callbacks.onPointerUp(event),
    );
    for (const type of [
      events.viewportMove,
      events.viewportMoveEnd,
      events.viewportZoom,
      events.viewportZoomEnd,
      events.viewportResize,
    ]) {
      this.#bindLeafer(options.app, type, () => callbacks.onViewportChanged());
    }
    this.#bindLeafer(options.app, events.renderChildStart, () =>
      callbacks.onRenderChildStart(),
    );

    this.#bindDom(options.keyboardTarget, "keydown", (event) =>
      callbacks.onKeyDown(event as KeyboardEvent),
    );
    this.#bindDom(options.keyboardTarget, "keyup", (event) =>
      callbacks.onKeyUp(event as KeyboardEvent),
    );
    this.#bindDom(options.host, "contextlost", (event) =>
      callbacks.onContextLost(event),
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const binding of this.#domBindings.reverse()) {
      binding.target.removeEventListener(
        binding.type,
        binding.listener,
        binding.capture,
      );
    }
    this.#domBindings.length = 0;
    for (const binding of this.#leaferBindings.reverse()) {
      binding.target.off(binding.type, binding.listener);
    }
    this.#leaferBindings.length = 0;
  }

  #bindLeafer(
    target: LeaferAdapterEventTarget,
    type: string,
    listener: LeaferListener,
  ): void {
    target.on(type, listener);
    this.#leaferBindings.push({ target, type, listener });
  }

  #bindDom(
    target: DomListenerTarget,
    type: string,
    listener: EventListener,
  ): void {
    target.addEventListener(type, listener, true);
    this.#domBindings.push({ target, type, listener, capture: true });
  }
}
