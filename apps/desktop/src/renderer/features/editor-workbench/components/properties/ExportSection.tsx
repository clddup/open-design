import type { DesignNode } from "@opendesign/design-contracts";
import { MAX_SVG_EXPORT_PADDING } from "@opendesign/editor-runtime";
import {
  planRasterExportDimensions,
  type RasterExportResampling,
  type RasterExportSize,
} from "@opendesign/import-export-service/raster";
import { Button, IconButton } from "@opendesign/ui";
import { useI18n } from "../../../../i18n";
import type {
  ExportFormat,
  RasterExportSettings,
  SvgInterchangeFeedback,
  SvgOperationStatus,
} from "../../../import-export/types";
import type { SvgWorkerExportSettings } from "../../../../svg-interchange-contract";
import styles from "../PropertiesPanel.module.scss";
import {
  ColorPicker,
  Field,
  Section,
  commitNumber,
  cx,
  formatNumber,
} from "./controls";

export function SvgOperationNotice({
  operation,
  onCancel,
}: {
  operation: SvgOperationStatus;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <section
      aria-live="polite"
      className={styles.operationNotice}
      role="status"
    >
      <span aria-hidden="true" className={styles.operationIndicator} />
      <span className={styles.operationCopy}>
        <strong>
          {operation.kind === "import"
            ? t("properties.importingSvg", { name: operation.name })
            : operation.kind === "export"
              ? t("properties.exportingSvg")
              : t("properties.exportingRaster", { name: operation.name })}
        </strong>
        <small>
          {operation.kind === "raster-export"
            ? t("properties.rasterOperationDetail")
            : t("properties.svgOperationDetail")}
        </small>
      </span>
      <Button onClick={onCancel} tone="quiet">
        {t("properties.cancelSvgOperation")}
      </Button>
    </section>
  );
}

export function SvgFidelityReport({
  feedback,
  onDismiss,
}: {
  feedback: SvgInterchangeFeedback;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const warning = feedback.issues.length > 0;
  const visibleIssues = feedback.issues.slice(0, 3);
  return (
    <section
      aria-live="polite"
      className={cx(styles.fidelityReport, warning && styles.fidelityWarning)}
      role="status"
    >
      <header>
        <span aria-hidden="true" className={styles.fidelityMark}>
          {warning ? "!" : "✓"}
        </span>
        <strong>
          {t(
            feedback.kind === "import"
              ? "properties.svgImportComplete"
              : "properties.svgExportComplete",
            { name: feedback.name },
          )}
        </strong>
        <IconButton
          icon="lucide:x"
          label={t("properties.dismissSvgFeedback")}
          onClick={onDismiss}
        />
      </header>
      <p>
        {warning
          ? t("properties.svgFidelityIssues", {
              count: feedback.issues.length,
            })
          : t("properties.svgNoFidelityIssues")}
      </p>
      {visibleIssues.length > 0 && (
        <ul>
          {visibleIssues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              <code>{issue.code}</code>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      {feedback.issues.length > visibleIssues.length && (
        <small className={styles.fidelityMore}>
          {t("properties.svgMoreIssues", {
            count: feedback.issues.length - visibleIssues.length,
          })}
        </small>
      )}
    </section>
  );
}

export function ExportSection({
  busy,
  format,
  node,
  onExportFormatChange,
  onExportRaster,
  onExportSvg,
  onRasterSettingsChange,
  onSvgSettingsChange,
  rasterSettings,
  selectionCount,
  svgSettings,
}: {
  busy: boolean;
  format: ExportFormat;
  node: DesignNode | undefined;
  onExportFormatChange: (format: ExportFormat) => void;
  onExportRaster: () => void;
  onExportSvg: () => void;
  onRasterSettingsChange: (settings: RasterExportSettings) => void;
  onSvgSettingsChange: (settings: SvgWorkerExportSettings) => void;
  rasterSettings: RasterExportSettings;
  selectionCount: number;
  svgSettings: SvgWorkerExportSettings;
}) {
  const { t } = useI18n();
  const dimensionPlan = node
    ? planRasterExportDimensions(node.size, rasterSettings.size)
    : null;
  const rasterTargetValid = selectionCount === 1 && node !== undefined;
  const fixedWidth =
    rasterSettings.size.mode === "width" ? rasterSettings.size.value : 1_920;
  const fixedHeight =
    rasterSettings.size.mode === "height" ? rasterSettings.size.value : 1_080;
  return (
    <Section defaultOpen={false} title={t("properties.export")}>
      <div className={styles.exportSettings}>
        <label className={styles.selectRow}>
          <span>{t("properties.exportFormat")}</span>
          <select
            aria-label={t("properties.exportFormat")}
            disabled={busy}
            onChange={(event) =>
              onExportFormatChange(event.target.value as ExportFormat)
            }
            value={format}
          >
            <option value="svg">SVG</option>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </label>
        {format === "svg" ? (
          <>
            <label className={styles.exportToggle}>
              <input
                checked={svgSettings.includeLayerIds}
                disabled={busy}
                onChange={(event) =>
                  onSvgSettingsChange({
                    ...svgSettings,
                    includeLayerIds: event.target.checked,
                  })
                }
                type="checkbox"
              />
              <span>{t("properties.exportIncludeLayerIds")}</span>
            </label>
            <Field
              accessibleLabel={t("properties.exportPadding")}
              disabled={busy}
              label="P"
              max={MAX_SVG_EXPORT_PADDING}
              min={0}
              onCommit={(draft) =>
                commitNumber(
                  draft,
                  svgSettings.padding,
                  (padding) => onSvgSettingsChange({ ...svgSettings, padding }),
                  { min: 0, max: MAX_SVG_EXPORT_PADDING },
                )
              }
              suffix="px"
              value={formatNumber(svgSettings.padding)}
            />
          </>
        ) : (
          <>
            <label className={styles.selectRow}>
              <span>{t("properties.exportSize")}</span>
              <select
                aria-label={t("properties.exportSize")}
                disabled={busy}
                onChange={(event) => {
                  const [mode, raw] = event.target.value.split(":");
                  const value = Number(raw);
                  onRasterSettingsChange({
                    ...rasterSettings,
                    size: {
                      mode,
                      value,
                    } as RasterExportSize,
                  });
                }}
                value={`${rasterSettings.size.mode}:${rasterSettings.size.value}`}
              >
                <option value="scale:1">1×</option>
                <option value="scale:2">2×</option>
                <option value="scale:3">3×</option>
                <option value={`width:${fixedWidth}`}>
                  {t("properties.exportFixedWidth")}
                </option>
                <option value={`height:${fixedHeight}`}>
                  {t("properties.exportFixedHeight")}
                </option>
              </select>
            </label>
            {rasterSettings.size.mode !== "scale" && (
              <Field
                accessibleLabel={
                  rasterSettings.size.mode === "width"
                    ? t("properties.exportWidth")
                    : t("properties.exportHeight")
                }
                disabled={busy}
                label={rasterSettings.size.mode === "width" ? "W" : "H"}
                max={16_384}
                min={1}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    rasterSettings.size.value,
                    (value) =>
                      onRasterSettingsChange({
                        ...rasterSettings,
                        size:
                          rasterSettings.size.mode === "width"
                            ? { mode: "width", value }
                            : { mode: "height", value },
                      }),
                    { min: 1, max: 16_384 },
                  )
                }
                suffix="px"
                value={formatNumber(rasterSettings.size.value)}
              />
            )}
            {format !== "jpeg" && (
              <label className={styles.exportToggle}>
                <input
                  checked={rasterSettings.background.mode === "transparent"}
                  disabled={busy}
                  onChange={(event) =>
                    onRasterSettingsChange({
                      ...rasterSettings,
                      background: event.target.checked
                        ? { mode: "transparent" }
                        : { mode: "color", color: "#ffffff" },
                    })
                  }
                  type="checkbox"
                />
                <span>{t("properties.exportTransparent")}</span>
              </label>
            )}
            {(format === "jpeg" ||
              rasterSettings.background.mode === "color") && (
              <label className={styles.selectRow}>
                <span>{t("properties.exportBackground")}</span>
                <ColorPicker
                  label={t("properties.exportBackground")}
                  onChange={(color) =>
                    onRasterSettingsChange({
                      ...rasterSettings,
                      background: { mode: "color", color },
                    })
                  }
                  value={
                    rasterSettings.background.mode === "color"
                      ? rasterSettings.background.color
                      : "#ffffff"
                  }
                />
              </label>
            )}
            {format !== "png" && (
              <Field
                accessibleLabel={t("properties.exportQuality")}
                disabled={busy}
                label="Q"
                max={100}
                min={1}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    Math.round(rasterSettings.quality * 100),
                    (quality) =>
                      onRasterSettingsChange({
                        ...rasterSettings,
                        quality: quality / 100,
                      }),
                    { min: 1, max: 100 },
                  )
                }
                suffix="%"
                value={String(Math.round(rasterSettings.quality * 100))}
              />
            )}
            <label className={styles.selectRow}>
              <span>{t("properties.exportResampling")}</span>
              <select
                aria-label={t("properties.exportResampling")}
                disabled={busy}
                onChange={(event) =>
                  onRasterSettingsChange({
                    ...rasterSettings,
                    resampling: event.target.value as RasterExportResampling,
                  })
                }
                value={rasterSettings.resampling}
              >
                <option value="smooth">{t("properties.exportSmooth")}</option>
                <option value="pixelated">
                  {t("properties.exportPixelated")}
                </option>
              </select>
            </label>
            <div className={styles.rasterDimensions} role="status">
              {dimensionPlan?.ok
                ? `${dimensionPlan.dimensions.width} × ${dimensionPlan.dimensions.height} px`
                : t("properties.exportDimensionsUnavailable")}
            </div>
            {!rasterTargetValid && (
              <small className={styles.rasterHint}>
                {t("properties.exportRasterSingleTarget")}
              </small>
            )}
          </>
        )}
        <Button
          className={styles.exportButton}
          disabled={busy || (format !== "svg" && !rasterTargetValid)}
          onClick={format === "svg" ? onExportSvg : onExportRaster}
          tone="primary"
        >
          {format === "svg"
            ? t("properties.exportSelection", { count: selectionCount })
            : t("properties.exportRasterSelection", {
                format: format.toUpperCase(),
              })}
        </Button>
      </div>
    </Section>
  );
}
