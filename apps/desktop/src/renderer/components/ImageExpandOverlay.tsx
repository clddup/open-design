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
  createImageExpandSession,
  imageExpansionIsEmpty,
  resizeImageExpand,
  setImageExpandAspectRatio,
  type ImageExpandHandle,
  type ImageExpandSession,
  type ImageExpansionInsets,
} from "@opendesign/image-service";
import { Button, Icon } from "@opendesign/ui";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useI18n } from "../i18n";
import styles from "./ImageExpandOverlay.module.scss";

const handles: readonly ImageExpandHandle[] = [
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
];

const aspectRatios = [
  { value: "free", ratio: null },
  { value: "1:1", ratio: 1 },
  { value: "4:3", ratio: 4 / 3 },
  { value: "3:2", ratio: 3 / 2 },
  { value: "16:9", ratio: 16 / 9 },
] as const;

export function ImageExpandOverlay({
  document,
  node,
  viewport,
  onCancel,
  onSubmit,
}: {
  document: DesignDocument;
  node: ImageNode;
  viewport: ViewportState;
  onCancel: () => void;
  onSubmit: (expansion: ImageExpansionInsets) => void;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<ImageExpandSession>(() =>
    createImageExpandSession(node.size),
  );
  const [activeHandle, setActiveHandle] = useState<ImageExpandHandle | null>(
    null,
  );
  const [aspect, setAspect] = useState("free");
  const world = useMemo(
    () => getWorldTransform(document, node.id),
    [document, node.id],
  );
  const worldInverse = useMemo(
    () => (world ? invertTransform(world) : null),
    [world],
  );
  const expandedBounds = {
    x: -session.expansion.left,
    y: -session.expansion.top,
    width: session.expansion.left + node.size.width + session.expansion.right,
    height: session.expansion.top + node.size.height + session.expansion.bottom,
  };
  const screenPointForLocal = (point: Point): Point =>
    world
      ? documentToScreen(transformPoint(point, world), viewport)
      : { x: 0, y: 0 };
  const originalOutline = polygonPath(
    [
      { x: 0, y: 0 },
      { x: node.size.width, y: 0 },
      { x: node.size.width, y: node.size.height },
      { x: 0, y: node.size.height },
    ].map(screenPointForLocal),
  );
  const expandedOutline = polygonPath(
    [
      { x: expandedBounds.x, y: expandedBounds.y },
      {
        x: expandedBounds.x + expandedBounds.width,
        y: expandedBounds.y,
      },
      {
        x: expandedBounds.x + expandedBounds.width,
        y: expandedBounds.y + expandedBounds.height,
      },
      {
        x: expandedBounds.x,
        y: expandedBounds.y + expandedBounds.height,
      },
    ].map(screenPointForLocal),
  );
  const canSubmit = !imageExpansionIsEmpty(session.expansion);

  useEffect(() => root.current?.focus(), []);

  const localPoint = (event: PointerEvent<HTMLDivElement>): Point | null => {
    if (!worldInverse) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return transformPoint(
      screenToDocument(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        viewport,
      ),
      worldInverse,
    );
  };

  return (
    <div
      aria-label={t("canvas.imageExpand")}
      className={styles.root}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (event.key === "Enter" && canSubmit) {
          event.preventDefault();
          event.stopPropagation();
          onSubmit({ ...session.expansion });
        }
      }}
      onPointerDown={(event) => {
        const handle =
          event.target instanceof HTMLElement
            ? (event.target.dataset.expandHandle as
                ImageExpandHandle | undefined)
            : undefined;
        if (event.button !== 0 || !handle || !handles.includes(handle)) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setActiveHandle(handle);
        setAspect("free");
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (
          !activeHandle ||
          !event.currentTarget.hasPointerCapture(event.pointerId)
        ) {
          return;
        }
        const point = localPoint(event);
        if (!point) return;
        try {
          setSession((current) =>
            resizeImageExpand(current, activeHandle, point),
          );
        } catch {
          // Keep the last valid geometry when the provider aspect limit is hit.
        }
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setActiveHandle(null);
      }}
      onPointerCancel={() => setActiveHandle(null)}
      ref={root}
      role="application"
      tabIndex={0}
    >
      <svg aria-hidden="true" className={styles.overlay}>
        <path
          className={styles.expansionArea}
          d={`${expandedOutline} ${originalOutline}`}
          fillRule="evenodd"
        />
        <path className={styles.originalOutline} d={originalOutline} />
        <path className={styles.expandedOutline} d={expandedOutline} />
      </svg>
      {handles.map((handle) => {
        const point = screenPointForLocal(handlePoint(handle, expandedBounds));
        return (
          <button
            aria-label={t("canvas.imageExpandHandle", { edge: handle })}
            className={`${styles.handle} ${styles[handle.replace("-", "")] ?? ""}`}
            data-expand-handle={handle}
            key={handle}
            style={{ left: point.x, top: point.y }}
            type="button"
          />
        );
      })}
      <div
        className={styles.toolbar}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Icon name="lucide:scan" size={14} />
        <strong>{t("canvas.imageExpand")}</strong>
        <label>
          <span>{t("canvas.imageExpandAspect")}</span>
          <select
            aria-label={t("canvas.imageExpandAspect")}
            onChange={(event) => {
              const value = event.target.value;
              setAspect(value);
              const preset = aspectRatios.find(
                (candidate) => candidate.value === value,
              );
              if (preset && preset.ratio !== null) {
                setSession((current) =>
                  setImageExpandAspectRatio(current, preset.ratio),
                );
              }
            }}
            value={aspect}
          >
            {aspectRatios.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.value === "free"
                  ? t("canvas.imageExpandFree")
                  : preset.value}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={onCancel} tone="quiet">
          {t("common.cancel")}
        </Button>
        <Button
          disabled={!canSubmit}
          icon="lucide:sparkles"
          onClick={() => onSubmit({ ...session.expansion })}
        >
          {t("canvas.imageExpandApply")}
        </Button>
      </div>
    </div>
  );
}

function handlePoint(
  handle: ImageExpandHandle,
  bounds: { x: number; y: number; width: number; height: number },
): Point {
  const left = bounds.x;
  const centerX = bounds.x + bounds.width / 2;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const centerY = bounds.y + bounds.height / 2;
  const bottom = bounds.y + bounds.height;
  switch (handle) {
    case "top-left":
      return { x: left, y: top };
    case "top":
      return { x: centerX, y: top };
    case "top-right":
      return { x: right, y: top };
    case "right":
      return { x: right, y: centerY };
    case "bottom-right":
      return { x: right, y: bottom };
    case "bottom":
      return { x: centerX, y: bottom };
    case "bottom-left":
      return { x: left, y: bottom };
    case "left":
      return { x: left, y: centerY };
  }
}

function polygonPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  return `${points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ")} Z`;
}
