import {
  VECTOR_ERASER_MAX_WEIGHT,
  VECTOR_ERASER_MIN_WEIGHT,
  type VectorEraserSettings,
} from "@/renderer/features/canvas";
import { useI18n } from "../../../../i18n";
import styles from "../PropertiesPanel.module.scss";
import { Field, Section, commitNumber, formatNumber } from "./controls";

export function VectorEraserSection({
  onChange,
  settings,
}: {
  onChange: (settings: VectorEraserSettings) => void;
  settings: VectorEraserSettings;
}) {
  const { t } = useI18n();
  return (
    <Section title={t("properties.vectorEraser")}>
      <div className={styles.grid}>
        <Field
          accessibleLabel={t("properties.vectorEraserWeight")}
          label={t("properties.vectorEraserWeight")}
          max={VECTOR_ERASER_MAX_WEIGHT}
          min={VECTOR_ERASER_MIN_WEIGHT}
          onCommit={(draft) =>
            commitNumber(
              draft,
              settings.weight,
              (weight) => onChange({ ...settings, weight }),
              {
                max: VECTOR_ERASER_MAX_WEIGHT,
                min: VECTOR_ERASER_MIN_WEIGHT,
              },
            )
          }
          suffix="px"
          value={formatNumber(settings.weight)}
        />
        <label className={styles.select}>
          <span>{t("properties.vectorEraserShape")}</span>
          <select
            aria-label={t("properties.vectorEraserShape")}
            onChange={(event) =>
              onChange({
                ...settings,
                shape: event.target.value as VectorEraserSettings["shape"],
              })
            }
            value={settings.shape}
          >
            <option value="round">{t("properties.vectorEraserRound")}</option>
            <option value="square">{t("properties.vectorEraserSquare")}</option>
          </select>
        </label>
      </div>
    </Section>
  );
}
