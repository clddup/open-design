import type {
  DesignDocument,
  DesignNode,
  RelativePoint,
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
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import styles from "./RotationOriginOverlay.module.scss";

const DEFAULT_ORIGIN: RelativePoint = { x: 0.5, y: 0.5 };

export function RotationOriginOverlay({
  document,
  label,
  node,
  onCommit,
  viewport,
}: {
  document: DesignDocument;
  label: string;
  node: DesignNode;
  onCommit: (origin: RelativePoint | null) => void;
  viewport: ViewportState;
}) {
  const dragging = useRef(false);
  const current = useRef(node.rotationOrigin ?? DEFAULT_ORIGIN);
  const [draft, setDraft] = useState(current.current);
  useEffect(() => {
    if (dragging.current) return;
    current.current = node.rotationOrigin ?? DEFAULT_ORIGIN;
    setDraft(current.current);
  }, [node.rotationOrigin]);
  const point = rotationOriginScreenPoint(document, node, draft, viewport);
  if (!point) return null;
  const style = {
    "--rotation-origin-x": `${point.x}px`,
    "--rotation-origin-y": `${point.y}px`,
  } as CSSProperties;

  const updateFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    const next = rotationOriginFromScreenPoint(
      document,
      node,
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      viewport,
    );
    if (!next) return;
    current.current = next;
    setDraft(next);
  };

  return (
    <button
      aria-label={label}
      className={styles.handle}
      onPointerCancel={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        current.current = node.rotationOrigin ?? DEFAULT_ORIGIN;
        setDraft(current.current);
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        updateFromPointer(event);
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        const next = current.current;
        onCommit(next.x === 0.5 && next.y === 0.5 ? null : next);
      }}
      style={style}
      type="button"
    />
  );
}

export function rotationOriginScreenPoint(
  document: DesignDocument,
  node: DesignNode,
  origin: RelativePoint,
  viewport: ViewportState,
): Point | null {
  const world = getWorldTransform(document, node.id);
  if (!world) return null;
  return documentToScreen(
    transformPoint(
      { x: node.size.width * origin.x, y: node.size.height * origin.y },
      world,
    ),
    viewport,
  );
}

export function rotationOriginFromScreenPoint(
  document: DesignDocument,
  node: DesignNode,
  point: Point,
  viewport: ViewportState,
): RelativePoint | null {
  if (node.size.width <= 0 || node.size.height <= 0) return null;
  const world = getWorldTransform(document, node.id);
  const inverse = world ? invertTransform(world) : null;
  if (!inverse) return null;
  const local = transformPoint(screenToDocument(point, viewport), inverse);
  return {
    x: local.x / node.size.width,
    y: local.y / node.size.height,
  };
}
