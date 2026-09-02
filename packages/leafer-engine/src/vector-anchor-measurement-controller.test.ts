import { describe, expect, it, vi } from "vitest";
import type { DistanceMeasurementPresenter } from "./distance-measurement-controller.js";
import { VectorAnchorMeasurementController } from "./vector-anchor-measurement-controller.js";

describe("VectorAnchorMeasurementController", () => {
  it("shows both axis distances when Option or Alt is pressed after hover", () => {
    const setup = createSetup();
    setup.controller.sync(anchor("source", 100, 100));
    setup.controller.pointerMove({
      altKey: false,
      target: anchor("target", 70, 160),
    });
    expect(setup.presenter.measurements).toEqual([]);

    setup.controller.handleKeyDown(keyboardEvent("AltLeft"));
    expect(
      setup.presenter.measurements.map(({ axis, value }) => ({ axis, value })),
    ).toEqual([
      { axis: "x", value: 30 },
      { axis: "y", value: 60 },
    ]);

    setup.controller.handleKeyUp(keyboardEvent("AltLeft"));
    expect(setup.presenter.measurements).toEqual([]);
  });

  it("requires one distinct selected anchor and clears transient state", () => {
    const setup = createSetup();
    setup.controller.sync(anchor("source", 10, 20));
    setup.controller.pointerMove({
      altKey: true,
      target: anchor("source", 10, 20),
    });
    expect(setup.presenter.active).toBe(false);

    setup.controller.pointerMove({
      altKey: true,
      target: anchor("target", 30, 40),
    });
    expect(setup.presenter.active).toBe(true);
    setup.controller.pointerLeave();
    expect(setup.presenter.active).toBe(false);

    setup.controller.pointerMove({
      altKey: true,
      target: anchor("target", 30, 40),
    });
    setup.controller.sync(null);
    expect(setup.presenter.active).toBe(false);

    setup.controller.sync(anchor("source", 10, 20));
    setup.controller.pointerMove({
      altKey: true,
      target: anchor("target", 30, 40),
    });
    setup.controller.handleWindowBlur();
    expect(setup.presenter.active).toBe(false);
  });

  it("forwards viewport synchronization and disposes the overlay", () => {
    const setup = createSetup();
    setup.controller.syncViewport();
    setup.controller.dispose();
    expect(setup.presenter.syncViewport).toHaveBeenCalledOnce();
    expect(setup.presenter.dispose).toHaveBeenCalledOnce();
  });
});

function createSetup() {
  const presenter = new FakePresenter();
  return {
    controller: new VectorAnchorMeasurementController({
      layerIndex: 0,
      leafer: {} as never,
      presentationRoot: {} as never,
      presenter,
      viewportRoot: {} as never,
    }),
    presenter,
  };
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

function anchor(id: string, x: number, y: number) {
  return { id, position: { x, y } };
}

function keyboardEvent(code: "AltLeft" | "AltRight"): KeyboardEvent {
  return { code, key: "Alt" } as KeyboardEvent;
}
