import type { RelativePoint } from "@opendesign/design-contracts";
import { IconButton } from "@opendesign/ui";
import { useI18n } from "../../../../i18n";
import styles from "./RotationOriginControl.module.scss";

export function RotationOriginControl({
  disabled,
  editing,
  origin,
  onChange,
  onToggleEditing,
}: {
  disabled: boolean;
  editing: boolean;
  origin?: RelativePoint;
  onChange: (origin: RelativePoint | null) => void;
  onToggleEditing: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.root}>
      <span className={styles.label}>{t("properties.rotationOrigin")}</span>
      <div className={styles.controls}>
        <IconButton
          disabled={disabled}
          icon="lucide:crosshair"
          label={t("properties.editRotationOrigin")}
          onClick={onToggleEditing}
          selected={editing}
        />
        <IconButton
          disabled={disabled || origin === undefined}
          icon="lucide:rotate-ccw"
          label={t("properties.resetRotationOrigin")}
          onClick={() => onChange(null)}
        />
      </div>
    </div>
  );
}
