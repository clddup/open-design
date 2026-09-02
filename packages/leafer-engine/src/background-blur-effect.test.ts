import { describe, expect, it, vi } from "vitest";
import { installLeaferBackgroundBlurEffect } from "./background-blur-effect.js";

describe("Leafer background blur effect", () => {
  it("samples the already rendered canvas before drawing the layer", () => {
    const fixture = createFixture({ a: 2, b: 0, c: 0, d: 3 });
    installLeaferBackgroundBlurEffect(fixture.leafer as never);

    fixture.ui.__draw(fixture.current, fixture.options);

    expect(fixture.blurred.setWorldBlur).toHaveBeenCalledWith(30);
    expect(fixture.blurred.copyWorld).toHaveBeenCalledWith(fixture.current);
    expect(fixture.calls).toEqual([
      "blur",
      "copy-backdrop",
      "path",
      "clip",
      "composite",
      "draw-layer",
    ]);
  });

  it("samples the parent canvas when Leafer isolates the current layer", () => {
    const fixture = createFixture();
    const origin = { id: "parent-canvas" };
    installLeaferBackgroundBlurEffect(fixture.leafer as never);

    fixture.ui.__draw(fixture.current, fixture.options, origin);

    expect(fixture.blurred.copyWorld).toHaveBeenCalledWith(origin);
  });

  it("does not wrap the same Leafer prototype twice", () => {
    const fixture = createFixture();
    installLeaferBackgroundBlurEffect(fixture.leafer as never);
    installLeaferBackgroundBlurEffect(fixture.leafer as never);

    fixture.ui.__draw(fixture.current, fixture.options);

    expect(fixture.blurred.setWorldBlur).toHaveBeenCalledOnce();
    expect(fixture.draw).toHaveBeenCalledOnce();
  });

  it("leaves ordinary layers on Leafer's native draw path", () => {
    const fixture = createFixture();
    fixture.ui.__.backgroundBlur = 0;
    installLeaferBackgroundBlurEffect(fixture.leafer as never);

    fixture.ui.__draw(fixture.current, fixture.options);

    expect(fixture.current.getSameCanvas).not.toHaveBeenCalled();
    expect(fixture.draw).toHaveBeenCalledOnce();
  });
});

function createFixture(world = { a: 1, b: 0, c: 0, d: 1 }) {
  const calls: string[] = [];
  const blurred = {
    copyWorld: vi.fn(() => calls.push("copy-backdrop")),
    filter: "",
    recycle: vi.fn(),
    setWorldBlur: vi.fn(() => calls.push("blur")),
  };
  const current = {
    clipUI: vi.fn(() => calls.push("clip")),
    copyWorld: vi.fn(() => calls.push("composite")),
    getSameCanvas: vi.fn(() => blurred),
    resetTransform: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    setWorld: vi.fn(),
  };
  const draw = vi.fn(() => calls.push("draw-layer"));
  class UI {
    __ = { backgroundBlur: 10 };
    __nowWorld = world;
    __drawRenderPath = vi.fn(() => calls.push("path"));
    __draw(...args: unknown[]): void {
      void args;
      draw();
    }
  }
  const ui = new UI();
  return {
    blurred,
    calls,
    current,
    draw,
    leafer: { UI },
    options: {},
    ui,
  };
}
