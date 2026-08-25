import {
  MAX_GRID_TRACK_VALUE,
  type GridTrack,
} from "@opendesign/design-contracts";
import type { LeaferGridTrackInputRequest } from "@opendesign/leafer-engine";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import styles from "./GridTrackInput.module.scss";

export type CanvasGridTrackInput = LeaferGridTrackInputRequest & {
  canvasPoint: { x: number; y: number };
};

export function GridTrackInput({
  fixedLabel,
  fillLabel,
  hugLabel,
  label,
  mixedLabel,
  onClose,
  onCommit,
  request,
}: {
  fixedLabel: string;
  fillLabel: string;
  hugLabel: string;
  label: string;
  mixedLabel: string;
  onClose: () => void;
  onCommit: (track: GridTrack) => boolean;
  request: CanvasGridTrackInput;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [type, setType] = useState<GridTrack["type"] | "">(() =>
    commonTrackType(request),
  );
  const [value, setValue] = useState(() =>
    initialValue(request, commonTrackType(request)),
  );

  useLayoutEffect(() => {
    const nextType = commonTrackType(request);
    setType(nextType);
    setValue(initialValue(request, nextType));
    const target =
      nextType === "" || nextType === "hug"
        ? selectRef.current
        : inputRef.current;
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
  }, [request]);

  useLayoutEffect(() => {
    if (type === "" || type === "hug") selectRef.current?.focus();
    else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [type]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const track = trackFromInput(type, value);
    if (!track) return;
    if (onCommit(track)) onClose();
  };
  const stopPointer = (event: PointerEvent) => event.stopPropagation();
  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (
      event.key === "Enter" &&
      event.currentTarget instanceof HTMLSelectElement
    ) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  };
  const handleBlur = (event: FocusEvent<HTMLFormElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    onClose();
  };

  return (
    <form
      aria-label={label}
      className={styles.root}
      onBlur={handleBlur}
      onPointerDown={stopPointer}
      onSubmit={submit}
      ref={formRef}
      style={
        {
          "--grid-track-input-x": `${request.canvasPoint.x}px`,
          "--grid-track-input-y": `${request.canvasPoint.y}px`,
        } as CSSProperties
      }
    >
      <select
        aria-label={label}
        onChange={(event) => {
          const nextType = event.target.value as GridTrack["type"];
          setType(nextType);
          setValue(initialValue(request, nextType));
        }}
        onKeyDown={handleKeyDown}
        ref={selectRef}
        value={type}
      >
        <option disabled value="">
          {mixedLabel}
        </option>
        <option value="fixed">{fixedLabel}</option>
        <option value="fill">{fillLabel}</option>
        <option value="hug">{hugLabel}</option>
      </select>
      {type !== "" && type !== "hug" && (
        <label>
          <input
            aria-label={`${label} ${type === "fill" ? "fr" : "px"}`}
            inputMode="decimal"
            max={MAX_GRID_TRACK_VALUE}
            min={type === "fill" ? Number.EPSILON : 0}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            ref={inputRef}
            required
            step="any"
            type="number"
            value={value}
          />
          <span>{type === "fill" ? "fr" : "px"}</span>
        </label>
      )}
    </form>
  );
}

function initialValue(
  request: LeaferGridTrackInputRequest,
  type: GridTrack["type"] | "",
): string {
  if (type === "" || type === "hug") return "";
  const first = request.tracks[0];
  if (!first) return "";
  const values = request.tracks.map((item) =>
    item.track.type === type ? item.track.value : null,
  );
  const firstValue = values[0];
  if (firstValue !== null && values.every((value) => value === firstValue)) {
    return String(firstValue);
  }
  if (type === "fill") return "1";
  if (request.tracks.length === 1)
    return String(Math.round(first.resolvedSize));
  return "";
}

function commonTrackType(
  request: LeaferGridTrackInputRequest,
): GridTrack["type"] | "" {
  const first = request.tracks[0]?.track.type;
  return first && request.tracks.every((item) => item.track.type === first)
    ? first
    : "";
}

function trackFromInput(
  type: GridTrack["type"] | "",
  value: string,
): GridTrack | null {
  if (type === "") return null;
  if (type === "hug") return { type };
  const numeric = Number(value);
  if (
    !Number.isFinite(numeric) ||
    numeric < 0 ||
    numeric > MAX_GRID_TRACK_VALUE ||
    (type === "fill" && numeric <= 0)
  ) {
    return null;
  }
  return { type, value: numeric };
}
