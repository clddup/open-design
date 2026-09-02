import type { Rect, ViewportState } from "@opendesign/design-contracts";
import {
  createDirectionalSnapTargetIndex,
  directionalTargetFromAxis,
  resolveDirectionalResizeSnapping,
  type DirectionalSnapTarget,
  type DirectionalSnapTargetIndex,
} from "@opendesign/geometry-service/directional-snapping";
import {
  resolveOrientedResizeSnapping,
  type OrientedResizeFrame,
} from "@opendesign/geometry-service/oriented-resize-snapping";
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
  directionalGuides: readonly DirectionalSnapTarget[];
  directionalTargets: DirectionalSnapTargetIndex;
  pageGuides: readonly SnapTarget[];
  pixelGrid: boolean;
  primaryTargetIds: ReadonlySet<string>;
  targets: SnapTargetIndex;
  threshold: number;
}

export interface DirectResizeScaleInput {
  aroundCenter: boolean;
  bounds: Rect;
  direction: number;
  frame?: OrientedResizeFrame;
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
      directionalGuides: targets.directionalGuides,
      directionalTargets: createDirectionalSnapTargetIndex([
        ...targets.directionalGuides,
        ...targets.axisTargets.map(directionalTargetFromAxis),
      ]),
      pageGuides: targets.axisTargets.filter(({ id }) =>
        id.startsWith("page:"),
      ),
      pixelGrid: input.settings.pixelGrid,
      primaryTargetIds: new Set(targets.directionalGuides.map(({ id }) => id)),
      targets: createSnapTargetIndex(targets.axisTargets),
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
    if (!this.#suppressed && session.primaryTargetIds.size > 0) {
      const directional = resolveDirectionalResizeSnapping({
        aroundCenter: input.aroundCenter,
        frame: input.frame ?? {
          bounds: input.bounds,
          transform: [1, 0, 0, 1, 0, 0],
        },
        horizontal: axes.horizontal,
        lockRatio: input.lockRatio,
        primaryTargetIds: session.primaryTargetIds,
        scaleX: input.scaleX,
        scaleY: input.scaleY,
        targets: session.directionalTargets,
        threshold: session.threshold,
        vertical: axes.vertical,
      });
      if (directional.matches.length > 0) {
        this.#onLines(directional.lines);
        return { scaleX: directional.scaleX, scaleY: directional.scaleY };
      }
    }
    if (input.frame) {
      const resolution = resolveOrientedResizeSnapping({
        aroundCenter: input.aroundCenter,
        frame: input.frame,
        horizontal: axes.horizontal,
        lockRatio: input.lockRatio,
        pixelGrid: session.pixelGrid,
        scaleX: input.scaleX,
        scaleY: input.scaleY,
        targets: this.#suppressed ? { x: [], y: [] } : session.targets,
        threshold: session.threshold,
        vertical: axes.vertical,
      });
      this.#onLines(resolution.lines);
      return { scaleX: resolution.scaleX, scaleY: resolution.scaleY };
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
    session.directionalTargets = createDirectionalSnapTargetIndex([
      ...session.directionalGuides,
      ...session.targets.x.map(directionalTargetFromAxis),
      ...session.targets.y.map(directionalTargetFromAxis),
    ]);
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
