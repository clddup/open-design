import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useRef } from "react";

export type ResizeHandleProps = {
  label: string;
  orientation: "horizontal" | "vertical";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  invert?: boolean;
};

export function ResizeHandle({
  label,
  orientation,
  value,
  min,
  max,
  onChange,
  invert = false,
}: ResizeHandleProps) {
  const start = useRef({ coordinate: 0, value });
  const coordinate = useCallback(
    (event: PointerEvent | ReactPointerEvent) =>
      orientation === "vertical" ? event.clientX : event.clientY,
    [orientation],
  );
  const clamp = useCallback(
    (next: number) => Math.min(max, Math.max(min, next)),
    [max, min],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { coordinate: coordinate(event), value };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const delta =
      (coordinate(event) - start.current.coordinate) * (invert ? -1 : 1);
    onChange(clamp(start.current.value + delta));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 24 : 8;
    const decrease =
      orientation === "vertical"
        ? event.key === "ArrowLeft"
        : event.key === "ArrowUp";
    const increase =
      orientation === "vertical"
        ? event.key === "ArrowRight"
        : event.key === "ArrowDown";
    if (!decrease && !increase) return;
    event.preventDefault();
    const direction = decrease ? -1 : 1;
    onChange(clamp(value + direction * step * (invert ? -1 : 1)));
  };
  const style = { "--resize-value": value } as CSSProperties;
  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(value)}
      className={`ui-resize-handle ui-resize-handle--${orientation}`}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      role="separator"
      style={style}
      tabIndex={0}
    />
  );
}
