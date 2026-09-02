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
import {
  collectRulerGuideSegments,
  guideOwnerKey,
  guidePlacementAtScreenPoint,
  guideSegmentForPlacement,
  resolveActiveGuideFrameId,
  rulerTicks,
  selectionRulerRanges,
  RULER_SIZE,
  type RulerGuideOwner,
  type RulerGuideEdit,
  type RulerGuideReference,
} from "../ruler-guides";
import styles from "./RulerGuides.module.scss";

interface DragState {
  activeFrameId?: string;
  axis: Guide["axis"];
  duplicate: boolean;
  expectedRevision: number;
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
  const xTicks = useMemo(() => rulerTicks("X", viewport), [viewport]);
  const yTicks = useMemo(() => rulerTicks("Y", viewport), [viewport]);

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
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    window.addEventListener("blur", cancel, { once: true });
    window.addEventListener("keydown", keyDown, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", keyDown, true);
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

  return (
    <div
      aria-label={t("canvas.rulersAndGuides")}
      className={styles.root}
      ref={root}
    >
      <svg aria-hidden="true" className={styles.rulers}>
        <rect
          className={styles.horizontalRuler}
          data-ruler-axis="Y"
          height={RULER_SIZE}
          onPointerDown={(event) => beginDrag("Y", event)}
          width="100%"
          x={RULER_SIZE}
          y={0}
        />
        <rect
          className={styles.verticalRuler}
          data-ruler-axis="X"
          height="100%"
          onPointerDown={(event) => beginDrag("X", event)}
          width={RULER_SIZE}
          x={0}
          y={RULER_SIZE}
        />
        <rect
          className={styles.corner}
          height={RULER_SIZE}
          width={RULER_SIZE}
        />
        {ranges && (
          <>
            <rect
              className={styles.selectionRange}
              height={RULER_SIZE}
              width={Math.max(0, ranges.x[1] - ranges.x[0])}
              x={ranges.x[0]}
              y={0}
            />
            <rect
              className={styles.selectionRange}
              height={Math.max(0, ranges.y[1] - ranges.y[0])}
              width={RULER_SIZE}
              x={0}
              y={ranges.y[0]}
            />
          </>
        )}
        {xTicks.map((tick) => (
          <g key={`x:${tick.value}`}>
            <line
              className={styles.tick}
              x1={tick.position}
              x2={tick.position}
              y1={tick.major ? 8 : 14}
              y2={RULER_SIZE}
            />
            {tick.major && (
              <text className={styles.tickLabel} x={tick.position + 3} y={8}>
                {formatOffset(tick.value)}
              </text>
            )}
          </g>
        ))}
        {yTicks.map((tick) => (
          <g key={`y:${tick.value}`}>
            <line
              className={styles.tick}
              x1={tick.major ? 8 : 14}
              x2={RULER_SIZE}
              y1={tick.position}
              y2={tick.position}
            />
            {tick.major && (
              <text
                className={styles.verticalTickLabel}
                transform={`translate(8 ${tick.position - 3}) rotate(-90)`}
              >
                {formatOffset(tick.value)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <svg className={styles.guides}>
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
