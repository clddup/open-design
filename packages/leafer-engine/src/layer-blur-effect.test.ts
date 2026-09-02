import { describe, expect, it, vi } from "vitest";
import { installLeaferLayerBlurEffect } from "./layer-blur-effect.js";

describe("Leafer layer blur effect", () => {
  it("blurs one isolated layer before applying root opacity and blend", () => {
    const fixture = createFixture({ a: 2, b: 0, c: 0, d: 3 });
    installLeaferLayerBlurEffect(fixture.leafer as never);

    fixture.ui.__render(fixture.current, fixture.options);

    expect(fixture.render).toHaveBeenCalledWith(fixture.layer, fixture.options);
    expect(fixture.renderState).toEqual({
      blendMode: "pass-through",
      opacity: 1,
      single: true,
    });
    expect(fixture.current.opacity).toBe(0.6);
    expect(fixture.current.setWorldBlur).toHaveBeenCalledWith(30);
    expect(fixture.current.copyWorldByReset).toHaveBeenCalledWith(
      fixture.layer,
      undefined,
      undefined,
      "multiply",
      true,
    );
    expect(fixture.current.filter).toBe("none");
    expect(fixture.layer.recycle).toHaveBeenCalledWith(fixture.world);
    expect(fixture.ui.__).toMatchObject({
      blendMode: "multiply",
      opacity: 0.6,
      __single: false,
    });
  });

  it.each(["UI", "Group", "Box"] as const)(
    "wraps %s rendering so container children share the same blur surface",
    (kind) => {
      const fixture = createFixture(undefined, kind);
      installLeaferLayerBlurEffect(fixture.leafer as never);

      fixture.ui.__render(fixture.current, fixture.options);

      expect(fixture.render).toHaveBeenCalledOnce();
      expect(fixture.current.copyWorldByReset).toHaveBeenCalledOnce();
    },
  );

  it("leaves ordinary and shape-only rendering on Leafer's native path", () => {
    const ordinary = createFixture();
    ordinary.ui.__.blur = 0;
    installLeaferLayerBlurEffect(ordinary.leafer as never);
    ordinary.ui.__render(ordinary.current, ordinary.options);

    const shape = createFixture();
    installLeaferLayerBlurEffect(shape.leafer as never);
    shape.ui.__render(shape.current, { shape: true });

    expect(ordinary.current.getSameCanvas).not.toHaveBeenCalled();
    expect(shape.current.getSameCanvas).not.toHaveBeenCalled();
  });

  it("does not wrap the same prototypes twice", () => {
    const fixture = createFixture();
    installLeaferLayerBlurEffect(fixture.leafer as never);
    installLeaferLayerBlurEffect(fixture.leafer as never);

    fixture.ui.__render(fixture.current, fixture.options);

    expect(fixture.current.getSameCanvas).toHaveBeenCalledOnce();
    expect(fixture.render).toHaveBeenCalledOnce();
  });

  it("tolerates a narrowed Leafer test host without Box", () => {
    const fixture = createFixture();
    const { UI, Group } = fixture.leafer;

    expect(() =>
      installLeaferLayerBlurEffect({ UI, Group } as never),
    ).not.toThrow();
  });

  it("restores Leafer state and recycles the surface after a render failure", () => {
    const fixture = createFixture();
    fixture.render.mockImplementationOnce(() => {
      throw new Error("render failed");
    });
    installLeaferLayerBlurEffect(fixture.leafer as never);

    expect(() => fixture.ui.__render(fixture.current, fixture.options)).toThrow(
      "render failed",
    );
    expect(fixture.ui.__).toMatchObject({
      blendMode: "multiply",
      opacity: 0.6,
      __single: false,
    });
    expect(fixture.layer.recycle).toHaveBeenCalledOnce();
  });

  it("clears the canvas filter and recycles after a composite failure", () => {
    const fixture = createFixture();
    fixture.current.copyWorldByReset.mockImplementationOnce(() => {
      throw new Error("composite failed");
    });
    installLeaferLayerBlurEffect(fixture.leafer as never);

    expect(() => fixture.ui.__render(fixture.current, fixture.options)).toThrow(
      "composite failed",
    );
    expect(fixture.current.filter).toBe("none");
    expect(fixture.layer.recycle).toHaveBeenCalledOnce();
  });
});

function createFixture(
  world = { a: 1, b: 0, c: 0, d: 1 },
  kind: "UI" | "Group" | "Box" = "UI",
) {
  const bounds = { x: -10, y: -10, width: 120, height: 120 };
  const layer = { recycle: vi.fn() };
  const current = {
    copyWorldByReset: vi.fn(),
    filter: "blur(10px)",
    getSameCanvas: vi.fn(() => layer),
    opacity: 1,
    setWorldBlur: vi.fn(),
  };
  const renderState: Record<string, unknown> = {};
  const render = vi.fn(function (
    this: FakeUI,
    _current: unknown,
    _options: unknown,
  ) {
    void _current;
    void _options;
    Object.assign(renderState, {
      blendMode: this.__.blendMode,
      opacity: this.__.opacity,
      single: this.__.__single,
    });
    this.__nowWorld = world;
  });
  class Leaf {
    __ = {
      __blendMode: "multiply",
      __single: false,
      blendMode: "multiply",
      blur: 10,
      dimskip: false,
      opacity: 0.6,
    };
    __layout = { renderBounds: bounds };
    __nowWorld = world;
    __render(current: unknown, options: unknown) {
      render.call(this, current, options);
    }
  }
  class UI extends Leaf {}
  class Group extends UI {
    override __render(current: unknown, options: unknown) {
      render.call(this, current, options);
    }
  }
  class Box extends Group {
    override __render(current: unknown, options: unknown) {
      render.call(this, current, options);
    }
  }
  type FakeUI = InstanceType<typeof UI>;
  const Constructor = { UI, Group, Box }[kind];
  const ui = new Constructor();
  return {
    bounds,
    current,
    layer,
    leafer: { UI, Group, Box },
    options: { dimOpacity: 0 },
    render,
    renderState,
    ui,
    world,
  };
}
