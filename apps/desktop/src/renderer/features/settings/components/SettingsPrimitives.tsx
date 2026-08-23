import type { ReactNode } from "react";
import styles from "../SettingsFeature.module.scss";

export function SettingsHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className={styles.heading}>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

export function SettingsRow({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) {
  return (
    <section className={styles.row}>
      <div>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </div>
      {children}
    </section>
  );
}

export function SegmentedControl<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: ReadonlyArray<{ value: Value; label: string }>;
  value: Value;
}) {
  return (
    <div aria-label={label} className={styles.segmented} role="group">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
