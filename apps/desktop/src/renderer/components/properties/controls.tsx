import { Glyph } from "@opendesign/ui";
import {
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import styles from "../PropertiesPanel.module.scss";

export function cx(
  ...classNames: Array<string | false | null | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}

export function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function Field({
  label,
  accessibleLabel = label,
  value,
  suffix,
  min,
  max,
  disabled = false,
  placeholder,
  type = "number",
  onCommit,
}: {
  label: string;
  accessibleLabel?: string;
  value: string;
  suffix?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  type?: "number" | "text";
  onCommit: (draft: string) => string | null;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft === value) return;
    setDraft(onCommit(draft) ?? value);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  return (
    <label className={cx(styles.field, disabled && styles.fieldDisabled)}>
      <span>{label}</span>
      <span className={styles.fieldControl}>
        <input
          aria-label={accessibleLabel}
          disabled={disabled}
          inputMode={type === "number" ? "decimal" : undefined}
          max={max}
          min={min}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          type={type}
          value={draft}
        />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className={styles.textarea}>
      <span>{label}</span>
      <textarea
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        value={draft}
      />
    </label>
  );
}

export function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <input
      aria-label={label}
      className={styles.colorPicker}
      onChange={(event) => onChange(event.target.value)}
      type="color"
      value={isHexColor(value) ? value : "#000000"}
    />
  );
}

export function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className={styles.section}>
      <header>
        <button
          aria-controls={contentId}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <Glyph name={open ? "chevron-down" : "chevron-right"} size={13} />
          {title}
        </button>
      </header>
      <div
        className={open ? styles.sectionBody : styles.sectionBodyCollapsed}
        id={contentId}
      >
        {children}
      </div>
    </section>
  );
}

export function commitNumber(
  draft: string,
  current: number,
  update: (value: number) => void,
  bounds: { min?: number; max?: number; integer?: boolean } = {},
): string | null {
  const normalized = draft.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (bounds.integer && !Number.isInteger(parsed)) return null;

  const next = Math.min(
    bounds.max ?? Number.POSITIVE_INFINITY,
    Math.max(bounds.min ?? Number.NEGATIVE_INFINITY, parsed),
  );
  if (next !== current) update(next);
  return formatNumber(next);
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isHexColor(value: string): boolean {
  return /^#[\da-f]{6}$/i.test(value);
}
