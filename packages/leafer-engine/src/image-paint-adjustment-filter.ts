import type {
  ImageFilterKey,
  ImageFilters,
} from "@opendesign/design-contracts";
import {
  applyImageFiltersToRgba,
  normalizeImageFilters,
} from "@opendesign/image-service";
import type * as LeaferEditorModule from "leafer-editor";

type LeaferModule = typeof LeaferEditorModule;
type LeaferImage = Parameters<
  NonNullable<LeaferModule["PaintImage"]["applyFilter"]>
>[1];
type LeafPaint = Parameters<
  NonNullable<LeaferModule["PaintImage"]["applyFilter"]>
>[0];

const FILTER_KEY_PREFIX = "opendesign-image-paint:";
const MAX_FILTER_CHUNK_PIXELS = 1_048_576;
const MAX_IDLE_DERIVATIVES_PER_SOURCE = 4;
const installedModules = new WeakSet<object>();
const adjustedLeafPaints = new WeakMap<object, LeaferImage>();
const accessOrder = new WeakMap<LeaferImage, Map<string, number>>();
let accessSequence = 0;

/** Installs the missing Leafer 2.2.9 per-image-paint filter provider once. */
export function installLeaferImagePaintAdjustmentFilter(
  leafer: LeaferModule,
): void {
  if (!leafer.PaintImage || !leafer.Creator) return;
  const paintImage = leafer.PaintImage;
  if (installedModules.has(paintImage)) return;
  installedModules.add(paintImage);

  const recycleImage = paintImage.recycleImage.bind(paintImage);
  paintImage.applyFilter = (leafPaint, source, rawFilters) => {
    const filters = fromLeaferFilters(rawFilters);
    if (!filters) return;
    const key = filterKey(filters);
    const previous = adjustedLeafPaints.get(leafPaint);
    if (previous?.parent === source && previous.filterKey === key) return;
    if (previous?.parent) releaseDerivative(previous);

    const derivative = getOrCreateDerivative(leafer, source, key, filters);
    derivative.use++;
    adjustedLeafPaints.set(leafPaint, derivative);
    leafPaint.image = derivative;
    delete leafPaint.style;
    delete leafPaint.patternId;
  };
  // recycleImage below owns derivative reference accounting. Leafer invokes
  // recycleFilter again while destroying one UI, so decrementing here would
  // double-release a derivative shared by another active Image Paint.
  paintImage.recycleFilter = () => {};
  paintImage.recycleImage = (attrName, data) => {
    const paints = (data as unknown as Record<string, unknown>)[`_${attrName}`];
    if (Array.isArray(paints)) {
      for (const paint of paints as LeafPaint[]) {
        const derivative = adjustedLeafPaints.get(paint);
        if (!derivative) continue;
        adjustedLeafPaints.delete(paint);
        releaseDerivative(derivative);
      }
    }
    return recycleImage(attrName, data);
  };
}

function getOrCreateDerivative(
  leafer: LeaferModule,
  source: LeaferImage,
  key: string,
  filters: ImageFilters,
): LeaferImage {
  const children = (source.childrenMap ??= {});
  const cached = children[key];
  if (cached) {
    touch(source, key);
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Image Paint adjustments require Canvas2D");
  context.drawImage(
    source.view as CanvasImageSource,
    0,
    0,
    source.width,
    source.height,
  );
  const rowsPerChunk = Math.max(
    1,
    Math.floor(MAX_FILTER_CHUNK_PIXELS / Math.max(1, source.width)),
  );
  for (let y = 0; y < source.height; y += rowsPerChunk) {
    const rows = Math.min(rowsPerChunk, source.height - y);
    const imageData = context.getImageData(0, y, source.width, rows);
    applyImageFiltersToRgba(imageData.data, filters);
    context.putImageData(imageData, 0, y);
  }

  const createImage = leafer.Creator.image?.bind(leafer.Creator);
  if (!createImage) throw new Error("Leafer image provider is unavailable");
  const derivative = createImage({
    url: `opendesign-adjusted:${source.innerId}:${encodeURIComponent(key)}`,
    view: canvas,
  });
  derivative.parent = source;
  derivative.filterKey = key;
  derivative.filter = toLeaferFilters(filters);
  derivative.hasAlphaPixel = source.hasAlphaPixel;
  children[key] = derivative;
  ensureSourceCleanup(source);
  touch(source, key);
  pruneIdleDerivatives(source);
  return derivative;
}

function ensureSourceCleanup(source: LeaferImage): void {
  const marker = source as LeaferImage & { __opendesignFilterCleanup?: true };
  if (marker.__opendesignFilterCleanup) return;
  marker.__opendesignFilterCleanup = true;
  const destroyFilter = source.destroyFilter.bind(source);
  source.destroyFilter = () => {
    for (const child of Object.values(source.childrenMap ?? {})) {
      delete child.parent;
      child.destroy();
    }
    delete source.childrenMap;
    accessOrder.delete(source);
    destroyFilter();
  };
}

function releaseDerivative(derivative: LeaferImage): void {
  derivative.use = Math.max(0, derivative.use - 1);
  if (derivative.parent) pruneIdleDerivatives(derivative.parent);
}

function touch(source: LeaferImage, key: string): void {
  let order = accessOrder.get(source);
  if (!order) accessOrder.set(source, (order = new Map<string, number>()));
  order.set(key, ++accessSequence);
}

function pruneIdleDerivatives(source: LeaferImage): void {
  const children = source.childrenMap;
  const order = accessOrder.get(source);
  if (!children || !order) return;
  const idle = Object.entries(children)
    .filter(([, image]) => image.use === 0)
    .sort(
      ([left], [right]) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
    );
  while (idle.length > MAX_IDLE_DERIVATIVES_PER_SOURCE) {
    const [key, image] = idle.shift()!;
    delete children[key];
    order.delete(key);
    delete image.parent;
    image.destroy();
  }
}

function fromLeaferFilters(
  raw: Parameters<NonNullable<LeaferModule["PaintImage"]["applyFilter"]>>[2],
): ImageFilters | undefined {
  const candidate: ImageFilters = {};
  for (const filter of raw) {
    if (
      filter.type === "exposure" ||
      filter.type === "contrast" ||
      filter.type === "saturation" ||
      filter.type === "temperature" ||
      filter.type === "tint" ||
      filter.type === "highlights" ||
      filter.type === "shadows"
    ) {
      candidate[filter.type as ImageFilterKey] = filter.value;
    }
  }
  return normalizeImageFilters(candidate);
}

function toLeaferFilters(filters: ImageFilters) {
  return Object.entries(filters).map(([type, value]) => ({ type, value }));
}

function filterKey(filters: ImageFilters): string {
  return `${FILTER_KEY_PREFIX}${JSON.stringify(filters)}`;
}
