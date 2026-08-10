import type {
  ButtonHTMLAttributes,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useCallback, useRef } from "react";
import { Tooltip } from "./overlays";

export type GlyphName =
  | "agent"
  | "align-center"
  | "assets"
  | "chevron-down"
  | "chevron-right"
  | "close"
  | "comment"
  | "duplicate"
  | "ellipse"
  | "eye"
  | "eye-off"
  | "file"
  | "frame"
  | "image"
  | "layers"
  | "lock"
  | "unlock"
  | "maximize"
  | "minimize"
  | "moon"
  | "more"
  | "pen"
  | "paperclip"
  | "play"
  | "plus"
  | "rectangle"
  | "redo"
  | "search"
  | "select"
  | "settings"
  | "spark"
  | "stop"
  | "sun"
  | "text"
  | "trash"
  | "undo";

const paths: Record<GlyphName, ReactNode> = {
  agent: (
    <>
      <path d="M8 3.5h8M8 20.5h8M4.5 8v8M19.5 8v8" />
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9.5 11.5h.01M14.5 11.5h.01M9.5 15h5" />
    </>
  ),
  "align-center": (
    <>
      <path d="M4 6h16M7 10h10M5 14h14M8 18h8" />
    </>
  ),
  assets: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <path d="m16.5 13 3.5 7h-7z" />
    </>
  ),
  "chevron-down": <path d="m7 9 5 5 5-5" />,
  "chevron-right": <path d="m9 7 5 5-5 5" />,
  close: <path d="m7 7 10 10M17 7 7 17" />,
  comment: (
    <path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z" />
  ),
  duplicate: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6.5" />,
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  "eye-off": (
    <>
      <path d="m4 4 16 16M10.5 6.2A9 9 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.2 2.8M6.2 7.2A16 16 0 0 0 2.5 12s3.5 6 9.5 6a9 9 0 0 0 2-.2" />
    </>
  ),
  file: (
    <>
      <path d="M6 3.5h8l4 4V20H6z" />
      <path d="M14 3.5V8h4M9 12h6M9 15.5h6" />
    </>
  ),
  frame: (
    <>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m5.5 17 4.2-4.2 3 3 2.2-2.2 3.6 3.4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m4 12 8 4.5 8-4.5M4 16l8 4.5 8-4.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 7.4-2.1M12 14v2" />
    </>
  ),
  maximize: <rect x="6" y="6" width="12" height="12" rx="1" />,
  minimize: <path d="M6 12h12" />,
  moon: <path d="M20 15.3A8 8 0 0 1 8.7 4 8.2 8.2 0 1 0 20 15.3Z" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  pen: (
    <>
      <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10zM14 7l3 3" />
      <path d="M12 20h8" />
    </>
  ),
  paperclip: (
    <path d="m8.5 12.5 6.2-6.2a3 3 0 0 1 4.2 4.2l-8.5 8.5a5 5 0 0 1-7.1-7.1l8.2-8.2M6.2 14.8l8.1-8.1a1.5 1.5 0 0 1 2.1 2.1l-8.1 8.1" />
  ),
  play: <path d="m9 7 8 5-8 5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  redo: (
    <>
      <path d="m15 7 5 5-5 5" />
      <path d="M19 12h-8a6 6 0 0 0-6 6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  select: <path d="m5 3 13 9-6 1.5-3 5.5z" />,
  settings: (
    <>
      <path d="M4 6h5M15 6h5M4 12h10M18 12h2M4 18h2M10 18h10" />
      <circle cx="12" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9z" />
      <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  text: <path d="M5 5h14M12 5v14M8 19h8" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </>
  ),
  undo: (
    <>
      <path d="m9 7-5 5 5 5" />
      <path d="M5 12h8a6 6 0 0 1 6 6" />
    </>
  ),
};

export function Glyph({ name, size = 16 }: { name: GlyphName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="ui-glyph"
      data-glyph={name}
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: GlyphName;
  selected?: boolean;
};

export function IconButton({
  label,
  icon,
  selected,
  className = "",
  ...props
}: IconButtonProps) {
  const button = (
    <button
      aria-label={label}
      aria-pressed={selected}
      className={`ui-icon-button ${className}`}
      type="button"
      {...props}
    >
      <Glyph name={icon} />
    </button>
  );

  return (
    <Tooltip content={label}>
      {props.disabled ? (
        <span className="ui-disabled-tooltip-trigger">{button}</span>
      ) : (
        button
      )}
    </Tooltip>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: GlyphName;
  tone?: "default" | "primary" | "quiet";
};

export function Button({
  children,
  icon,
  tone = "default",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`ui-button ui-button--${tone} ${className}`}
      type="button"
      {...props}
    >
      {icon && <Glyph name={icon} />}
      <span>{children}</span>
    </button>
  );
}

export function Divider({
  orientation = "vertical",
}: {
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <span
      aria-hidden="true"
      className={`ui-divider ui-divider--${orientation}`}
    />
  );
}

type ResizeHandleProps = {
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
