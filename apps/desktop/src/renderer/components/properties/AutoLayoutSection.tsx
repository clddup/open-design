import type { AutoLayout, AutoLayoutFlow } from "@opendesign/design-contracts";
import { useI18n } from "../../i18n";
import styles from "../PropertiesPanel.module.scss";
import { Field, Section, commitNumber, formatNumber } from "./controls";

const defaultAutoLayout: AutoLayoutFlow = {
  mode: "vertical",
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  gap: 0,
  primaryAlignment: "start",
  counterAlignment: "start",
  sizing: { horizontal: "fixed", vertical: "fixed" },
};

export function AutoLayoutSection({
  autoLayout,
  onChange,
}: {
  autoLayout: AutoLayout;
  onChange: (autoLayout: AutoLayout) => void;
}) {
  const { t } = useI18n();
  const flow = autoLayout.mode === "none" ? null : autoLayout;
  const updateFlow = (patch: Partial<AutoLayoutFlow>) => {
    onChange({ ...(flow ?? defaultAutoLayout), ...patch });
  };
  const horizontalFlow = flow?.mode === "horizontal" ? flow : null;
  const wrapEnabled = horizontalFlow?.wrap?.mode === "wrap";
  const autoGap = flow?.primaryAlignment === "space-between";
  return (
    <Section title={t("properties.autoLayout")}>
      <div className={styles.stack}>
        <label className={styles.select}>
          <span>{t("properties.autoLayoutDirection")}</span>
          <select
            aria-label={t("properties.autoLayoutDirection")}
            onChange={(event) => {
              const mode = event.target.value as AutoLayout["mode"];
              if (mode === "none") {
                onChange({ mode: "none" });
                return;
              }
              const current = flow ?? defaultAutoLayout;
              onChange({
                mode,
                padding: current.padding,
                gap: current.gap,
                primaryAlignment: current.primaryAlignment,
                counterAlignment: current.counterAlignment,
                ...(current.sizing ? { sizing: current.sizing } : {}),
              });
            }}
            value={autoLayout.mode}
          >
            <option value="none">{t("properties.autoLayoutNone")}</option>
            <option value="horizontal">
              {t("properties.autoLayoutHorizontal")}
            </option>
            <option value="vertical">
              {t("properties.autoLayoutVertical")}
            </option>
          </select>
        </label>
        {flow && (
          <>
            {horizontalFlow && (
              <label className={styles.select}>
                <span>{t("properties.autoLayoutFlow")}</span>
                <select
                  aria-label={t("properties.autoLayoutFlow")}
                  onChange={(event) => {
                    if (event.target.value === "wrap") {
                      onChange({
                        ...horizontalFlow,
                        sizing: {
                          horizontal: "fixed",
                          vertical: horizontalFlow.sizing?.vertical ?? "fixed",
                        },
                        wrap: {
                          mode: "wrap",
                          counterGap: horizontalFlow.gap,
                        },
                      });
                      return;
                    }
                    onChange({
                      mode: "horizontal",
                      padding: horizontalFlow.padding,
                      gap: horizontalFlow.gap,
                      primaryAlignment: horizontalFlow.primaryAlignment,
                      counterAlignment: horizontalFlow.counterAlignment,
                      ...(horizontalFlow.sizing
                        ? { sizing: horizontalFlow.sizing }
                        : {}),
                    });
                  }}
                  value={wrapEnabled ? "wrap" : "single-line"}
                >
                  <option value="single-line">
                    {t("properties.autoLayoutSingleLine")}
                  </option>
                  <option value="wrap">{t("properties.autoLayoutWrap")}</option>
                </select>
              </label>
            )}
            <div className={styles.grid}>
              {(["horizontal", "vertical"] as const).map((axis) => (
                <label className={styles.select} key={axis}>
                  <span>
                    {t(
                      axis === "horizontal"
                        ? "properties.autoLayoutWidthSizing"
                        : "properties.autoLayoutHeightSizing",
                    )}
                  </span>
                  <select
                    aria-label={t(
                      axis === "horizontal"
                        ? "properties.autoLayoutWidthSizing"
                        : "properties.autoLayoutHeightSizing",
                    )}
                    onChange={(event) =>
                      updateFlow({
                        sizing: {
                          horizontal: flow.sizing?.horizontal ?? "fixed",
                          vertical: flow.sizing?.vertical ?? "fixed",
                          [axis]: event.target.value as "fixed" | "hug",
                        },
                      })
                    }
                    value={flow.sizing?.[axis] ?? "fixed"}
                  >
                    <option value="fixed">
                      {t("properties.autoLayoutFixed")}
                    </option>
                    <option
                      disabled={axis === "horizontal" && wrapEnabled}
                      value="hug"
                    >
                      {t("properties.autoLayoutHug")}
                    </option>
                  </select>
                </label>
              ))}
            </div>
            <div className={styles.grid}>
              <label className={styles.select}>
                <span>{t("properties.autoLayoutGapMode")}</span>
                <select
                  aria-label={t("properties.autoLayoutGapMode")}
                  onChange={(event) =>
                    updateFlow({
                      primaryAlignment:
                        event.target.value === "auto"
                          ? "space-between"
                          : "start",
                    })
                  }
                  value={autoGap ? "auto" : "fixed"}
                >
                  <option value="fixed">
                    {t("properties.autoLayoutGapFixed")}
                  </option>
                  <option value="auto">
                    {t("properties.autoLayoutGapAuto")}
                  </option>
                </select>
              </label>
              <Field
                accessibleLabel={t("properties.autoLayoutGap")}
                disabled={autoGap}
                label={t("properties.autoLayoutGap")}
                min={0}
                onCommit={(value) =>
                  commitNumber(value, flow.gap, (gap) => updateFlow({ gap }), {
                    min: 0,
                  })
                }
                placeholder={
                  autoGap ? t("properties.autoLayoutGapAuto") : undefined
                }
                type="number"
                value={autoGap ? "" : formatNumber(flow.gap)}
              />
              {horizontalFlow?.wrap && (
                <Field
                  accessibleLabel={t("properties.autoLayoutCounterGap")}
                  label={t("properties.autoLayoutCounterGap")}
                  min={0}
                  onCommit={(value) =>
                    commitNumber(
                      value,
                      horizontalFlow.wrap?.counterGap ?? horizontalFlow.gap,
                      (counterGap) =>
                        onChange({
                          ...horizontalFlow,
                          wrap: { mode: "wrap", counterGap },
                        }),
                      { min: 0 },
                    )
                  }
                  type="number"
                  value={formatNumber(horizontalFlow.wrap.counterGap)}
                />
              )}
              {!autoGap && (
                <AlignmentSelect
                  label={t("properties.autoLayoutPrimary")}
                  onChange={(primaryAlignment) =>
                    updateFlow({ primaryAlignment })
                  }
                  value={flow.primaryAlignment as PackedAlignment}
                />
              )}
              <AlignmentSelect
                label={t("properties.autoLayoutCounter")}
                onChange={(counterAlignment) =>
                  updateFlow({ counterAlignment })
                }
                value={flow.counterAlignment}
              />
            </div>
            <div className={styles.grid}>
              {(["top", "right", "bottom", "left"] as const).map((side) => (
                <Field
                  accessibleLabel={t(`properties.padding.${side}`)}
                  key={side}
                  label={t(`properties.padding.${side}`)}
                  min={0}
                  onCommit={(value) =>
                    commitNumber(
                      value,
                      flow.padding[side],
                      (next) =>
                        updateFlow({
                          padding: { ...flow.padding, [side]: next },
                        }),
                      { min: 0 },
                    )
                  }
                  type="number"
                  value={formatNumber(flow.padding[side])}
                />
              ))}
            </div>
            <small className={styles.hint}>
              {t("properties.autoLayoutSizingHint")}
            </small>
          </>
        )}
      </div>
    </Section>
  );
}

function AlignmentSelect({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: PackedAlignment) => void;
  value: PackedAlignment;
}) {
  const { t } = useI18n();
  return (
    <label className={styles.select}>
      <span>{label}</span>
      <select
        aria-label={label}
        onChange={(event) => onChange(event.target.value as PackedAlignment)}
        value={value}
      >
        <option value="start">{t("properties.autoLayoutStart")}</option>
        <option value="center">{t("properties.autoLayoutCenter")}</option>
        <option value="end">{t("properties.autoLayoutEnd")}</option>
      </select>
    </label>
  );
}

type PackedAlignment = Exclude<
  AutoLayoutFlow["primaryAlignment"],
  "space-between"
>;
