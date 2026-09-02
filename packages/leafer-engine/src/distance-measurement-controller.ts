import type { Rect } from "@opendesign/design-contracts";
import { measureRectDistances } from "@opendesign/geometry-service/measurements";
import type * as LeaferEditorModule from "leafer-editor";
import { DistanceMeasurementOverlay } from "./distance-measurement-overlay.js";
import type { LeaferEventLike } from "./pointer-event.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;
type MeasurementElement = LeaferElement & {
  parent?: MeasurementElement;
};

export interface DistanceMeasurementPresenter {
  readonly active: boolean;
  clear(): void;
  dispose(): void;
  setMeasurements(
    measurements: Parameters<DistanceMeasurementOverlay["setMeasurements"]>[0],
  ): void;
  syncViewport(): void;
}

export class DistanceMeasurementController {
  readonly #altKeys = new Set<string>();
  readonly #canMeasure: () => boolean;
  #fingerprint = "";
  #lastTarget: unknown = null;
  readonly #modifierKeys = new Set<string>();
  readonly #overlay: DistanceMeasurementPresenter;
  #pointerAlt = false;
  #pointerExact = false;
  readonly #projectionId: (element: LeaferElement) => string | undefined;
  readonly #selectedElements: () => readonly LeaferElement[];
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    canMeasure: () => boolean;
    layerIndex: number;
    leafer: LeaferModule;
    presentationRoot: LeaferGroup;
    projectionId: (element: LeaferElement) => string | undefined;
    selectedElements: () => readonly LeaferElement[];
    viewportRoot: LeaferGroup;
    presenter?: DistanceMeasurementPresenter;
  }) {
    this.#canMeasure = options.canMeasure;
    this.#projectionId = options.projectionId;
    this.#selectedElements = options.selectedElements;
    this.#viewportRoot = options.viewportRoot;
    this.#overlay =
      options.presenter ?? new DistanceMeasurementOverlay(options);
  }

  get active(): boolean {
    return this.#overlay.active;
  }

  sync(input: {
    blocked: boolean;
    documentId: string;
    pageId: string;
    revision: number;
    selectionKey: string;
    tool: string;
  }): void {
    const fingerprint = [
      input.documentId,
      input.pageId,
      input.revision,
      input.selectionKey,
      input.tool,
      input.blocked ? "blocked" : "ready",
    ].join(":");
    if (fingerprint === this.#fingerprint) return;
    this.#fingerprint = fingerprint;
    this.#lastTarget = null;
    this.#pointerAlt = false;
    this.#pointerExact = false;
    this.#overlay.clear();
  }

  pointerMove(event: LeaferEventLike): void {
    this.#lastTarget = event.target;
    this.#pointerAlt = event.altKey;
    this.#pointerExact = event.metaKey === true || event.ctrlKey === true;
    this.#refresh();
  }

  handleKeyDown(event: KeyboardEvent): void {
    const alt = modifierKeyId(event, "Alt");
    const exact = exactModifierKeyId(event);
    if (alt) this.#altKeys.add(alt);
    if (exact) this.#modifierKeys.add(exact);
    if (alt || exact) this.#refresh();
  }

  handleKeyUp(event: KeyboardEvent): void {
    const alt = modifierKeyId(event, "Alt");
    const exact = exactModifierKeyId(event);
    if (alt) {
      this.#altKeys.delete(alt);
      this.#pointerAlt = false;
    }
    if (exact) {
      this.#modifierKeys.delete(exact);
      this.#pointerExact = false;
    }
    if (alt || exact) this.#refresh();
  }

  pointerLeave(): void {
    this.#lastTarget = null;
    this.#overlay.clear();
  }

  handleWindowBlur(): void {
    this.#altKeys.clear();
    this.#modifierKeys.clear();
    this.#pointerAlt = false;
    this.#pointerExact = false;
    this.#lastTarget = null;
    this.#overlay.clear();
  }

  clear(): void {
    this.#overlay.clear();
  }

  syncViewport(): void {
    this.#overlay.syncViewport();
  }

  dispose(): void {
    this.#overlay.dispose();
  }

  #refresh(): void {
    if (!this.#activeModifier() || !this.#canMeasure()) {
      this.#overlay.clear();
      return;
    }
    const selection = topLevelElements(this.#selectedElements());
    const target = resolveMeasurementTarget({
      exact: this.#exactModifier(),
      projectionId: this.#projectionId,
      rawTarget: this.#lastTarget,
      selection,
      viewportRoot: this.#viewportRoot,
    });
    const selectionBounds = unionElementBounds(selection, this.#viewportRoot);
    const targetBounds = target
      ? elementDocumentBounds(target, this.#viewportRoot)
      : null;
    this.#overlay.setMeasurements(
      selectionBounds && targetBounds
        ? measureRectDistances(selectionBounds, targetBounds)
        : [],
    );
  }

  #activeModifier(): boolean {
    return this.#pointerAlt || this.#altKeys.size > 0;
  }

  #exactModifier(): boolean {
    return this.#pointerExact || this.#modifierKeys.size > 0;
  }
}

export function resolveMeasurementTarget(input: {
  exact: boolean;
  projectionId: (element: LeaferElement) => string | undefined;
  rawTarget: unknown;
  selection: readonly LeaferElement[];
  viewportRoot: LeaferGroup;
}): LeaferElement | null {
  let target = nearestProjectionElement(input.rawTarget, input.projectionId);
  if (!target) return null;
  if (!input.exact) {
    const context = commonParent(input.selection) ?? input.viewportRoot;
    const parent = isDescendantOf(target, context)
      ? context
      : input.viewportRoot;
    target = directChildWithin(target, parent, input.projectionId) ?? target;
  }
  return input.selection.some(
    (selected) => target === selected || isDescendantOf(target, selected),
  )
    ? null
    : target;
}

export function elementDocumentBounds(
  element: LeaferElement,
  viewportRoot: LeaferGroup,
): Rect | null {
  const local = element.getBounds("box", "inner");
  if (!validBounds(local)) return null;
  const root = viewportRoot as unknown as MeasurementElement;
  let transform = affineValues(element.localTransform);
  let parent = (element as MeasurementElement).parent;
  while (parent && parent !== root) {
    transform = multiplyAffine(affineValues(parent.localTransform), transform);
    parent = parent.parent;
  }
  return parent === root ? transformBounds(local, transform) : null;
}

function unionElementBounds(
  elements: readonly LeaferElement[],
  viewportRoot: LeaferGroup,
): Rect | null {
  const bounds = elements.map((element) =>
    elementDocumentBounds(element, viewportRoot),
  );
  if (bounds.length === 0 || bounds.some((item) => item === null)) return null;
  const valid = bounds as Rect[];
  const left = Math.min(...valid.map(({ x }) => x));
  const top = Math.min(...valid.map(({ y }) => y));
  const right = Math.max(...valid.map(({ x, width }) => x + width));
  const bottom = Math.max(...valid.map(({ y, height }) => y + height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function topLevelElements(elements: readonly LeaferElement[]): LeaferElement[] {
  const selected = new Set(elements);
  return [...selected].filter((element) => {
    let parent = (element as MeasurementElement).parent;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = parent.parent;
    }
    return true;
  });
}

function nearestProjectionElement(
  rawTarget: unknown,
  projectionId: (element: LeaferElement) => string | undefined,
): LeaferElement | null {
  let current = rawTarget as MeasurementElement | undefined;
  while (current) {
    if (projectionId(current)) return current;
    current = current.parent;
  }
  return null;
}

function directChildWithin(
  element: LeaferElement,
  parent: LeaferElement,
  projectionId: (element: LeaferElement) => string | undefined,
): LeaferElement | null {
  let current = element as MeasurementElement;
  while (current.parent && current.parent !== parent) {
    const next = nearestProjectionElement(current.parent, projectionId);
    if (!next || next === current) return null;
    current = next as MeasurementElement;
  }
  return current.parent === parent ? current : null;
}

function commonParent(
  elements: readonly LeaferElement[],
): LeaferElement | null {
  const first = (elements[0] as MeasurementElement | undefined)?.parent;
  return first && elements.every((element) => element.parent === first)
    ? first
    : null;
}

function isDescendantOf(element: LeaferElement, ancestor: LeaferElement) {
  let parent = (element as MeasurementElement).parent;
  while (parent) {
    if (parent === ancestor) return true;
    parent = parent.parent;
  }
  return false;
}

function modifierKeyId(event: KeyboardEvent, key: string): string | null {
  if (event.code === `${key}Left` || event.code === `${key}Right`) {
    return event.code;
  }
  return event.key === key ? key : null;
}

function exactModifierKeyId(event: KeyboardEvent): string | null {
  return modifierKeyId(event, "Meta") ?? modifierKeyId(event, "Control");
}

type AffineValues = readonly [number, number, number, number, number, number];

function affineValues(transform: {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}): AffineValues {
  return [
    transform.a,
    transform.b,
    transform.c,
    transform.d,
    transform.e,
    transform.f,
  ];
}

function multiplyAffine(left: AffineValues, right: AffineValues): AffineValues {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}

function transformBounds(rect: Rect, transform: AffineValues): Rect {
  const [a, b, c, d, e, f] = transform;
  const points = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ].map(([x, y]) => ({ x: a * x! + c * y! + e, y: b * x! + d * y! + f }));
  const left = Math.min(...points.map(({ x }) => x));
  const top = Math.min(...points.map(({ y }) => y));
  const right = Math.max(...points.map(({ x }) => x));
  const bottom = Math.max(...points.map(({ y }) => y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function validBounds(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}
