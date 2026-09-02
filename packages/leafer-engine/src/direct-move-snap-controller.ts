import type { Rect, ViewportState } from "@opendesign/design-contracts";
import {
  createDirectionalSnapTargetIndex,
  directionalTargetFromAxis,
  resolveDirectionalMoveSnapping,
  type DirectionalSnapFrame,
  type DirectionalSnapTarget,
  type DirectionalSnapTargetIndex,
} from "@opendesign/geometry-service/directional-snapping";
import {
  createSnapTargetIndex,
  resolveMoveSnapping,
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

interface MoveSnapSession {
  correction: { x: number; y: number };
  directionalGuides: readonly DirectionalSnapTarget[];
  directionalTargets: DirectionalSnapTargetIndex;
  nodeIds: readonly string[];
  pageGuides: readonly SnapTarget[];
  pixelGrid: boolean;
  primaryTargetIds: ReadonlySet<string>;
  targets: SnapTargetIndex;
  threshold: number;
}

export type DirectMoveSnapInput = DirectSnapTargetInput;

export class DirectMoveSnapController {
  readonly #onLines: (lines: readonly SnapGuideLine[]) => void;
  readonly #selectionFrame: (
    nodeIds: readonly string[],
  ) => DirectionalSnapFrame | null;
  readonly #selectionBounds: (nodeIds: readonly string[]) => Rect | null;
  #session: MoveSnapSession | null = null;
  #suppressed = false;
  readonly #translate: (
    nodeIds: readonly string[],
    delta: { x: number; y: number },
  ) => boolean;

  constructor(options: {
    onLines: (lines: readonly SnapGuideLine[]) => void;
    selectionFrame: (nodeIds: readonly string[]) => DirectionalSnapFrame | null;
    selectionBounds: (nodeIds: readonly string[]) => Rect | null;
    translate: (
      nodeIds: readonly string[],
      delta: { x: number; y: number },
    ) => boolean;
  }) {
    this.#onLines = options.onLines;
    this.#selectionFrame = options.selectionFrame;
    this.#selectionBounds = options.selectionBounds;
    this.#translate = options.translate;
  }

  begin(input: DirectMoveSnapInput): void {
    const targets = buildDirectSnapTargets(input);
    this.#session = {
      correction: { x: 0, y: 0 },
      directionalGuides: targets.directionalGuides,
      directionalTargets: directionalTargetIndex(targets),
      nodeIds: input.nodeIds,
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

  update(): void {
    const session = this.#session;
    if (!session) {
      this.#onLines([]);
      return;
    }
    // Leafer resolves every drag event from the drag start and compensates for
    // the element's current snapped position before emitting editor.move. The
    // current transform is therefore already the raw pointer result here.
    session.correction = { x: 0, y: 0 };
    this.#resolveCurrentRaw(session);
  }

  refresh(input: DirectMoveSnapInput): void {
    const session = this.#session;
    if (!session || !this.#removeCorrection(session)) {
      this.#onLines([]);
      return;
    }
    const targets = buildDirectSnapTargets(input);
    session.nodeIds = input.nodeIds;
    session.directionalGuides = targets.directionalGuides;
    session.directionalTargets = directionalTargetIndex(targets);
    session.pageGuides = targets.axisTargets.filter(({ id }) =>
      id.startsWith("page:"),
    );
    session.pixelGrid = input.settings.pixelGrid;
    session.primaryTargetIds = new Set(
      targets.directionalGuides.map(({ id }) => id),
    );
    session.targets = createSnapTargetIndex(targets.axisTargets);
    session.threshold = snapThreshold(input.viewport);
    this.#resolveCurrentRaw(session);
  }

  syncViewport(viewport: ViewportState): void {
    const session = this.#session;
    if (!session) return;
    session.threshold = 5 / Math.max(viewport.zoom, 0.000_001);
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

  #resolveCurrentRaw(session: MoveSnapSession): void {
    const selection = this.#selectionBounds(session.nodeIds);
    const frame = this.#selectionFrame(session.nodeIds);
    if (!selection || !frame) {
      this.#onLines([]);
      return;
    }
    if (!this.#suppressed && session.primaryTargetIds.size > 0) {
      const directional = resolveDirectionalMoveSnapping({
        frame,
        primaryTargetIds: session.primaryTargetIds,
        targets: session.directionalTargets,
        threshold: session.threshold,
      });
      if (directional.matches.length > 0) {
        this.#applyResolution(session, directional);
        return;
      }
    }
    const resolution = resolveMoveSnapping({
      pixelGrid: session.pixelGrid,
      selection,
      targets: this.#suppressed ? { x: [], y: [] } : session.targets,
      threshold: session.threshold,
    });
    this.#applyResolution(session, resolution);
  }

  #applyResolution(
    session: MoveSnapSession,
    resolution: {
      delta: { x: number; y: number };
      lines: readonly SnapGuideLine[];
    },
  ): void {
    if (
      (resolution.delta.x !== 0 || resolution.delta.y !== 0) &&
      !this.#translate(session.nodeIds, resolution.delta)
    ) {
      this.#onLines([]);
      return;
    }
    session.correction = resolution.delta;
    this.#onLines(resolution.lines);
  }

  setSuppressed(suppressed: boolean): void {
    if (this.#suppressed === suppressed) return;
    this.#suppressed = suppressed;
    const session = this.#session;
    if (!session || !this.#removeCorrection(session)) {
      this.#onLines([]);
      return;
    }
    this.#resolveCurrentRaw(session);
  }

  finish(): void {
    this.#session = null;
    this.#onLines([]);
  }

  cancel(): void {
    this.#session = null;
    this.#onLines([]);
  }

  #removeCorrection(session: MoveSnapSession): boolean {
    const correction = session.correction;
    session.correction = { x: 0, y: 0 };
    if (correction.x === 0 && correction.y === 0) return true;
    return this.#translate(session.nodeIds, {
      x: -correction.x,
      y: -correction.y,
    });
  }
}

function directionalTargetIndex(
  targets: ReturnType<typeof buildDirectSnapTargets>,
) {
  return createDirectionalSnapTargetIndex([
    ...targets.directionalGuides,
    ...targets.axisTargets.map(directionalTargetFromAxis),
  ]);
}
