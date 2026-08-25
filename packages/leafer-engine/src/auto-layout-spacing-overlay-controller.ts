import type { DesignDocument } from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import { matrixRelativeToParent, transformToAffine } from "./affine.js";
import { autoLayoutSpacingChangeFromInput } from "./auto-layout-spacing-input.js";
import {
  createAutoLayoutSpacingOverlayPlan,
  type AutoLayoutSpacingHandleKind,
  type AutoLayoutSpacingHandleSpec,
  type AutoLayoutSpacingOverlayPlan,
} from "./auto-layout-spacing-overlay.js";
import { eventClientPoint, type LeaferEventLike } from "./pointer-event.js";
import type {
  LeaferAutoLayoutSpacingChange,
  LeaferAutoLayoutSpacingCommitRequest,
  LeaferAutoLayoutSpacingInputRequest,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

interface SpacingHandleElements {
  hit: LeaferElement;
  visual: LeaferElement;
}

interface SpacingDragSession {
  axis: "x" | "y";
  documentId: string;
  expectedRevision: number;
  frameId: string;
  handleId: string;
  kind: AutoLayoutSpacingHandleKind;
  padding: AutoLayoutSpacingOverlayPlan["padding"];
  startClientPoint: { x: number; y: number };
  startCoordinate: number;
  startValue: number;
  moved: boolean;
}

const MATRIX_EPSILON = 0.000_001;
const SPACING_COLOR = "#f24e8a";
const SPACING_IDLE_COLOR = "rgba(242, 78, 138, 0.78)";
const SPACING_HIT_FILL = "rgba(0, 0, 0, 0.001)";
const HANDLE_LENGTH = 22;
const HANDLE_THICKNESS = 2;
const HIT_CROSS = 14;
const HIT_LENGTH = 34;
const PILL_HEIGHT = 20;
const PILL_OFFSET = 10;
const VALUE_MAXIMUM = 1_000_000;
const BIG_NUDGE = 10;

export class AutoLayoutSpacingOverlayController {
  #documentId: string | null = null;
  #drag: SpacingDragSession | null = null;
  #fingerprint: string | null = null;
  #frameHovered = false;
  readonly #handles = new Map<string, SpacingHandleElements>();
  readonly #hitHandleIds = new WeakMap<object, string>();
  readonly #layer: LeaferGroup;
  readonly #leafer: LeaferModule;
  readonly #onCommit: (
    request: LeaferAutoLayoutSpacingCommitRequest,
  ) => boolean;
  readonly #onInputRequest: (
    request: LeaferAutoLayoutSpacingInputRequest,
  ) => void;
  readonly #pill: LeaferElement;
  readonly #pillLabel: LeaferElement;
  #plan: AutoLayoutSpacingOverlayPlan | null = null;
  #previewChange: LeaferAutoLayoutSpacingChange | null = null;
  #previewPoint: { x: number; y: number } | null = null;
  #previewValue: number | null = null;
  readonly #presentationRoot: LeaferGroup;
  #revision: number | null = null;
  #scaleX = 1;
  #scaleY = 1;
  readonly #specs = new Map<string, AutoLayoutSpacingHandleSpec>();
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    layerIndex: number;
    leafer: LeaferModule;
    onCommit: (request: LeaferAutoLayoutSpacingCommitRequest) => boolean;
    onInputRequest: (request: LeaferAutoLayoutSpacingInputRequest) => void;
    presentationRoot: LeaferGroup;
    viewportRoot: LeaferGroup;
  }) {
    this.#leafer = options.leafer;
    this.#onCommit = options.onCommit;
    this.#onInputRequest = options.onInputRequest;
    this.#presentationRoot = options.presentationRoot;
    this.#viewportRoot = options.viewportRoot;
    this.#layer = new this.#leafer.Group({
      editable: false,
      hitChildren: true,
      visible: false,
    });
    this.#pill = new this.#leafer.Rect({
      cornerRadius: 4,
      editable: false,
      fill: SPACING_COLOR,
      hittable: false,
      visible: false,
    });
    this.#pillLabel = new this.#leafer.Text({
      editable: false,
      fill: "#ffffff",
      fontFamily: "Inter, sans-serif",
      fontWeight: 650,
      hittable: false,
      textAlign: "center",
      verticalAlign: "middle",
      visible: false,
    });
    this.#layer.add(this.#pill);
    this.#layer.add(this.#pillLabel);
    this.#presentationRoot.addAt(this.#layer, options.layerIndex);
  }

  get active(): boolean {
    return this.#plan !== null;
  }

  get dragging(): boolean {
    return this.#drag !== null;
  }

  cancelDrag(): boolean {
    if (!this.#drag) return false;
    this.#drag = null;
    this.#previewChange = null;
    this.#previewPoint = null;
    this.#previewValue = null;
    this.#pill.visible = false;
    this.#pillLabel.visible = false;
    this.#syncAppearance();
    return true;
  }

  dispose(): void {
    this.cancelDrag();
    this.#destroyHandles();
    this.#pill.remove();
    this.#pill.destroy();
    this.#pillLabel.remove();
    this.#pillLabel.destroy();
    this.#layer.remove();
    this.#layer.destroy();
  }

  pointerDown(event: LeaferEventLike): boolean {
    const handleId =
      event.target && typeof event.target === "object"
        ? this.#hitHandleIds.get(event.target)
        : undefined;
    const spec = handleId ? this.#specs.get(handleId) : undefined;
    if (
      !spec ||
      !this.#plan ||
      this.#documentId === null ||
      this.#revision === null ||
      event.right ||
      event.middle
    ) {
      return false;
    }
    const point = event.getInnerPoint(this.#layer);
    this.#drag = {
      axis: spec.axis,
      documentId: this.#documentId,
      expectedRevision: this.#revision,
      frameId: this.#plan.frameId,
      handleId: spec.id,
      kind: spec.kind,
      padding: { ...this.#plan.padding },
      startClientPoint: eventClientPoint(event),
      startCoordinate: spec.axis === "x" ? point.x : point.y,
      startValue: spec.value,
      moved: false,
    };
    this.#frameHovered = true;
    this.#previewPoint = { x: spec.x, y: spec.y };
    this.#previewValue = spec.value;
    this.#previewChange = spacingChange(
      this.#drag,
      spec.value,
      event.altKey,
      event.shiftKey,
    );
    this.#syncAppearance();
    this.#syncPill();
    return true;
  }

  pointerMove(event: LeaferEventLike): boolean {
    const drag = this.#drag;
    const plan = this.#plan;
    if (!drag || !plan) {
      const hoveredHandleId =
        event.target && typeof event.target === "object"
          ? this.#hitHandleIds.get(event.target)
          : undefined;
      const point = event.getInnerPoint(this.#layer);
      const hovered =
        hoveredHandleId !== undefined ||
        (point.x >= 0 &&
          point.y >= 0 &&
          point.x <= (plan?.frameSize.width ?? -1) &&
          point.y <= (plan?.frameSize.height ?? -1));
      if (hovered !== this.#frameHovered) {
        this.#frameHovered = hovered;
        this.#syncAppearance();
      }
      return false;
    }
    if (event.isCancel) {
      this.cancelDrag();
      return true;
    }
    const point = event.getInnerPoint(this.#layer);
    const clientPoint = eventClientPoint(event);
    if (
      Math.hypot(
        clientPoint.x - drag.startClientPoint.x,
        clientPoint.y - drag.startClientPoint.y,
      ) >= 3
    ) {
      drag.moved = true;
    }
    const coordinate = drag.axis === "x" ? point.x : point.y;
    const direction =
      drag.kind === "padding-right" || drag.kind === "padding-bottom" ? -1 : 1;
    const rawValue =
      drag.startValue + direction * (coordinate - drag.startCoordinate);
    const step = event.shiftKey ? BIG_NUDGE : 1;
    const value = bounded(Math.round(rawValue / step) * step, 0, VALUE_MAXIMUM);
    this.#previewChange = spacingChange(
      drag,
      value,
      event.altKey,
      event.shiftKey,
    );
    this.#previewPoint = point;
    this.#previewValue = value;
    this.#syncAppearance();
    this.#syncPill();
    return true;
  }

  pointerUp(event: LeaferEventLike): boolean {
    const drag = this.#drag;
    if (!drag) return false;
    if (!event.isCancel) this.pointerMove(event);
    const change = this.#previewChange;
    const inputRequest =
      !event.isCancel && !drag.moved
        ? {
            clientPoint: eventClientPoint(event),
            expectedRevision: drag.expectedRevision,
            frameId: drag.frameId,
            kind: drag.kind,
            padding: { ...drag.padding },
            paddingScope: paddingScope(event.altKey, event.shiftKey),
            value: drag.startValue,
          }
        : null;
    const changed =
      change !== null &&
      this.#previewValue !== null &&
      this.#previewValue !== drag.startValue;
    const request =
      change && changed
        ? {
            change,
            expectedRevision: drag.expectedRevision,
            frameId: drag.frameId,
          }
        : null;
    this.cancelDrag();
    if (inputRequest) this.#onInputRequest(inputRequest);
    else if (!event.isCancel && request) this.#onCommit(request);
    return true;
  }

  sync(input: { document: DesignDocument; frameId?: string }): void {
    if (
      this.#drag &&
      (this.#drag.documentId !== input.document.documentId ||
        this.#drag.expectedRevision !== input.document.revision ||
        this.#drag.frameId !== input.frameId)
    ) {
      this.cancelDrag();
    }
    this.#documentId = input.document.documentId;
    this.#revision = input.document.revision;
    const plan = createAutoLayoutSpacingOverlayPlan(
      input.document,
      input.frameId,
    );
    this.#plan = plan;
    if (!plan) {
      this.#fingerprint = null;
      this.#frameHovered = false;
      this.#destroyHandles();
      this.#pill.visible = false;
      this.#pillLabel.visible = false;
      this.#layer.visible = false;
      return;
    }
    if (plan.fingerprint !== this.#fingerprint) {
      this.#reconcileHandles(plan);
      this.#fingerprint = plan.fingerprint;
    }
    this.syncViewport();
  }

  syncViewport(): void {
    const plan = this.#plan;
    if (!plan) return;
    const desired = multiplyAffine(
      this.#viewportRoot.localTransform,
      transformToAffine(plan.transform),
    );
    const relative = matrixRelativeToParent(
      this.#presentationRoot.localTransform,
      desired,
      MATRIX_EPSILON,
    );
    if (!relative) {
      this.#layer.visible = false;
      return;
    }
    this.#layer.setTransform(relative);
    this.#layer.visible = true;
    this.#scaleX = Math.max(MATRIX_EPSILON, Math.hypot(desired.a, desired.b));
    this.#scaleY = Math.max(MATRIX_EPSILON, Math.hypot(desired.c, desired.d));
    for (const spec of plan.handles) this.#syncHandleGeometry(spec);
    this.#syncAppearance();
    this.#syncPill();
  }

  #createHandle(spec: AutoLayoutSpacingHandleSpec): SpacingHandleElements {
    const visual = new this.#leafer.Rect({
      cornerRadius: 2,
      editable: false,
      fill: SPACING_IDLE_COLOR,
      hittable: false,
      visible: false,
    }) as LeaferElement;
    const hit = new this.#leafer.Rect({
      cursor: spec.axis === "x" ? "ew-resize" : "ns-resize",
      editable: false,
      fill: SPACING_HIT_FILL,
      hittable: true,
      id: `__opendesign_auto_layout_spacing_hit__:${spec.id}`,
    }) as LeaferElement;
    this.#hitHandleIds.set(hit, spec.id);
    this.#layer.add(visual);
    this.#layer.add(hit);
    return { hit, visual };
  }

  #destroyHandles(): void {
    for (const elements of this.#handles.values()) {
      elements.hit.remove();
      elements.hit.destroy();
      elements.visual.remove();
      elements.visual.destroy();
    }
    this.#handles.clear();
    this.#specs.clear();
  }

  #reconcileHandles(plan: AutoLayoutSpacingOverlayPlan): void {
    const expected = new Set<string>();
    this.#specs.clear();
    for (const spec of plan.handles) {
      expected.add(spec.id);
      this.#specs.set(spec.id, spec);
      if (!this.#handles.has(spec.id)) {
        this.#handles.set(spec.id, this.#createHandle(spec));
      }
    }
    for (const [id, elements] of this.#handles) {
      if (expected.has(id)) continue;
      elements.hit.remove();
      elements.hit.destroy();
      elements.visual.remove();
      elements.visual.destroy();
      this.#handles.delete(id);
    }
  }

  #syncHandleGeometry(spec: AutoLayoutSpacingHandleSpec): void {
    const elements = this.#handles.get(spec.id);
    if (!elements) return;
    if (spec.orientation === "vertical") {
      elements.visual.set({
        x: spec.x - HANDLE_THICKNESS / this.#scaleX / 2,
        y: spec.y - HANDLE_LENGTH / this.#scaleY / 2,
        width: HANDLE_THICKNESS / this.#scaleX,
        height: HANDLE_LENGTH / this.#scaleY,
        cornerRadius: 1 / this.#scaleX,
      });
      elements.hit.set({
        x: spec.x - HIT_CROSS / this.#scaleX / 2,
        y: spec.y - HIT_LENGTH / this.#scaleY / 2,
        width: HIT_CROSS / this.#scaleX,
        height: HIT_LENGTH / this.#scaleY,
      });
      return;
    }
    elements.visual.set({
      x: spec.x - HANDLE_LENGTH / this.#scaleX / 2,
      y: spec.y - HANDLE_THICKNESS / this.#scaleY / 2,
      width: HANDLE_LENGTH / this.#scaleX,
      height: HANDLE_THICKNESS / this.#scaleY,
      cornerRadius: 1 / this.#scaleY,
    });
    elements.hit.set({
      x: spec.x - HIT_LENGTH / this.#scaleX / 2,
      y: spec.y - HIT_CROSS / this.#scaleY / 2,
      width: HIT_LENGTH / this.#scaleX,
      height: HIT_CROSS / this.#scaleY,
    });
  }

  #syncAppearance(): void {
    const visible = this.#frameHovered || this.#drag !== null;
    for (const [id, elements] of this.#handles) {
      elements.visual.set({
        fill: id === this.#drag?.handleId ? SPACING_COLOR : SPACING_IDLE_COLOR,
        visible,
      });
    }
  }

  #syncPill(): void {
    const point = this.#previewPoint;
    const value = this.#previewValue;
    if (!this.#drag || !point || value === null || !this.#layer.visible) {
      this.#pill.visible = false;
      this.#pillLabel.visible = false;
      return;
    }
    const label = String(value);
    const width = Math.max(28, label.length * 7 + 12);
    const x = point.x + PILL_OFFSET / this.#scaleX;
    const y = point.y + PILL_OFFSET / this.#scaleY;
    this.#pill.set({
      x,
      y,
      width: width / this.#scaleX,
      height: PILL_HEIGHT / this.#scaleY,
      cornerRadius: 4 / Math.max(this.#scaleX, this.#scaleY),
      visible: true,
    });
    this.#pillLabel.set({
      x,
      y: y + 2 / this.#scaleY,
      width: width / this.#scaleX,
      height: PILL_HEIGHT / this.#scaleY,
      fontSize: 10 / this.#scaleY,
      lineHeight: 14 / this.#scaleY,
      text: label,
      visible: true,
    });
  }
}

function spacingChange(
  drag: SpacingDragSession,
  value: number,
  altKey: boolean,
  shiftKey: boolean,
): LeaferAutoLayoutSpacingChange {
  const change = autoLayoutSpacingChangeFromInput(
    {
      kind: drag.kind,
      padding: drag.padding,
      paddingScope: paddingScope(altKey, shiftKey),
    },
    value,
  );
  if (!change) throw new TypeError("Auto Layout spacing preview is invalid");
  return change;
}

function paddingScope(
  altKey: boolean,
  shiftKey: boolean,
): LeaferAutoLayoutSpacingInputRequest["paddingScope"] {
  if (altKey && shiftKey) return "all";
  return altKey ? "opposite" : "single";
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function multiplyAffine(
  left: { a: number; b: number; c: number; d: number; e: number; f: number },
  right: { a: number; b: number; c: number; d: number; e: number; f: number },
) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}
