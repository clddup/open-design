import type { Point } from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import {
  generationRevealPaintState,
  scheduleGenerationReveals,
  type ScheduledGenerationReveal,
} from "./generation-reveal.js";
import {
  createGenerationTweenPlan,
  generationTweenCadence,
  generationTweenFrame,
  type GenerationTweenEndpoint,
  type GenerationTweenFrame,
  type GenerationTweenPlan,
} from "./generation-tween.js";
import {
  generationActivityBadgeWidth,
  generationSkeletonFill,
} from "./generation-presentation-style.js";
import {
  matrixRelativeToParent,
  sameAffineMatrix,
  transformToAffine,
  type AffineMatrix,
} from "./affine.js";
import type { LeaferElementSpec } from "./mapping.js";
import type { SceneReconciler } from "./scene-reconciler.js";
import type {
  LeaferGenerationActivity,
  LeaferGenerationReveal,
  LeaferGenerationSkeleton,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;
type LeaferEditor = InstanceType<LeaferModule["Editor"]>;
type LeaferStroker = InstanceType<LeaferModule["Stroker"]>;

interface GenerationSkeletonLabel {
  element: LeaferElement;
  height: number;
  width: number;
  x: number;
  y: number;
}

interface GenerationActivityElements {
  badge: LeaferElement;
  cursor: LeaferElement;
  label: LeaferElement;
}

interface GenerationActivityViewportState {
  badgeWidth: number;
  badgeX: number;
  badgeY: number;
  layerTransform: AffineMatrix;
}

interface GenerationSkeletonViewportState {
  layerTransform: AffineMatrix;
  zoom: number;
}

interface ActiveGenerationTween {
  current: GenerationTweenFrame;
  plan: GenerationTweenPlan;
}

interface GenerationPresentationControllerOptions {
  editor: Pick<LeaferEditor, "add" | "update">;
  hasAdjacentViewportPresentation(): boolean;
  host: HTMLElement;
  isDisposed(): boolean;
  leafer: LeaferModule;
  presentationRoot: LeaferGroup;
  report(error: unknown): void;
  scene: SceneReconciler;
  selectionNodeIds(): readonly string[];
  syncAdjacentViewport(): void;
  viewportRoot: LeaferGroup;
}

const MATRIX_EPSILON = 0.000_001;
const GENERATION_REVEAL_COLOR = "#6574ff";
const MAX_PROCESSED_GENERATION_REVEALS = 128;
const GENERATION_SKELETON_COLOR = "#7c6ee6";
const GENERATION_SKELETON_FILL = "rgba(124, 110, 230, 0.08)";
const MAX_SUPPRESSED_GENERATION_SKELETONS = 128;
const GENERATION_ACTIVITY_BADGE_FILL = "rgba(31, 28, 48, 0.94)";
const GENERATION_ACTIVITY_MOVE_MS = 180;
const MAX_SUPPRESSED_GENERATION_ACTIVITIES = 128;

/**
 * Owns every disposable Agent-generation presentation: plan skeleton,
 * committed-revision reveal, geometry tween, activity cursor and their frame
 * schedulers. It can only read SceneReconciler and never writes document,
 * revision, history or delivery-ledger state.
 */
export class GenerationPresentationController {
  readonly #generationActivityElements: GenerationActivityElements;
  readonly #generationActivityLayer: LeaferGroup;
  readonly #generationRevealStroker: LeaferStroker;
  readonly #generationReveals = new Map<string, ScheduledGenerationReveal>();
  readonly #generationSkeletonLabels: GenerationSkeletonLabel[] = [];
  readonly #generationSkeletonLayer: LeaferGroup;
  readonly #generationSkeletonStrokes: LeaferElement[] = [];
  readonly #generationTweens = new Map<string, ActiveGenerationTween>();
  readonly #options: GenerationPresentationControllerOptions;
  readonly #processedGenerationRevealIds = new Set<string>();
  readonly #suppressedGenerationActivityIds = new Set<string>();
  readonly #suppressedGenerationSkeletonIds = new Set<string>();
  readonly #generationRevealFocusPoints = new Map<string, Point>();
  #foregroundMounted = false;
  #generationActivityCurrentPoint: Point | null = null;
  #generationActivityFingerprint: string | null = null;
  #generationActivityFrame: number | null = null;
  #generationActivityId: string | null = null;
  #generationActivityMoveFrom: Point | null = null;
  #generationActivityMoveStartedAt: number | null = null;
  #generationActivityRevealNodeId: string | null = null;
  #generationActivityTargetPoint: Point | null = null;
  #generationActivityViewportState: GenerationActivityViewportState | null =
    null;
  #generationPresentationAverageFrameMs = 16.67;
  #generationPresentationFrame: number | null = null;
  #generationPresentationLastFrameAt: number | null = null;
  #generationRevealNextStartAt: number | null = null;
  #generationSkeletonFingerprint: string | null = null;
  #generationSkeletonId: string | null = null;
  #generationSkeletonViewportState: GenerationSkeletonViewportState | null =
    null;
  #generationViewportFrame: number | null = null;

  constructor(options: GenerationPresentationControllerOptions) {
    this.#options = options;
    this.#generationSkeletonLayer = new options.leafer.Group({
      editable: false,
      hitChildren: false,
      hittable: false,
      visible: false,
    });
    options.presentationRoot.addAt(this.#generationSkeletonLayer, 0);

    this.#generationActivityLayer = new options.leafer.Group({
      editable: false,
      hitChildren: false,
      hittable: false,
      visible: false,
    });
    const cursor = new options.leafer.Path({
      editable: false,
      fill: GENERATION_SKELETON_COLOR,
      hittable: false,
      path: "M 0 0 L 0 18 L 4.5 13.5 L 8.5 21 L 12 19 L 8 11.5 L 15 11.5 Z",
      stroke: "#ffffff",
      strokeJoin: "round",
      strokeWidth: 1,
    }) as LeaferElement;
    const badge = new options.leafer.Rect({
      cornerRadius: 4,
      editable: false,
      fill: GENERATION_ACTIVITY_BADGE_FILL,
      height: 26,
      hittable: false,
      stroke: "rgba(124, 110, 230, 0.72)",
      strokeAlign: "inside",
      strokeWidth: 1,
      width: 148,
      x: 14,
      y: 16,
    }) as LeaferElement;
    const label = new options.leafer.Text({
      editable: false,
      fill: "#ffffff",
      fontFamily: "Inter, sans-serif",
      fontSize: 11,
      fontWeight: 600,
      height: 16,
      hittable: false,
      lineHeight: 14,
      text: "AI",
      textOverflow: "ellipsis",
      width: 132,
      x: 22,
      y: 22,
    }) as LeaferElement;
    this.#generationActivityLayer.add(cursor);
    this.#generationActivityLayer.add(badge);
    this.#generationActivityLayer.add(label);
    this.#generationActivityElements = { badge, cursor, label };

    this.#generationRevealStroker = new options.leafer.Stroker();
    this.#generationRevealStroker.set({
      dashPattern: [6, 4],
      hittable: false,
      opacity: 0,
      stroke: GENERATION_REVEAL_COLOR,
      strokeAlign: "center",
      strokePathType: "render-path",
      strokeWidth: 1.25,
    });
  }

  mountForeground(): void {
    if (this.#foregroundMounted) return;
    this.#foregroundMounted = true;
    this.#options.presentationRoot.addAt(this.#generationActivityLayer, 3);
    this.#options.editor.add(this.#generationRevealStroker);
  }

  identityChanged(): void {
    this.finishReveal();
    this.#clearGenerationActivity(false);
    this.#clearGenerationSkeleton(false);
    this.#generationRevealFocusPoints.clear();
    this.#processedGenerationRevealIds.clear();
    this.#suppressedGenerationActivityIds.clear();
    this.#suppressedGenerationSkeletonIds.clear();
  }

  syncReveal(
    reveal: LeaferGenerationReveal | undefined,
    reducedMotion: boolean,
    tweenStarts?: ReadonlyMap<string, GenerationTweenEndpoint>,
  ): void {
    if (!reveal) return;
    if (reducedMotion) {
      this.finishReveal();
      if (this.#rememberGenerationReveal(reveal.id)) {
        this.#focusGenerationActivityOnRevealLast(reveal);
      }
      return;
    }
    this.#queueGenerationReveal(reveal, tweenStarts);
  }

  finishNode(nodeId: string): void {
    this.finishRevealNode(nodeId);
    this.finishTweenNode(nodeId, true);
  }

  finishPresentation(): void {
    this.finishReveal();
    this.#clearGenerationActivity(true);
    this.#clearGenerationSkeleton(true);
  }

  syncViewport(): void {
    this.#syncGenerationSkeletonViewport();
    this.#syncGenerationActivityViewport();
  }

  dispose(): void {
    this.finishReveal();
    this.#clearGenerationActivity(false);
    this.#clearGenerationSkeleton(false);
    if (this.#generationViewportFrame !== null) {
      cancelAnimationFrame(this.#generationViewportFrame);
      this.#generationViewportFrame = null;
    }
    this.#generationActivityLayer.remove();
    this.#generationActivityLayer.destroy();
    this.#generationSkeletonLayer.remove();
    this.#generationSkeletonLayer.destroy();
    this.#generationRevealStroker.remove();
    this.#generationRevealStroker.destroy();
    this.#foregroundMounted = false;
  }

  finishReveal(): void {
    if (this.#generationPresentationFrame !== null) {
      cancelAnimationFrame(this.#generationPresentationFrame);
      this.#generationPresentationFrame = null;
    }
    for (const [nodeId] of this.#generationReveals) {
      this.#restoreGenerationRevealNode(nodeId);
    }
    this.#generationReveals.clear();
    const tweenNodeIds = new Set(this.#generationTweens.keys());
    for (const [nodeId] of this.#generationTweens) {
      this.#restoreGenerationTweenNode(nodeId);
    }
    this.#generationTweens.clear();
    this.#refreshGenerationTweenSelection(tweenNodeIds);
    this.#generationPresentationLastFrameAt = null;
    this.#generationRevealFocusPoints.clear();
    this.#generationActivityRevealNodeId = null;
    this.#generationRevealNextStartAt = null;
    this.#generationRevealStroker.target = null as never;
    this.#generationRevealStroker.opacity = 0;
    this.#generationRevealStroker.update();
  }

  syncActivity(
    activity: LeaferGenerationActivity | undefined,
    reducedMotion: boolean,
  ): void {
    if (!activity || this.#suppressedGenerationActivityIds.has(activity.id)) {
      this.#clearGenerationActivity(false);
      return;
    }
    const fingerprint = JSON.stringify(activity);
    if (
      this.#generationActivityId === activity.id &&
      this.#generationActivityFingerprint === fingerprint
    ) {
      this.#syncGenerationActivityViewport();
      return;
    }

    this.#generationActivityId = activity.id;
    this.#generationActivityFingerprint = fingerprint;
    this.#generationActivityRevealNodeId = null;
    const badgeWidth = generationActivityBadgeWidth(activity.label);
    this.#generationActivityElements.badge.set({ width: badgeWidth });
    this.#generationActivityElements.label.set({
      text: activity.label,
      width: badgeWidth - 16,
    });
    this.#setGenerationActivityTarget(activity.target, reducedMotion);
  }

  #setGenerationActivityTarget(point: Point, reducedMotion: boolean): void {
    const target = { x: point.x, y: point.y };
    if (
      reducedMotion ||
      !this.#generationActivityCurrentPoint ||
      !this.#generationActivityTargetPoint
    ) {
      this.#cancelGenerationActivityMove();
      this.#generationActivityCurrentPoint = target;
      this.#generationActivityTargetPoint = target;
      this.#generationActivityMoveFrom = target;
      this.#generationActivityLayer.visible = true;
      this.#syncGenerationActivityViewport();
      return;
    }
    if (samePoint(this.#generationActivityTargetPoint, target)) {
      this.#syncGenerationActivityViewport();
      return;
    }
    this.#generationActivityMoveFrom = {
      ...this.#generationActivityCurrentPoint,
    };
    this.#generationActivityTargetPoint = target;
    this.#generationActivityMoveStartedAt = null;
    this.#generationActivityLayer.visible = true;
    this.#scheduleGenerationActivityFrame();
  }

  #scheduleGenerationActivityFrame(): void {
    if (
      this.#options.isDisposed() ||
      this.#generationActivityFrame !== null ||
      !this.#generationActivityId
    ) {
      return;
    }
    this.#generationActivityFrame = requestAnimationFrame((now) => {
      this.#generationActivityFrame = null;
      if (this.#options.isDisposed() || !this.#generationActivityId) return;
      const from = this.#generationActivityMoveFrom;
      const target = this.#generationActivityTargetPoint;
      if (!from || !target) return;
      this.#generationActivityMoveStartedAt ??= now;
      const elapsed = Math.max(0, now - this.#generationActivityMoveStartedAt);
      const progress = Math.min(1, elapsed / GENERATION_ACTIVITY_MOVE_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.#generationActivityCurrentPoint = {
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
      };
      this.#syncGenerationActivityViewport();
      if (progress < 1) {
        this.#scheduleGenerationActivityFrame();
      } else {
        this.#generationActivityMoveFrom = target;
        this.#generationActivityMoveStartedAt = null;
      }
    });
  }

  #syncGenerationActivityViewport(): void {
    const point = this.#generationActivityCurrentPoint;
    if (!point || !this.#generationActivityId) return;
    const matrix = this.#options.viewportRoot.localTransform;
    const screen = {
      x: matrix.a * point.x + matrix.c * point.y + matrix.e,
      y: matrix.b * point.x + matrix.d * point.y + matrix.f,
    };
    const hostBounds = this.#options.host.getBoundingClientRect();
    const onScreen =
      screen.x >= -24 &&
      screen.y >= -24 &&
      screen.x <= hostBounds.width + 24 &&
      screen.y <= hostBounds.height + 24;
    if (this.#generationActivityLayer.visible !== onScreen) {
      this.#generationActivityLayer.visible = onScreen;
    }
    if (!onScreen) return;
    const layerTransform = matrixRelativeToParent(
      this.#options.presentationRoot.localTransform,
      {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: screen.x,
        f: screen.y,
      },
      MATRIX_EPSILON,
    );
    if (!layerTransform) {
      this.#generationActivityLayer.visible = false;
      this.#generationActivityViewportState = null;
      return;
    }
    const badgeWidth = Math.max(
      1,
      Number(this.#generationActivityElements.badge.width) || 148,
    );
    const badgeX =
      screen.x + badgeWidth + 28 > hostBounds.width ? -badgeWidth - 14 : 14;
    const badgeY = screen.y + 48 > hostBounds.height ? -40 : 16;
    const previous = this.#generationActivityViewportState;
    if (
      previous &&
      sameAffineMatrix(
        previous.layerTransform,
        layerTransform,
        MATRIX_EPSILON,
      ) &&
      nearlyEqual(previous.badgeWidth, badgeWidth) &&
      nearlyEqual(previous.badgeX, badgeX) &&
      nearlyEqual(previous.badgeY, badgeY)
    ) {
      return;
    }
    this.#generationActivityViewportState = {
      badgeWidth,
      badgeX,
      badgeY,
      layerTransform: { ...layerTransform },
    };
    this.#generationActivityLayer.setTransform(layerTransform);
    this.#generationActivityElements.badge.set({ x: badgeX, y: badgeY });
    this.#generationActivityElements.label.set({
      width: badgeWidth - 16,
      x: badgeX + 8,
      y: badgeY + 6,
    });
  }

  #focusGenerationActivityOnRevealLast(reveal: LeaferGenerationReveal): void {
    if (!this.#generationActivityId || !reveal.focusPoints) return;
    const nodeIds = [...reveal.nodeIds, ...(reveal.tweenNodeIds ?? [])];
    for (let index = nodeIds.length - 1; index >= 0; index -= 1) {
      const nodeId = nodeIds[index];
      if (!nodeId) continue;
      const point = reveal.focusPoints[nodeId];
      if (!point) continue;
      this.#generationActivityRevealNodeId = nodeId;
      this.#setGenerationActivityTarget(point, true);
      return;
    }
  }

  #cancelGenerationActivityMove(): void {
    if (this.#generationActivityFrame !== null) {
      cancelAnimationFrame(this.#generationActivityFrame);
      this.#generationActivityFrame = null;
    }
    this.#generationActivityMoveStartedAt = null;
  }

  #clearGenerationActivity(suppress: boolean): void {
    const activityId = this.#generationActivityId;
    if (suppress && activityId) {
      this.#suppressedGenerationActivityIds.add(activityId);
      while (
        this.#suppressedGenerationActivityIds.size >
        MAX_SUPPRESSED_GENERATION_ACTIVITIES
      ) {
        const oldest = this.#suppressedGenerationActivityIds
          .values()
          .next().value;
        if (oldest === undefined) break;
        this.#suppressedGenerationActivityIds.delete(oldest);
      }
    }
    this.#cancelGenerationActivityMove();
    this.#generationActivityLayer.visible = false;
    this.#generationActivityCurrentPoint = null;
    this.#generationActivityFingerprint = null;
    this.#generationActivityId = null;
    this.#generationActivityMoveFrom = null;
    this.#generationActivityTargetPoint = null;
    this.#generationActivityRevealNodeId = null;
    this.#generationActivityViewportState = null;
  }

  syncSkeleton(skeleton: LeaferGenerationSkeleton | undefined): void {
    if (!skeleton || this.#suppressedGenerationSkeletonIds.has(skeleton.id)) {
      this.#clearGenerationSkeleton(false);
      return;
    }
    const fingerprint = JSON.stringify(skeleton);
    if (
      this.#generationSkeletonId === skeleton.id &&
      this.#generationSkeletonFingerprint === fingerprint
    ) {
      this.#syncGenerationSkeletonViewport();
      return;
    }

    this.#clearGenerationSkeleton(false);
    this.#generationSkeletonId = skeleton.id;
    this.#generationSkeletonFingerprint = fingerprint;
    if (!skeleton.artboard.pending && skeleton.regions.length === 0) {
      return;
    }

    const artboardGroup = new this.#options.leafer.Group({
      editable: false,
      hitChildren: false,
      hittable: false,
    }) as LeaferGroup;
    artboardGroup.setTransform(transformToAffine(skeleton.artboard.transform));
    if (skeleton.artboard.pending) {
      const outline = new this.#options.leafer.Rect({
        cornerRadius: 8,
        dashPattern: [8, 6],
        editable: false,
        fill: "rgba(124, 110, 230, 0.035)",
        height: skeleton.artboard.height,
        hittable: false,
        stroke: GENERATION_SKELETON_COLOR,
        strokeAlign: "inside",
        width: skeleton.artboard.width,
      }) as LeaferElement;
      this.#generationSkeletonStrokes.push(outline);
      artboardGroup.add(outline);
    }
    for (const region of skeleton.regions) {
      const outline = new this.#options.leafer.Rect({
        cornerRadius: 5,
        dashPattern: [5, 4],
        editable: false,
        fill: generationSkeletonFill(region.role, GENERATION_SKELETON_FILL),
        height: region.height,
        hittable: false,
        stroke: GENERATION_SKELETON_COLOR,
        strokeAlign: "inside",
        width: region.width,
        x: region.x,
        y: region.y,
      }) as LeaferElement;
      const label = new this.#options.leafer.Text({
        editable: false,
        fill: GENERATION_SKELETON_COLOR,
        fontFamily: "Inter, sans-serif",
        fontWeight: 600,
        hittable: false,
        text: region.name,
        textOverflow: "ellipsis",
      }) as LeaferElement;
      this.#generationSkeletonStrokes.push(outline);
      this.#generationSkeletonLabels.push({
        element: label,
        height: region.height,
        width: region.width,
        x: region.x,
        y: region.y,
      });
      artboardGroup.add(outline);
      artboardGroup.add(label);
    }
    this.#generationSkeletonLayer.add(artboardGroup);
    this.#generationSkeletonLayer.visible = true;
    this.#syncGenerationSkeletonViewport();
  }

  #syncGenerationSkeletonViewport(): void {
    if (!this.#generationSkeletonId) return;
    const treeTransform = this.#options.viewportRoot.localTransform;
    const layerTransform = matrixRelativeToParent(
      this.#options.presentationRoot.localTransform,
      treeTransform,
      MATRIX_EPSILON,
    );
    if (!layerTransform) {
      this.#generationSkeletonLayer.visible = false;
      this.#generationSkeletonViewportState = null;
      return;
    }
    const zoom = Math.max(MATRIX_EPSILON, Math.abs(treeTransform.a || 1));
    const previous = this.#generationSkeletonViewportState;
    if (
      previous &&
      sameAffineMatrix(
        previous.layerTransform,
        layerTransform,
        MATRIX_EPSILON,
      ) &&
      nearlyEqual(previous.zoom, zoom)
    ) {
      if (!this.#generationSkeletonLayer.visible) {
        this.#generationSkeletonLayer.visible = true;
      }
      return;
    }
    this.#generationSkeletonViewportState = {
      layerTransform: { ...layerTransform },
      zoom,
    };
    this.#generationSkeletonLayer.setTransform(layerTransform);
    this.#generationSkeletonLayer.visible = true;
    const inverseZoom = 1 / zoom;
    for (const element of this.#generationSkeletonStrokes) {
      element.set({
        dashPattern: [5 * inverseZoom, 4 * inverseZoom],
        strokeWidth: 1.15 * inverseZoom,
      });
    }
    for (const label of this.#generationSkeletonLabels) {
      const inset = 7 * inverseZoom;
      const labelHeight = Math.min(label.height, 16 * inverseZoom);
      label.element.set({
        fontSize: 11 * inverseZoom,
        height: labelHeight,
        lineHeight: 14 * inverseZoom,
        width: Math.max(inverseZoom, label.width - inset * 2),
        x: label.x + inset,
        y: label.y + 5 * inverseZoom,
      });
    }
  }

  scheduleViewportSync(): void {
    if (
      this.#options.isDisposed() ||
      this.#generationViewportFrame !== null ||
      (!this.#generationSkeletonId &&
        !this.#generationActivityId &&
        !this.#options.hasAdjacentViewportPresentation())
    ) {
      return;
    }
    this.#generationViewportFrame = requestAnimationFrame(() => {
      this.#generationViewportFrame = null;
      if (this.#options.isDisposed()) return;
      // Leafer can settle the document tree and built-in editor sky in
      // different callbacks. Re-read both and recompute their relative
      // transform so kinetic pan/zoom never leaves an intermediate offset.
      this.#options.syncAdjacentViewport();
      this.#syncGenerationSkeletonViewport();
      this.#syncGenerationActivityViewport();
    });
  }

  #clearGenerationSkeleton(suppress: boolean): void {
    const skeletonId = this.#generationSkeletonId;
    if (suppress && skeletonId) {
      this.#suppressedGenerationSkeletonIds.add(skeletonId);
      while (
        this.#suppressedGenerationSkeletonIds.size >
        MAX_SUPPRESSED_GENERATION_SKELETONS
      ) {
        const oldest = this.#suppressedGenerationSkeletonIds
          .values()
          .next().value;
        if (oldest === undefined) break;
        this.#suppressedGenerationSkeletonIds.delete(oldest);
      }
    }
    for (const child of [...this.#generationSkeletonLayer.children]) {
      child.remove();
      child.destroy();
    }
    this.#generationSkeletonLayer.visible = false;
    this.#generationSkeletonFingerprint = null;
    this.#generationSkeletonId = null;
    this.#generationSkeletonLabels.length = 0;
    this.#generationSkeletonStrokes.length = 0;
    this.#generationSkeletonViewportState = null;
  }

  #queueGenerationReveal(
    reveal: LeaferGenerationReveal,
    tweenStarts?: ReadonlyMap<string, GenerationTweenEndpoint>,
  ): void {
    if (!this.#rememberGenerationReveal(reveal.id)) return;
    if (reveal.focusPoints) {
      for (const nodeId of [
        ...reveal.nodeIds,
        ...(reveal.tweenNodeIds ?? []),
      ]) {
        const point = reveal.focusPoints[nodeId];
        if (point) this.#generationRevealFocusPoints.set(nodeId, point);
      }
    }
    const nodeIds = reveal.nodeIds.filter((nodeId) => {
      const spec = this.#options.scene.projection?.elementsById.get(nodeId);
      const opacity = spec?.data.opacity;
      return (
        this.#options.scene.has(nodeId) &&
        spec?.data.visible !== false &&
        (typeof opacity !== "number" || opacity > 0)
      );
    });
    const scheduled = scheduleGenerationReveals(
      nodeIds,
      reveal.startedAt,
      this.#generationRevealNextStartAt,
    );
    this.#generationRevealNextStartAt = scheduled.nextAvailableStartAt;
    for (const item of scheduled.items) {
      this.#generationReveals.set(item.nodeId, item);
      this.#setGenerationRevealOpacity(item.nodeId, 0);
    }
    this.#queueGenerationTweens(reveal, tweenStarts);
    if (scheduled.items.length > 0 || this.#generationTweens.size > 0) {
      this.#scheduleGenerationPresentationFrame();
    }
  }

  #rememberGenerationReveal(revealId: string): boolean {
    if (this.#processedGenerationRevealIds.has(revealId)) return false;
    this.#processedGenerationRevealIds.add(revealId);
    while (
      this.#processedGenerationRevealIds.size > MAX_PROCESSED_GENERATION_REVEALS
    ) {
      const oldest = this.#processedGenerationRevealIds.values().next().value;
      if (oldest === undefined) break;
      this.#processedGenerationRevealIds.delete(oldest);
    }
    return true;
  }

  #scheduleGenerationPresentationFrame(): void {
    if (
      this.#options.isDisposed() ||
      this.#generationPresentationFrame !== null
    )
      return;
    this.#generationPresentationFrame = requestAnimationFrame((now) => {
      this.#generationPresentationFrame = null;
      if (this.#options.isDisposed()) return;
      try {
        this.#recordGenerationPresentationFrame(now);
        this.#renderGenerationRevealFrame(now);
        this.#renderGenerationTweenFrame(now);
      } catch (error) {
        this.finishReveal();
        this.#options.report(error);
        return;
      }
      if (this.#generationReveals.size > 0 || this.#generationTweens.size > 0) {
        this.#scheduleGenerationPresentationFrame();
      } else {
        this.#generationPresentationLastFrameAt = null;
      }
    });
  }

  #renderGenerationRevealFrame(now: number): void {
    let active:
      | {
          element: LeaferElement;
          nodeId: string;
          opacity: number;
          startsAt: number;
        }
      | undefined;
    for (const [nodeId, item] of this.#generationReveals) {
      const element = this.#options.scene.element(nodeId);
      const spec = this.#options.scene.projection?.elementsById.get(nodeId);
      if (!element || !spec) {
        this.#generationReveals.delete(nodeId);
        continue;
      }
      const state = generationRevealPaintState(item, now);
      const finalOpacity = projectionOpacity(spec.data.opacity);
      this.#setGenerationRevealOpacity(
        nodeId,
        finalOpacity * state.nodeOpacity,
      );
      if (state.phase === "done") {
        this.#generationReveals.delete(nodeId);
        continue;
      }
      if (
        state.overlayOpacity > 0 &&
        (!active || item.startsAt >= active.startsAt)
      ) {
        active = {
          element,
          nodeId,
          opacity: state.overlayOpacity,
          startsAt: item.startsAt,
        };
      }
    }

    if (active) {
      this.#generationRevealStroker.setTarget(active.element, {
        opacity: active.opacity,
      });
      if (
        this.#generationActivityId &&
        this.#generationActivityRevealNodeId !== active.nodeId
      ) {
        const point = this.#generationRevealFocusPoints.get(active.nodeId);
        if (point) {
          this.#generationActivityRevealNodeId = active.nodeId;
          this.#setGenerationActivityTarget(point, false);
        }
      }
    } else {
      this.#generationRevealStroker.target = null as never;
      this.#generationRevealStroker.opacity = 0;
      this.#generationRevealStroker.update();
    }
    if (
      this.#generationReveals.size === 0 &&
      this.#generationTweens.size === 0
    ) {
      this.#generationRevealNextStartAt = null;
      this.#generationRevealFocusPoints.clear();
      this.#generationActivityRevealNodeId = null;
    }
  }

  #setGenerationRevealOpacity(nodeId: string, opacity: number): void {
    const element = this.#options.scene.element(nodeId);
    if (!element || nearlyEqual(element.opacity ?? 1, opacity)) return;
    element.opacity = opacity;
  }

  #restoreGenerationRevealNode(nodeId: string): void {
    const opacity = projectionOpacity(
      this.#options.scene.projection?.elementsById.get(nodeId)?.data.opacity,
    );
    this.#setGenerationRevealOpacity(nodeId, opacity);
  }

  finishRevealNode(nodeId: string): void {
    if (!this.#generationReveals.delete(nodeId)) return;
    const element = this.#options.scene.element(nodeId);
    this.#restoreGenerationRevealNode(nodeId);
    if (element && this.#generationRevealStroker.target === element) {
      this.#generationRevealStroker.target = null as never;
      this.#generationRevealStroker.opacity = 0;
      this.#generationRevealStroker.update();
    }
  }

  #queueGenerationTweens(
    reveal: LeaferGenerationReveal,
    tweenStarts?: ReadonlyMap<string, GenerationTweenEndpoint>,
  ): void {
    const requested = reveal.tweenNodeIds ?? [];
    if (
      requested.length === 0 ||
      !tweenStarts ||
      !this.#options.scene.projection
    )
      return;
    const selectedNodeIds = new Set(this.#options.selectionNodeIds());
    const candidates = requested.flatMap((nodeId, order) => {
      const start = tweenStarts.get(nodeId);
      const target = this.#options.scene.projection?.elementsById.get(nodeId);
      const element = this.#options.scene.element(nodeId);
      const disappearing =
        target?.data.visible === false && start?.data.visible !== false;
      if (
        !start ||
        !target ||
        !element ||
        (target.data.visible === false && !disappearing) ||
        (!disappearing && !this.#isGenerationTweenVisible(element))
      ) {
        return [];
      }
      return [
        {
          element,
          nodeId,
          order,
          selected: selectedNodeIds.has(nodeId),
          start,
          target,
        },
      ];
    });
    const cadence = generationTweenCadence({
      averageFrameMs: this.#generationPresentationAverageFrameMs,
      nodeCount: requested.length,
      visibleNodeCount: candidates.length,
    });
    candidates.sort(
      (left, right) =>
        Number(right.selected) - Number(left.selected) ||
        left.order - right.order,
    );
    candidates
      .slice(0, cadence.maximumAnimatedNodeCount)
      .forEach(({ element, nodeId, start, target }, index) => {
        const plan = createGenerationTweenPlan(
          nodeId,
          start,
          { data: target.data, transform: target.transform },
          reveal.startedAt + index * cadence.staggerMs,
          cadence.durationMs,
        );
        if (!plan) return;
        const current = generationTweenFrame(plan, plan.startsAt);
        this.#generationTweens.set(nodeId, { current, plan });
        this.#applyGenerationTweenFrame(element, current);
      });
    const animatedNodeIds = new Set(this.#generationTweens.keys());
    const selectionBounds = this.#options.scene.selectionBoundsAffected(
      animatedNodeIds,
      this.#options.scene.projection,
      this.#options.scene.projection,
    );
    if (selectionBounds.size > 0) {
      for (const nodeId of selectionBounds) {
        this.#options.scene.element(nodeId)?.forceUpdate("bounds");
      }
      this.#options.editor.update();
    }
    const lastAnimatedNodeId = [...this.#generationTweens.keys()].at(-1);
    const focusPoint = lastAnimatedNodeId
      ? this.#generationRevealFocusPoints.get(lastAnimatedNodeId)
      : undefined;
    if (
      lastAnimatedNodeId &&
      focusPoint &&
      this.#generationActivityId &&
      this.#generationActivityRevealNodeId !== lastAnimatedNodeId
    ) {
      this.#generationActivityRevealNodeId = lastAnimatedNodeId;
      this.#setGenerationActivityTarget(focusPoint, false);
    }
  }

  #renderGenerationTweenFrame(now: number): void {
    if (this.#generationTweens.size === 0) return;
    const changedNodeIds = new Set<string>();
    for (const [nodeId, active] of this.#generationTweens) {
      const element = this.#options.scene.element(nodeId);
      const target = this.#options.scene.projection?.elementsById.get(nodeId);
      if (!element || !target) {
        this.#generationTweens.delete(nodeId);
        continue;
      }
      const current = generationTweenFrame(active.plan, now);
      active.current = current;
      this.#applyGenerationTweenFrame(element, current);
      changedNodeIds.add(nodeId);
      if (current.done) {
        this.#restoreGenerationTweenNode(nodeId);
        this.#generationTweens.delete(nodeId);
      }
    }
    const projection = this.#options.scene.projection;
    if (projection && changedNodeIds.size > 0) {
      const selectionBounds = this.#options.scene.selectionBoundsAffected(
        changedNodeIds,
        projection,
        projection,
      );
      if (selectionBounds.size > 0) {
        for (const nodeId of selectionBounds) {
          this.#options.scene.element(nodeId)?.forceUpdate("bounds");
        }
        this.#options.editor.update();
      }
    }
    if (
      this.#generationTweens.size === 0 &&
      this.#generationReveals.size === 0
    ) {
      this.#generationRevealNextStartAt = null;
      this.#generationRevealFocusPoints.clear();
      this.#generationActivityRevealNodeId = null;
    }
  }

  takeTweenStart(
    nodeId: string,
    previousSpec: LeaferElementSpec,
  ): GenerationTweenEndpoint {
    const active = this.#generationTweens.get(nodeId);
    if (!active) {
      return { data: previousSpec.data, transform: previousSpec.transform };
    }
    this.#generationTweens.delete(nodeId);
    return {
      data: { ...previousSpec.data, ...active.current.data },
      transform: active.current.transform,
    };
  }

  finishTweenNode(nodeId: string, restore: boolean): void {
    if (!this.#generationTweens.delete(nodeId)) return;
    if (restore) {
      this.#restoreGenerationTweenNode(nodeId);
      this.#refreshGenerationTweenSelection(new Set([nodeId]));
    }
  }

  finishTweens(): void {
    const nodeIds = new Set(this.#generationTweens.keys());
    for (const [nodeId] of this.#generationTweens) {
      this.#restoreGenerationTweenNode(nodeId);
    }
    this.#generationTweens.clear();
    this.#refreshGenerationTweenSelection(nodeIds);
  }

  #restoreGenerationTweenNode(nodeId: string): void {
    const element = this.#options.scene.element(nodeId);
    const target = this.#options.scene.projection?.elementsById.get(nodeId);
    if (!element || !target) return;
    element.set(target.data);
    element.setTransform(transformToAffine(target.transform));
  }

  #applyGenerationTweenFrame(
    element: LeaferElement,
    frame: GenerationTweenFrame,
  ): void {
    element.set(frame.data);
    element.setTransform(transformToAffine(frame.transform));
  }

  #refreshGenerationTweenSelection(nodeIds: ReadonlySet<string>): void {
    const projection = this.#options.scene.projection;
    if (!projection || nodeIds.size === 0) return;
    const selectionBounds = this.#options.scene.selectionBoundsAffected(
      nodeIds,
      projection,
      projection,
    );
    if (selectionBounds.size === 0) return;
    for (const nodeId of selectionBounds) {
      this.#options.scene.element(nodeId)?.forceUpdate("bounds");
    }
    this.#options.editor.update();
  }

  #recordGenerationPresentationFrame(now: number): void {
    const previous = this.#generationPresentationLastFrameAt;
    this.#generationPresentationLastFrameAt = now;
    if (previous === null) return;
    const interval = now - previous;
    if (!Number.isFinite(interval) || interval < 4 || interval > 100) return;
    this.#generationPresentationAverageFrameMs =
      this.#generationPresentationAverageFrameMs * 0.85 + interval * 0.15;
  }

  #isGenerationTweenVisible(element: LeaferElement): boolean {
    let bounds: ReturnType<LeaferElement["getBounds"]>;
    try {
      bounds = element.getBounds("render", "page");
    } catch {
      return false;
    }
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height)
    ) {
      return false;
    }
    const host = this.#options.host.getBoundingClientRect();
    const left = Number.isFinite(host.left) ? host.left : 0;
    const top = Number.isFinite(host.top) ? host.top : 0;
    const right = Number.isFinite(host.right) ? host.right : left + host.width;
    const bottom = Number.isFinite(host.bottom)
      ? host.bottom
      : top + host.height;
    return (
      bounds.x + bounds.width >= left &&
      bounds.y + bounds.height >= top &&
      bounds.x <= right &&
      bounds.y <= bottom
    );
  }
}

function projectionOpacity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 1;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MATRIX_EPSILON;
}

function samePoint(left: Point, right: Point): boolean {
  return nearlyEqual(left.x, right.x) && nearlyEqual(left.y, right.y);
}
