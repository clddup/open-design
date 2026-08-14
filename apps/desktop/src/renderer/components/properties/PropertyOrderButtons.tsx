import styles from "./PropertyOrderButtons.module.scss";

export function PropertyOrderButtons({
  downDisabled,
  downLabel,
  onDown,
  onUp,
  upDisabled,
  upLabel,
}: {
  downDisabled: boolean;
  downLabel: string;
  onDown: () => void;
  onUp: () => void;
  upDisabled: boolean;
  upLabel: string;
}) {
  return (
    <span className={styles.orderButtons}>
      <button
        aria-label={upLabel}
        disabled={upDisabled}
        onClick={onUp}
        type="button"
      >
        ↑
      </button>
      <button
        aria-label={downLabel}
        disabled={downDisabled}
        onClick={onDown}
        type="button"
      >
        ↓
      </button>
    </span>
  );
}

export function moveOrderedItem<T>(
  values: readonly T[],
  index: number,
  delta: -1 | 1,
): T[] {
  const next = [...values];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  const [value] = next.splice(index, 1);
  if (value !== undefined) next.splice(target, 0, value);
  return next;
}
