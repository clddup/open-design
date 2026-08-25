import {
  autoLayoutSpacingChangeFromInput,
  type LeaferAutoLayoutSpacingChange,
  type LeaferAutoLayoutSpacingInputRequest,
} from "@opendesign/leafer-engine";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import styles from "./AutoLayoutSpacingInput.module.scss";

export type CanvasAutoLayoutSpacingInput =
  LeaferAutoLayoutSpacingInputRequest & {
    canvasPoint: { x: number; y: number };
  };

export function AutoLayoutSpacingInput({
  label,
  onClose,
  onCommit,
  request,
}: {
  label: string;
  onClose: () => void;
  onCommit: (change: LeaferAutoLayoutSpacingChange) => boolean;
  request: CanvasAutoLayoutSpacingInput;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(String(request.value));

  useLayoutEffect(() => {
    setValue(String(request.value));
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [request]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const numeric = Number(value);
    const change = autoLayoutSpacingChangeFromInput(request, numeric);
    if (!change) return;
    if (onCommit(change)) onClose();
  };
  const stopPointer = (event: PointerEvent) => event.stopPropagation();
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <form
      aria-label={label}
      className={styles.root}
      onPointerDown={stopPointer}
      onSubmit={submit}
      style={
        {
          "--spacing-input-x": `${request.canvasPoint.x}px`,
          "--spacing-input-y": `${request.canvasPoint.y}px`,
        } as CSSProperties
      }
    >
      <input
        aria-label={label}
        inputMode="decimal"
        max={1_000_000}
        min={0}
        onBlur={onClose}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        ref={inputRef}
        step={1}
        type="number"
        value={value}
      />
    </form>
  );
}
