import type {
  DesignDocument,
  Guide,
  SelectionState,
  ViewportState,
} from "@opendesign/design-contracts";
import { ContextMenu, DropdownMenuItem } from "@opendesign/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useI18n } from "../../../i18n";
import { collectRulerGuideDistanceMeasurements } from "../ruler-guide-measurements";
import {
  collectRulerGuideSegments,
  guideOwnerKey,
  guidePlacementAtScreenPoint,
  guideSegmentForPlacement,
  resolveActiveGuideFrameId,
  selectionRulerRanges,
  RULER_SIZE,
  type RulerGuideOwner,
  type RulerGuideEdit,
  type RulerGuideReference,
} from "../ruler-guides";
import { RulerGuideMeasurements } from "./RulerGuideMeasurements";
import { RulerScale } from "./RulerScale";
import styles from "./RulerGuides.module.scss";

interface DragState {
  activeFrameId?: string;
  axis: Guide["axis"];
  duplicate: boolean;
  expectedRevision: number;
  measure: boolean;
  point: { x: number; y: number };
  source?: RulerGuideReference;
}

export function RulerGuides({
  document,
  onEdit,
  onFocusCanvas,
  pageId,
  selection,
  viewport,
}: {
  document: DesignDocument;
  onEdit: (edit: RulerGuideEdit) => boolean;
  onFocusCanvas: () => void;
  pageId: string;
  selection: SelectionState;
  viewport: ViewportState;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedGuide, setSelectedGuide] = useState<{
    key: string;
    revision: number;
  } | null>(null);
  const selectedKey =
    selectedGuide?.revision === document.revision ? selectedGuide.key : null;
  const activeFrameId = resolveActiveGuideFrameId(document, selection);
  const ranges = selectionRulerRanges(document, selection, viewport);
  const segments = useMemo(
    () => collectRulerGuideSegments(document, pageId, viewport),
    [document, pageId, viewport],
  );

  const localPoint = useCallback((clientX: number, clientY: number) => {
    const bounds = root.current?.getBoundingClientRect();
    return bounds
      ? { x: clientX - bounds.left, y: clientY - bounds.top }
      : { x: clientX, y: clientY };
  }, []);

  const removeGuide = useCallback(
    (source: RulerGuideReference) => {
      onEdit({
        duplicate: false,
        expectedRevision: document.revision,
        source: toReference(source),
      });
      setSelectedGuide(null);
      onFocusCanvas();
    },
    [document.revision, onEdit, onFocusCanvas],
  );

  const finishDrag = useCallback(
    (state: DragState) => {
      const remove =
        state.axis === "X"
          ? state.point.x <= RULER_SIZE
          : state.point.y <= RULER_SIZE;
      if (remove) {
        if (state.source && !state.duplicate) {
          onEdit({
            duplicate: false,
            expectedRevision: state.expectedRevision,
            source: state.source,
          });
          setSelectedGuide(null);
        }
        return;
      }
      const target = guidePlacementAtScreenPoint(
        document,
        pageId,
        viewport,
        state.axis,
        state.point,
        state.activeFrameId,
      );
      if (
        state.source &&
        !state.duplicate &&
        guideOwnerKey(state.source.owner) === guideOwnerKey(target.owner) &&
        state.source.guide.axis === target.guide.axis &&
        Math.abs(state.source.guide.offset - target.guide.offset) < 0.000_001
      ) {
        return;
      }
      const committed = onEdit({
        duplicate: state.duplicate,
        expectedRevision: state.expectedRevision,
        ...(state.source ? { source: state.source } : {}),
        target,
      });
      if (!committed) return;
      const sameOwner =
        state.source &&
        guideOwnerKey(state.source.owner) === guideOwnerKey(target.owner);
      const index =
        sameOwner && !state.duplicate && state.source
          ? state.source.index
          : guideCount(document, target.owner);
      setSelectedGuide({
        key: `${guideOwnerKey(target.owner)}:${index}`,
        revision: document.revision,
      });
    },
    [document, onEdit, pageId, viewport],
  );

  const dragActive = drag !== null;
  useEffect(() => {
    if (!dragActive) return;
    const move = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const next = {
        ...current,
        duplicate: current.source ? event.altKey : false,
        measure: event.altKey,
        point: localPoint(event.clientX, event.clientY),
      };
      dragRef.current = next;
      setDrag(next);
    };
    const up = (event: PointerEvent) => {
      const current = dragRef.current;
      if (current) {
        finishDrag({
          ...current,
          duplicate: current.source ? event.altKey : false,
          measure: event.altKey,
          point: localPoint(event.clientX, event.clientY),
        });
      }
      dragRef.current = null;
      setDrag(null);
      onFocusCanvas();
    };
    const cancel = () => {
      dragRef.current = null;
      setDrag(null);
      onFocusCanvas();
    };
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key === "Alt") updateDragModifier(true);
    };
    const keyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Alt") updateDragModifier(false);
    };
    const updateDragModifier = (altKey: boolean) => {
      const current = dragRef.current;
      if (!current) return;
      const next = {
        ...current,
        duplicate: current.source ? altKey : false,
        measure: altKey,
      };
      dragRef.current = next;
      setDrag(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    window.addEventListener("blur", cancel, { once: true });
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
    };
  }, [dragActive, finishDrag, localPoint, onFocusCanvas]);

  useEffect(() => {
    if (!selectedKey) return;
    const pointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        !target.closest("[data-ruler-guide]")
      ) {
        setSelectedGuide(null);
      }
    };
    window.addEventListener("pointerdown", pointerDown, true);
    return () => window.removeEventListener("pointerdown", pointerDown, true);
  }, [selectedKey]);

  useEffect(() => {
    const selected = segments.find(({ key }) => key === selectedKey);
    if (!selected) return;
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (
        (event.key !== "Delete" && event.key !== "Backspace") ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      removeGuide(selected);
    };
    window.addEventListener("keydown", keyDown, true);
    return () => window.removeEventListener("keydown", keyDown, true);
  }, [removeGuide, segments, selectedKey]);

  const beginDrag = (
    axis: Guide["axis"],
    event: ReactPointerEvent<SVGElement>,
    source?: RulerGuideReference & { locked?: boolean },
  ) => {
    if (event.button !== 0 || source?.locked) return;
    event.preventDefault();
    event.stopPropagation();
    if (source) {
      setSelectedGuide({
        key: referenceKey(source),
        revision: document.revision,
      });
    }
    const next: DragState = {
      ...(source?.owner.type === "frame"
        ? { activeFrameId: source.owner.frameId }
        : activeFrameId
          ? { activeFrameId }
          : {}),
      axis,
      duplicate: source ? event.altKey : false,
      expectedRevision: document.revision,
      measure: event.altKey,
      point: localPoint(event.clientX, event.clientY),
      ...(source ? { source: toReference(source) } : {}),
    };
    dragRef.current = next;
    setDrag(next);
  };

  const draft = drag
    ? guidePlacementAtScreenPoint(
        document,
        pageId,
        viewport,
        drag.axis,
        drag.point,
        drag.activeFrameId,
      )
    : null;
  const draftSegment = draft
    ? guideSegmentForPlacement(document, draft.owner, draft.guide, viewport)
    : null;
  const measurements =
    drag?.measure && draft
      ? collectRulerGuideDistanceMeasurements(
          document,
          pageId,
          selection,
          draft,
          drag.point,
          viewport,
        )
      : [];

  return (
    <div
      aria-label={t("canvas.rulersAndGuides")}
      className={styles.root}
      ref={root}
    >
      <RulerScale
        onPointerDown={(axis, event) => beginDrag(axis, event)}
        ranges={ranges}
        viewport={viewport}
      />
      <svg className={styles.guides}>
        <RulerGuideMeasurements
          measurements={measurements}
          viewport={viewport}
        />
        {segments.map((segment) => {
          const selected = selectedKey === segment.key;
          const label = t("canvas.rulerGuideLabel", {
            axis: segment.guide.axis,
            offset: formatOffset(segment.guide.offset),
          });
          return (
            <g key={segment.key}>
              <ContextMenu
                disabled={segment.locked}
                onOpenChange={(open) => {
                  if (open) {
                    setSelectedGuide({
                      key: segment.key,
                      revision: document.revision,
                    });
                  }
                }}
                trigger={
                  <line
                    aria-disabled={segment.locked}
                    aria-label={label}
                    className={styles.guideHitTarget}
                    data-locked={segment.locked}
                    data-ruler-guide=""
                    onKeyDown={(event) =>
                      handleGuideKeyDown(event, segment, removeGuide)
                    }
                    onPointerDown={(event) =>
                      beginDrag(segment.guide.axis, event, segment)
                    }
                    role="button"
                    tabIndex={segment.locked ? -1 : 0}
                    x1={segment.start.x}
                    x2={segment.end.x}
                    y1={segment.start.y}
                    y2={segment.end.y}
                  />
                }
              >
                <DropdownMenuItem onSelect={() => removeGuide(segment)}>
                  {t("canvas.removeGuide")}
                </DropdownMenuItem>
              </ContextMenu>
              <line
                className={selected ? styles.selectedGuide : styles.guide}
                x1={segment.start.x}
                x2={segment.end.x}
                y1={segment.start.y}
                y2={segment.end.y}
              />
            </g>
          );
        })}
        {draftSegment && (
          <line
            className={styles.draftGuide}
            x1={draftSegment.start.x}
            x2={draftSegment.end.x}
            y1={draftSegment.start.y}
            y2={draftSegment.end.y}
          />
        )}
      </svg>
      {draft && (
        <output
          className={styles.value}
          style={{
            left: clampOverlayPosition(
              drag!.point.x + 8,
              24,
              viewport.width - 64,
            ),
            top: clampOverlayPosition(
              drag!.point.y + 8,
              24,
              viewport.height - 28,
            ),
          }}
        >
          {formatOffset(draft.guide.offset)}
        </output>
      )}
    </div>
  );
}

function handleGuideKeyDown(
  event: KeyboardEvent<SVGLineElement>,
  guide: RulerGuideReference,
  remove: (guide: RulerGuideReference) => void,
) {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  event.preventDefault();
  event.stopPropagation();
  remove(guide);
}

function referenceKey(reference: RulerGuideReference): string {
  return `${guideOwnerKey(reference.owner)}:${reference.index}`;
}

function toReference(reference: RulerGuideReference): RulerGuideReference {
  return {
    guide: reference.guide,
    index: reference.index,
    owner: reference.owner,
  };
}

function formatOffset(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function guideCount(document: DesignDocument, owner: RulerGuideOwner): number {
  if (owner.type === "page") {
    return document.pagesById[owner.pageId]?.guides?.length ?? 0;
  }
  const frame = document.nodesById[owner.frameId];
  return frame?.kind === "frame" ? (frame.properties.guides?.length ?? 0) : 0;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

function clampOverlayPosition(
  value: number,
  preferredMinimum: number,
  maximum: number,
): number {
  const upper = Math.max(4, maximum);
  return Math.min(Math.max(value, Math.min(preferredMinimum, upper)), upper);
}
