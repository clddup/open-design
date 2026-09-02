import type * as LeaferEditorModule from "leafer-editor";

type LeaferModule = typeof LeaferEditorModule;
type LeaferUI = InstanceType<LeaferModule["UI"]>;
type LeaferCanvas = Parameters<LeaferUI["__render"]>[0];
type RenderOptions = Parameters<LeaferUI["__render"]>[1];
type Render = (
  this: LeaferUI,
  current: LeaferCanvas,
  options: RenderOptions,
) => void;

const installedPrototypes = new WeakSet<object>();

/** Installs the missing Leafer 2.2.9 whole-layer blur compositing. */
export function installLeaferLayerBlurEffect(leafer: LeaferModule): void {
  installPrototype(modulePrototype(leafer, "UI"));
  installPrototype(modulePrototype(leafer, "Group"));
  installPrototype(modulePrototype(leafer, "Box"));
}

function modulePrototype(
  leafer: LeaferModule,
  name: "UI" | "Group" | "Box",
): LeaferUI | undefined {
  if (!Object.prototype.hasOwnProperty.call(leafer, name)) return undefined;
  const Constructor = leafer[name] as unknown as
    { prototype: LeaferUI } | undefined;
  return Constructor?.prototype;
}

function installPrototype(prototype: LeaferUI | undefined): void {
  if (!prototype || installedPrototypes.has(prototype)) return;
  const render = findRender(prototype);
  if (!render) return;

  installedPrototypes.add(prototype);
  prototype.__render = function (
    current: LeaferCanvas,
    options: RenderOptions,
  ): void {
    const radius = this.__.blur;
    if (!radius || radius <= 0 || options.shape) {
      Reflect.apply(render, this, [current, options]);
      return;
    }
    renderLayerBlur(this, current, options, render, radius);
  };
}

function findRender(prototype: object): Render | undefined {
  let owner: object | null = prototype;
  while (owner) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, "__render");
    if (descriptor && typeof descriptor.value === "function") {
      return descriptor.value as Render;
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}

function renderLayerBlur(
  ui: LeaferUI,
  current: LeaferCanvas,
  options: RenderOptions,
  render: Render,
  radius: number,
): void {
  const data = ui.__;
  const authoredOpacity = data.opacity;
  const opacity = authoredOpacity ?? 1;
  const authoredBlendMode = data.blendMode;
  const blendMode = data.__blendMode;
  const single = data.__single;
  const layer = current.getSameCanvas(false, true);

  try {
    data.opacity = 1;
    data.blendMode = "pass-through";
    data.__single = true;
    try {
      Reflect.apply(render, ui, [layer, options]);
    } finally {
      if (authoredOpacity === undefined) delete data.opacity;
      else data.opacity = authoredOpacity;
      if (authoredBlendMode === undefined) delete data.blendMode;
      else data.blendMode = authoredBlendMode;
      if (single === undefined) delete data.__single;
      else data.__single = single;
    }

    const world = ui.__nowWorld;
    if (!world) return;
    current.opacity = effectiveOpacity(opacity, data.dimskip, options);
    try {
      current.setWorldBlur(radius * worldScale(ui));
      current.copyWorldByReset(
        layer,
        undefined,
        undefined,
        blendMode ?? undefined,
        true,
      );
    } finally {
      current.filter = "none";
    }
  } finally {
    layer.recycle(ui.__nowWorld);
  }
}

function effectiveOpacity(
  opacity: number,
  dimskip: unknown,
  options: RenderOptions,
): number {
  if (options.ignoreOpacity) return 1;
  return options.dimOpacity && !dimskip
    ? opacity * options.dimOpacity
    : opacity;
}

function worldScale(ui: LeaferUI): number {
  const { a, b, c, d } = ui.__nowWorld!;
  return Math.max(Math.hypot(a, b), Math.hypot(c, d));
}
