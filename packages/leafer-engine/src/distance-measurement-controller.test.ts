import type { Rect } from "@opendesign/design-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DistanceMeasurementController,
  elementDocumentBounds,
  resolveMeasurementTarget,
  type DistanceMeasurementPresenter,
} from "./distance-measurement-controller.js";
import type { LeaferEventLike } from "./pointer-event.js";

describe("DistanceMeasurementController", () => {
  it("shows measurements on Alt hover and refreshes without another pointer move", () => {
    const setup = createSetup();

    setup.controller.pointerMove(pointerEvent(setup.target));
    expect(setup.presenter.measurements).toEqual([]);

    setup.controller.handleKeyDown(keyboardEvent("AltLeft", "Alt"));
    expect(
      setup.presenter.measurements.map(({ id, value }) => ({ id, value })),
    ).toEqual([{ id: "x-after", value: 40 }]);

    setup.controller.handleKeyUp(keyboardEvent("AltLeft", "Alt"));
    expect(setup.presenter.measurements).toEqual([]);
  });

  it("clears transient measurements on pointer leave, blur, and scope changes", () => {
    const setup = createSetup();
    setup.controller.pointerMove(pointerEvent(setup.target, { altKey: true }));
    expect(setup.presenter.active).toBe(true);

    setup.controller.pointerLeave();
    expect(setup.presenter.active).toBe(false);

    setup.controller.pointerMove(pointerEvent(setup.target, { altKey: true }));
    setup.controller.handleWindowBlur();
    expect(setup.presenter.active).toBe(false);

    setup.controller.pointerMove(pointerEvent(setup.target, { altKey: true }));
    setup.controller.sync({
      blocked: false,
      documentId: "document",
      pageId: "page",
      revision: 2,
      selectionKey: "selection",
      tool: "select",
    });
    expect(setup.presenter.active).toBe(false);
  });

  it("uses the union bounds of a multi-selection", () => {
    const viewport = element("viewport", bounds(0, 0, 0, 0));
    const first = element("first", bounds(0, 0, 20, 20), viewport);
    const second = element("second", bounds(0, 0, 20, 20), viewport, 40, 0);
    const target = element("target", bounds(0, 0, 20, 20), viewport, 100, 0);
    const presenter = new FakePresenter();
    const controller = controllerFor({
      presenter,
      selected: [first, second],
      viewport,
    });

    controller.pointerMove(pointerEvent(target, { altKey: true }));

    expect(
      presenter.measurements.map(({ id, value }) => ({ id, value })),
    ).toEqual([{ id: "x-after", value: 40 }]);
  });

  it("does not measure while another direct-edit interaction owns the canvas", () => {
    let canMeasure = false;
    const setup = createSetup(() => canMeasure);

    setup.controller.pointerMove(pointerEvent(setup.target, { altKey: true }));
    expect(setup.presenter.measurements).toEqual([]);

    canMeasure = true;
    setup.controller.handleKeyDown(keyboardEvent("AltLeft", "Alt"));
    expect(setup.presenter.active).toBe(true);
  });

  it("honors the explicit interaction block from the editor scope", () => {
    const setup = createSetup();
    setup.controller.sync({
      blocked: true,
      documentId: "document",
      pageId: "page",
      revision: 1,
      selectionKey: "selection",
      tool: "select",
    });

    setup.controller.pointerMove(pointerEvent(setup.target, { altKey: true }));
    expect(setup.presenter.active).toBe(false);
  });

  it("forwards viewport synchronization and disposes its presenter once", () => {
    const setup = createSetup();

    setup.controller.syncViewport();
    setup.controller.dispose();

    expect(setup.presenter.syncViewport).toHaveBeenCalledOnce();
    expect(setup.presenter.dispose).toHaveBeenCalledOnce();
  });
});

describe("resolveMeasurementTarget", () => {
  it("measures the direct layer by default and the nested layer with Command/Control", () => {
    const viewport = element("viewport", bounds(0, 0, 0, 0));
    const selected = element("selected", bounds(0, 0, 20, 20), viewport);
    const group = element("group", bounds(0, 0, 80, 80), viewport, 100, 0);
    const nested = element("nested", bounds(0, 0, 20, 20), group, 12, 16);
    const input = {
      projectionId: (candidate: FakeElement) => candidate.id,
      rawTarget: nested,
      selection: [selected],
      viewportRoot: viewport,
    };

    expect(resolveMeasurementTarget({ ...input, exact: false } as never)).toBe(
      group,
    );
    expect(resolveMeasurementTarget({ ...input, exact: true } as never)).toBe(
      nested,
    );
  });

  it("never measures a selected layer or one of its descendants", () => {
    const viewport = element("viewport", bounds(0, 0, 0, 0));
    const selected = element("selected", bounds(0, 0, 80, 80), viewport);
    const child = element("child", bounds(0, 0, 20, 20), selected);

    expect(
      resolveMeasurementTarget({
        exact: true,
        projectionId: (candidate: FakeElement) => candidate.id,
        rawTarget: child,
        selection: [selected],
        viewportRoot: viewport,
      } as never),
    ).toBeNull();
  });
});

describe("elementDocumentBounds", () => {
  it("composes nested affine transforms into document-space axis-aligned bounds", () => {
    const viewport = element("viewport", bounds(0, 0, 0, 0));
    const group = element("group", bounds(0, 0, 0, 0), viewport, 100, 50);
    group.localTransform = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 };
    const child = element("child", bounds(0, 0, 20, 10), group, 10, 15);

    expect(elementDocumentBounds(child as never, viewport as never)).toEqual({
      x: 120,
      y: 80,
      width: 40,
      height: 20,
    });
  });
});

function createSetup(canMeasure: () => boolean = () => true) {
  const viewport = element("viewport", bounds(0, 0, 0, 0));
  const selected = element("selected", bounds(0, 0, 20, 20), viewport);
  const target = element("target", bounds(0, 0, 20, 20), viewport, 60, 0);
  const presenter = new FakePresenter();
  return {
    controller: controllerFor({
      canMeasure,
      presenter,
      selected: [selected],
      viewport,
    }),
    presenter,
    target,
  };
}

function controllerFor(input: {
  canMeasure?: () => boolean;
  presenter: FakePresenter;
  selected: FakeElement[];
  viewport: FakeElement;
}) {
  return new DistanceMeasurementController({
    canMeasure: input.canMeasure ?? (() => true),
    layerIndex: 0,
    leafer: {} as never,
    presentationRoot: {} as never,
    presenter: input.presenter,
    projectionId: (candidate) => (candidate as unknown as FakeElement).id,
    selectedElements: () => input.selected as never,
    viewportRoot: input.viewport as never,
  });
}

class FakePresenter implements DistanceMeasurementPresenter {
  measurements: Parameters<DistanceMeasurementPresenter["setMeasurements"]>[0] =
    [];
  readonly clear = vi.fn(() => {
    this.measurements = [];
  });
  readonly dispose = vi.fn();
  readonly syncViewport = vi.fn();

  get active(): boolean {
    return this.measurements.length > 0;
  }

  setMeasurements(measurements: typeof this.measurements): void {
    this.measurements = measurements;
  }
}

interface FakeElement {
  getBounds: () => Rect;
  id: string;
  localTransform: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  };
  parent?: FakeElement;
}

function element(
  id: string,
  rect: Rect,
  parent?: FakeElement,
  x = 0,
  y = 0,
): FakeElement {
  return {
    getBounds: () => rect,
    id,
    localTransform: { a: 1, b: 0, c: 0, d: 1, e: x, f: y },
    ...(parent ? { parent } : {}),
  };
}

function bounds(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

function pointerEvent(
  target: FakeElement,
  modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): LeaferEventLike {
  return {
    altKey: modifiers.altKey ?? false,
    clientX: 0,
    clientY: 0,
    ctrlKey: modifiers.ctrlKey ?? false,
    getInnerPoint: () => ({ x: 0, y: 0 }),
    metaKey: modifiers.metaKey ?? false,
    shiftKey: false,
    target,
  };
}

function keyboardEvent(code: string, key: string): KeyboardEvent {
  return { code, key } as KeyboardEvent;
}
