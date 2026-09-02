import type { Rect, ViewportState } from "@opendesign/design-contracts";
import {
  createSnapTargetIndex,
  resolveResizeSnapping,
  type SnapGuideLine,
  type SnapTarget,
  type SnapTargetIndex,
} from "@opendesign/geometry-service/snapping";
import {
  buildDirectSnapTargets,
  snapThreshold,
  viewportDocumentBounds,
  type DirectSnapTargetInput,
} from "./direct-snap-targets.js";

interface ResizeSnapSession {
  pageGuides: readonly SnapTarget[];
  pixelGrid: boolean;
  targets: SnapTargetIndex;
  threshold: number;
}

export interface DirectResizeScaleInput {
  aroundCenter: boolean;
  bounds: Rect;
  direction: number;
  lockRatio: boolean;
  origin: { x: number; y: number };
  scaleX: number;
  scaleY: number;
}

export class DirectResizeSnapController {
  readonly #onLines: (lines: readonly SnapGuideLine[]) => void;
  #session: ResizeSnapSession | null = null;
  #suppressed = false;

  constructor(options: { onLines: (lines: readonly SnapGuideLine[]) => void }) {
    this.#onLines = options.onLines;
  }

  begin(input: DirectSnapTargetInput): void {
    const targets = buildDirectSnapTargets(input);
    this.#session = {
      pageGuides: targets.filter(({ id }) => id.startsWith("page:")),
      pixelGrid: input.settings.pixelGrid,
      targets: createSnapTargetIndex(targets),
      threshold: snapThreshold(input.viewport),
    };
    this.#onLines([]);
  }

  resolve(input: DirectResizeScaleInput): {
    scaleX: number;
    scaleY: number;
  } {
    const session = this.#session;
    const axes = resizeAxes(input.direction);
    if (
      !session ||
      (!axes.horizontal && !axes.vertical) ||
      !validScaleInput(input)
    ) {
      this.#onLines([]);
      return originalScale(input);
    }
    const raw = scaleBounds(
      input.bounds,
      input.origin,
      input.scaleX,
      input.scaleY,
    );
    if (raw.width <= 0 || raw.height <= 0) {
      this.#onLines([]);
      return originalScale(input);
    }
    const resolution = resolveResizeSnapping({
      aroundCenter: input.aroundCenter,
      horizontal: axes.horizontal,
      lockRatio: input.lockRatio,
      pixelGrid: session.pixelGrid,
      selection: raw,
      targets: this.#suppressed ? { x: [], y: [] } : session.targets,
      threshold: session.threshold,
      vertical: axes.vertical,
    });
    this.#onLines(resolution.lines);
    return {
      scaleX: input.scaleX * (resolution.bounds.width / raw.width),
      scaleY: input.scaleY * (resolution.bounds.height / raw.height),
    };
  }

  refresh(input: DirectSnapTargetInput): void {
    if (!this.#session) return;
    this.begin(input);
  }

  setSuppressed(suppressed: boolean): void {
    if (this.#suppressed === suppressed) return;
    this.#suppressed = suppressed;
    this.#onLines([]);
  }

  syncViewport(viewport: ViewportState): void {
    const session = this.#session;
    if (!session) return;
    session.threshold = snapThreshold(viewport);
    const view = viewportDocumentBounds(viewport);
    session.pageGuides.forEach((guide) => {
      guide.range =
        guide.axis === "x"
          ? { start: view.top, end: view.bottom }
          : { start: view.left, end: view.right };
    });
  }

  finish(): void {
    this.#session = null;
    this.#onLines([]);
  }

  cancel(): void {
    this.finish();
  }
}

export function resizeAxes(direction: number): {
  horizontal: "start" | "end" | null;
  vertical: "start" | "end" | null;
} {
  return {
    horizontal:
      direction === 0 || direction === 6 || direction === 7
        ? "start"
        : direction === 2 || direction === 3 || direction === 4
          ? "end"
          : null,
    vertical:
      direction === 0 || direction === 1 || direction === 2
        ? "start"
        : direction === 4 || direction === 5 || direction === 6
          ? "end"
          : null,
  };
}

function scaleBounds(
  bounds: Rect,
  origin: { x: number; y: number },
  scaleX: number,
  scaleY: number,
): Rect {
  return {
    x: origin.x + (bounds.x - origin.x) * scaleX,
    y: origin.y + (bounds.y - origin.y) * scaleY,
    width: bounds.width * scaleX,
    height: bounds.height * scaleY,
  };
}

function validScaleInput(input: DirectResizeScaleInput): boolean {
  return [
    input.bounds.x,
    input.bounds.y,
    input.bounds.width,
    input.bounds.height,
    input.origin.x,
    input.origin.y,
    input.scaleX,
    input.scaleY,
  ].every(Number.isFinite);
}

function originalScale(input: DirectResizeScaleInput) {
  return { scaleX: input.scaleX, scaleY: input.scaleY };
}
