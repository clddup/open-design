import type {
  DesignNode,
  ExportConstraint,
  ExportSetting,
} from "@opendesign/design-contracts";
import { MAX_EXPORT_SETTINGS_PER_NODE } from "@opendesign/design-contracts";
import { planStoredExportSetting } from "@opendesign/import-export-service/stored-export";
import { Button } from "@opendesign/ui";
import { useI18n } from "../../i18n";
import { Section } from "./controls";
import styles from "./ExportSettingsEditor.module.scss";

export function ExportSettingsEditor({
  busy,
  node,
  onChange,
  onExport,
}: {
  busy: boolean;
  node: DesignNode;
  onChange: (settings: readonly ExportSetting[]) => void;
  onExport: (setting: ExportSetting) => void;
}) {
  const { t } = useI18n();
  const replace = (index: number, setting: ExportSetting) => {
    const next = [...node.exportSettings];
    next[index] = setting;
    onChange(next);
  };
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= node.exportSettings.length) return;
    const next = [...node.exportSettings];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <Section defaultOpen={false} title={t("properties.exportSettings")}>
      <div className={styles.list}>
        {node.exportSettings.length === 0 && (
          <p className={styles.empty}>{t("properties.exportSettingsEmpty")}</p>
        )}
        {node.exportSettings.map((setting, index) => {
          const plan = planStoredExportSetting(node, setting);
          return (
            <div className={styles.item} key={`${index}-${setting.format}`}>
              <div className={styles.row}>
                <select
                  aria-label={t("properties.exportFormat")}
                  disabled={busy}
                  onChange={(event) =>
                    replace(index, changeFormat(setting, event.target.value))
                  }
                  value={setting.format}
                >
                  <option value="PNG">PNG</option>
                  <option value="JPG">JPG</option>
                  <option value="WEBP">WebP</option>
                  <option value="SVG">SVG</option>
                  <option value="PDF">PDF</option>
                </select>
                <input
                  aria-label={t("properties.exportSuffix")}
                  defaultValue={setting.suffix}
                  disabled={busy}
                  key={setting.suffix}
                  maxLength={128}
                  onBlur={(event) =>
                    event.target.value !== setting.suffix &&
                    replace(index, { ...setting, suffix: event.target.value })
                  }
                  placeholder={t("properties.exportSuffix")}
                />
                <div className={styles.actions}>
                  <button
                    aria-label={t("properties.moveExportUp")}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={t("properties.moveExportDown")}
                    disabled={busy || index === node.exportSettings.length - 1}
                    onClick={() => move(index, 1)}
                    type="button"
                  >
                    ↓
                  </button>
                  <button
                    aria-label={t("properties.removeExportSetting")}
                    disabled={busy}
                    onClick={() =>
                      onChange(
                        node.exportSettings.filter((_, item) => item !== index),
                      )
                    }
                    type="button"
                  >
                    −
                  </button>
                </div>
              </div>
              <div className={styles.row}>
                <select
                  aria-label={t("properties.exportColorProfile")}
                  disabled={busy}
                  onChange={(event) =>
                    replace(index, {
                      ...setting,
                      colorProfile: event.target
                        .value as ExportSetting["colorProfile"],
                    })
                  }
                  value={setting.colorProfile}
                >
                  <option value="DOCUMENT">Document</option>
                  <option value="SRGB">sRGB</option>
                  <option value="DISPLAY_P3_V4">Display P3</option>
                </select>
                <div className={styles.toggles}>
                  <label>
                    <input
                      checked={setting.contentsOnly}
                      disabled={busy}
                      onChange={(event) =>
                        replace(index, {
                          ...setting,
                          contentsOnly: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    {t("properties.exportContentsOnly")}
                  </label>
                  <label>
                    <input
                      checked={setting.useAbsoluteBounds}
                      disabled={busy}
                      onChange={(event) =>
                        replace(index, {
                          ...setting,
                          useAbsoluteBounds: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    {t("properties.exportAbsoluteBounds")}
                  </label>
                </div>
                <span />
              </div>
              {"constraint" in setting && (
                <div className={styles.row}>
                  <div className={styles.constraint}>
                    <select
                      aria-label={t("properties.exportSize")}
                      disabled={busy}
                      onChange={(event) =>
                        replace(index, {
                          ...setting,
                          constraint: {
                            type: event.target.value,
                            value: setting.constraint.value,
                          } as ExportConstraint,
                        })
                      }
                      value={setting.constraint.type}
                    >
                      <option value="SCALE">Scale</option>
                      <option value="WIDTH">Width</option>
                      <option value="HEIGHT">Height</option>
                    </select>
                    <input
                      aria-label={t("properties.exportConstraintValue")}
                      defaultValue={setting.constraint.value}
                      disabled={busy}
                      key={`${setting.constraint.type}:${setting.constraint.value}`}
                      min={setting.constraint.type === "SCALE" ? 0.01 : 1}
                      max={setting.constraint.type === "SCALE" ? 64 : 16_384}
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        const valid =
                          setting.constraint.type === "SCALE"
                            ? Number.isFinite(value) && value > 0 && value <= 64
                            : Number.isInteger(value) &&
                              value >= 1 &&
                              value <= 16_384;
                        if (valid && value !== setting.constraint.value) {
                          replace(index, {
                            ...setting,
                            constraint: { ...setting.constraint, value },
                          });
                        } else {
                          event.target.value = String(setting.constraint.value);
                        }
                      }}
                      step={setting.constraint.type === "SCALE" ? 0.01 : 1}
                      type="number"
                    />
                  </div>
                  <span className={styles.status}>
                    {plan.ok
                      ? t("properties.exportSettingReady")
                      : plan.message}
                  </span>
                  <Button
                    disabled={busy || !plan.ok}
                    onClick={() => onExport(setting)}
                    tone="quiet"
                  >
                    {t("properties.exportSettingRun")}
                  </Button>
                </div>
              )}
              {setting.format === "SVG" && (
                <div className={styles.toggles}>
                  <label>
                    <input
                      checked={setting.svgOutlineText}
                      disabled={busy}
                      onChange={(event) =>
                        replace(index, {
                          ...setting,
                          svgOutlineText: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    {t("properties.exportOutlineText")}
                  </label>
                  <label>
                    <input
                      checked={setting.svgIdAttribute}
                      disabled={busy}
                      onChange={(event) =>
                        replace(index, {
                          ...setting,
                          svgIdAttribute: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    {t("properties.exportLayerIds")}
                  </label>
                  <label>
                    <input
                      checked={setting.svgSimplifyStroke}
                      disabled={busy}
                      onChange={(event) =>
                        replace(index, {
                          ...setting,
                          svgSimplifyStroke: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    {t("properties.exportSimplifyStroke")}
                  </label>
                </div>
              )}
              {!("constraint" in setting) && (
                <div className={styles.row}>
                  <span />
                  <span
                    className={`${styles.status} ${!plan.ok ? styles.unsupported : ""}`}
                  >
                    {plan.ok
                      ? t("properties.exportSettingReady")
                      : plan.message}
                  </span>
                  <Button
                    disabled={busy || !plan.ok}
                    onClick={() => onExport(setting)}
                    tone="quiet"
                  >
                    {t("properties.exportSettingRun")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        <Button
          disabled={
            busy || node.exportSettings.length >= MAX_EXPORT_SETTINGS_PER_NODE
          }
          onClick={() =>
            onChange([...node.exportSettings, defaultPngSetting()])
          }
          tone="quiet"
        >
          {t("properties.addExportSetting")}
        </Button>
      </div>
    </Section>
  );
}

function common(setting: ExportSetting) {
  return {
    suffix: setting.suffix,
    contentsOnly: setting.contentsOnly,
    useAbsoluteBounds: setting.useAbsoluteBounds,
    colorProfile: setting.colorProfile,
  } as const;
}

function changeFormat(setting: ExportSetting, format: string): ExportSetting {
  const base = common(setting);
  if (format === "SVG") {
    return {
      ...base,
      format: "SVG",
      svgOutlineText: false,
      svgIdAttribute: true,
      svgSimplifyStroke: true,
    };
  }
  if (format === "PDF") return { ...base, format: "PDF" };
  return {
    ...base,
    format: format === "JPG" ? "JPG" : format === "WEBP" ? "WEBP" : "PNG",
    constraint:
      "constraint" in setting
        ? setting.constraint
        : ({ type: "SCALE", value: 1 } as const),
  };
}

function defaultPngSetting(): ExportSetting {
  return {
    format: "PNG",
    suffix: "",
    contentsOnly: true,
    useAbsoluteBounds: false,
    colorProfile: "DOCUMENT",
    constraint: { type: "SCALE", value: 1 },
  };
}
