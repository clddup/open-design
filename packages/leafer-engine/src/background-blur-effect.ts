import type * as LeaferEditorModule from "leafer-editor";

type LeaferModule = typeof LeaferEditorModule;
type LeaferUI = InstanceType<LeaferModule["UI"]>;
type LeaferCanvas = Parameters<LeaferUI["__draw"]>[0];
type RenderOptions = Parameters<LeaferUI["__draw"]>[1];
type Draw = (
  this: LeaferUI,
  current: LeaferCanvas,
  options: RenderOptions,
  origin?: LeaferCanvas,
) => void;

const installedPrototypes = new WeakSet<object>();

/** Installs the missing Leafer 2.2.9 backdrop-filter rendering once. */
export function installLeaferBackgroundBlurEffect(leafer: LeaferModule): void {
  const prototype = leafer.UI?.prototype;
  if (!prototype || installedPrototypes.has(prototype)) return;
  const draw = Object.getOwnPropertyDescriptor(prototype, "__draw")?.value as
    Draw | undefined;
  if (!draw) return;

  installedPrototypes.add(prototype);
  prototype.__draw = function (
    current: LeaferCanvas,
    options: RenderOptions,
    origin?: LeaferCanvas,
  ): void {
    drawBackgroundBlur(this, current, origin);
    Reflect.apply(draw, this, [current, options, origin]);
  };
}

function drawBackgroundBlur(
  ui: LeaferUI,
  current: LeaferCanvas,
  origin?: LeaferCanvas,
): void {
  const radius = ui.__.backgroundBlur;
  const world = ui.__nowWorld;
  if (!radius || radius <= 0 || !world) return;

  const blurred = current.getSameCanvas(false, true);
  try {
    blurred.setWorldBlur(radius * worldScale(ui));
    blurred.copyWorld(origin ?? current);
    blurred.filter = "none";
    current.save();
    try {
      current.setWorld(world);
      ui.__drawRenderPath(current);
      current.clipUI(ui);
      current.resetTransform();
      current.copyWorld(blurred);
    } finally {
      current.restore();
    }
  } finally {
    blurred.recycle();
  }
}

function worldScale(ui: LeaferUI): number {
  const { a, b, c, d } = ui.__nowWorld!;
  return Math.max(Math.hypot(a, b), Math.hypot(c, d));
}
