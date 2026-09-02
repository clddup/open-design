import {
  DEFAULT_LAYOUT_SIZING,
  type DesignDocument,
  type SelectionState,
  type ViewportState,
} from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import type { SnapGuideLine } from "@opendesign/geometry-service/snapping";
import { AutoLayoutSpacingOverlayController } from "./auto-layout-spacing-overlay-controller.js";
import { DistanceMeasurementController } from "./distance-measurement-controller.js";
import { GridEditorOverlayController } from "./grid-editor-overlay-controller.js";
import type { GridEditorAxis } from "./grid-editor-overlay.js";
import {
  directTransformElementBounds,
  type DirectTransformElementState,
} from "./direct-transform-controller.js";
import type { LeaferEventLike } from "./pointer-event.js";
import { SmartSelectionOverlayController } from "./smart-selection-overlay-controller.js";
import { SnapGuideOverlayController } from "./snap-guide-overlay-controller.js";
import { StaticEditorOverlayController } from "./static-editor-overlay-controller.js";
import type {
  LeaferAutoLayoutSpacingCommitRequest,
  LeaferAutoLayoutSpacingInputRequest,
  LeaferGridTrackInputRequest,
  LeaferSmartSelectionMarkState,
  LeaferSmartSelectionSpacingRequest,
  LeaferSmartSelectionReorderRequest,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

export class EditorOverlayController {
  readonly #autoLayoutSpacing: AutoLayoutSpacingOverlayController;
  #document: DesignDocument | null = null;
  readonly #gridEditor: GridEditorOverlayController;
  readonly #measurements: DistanceMeasurementController;
  readonly #snapGuides: SnapGuideOverlayController;
  readonly #staticOverlays: StaticEditorOverlayController;
  readonly #smartSelection: SmartSelectionOverlayController;

  constructor(options: {
    canMeasure: () => boolean;
    element: (nodeId: string) => LeaferElement | undefined;
    finishNodePresentation: (nodeId: string) => void;
    leafer: LeaferModule;
    onGridTrackDelete: (request: {
      axis: GridEditorAxis;
      expectedRevision: number;
      frameId: string;
      indices: readonly number[];
    }) => boolean;
    onAutoLayoutSpacingCommit: (
      request: LeaferAutoLayoutSpacingCommitRequest,
    ) => boolean;
    onAutoLayoutSpacingInputRequest: (
      request: LeaferAutoLayoutSpacingInputRequest,
    ) => void;
    onGridTrackReorder: (request: {
      axis: GridEditorAxis;
      frameId: string;
      fromIndices: readonly number[];
      insertionIndex: number;
    }) => boolean;
    onGridTrackInputRequest: (request: LeaferGridTrackInputRequest) => void;
    onGridTrackResize: (request: {
      axis: GridEditorAxis;
      expectedRevision: number;
      frameId: string;
      index: number;
      value: number;
    }) => boolean;
    onSmartSelectionSpacing: (
      request: LeaferSmartSelectionSpacingRequest,
    ) => boolean;
    onSmartSelectionReorder: (
      request: LeaferSmartSelectionReorderRequest,
    ) => boolean;
    onSmartSelectionMarkChange: (
      state: LeaferSmartSelectionMarkState | null,
    ) => void;
    presentationRoot: LeaferGroup;
    projectionId: (element: LeaferElement) => string | undefined;
    restoreProjection: () => void;
    selectedElements: () => readonly LeaferElement[];
    viewportRoot: LeaferGroup;
  }) {
    this.#staticOverlays = new StaticEditorOverlayController({
      leafer: options.leafer,
      presentationRoot: options.presentationRoot,
      viewportRoot: options.viewportRoot,
    });
    this.#autoLayoutSpacing = new AutoLayoutSpacingOverlayController({
      layerIndex: 4,
      leafer: options.leafer,
      onCommit: options.onAutoLayoutSpacingCommit,
      onInputRequest: options.onAutoLayoutSpacingInputRequest,
      presentationRoot: options.presentationRoot,
      viewportRoot: options.viewportRoot,
    });
    this.#gridEditor = new GridEditorOverlayController({
      layerIndex: 5,
      leafer: options.leafer,
      onDelete: options.onGridTrackDelete,
      onInputRequest: options.onGridTrackInputRequest,
      onReorder: options.onGridTrackReorder,
      onResize: options.onGridTrackResize,
      presentationRoot: options.presentationRoot,
      viewportRoot: options.viewportRoot,
    });
    this.#smartSelection = new SmartSelectionOverlayController({
      element: options.element,
      finishNodePresentation: options.finishNodePresentation,
      layerIndex: 6,
      leafer: options.leafer,
      onCommit: options.onSmartSelectionSpacing,
      onReorder: options.onSmartSelectionReorder,
      onMarkChange: options.onSmartSelectionMarkChange,
      presentationRoot: options.presentationRoot,
      restoreProjection: options.restoreProjection,
      viewportRoot: options.viewportRoot,
    });
    this.#snapGuides = new SnapGuideOverlayController({
      layerIndex: 8,
      leafer: options.leafer,
      presentationRoot: options.presentationRoot,
      viewportRoot: options.viewportRoot,
    });
    this.#measurements = new DistanceMeasurementController({
      canMeasure: options.canMeasure,
      layerIndex: 9,
      leafer: options.leafer,
      presentationRoot: options.presentationRoot,
      projectionId: options.projectionId,
      selectedElements: options.selectedElements,
      viewportRoot: options.viewportRoot,
    });
  }

  get active(): boolean {
    return (
      this.#staticOverlays.active ||
      this.#autoLayoutSpacing.active ||
      this.#gridEditor.active ||
      this.#smartSelection.active ||
      this.#measurements.active
    );
  }

  get dragging(): boolean {
    return (
      this.#autoLayoutSpacing.dragging ||
      this.#gridEditor.dragging ||
      this.#smartSelection.dragging
    );
  }

  cancelDrag(): boolean {
    return (
      this.#autoLayoutSpacing.cancelDrag() ||
      this.#gridEditor.cancelDrag() ||
      this.#smartSelection.cancelDrag()
    );
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    this.#measurements.handleKeyDown(event);
    return this.#gridEditor.handleKeyDown(event);
  }

  handleKeyUp(event: KeyboardEvent): void {
    this.#measurements.handleKeyUp(event);
  }

  handleWindowBlur(): void {
    this.#measurements.handleWindowBlur();
  }

  pointerLeave(): void {
    this.#measurements.pointerLeave();
  }

  clearMeasurements(): void {
    this.#measurements.clear();
  }

  previewGridChildDrop(
    frameId: string,
    point: { x: number; y: number } | null,
  ): { row: number; column: number } | null {
    const cell = this.#gridEditor.previewChildDrop(frameId, point);
    return cell ? { row: cell.row, column: cell.column } : null;
  }

  gridChildCellAt(
    frameId: string,
    point: { x: number; y: number },
  ): { row: number; column: number } | null {
    const cell = this.#gridEditor.childCellAt(frameId, point);
    return cell ? { row: cell.row, column: cell.column } : null;
  }

  previewGridChildSpan(
    frameId: string,
    nodeId: string,
    before: DirectTransformElementState,
    next: DirectTransformElementState | null,
  ): {
    row: number;
    column: number;
    rowSpan: number;
    columnSpan: number;
  } | null {
    if (!next) {
      this.#gridEditor.previewChildPlacement(frameId, null);
      return null;
    }
    const node = this.#document?.nodesById[nodeId];
    if (!node?.gridPlacement) return null;
    return this.#gridEditor.previewChildSpan(
      frameId,
      node.gridPlacement,
      node.layoutSizing ?? DEFAULT_LAYOUT_SIZING,
      directTransformElementBounds(before),
      directTransformElementBounds(next),
    );
  }

  dispose(): void {
    this.#staticOverlays.dispose();
    this.#autoLayoutSpacing.dispose();
    this.#gridEditor.dispose();
    this.#smartSelection.dispose();
    this.#snapGuides.dispose();
    this.#measurements.dispose();
  }

  sync(input: {
    autoLayoutSpacingFrameId?: string;
    document: DesignDocument;
    gridEditorFrameId?: string;
    layoutGuideFrameId?: string;
    measurementBlocked: boolean;
    pageId: string;
    selection: SelectionState;
    tool: string;
    viewport: ViewportState;
  }): void {
    this.#document = input.document;
    this.#staticOverlays.sync({
      document: input.document,
      ...(input.layoutGuideFrameId
        ? { layoutGuideFrameId: input.layoutGuideFrameId }
        : {}),
      pageId: input.pageId,
    });
    this.#autoLayoutSpacing.sync({
      document: input.document,
      ...(input.autoLayoutSpacingFrameId
        ? { frameId: input.autoLayoutSpacingFrameId }
        : {}),
    });
    this.#gridEditor.sync({
      document: input.document,
      viewport: input.viewport,
      ...(input.gridEditorFrameId ? { frameId: input.gridEditorFrameId } : {}),
    });
    this.#smartSelection.sync({
      componentTargetActive: input.selection.componentTarget !== undefined,
      document: input.document,
      pageId: input.pageId,
      selectedNodeIds: input.selection.nodeIds,
      tool: input.tool,
    });
    this.#measurements.sync({
      blocked: input.measurementBlocked,
      documentId: input.document.documentId,
      pageId: input.pageId,
      revision: input.document.revision,
      selectionKey: JSON.stringify({
        componentTarget: input.selection.componentTarget ?? null,
        nodeIds: input.selection.nodeIds,
      }),
      tool: input.tool,
    });
    this.syncViewport(input.viewport);
  }

  pointerDown(event: LeaferEventLike): boolean {
    return (
      this.#autoLayoutSpacing.pointerDown(event) ||
      this.#gridEditor.pointerDown(event) ||
      this.#smartSelection.pointerDown(event)
    );
  }

  setSnapGuideLines(lines: readonly SnapGuideLine[]): void {
    this.#snapGuides.setLines(lines);
  }

  pointerMove(event: LeaferEventLike): boolean {
    this.#measurements.pointerMove(event);
    if (this.#autoLayoutSpacing.pointerMove(event)) return true;
    if (this.#gridEditor.pointerMove(event)) return true;
    return this.#smartSelection.pointerMove(event);
  }

  pointerUp(event: LeaferEventLike): boolean {
    return (
      this.#autoLayoutSpacing.pointerUp(event) ||
      this.#gridEditor.pointerUp(event) ||
      this.#smartSelection.pointerUp(event)
    );
  }

  syncViewport(viewport?: ViewportState): void {
    this.#staticOverlays.syncViewport();
    this.#autoLayoutSpacing.syncViewport();
    this.#gridEditor.syncViewport(viewport);
    this.#smartSelection.syncViewport();
    this.#snapGuides.syncViewport();
    this.#measurements.syncViewport();
  }
}
