import type { LeaferCaptureResult } from "./types.js";

type CaptureExportResult = {
  data: unknown;
  error?: unknown;
  height?: unknown;
  width?: unknown;
};

export interface LeaferCaptureElement {
  getBounds(
    boundsType: "render",
    coordinateType: "local",
  ): { height: number; width: number };
  leafer?: {
    waitViewCompleted(callback: () => void): void;
  };
  syncExport(
    format: "jpg",
    options: {
      pixelRatio: number;
      quality: number;
      scale: number;
      smooth: boolean;
    },
  ): CaptureExportResult;
  updateLayout(): void;
}

export async function exportLeaferCapture(
  leaf: LeaferCaptureElement,
  maximum: { height: number; width: number },
): Promise<LeaferCaptureResult> {
  const bounds = leaf.getBounds("render", "local");
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new Error("Leafer capture target has no renderable bounds");
  }
  const scale = Math.min(
    1,
    maximum.width / bounds.width,
    maximum.height / bounds.height,
  );
  const leafer = leaf.leafer;
  if (!leafer) throw new Error("Leafer capture surface is unavailable");
  leaf.updateLayout();
  await new Promise<void>((resolve) => leafer.waitViewCompleted(resolve));
  const exported = leaf.syncExport("jpg", {
    pixelRatio: 1,
    quality: 0.88,
    scale,
    smooth: true,
  });
  if (exported.error) {
    throw exported.error instanceof Error
      ? exported.error
      : new Error("Leafer capture export failed");
  }
  const width = finitePositiveInteger(exported.width);
  const height = finitePositiveInteger(exported.height);
  if (width === null || height === null) {
    throw new Error("Leafer capture returned invalid dimensions");
  }
  return {
    bytes: decodeJpegDataUrl(exported.data),
    height,
    mimeType: "image/jpeg",
    width,
  };
}

function decodeJpegDataUrl(value: unknown): Uint8Array {
  if (typeof value !== "string") {
    throw new Error("Leafer synchronous capture did not return image bytes");
  }
  const match = /^data:image\/jpe?g;base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match?.[1]) {
    throw new Error("Leafer synchronous capture returned invalid JPEG data");
  }
  const binary = globalThis.atob(match[1]);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function finitePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}
