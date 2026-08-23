import type {
  DesignDocument,
  ImageNode,
  Point,
  ViewportState,
} from "@opendesign/design-contracts";
import {
  documentToScreen,
  getWorldTransform,
  invertTransform,
  screenToDocument,
  transformPoint,
} from "@opendesign/editor-runtime";
import {
  createImageAreaSelection,
  type ImageAreaSelection,
} from "@opendesign/image-service";
import { Button, Icon } from "@opendesign/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { useI18n } from "../../../i18n";
import styles from "./ImageAreaSelectionOverlay.module.scss";

export type ImageAreaSelectionAction = "erase-object" | "isolate-object";

export function ImageAreaSelectionOverlay({
  document,
  node,
  sourceSize,
  viewport,
  onCancel,
  onSubmit,
}: {
  document: DesignDocument;
  node: ImageNode;
  sourceSize: { width: number; height: number };
  viewport: ViewportState;
  onCancel: () => void;
  onSubmit: (
    action: ImageAreaSelectionAction,
    selection: ImageAreaSelection,
  ) => void;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{
    localPoints: Point[];
    screenPoints: Point[];
  } | null>(null);
  const [selection, setSelection] = useState<ImageAreaSelection | null>(null);
  const world = useMemo(
    () => getWorldTransform(document, node.id),
    [document, node.id],
  );
  const worldInverse = useMemo(
    () => (world ? invertTransform(world) : null),
    [world],
  );
  const nodeScreenOutline = useMemo(() => {
    if (!world) return [];
    return [
      { x: 0, y: 0 },
      { x: node.size.width, y: 0 },
      { x: node.size.width, y: node.size.height },
      { x: 0, y: node.size.height },
    ].map((point) => documentToScreen(transformPoint(point, world), viewport));
  }, [node.size.height, node.size.width, viewport, world]);

  useEffect(() => root.current?.focus(), []);

  const localPoint = useCallback(
    (event: PointerEvent<HTMLDivElement>): Point | null => {
      if (!worldInverse) return null;
      const bounds = event.currentTarget.getBoundingClientRect();
      const documentPoint = screenToDocument(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        viewport,
      );
      const point = transformPoint(documentPoint, worldInverse);
      return {
        x: clamp(point.x, 0, node.size.width),
        y: clamp(point.y, 0, node.size.height),
      };
    },
    [node.size.height, node.size.width, viewport, worldInverse],
  );

  const screenPoint = (event: PointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const local = localPoint(event);
    if (!local) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelection(null);
    setDraft({ localPoints: [local], screenPoints: [screenPoint(event)] });
  };

  const extend = (event: PointerEvent<HTMLDivElement>) => {
    if (!draft || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    const local = localPoint(event);
    if (!local) return;
    const screen = screenPoint(event);
    const previous = draft.screenPoints.at(-1)!;
    if (Math.hypot(screen.x - previous.x, screen.y - previous.y) < 2) return;
    setDraft((current) =>
      current
        ? {
            localPoints: [...current.localPoints, local],
            screenPoints: [...current.screenPoints, screen],
          }
        : current,
    );
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (!draft || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    try {
      const next = createImageAreaSelection({
        placement: node.properties.placement,
        sourceSize,
        targetPoints: draft.localPoints,
        targetSize: node.size,
      });
      setSelection(next);
    } catch {
      setDraft(null);
      setSelection(null);
    }
  };

  const path = draft ? polygonPath(draft.screenPoints, selection !== null) : "";
  const outline = polygonPath(nodeScreenOutline, true);
  const toolbarPosition = toolbarPoint(draft?.screenPoints ?? [], root.current);

  return (
    <div
      aria-label={t("canvas.imageAreaSelection")}
      className={styles.root}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      onPointerDown={begin}
      onPointerMove={extend}
      onPointerCancel={() => {
        setDraft(null);
        setSelection(null);
      }}
      onPointerUp={finish}
      ref={root}
      role="application"
      tabIndex={0}
    >
      <svg aria-hidden="true" className={styles.overlay}>
        {outline && <path className={styles.imageOutline} d={outline} />}
        {path && <path className={styles.selection} d={path} />}
      </svg>
      {!draft && (
        <div className={styles.instruction} role="status">
          <Icon name="lucide:lasso-select" size={14} />
          <span>
            <strong>{t("canvas.imageAreaSelection")}</strong>
            <small>{t("canvas.imageAreaSelectionHint")}</small>
          </span>
          <Button onClick={onCancel} tone="quiet">
            {t("common.cancel")}
          </Button>
        </div>
      )}
      {selection && draft && (
        <div
          className={styles.toolbar}
          onPointerDown={(event) => event.stopPropagation()}
          style={{ left: toolbarPosition.x, top: toolbarPosition.y }}
        >
          <Button
            icon="lucide:eraser"
            onClick={() => onSubmit("erase-object", selection)}
          >
            {t("canvas.imageAreaErase")}
          </Button>
          <Button
            icon="lucide:scan-search"
            onClick={() => onSubmit("isolate-object", selection)}
          >
            {t("canvas.imageAreaIsolate")}
          </Button>
          <Button
            icon="lucide:rotate-ccw"
            onClick={() => {
              setDraft(null);
              setSelection(null);
            }}
            tone="quiet"
          >
            {t("canvas.imageAreaRedraw")}
          </Button>
          <Button onClick={onCancel} tone="quiet">
            {t("common.cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}

function polygonPath(points: readonly Point[], closed: boolean): string {
  if (points.length === 0) return "";
  return `${points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ")}${closed ? " Z" : ""}`;
}

function toolbarPoint(
  points: readonly Point[],
  element: HTMLDivElement | null,
): Point {
  if (points.length === 0) return { x: 12, y: 12 };
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: clamp(maxX + 10, 8, Math.max(8, (element?.clientWidth ?? 640) - 330)),
    y: clamp(maxY + 10, 8, Math.max(8, (element?.clientHeight ?? 480) - 38)),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
