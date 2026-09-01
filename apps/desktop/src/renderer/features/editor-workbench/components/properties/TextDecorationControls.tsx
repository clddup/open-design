import type {
  DesignOperation,
  TextDecorationMetric,
  TextRunStyle,
} from "@opendesign/design-contracts";
import { ColorPicker } from "./controls";
import { useI18n } from "../../../../i18n";
import styles from "./TextDecorationControls.module.scss";

type StylePatch = Extract<
  DesignOperation,
  { type: "update_text_range_style" }
>["style"];

export function TextDecorationControls({
  isMixed,
  onUpdate,
  style,
}: {
  isMixed: (field: keyof TextRunStyle) => boolean;
  onUpdate: (patch: StylePatch) => void;
  style: TextRunStyle;
}) {
  const { t } = useI18n();
  if (style.textDecoration !== "underline") return null;
  const color = style.textDecorationColor;
  const colorMode = color?.value === "auto" ? "auto" : "solid";
  const solidColor = color?.value === "auto" ? null : color?.value;
  return (
    <div className={styles.advanced}>
      <label className={styles.field}>
        <span>{t("properties.decorationStyle")}</span>
        <select
          aria-label={t("properties.decorationStyle")}
          onChange={(event) =>
            onUpdate({
              textDecorationStyle: event.target
                .value as TextRunStyle["textDecorationStyle"],
            })
          }
          value={
            isMixed("textDecorationStyle")
              ? ""
              : (style.textDecorationStyle ?? "solid")
          }
        >
          {isMixed("textDecorationStyle") && (
            <option value="">{t("properties.mixed")}</option>
          )}
          <option value="solid">{t("properties.decorationSolid")}</option>
          <option value="wavy">{t("properties.decorationWavy")}</option>
          <option value="dotted">{t("properties.decorationDotted")}</option>
        </select>
      </label>
      <MetricControl
        field="textDecorationOffset"
        isMixed={isMixed("textDecorationOffset")}
        label={t("properties.decorationOffset")}
        onUpdate={onUpdate}
        value={style.textDecorationOffset}
      />
      <MetricControl
        field="textDecorationThickness"
        isMixed={isMixed("textDecorationThickness")}
        label={t("properties.decorationThickness")}
        onUpdate={onUpdate}
        value={style.textDecorationThickness}
      />
      <label className={styles.field}>
        <span>{t("properties.decorationColor")}</span>
        <span className={styles.color}>
          <select
            aria-label={t("properties.decorationColor")}
            onChange={(event) =>
              onUpdate({
                textDecorationColor:
                  event.target.value === "auto"
                    ? { value: "auto" }
                    : {
                        value: {
                          type: "solid",
                          color: solidColor?.color ?? "#000000",
                          opacity: solidColor?.opacity ?? 1,
                        },
                      },
              })
            }
            value={isMixed("textDecorationColor") ? "" : colorMode}
          >
            {isMixed("textDecorationColor") && (
              <option value="">{t("properties.mixed")}</option>
            )}
            <option value="auto">{t("properties.decorationAuto")}</option>
            <option value="solid">{t("properties.decorationCustom")}</option>
          </select>
          {colorMode === "solid" && (
            <ColorPicker
              label={t("properties.decorationColor")}
              onChange={(nextColor) =>
                onUpdate({
                  textDecorationColor: {
                    value: {
                      type: "solid",
                      color: nextColor,
                      opacity: solidColor?.opacity ?? 1,
                    },
                  },
                })
              }
              value={solidColor?.color ?? "#000000"}
            />
          )}
        </span>
      </label>
      <label className={styles.toggle}>
        <input
          checked={style.textDecorationSkipInk ?? false}
          onChange={(event) =>
            onUpdate({ textDecorationSkipInk: event.target.checked })
          }
          type="checkbox"
        />
        {t("properties.decorationSkipInk")}
      </label>
    </div>
  );
}

function MetricControl({
  field,
  isMixed,
  label,
  onUpdate,
  value,
}: {
  field: "textDecorationOffset" | "textDecorationThickness";
  isMixed: boolean;
  label: string;
  onUpdate: (patch: StylePatch) => void;
  value: TextDecorationMetric | null;
}) {
  const { t } = useI18n();
  const unit = value?.unit ?? "auto";
  const numericValue = value && value.unit !== "auto" ? value.value : 1;
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <span className={styles.metric}>
        <select
          aria-label={label}
          onChange={(event) => {
            const nextUnit = event.target.value as TextDecorationMetric["unit"];
            onUpdate({
              [field]:
                nextUnit === "auto"
                  ? { unit: "auto" }
                  : { unit: nextUnit, value: numericValue },
            });
          }}
          value={isMixed ? "" : unit}
        >
          {isMixed && <option value="">{t("properties.mixed")}</option>}
          <option value="auto">{t("properties.decorationAuto")}</option>
          <option value="pixels">px</option>
          <option value="percent">%</option>
        </select>
        {unit !== "auto" && (
          <input
            aria-label={`${label} ${unit}`}
            min={field === "textDecorationThickness" ? 0.01 : undefined}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              onUpdate({ [field]: { unit, value: next } });
            }}
            step="0.1"
            type="number"
            value={numericValue}
          />
        )}
      </span>
    </label>
  );
}
