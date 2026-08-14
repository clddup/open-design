import type {
  BooleanOperation,
  ComponentPropertyAssignment,
  ComponentPropertyType,
  ComponentOverridePatch,
  DesignNode,
  LayoutConstraints,
  LayoutGuide,
  LayoutPositioning,
} from "@opendesign/design-contracts";
import {
  MAX_ARRANGEMENT_SPACING,
  type ArrangeOperation,
  type ArrangementSelectionMetrics,
} from "@opendesign/editor-runtime";
import { Glyph } from "@opendesign/ui";
import { useI18n } from "../i18n";
import type { UpdatePropertiesPatch } from "../features/editor/types";
import type {
  ExportFormat,
  RasterExportFeedback,
  RasterExportSettings,
  SvgInterchangeFeedback,
  SvgOperationStatus,
} from "../features/import-export/types";
import type { SvgWorkerExportSettings } from "../svg-interchange-contract";
import {
  type ComponentInspectorContext,
  type ComponentInspectorOption,
  type ComponentInspectorSource,
} from "./properties/ComponentSection";
import {
  ExportSection,
  RasterExportReport,
  SvgFidelityReport,
  SvgOperationNotice,
} from "./properties/ExportSection";
import { SelectedNodeProperties } from "./properties/SelectedNodeProperties";
import { Field, formatNumber } from "./properties/controls";
import styles from "./PropertiesPanel.module.scss";

export type { ComponentInspectorOption, ComponentInspectorSource };

export function PropertiesPanel({
  node,
  componentContext,
  arrangement,
  booleanOperationEditable,
  booleanOperandParent,
  canCombineVariants,
  canDelete,
  layoutMode,
  onArrange,
  onBooleanOperationChange,
  onCreateComponent,
  onCreateComponentInstance,
  onCombineVariants,
  onDelete,
  onDetachComponentInstance,
  onDuplicate,
  onGoToComponentMain,
  onCancelSvgOperation,
  onDismissRasterFeedback,
  onDismissSvgFeedback,
  onExportSvg,
  onExportRaster,
  onExportFormatChange,
  onReplaceImage,
  onRemoveComponent,
  onAddComponentProperty,
  onRemoveComponentProperty,
  onRenameComponentProperty,
  onResetComponentInstance,
  onResetComponentProperty,
  onResetComponentSourceOverride,
  onSelectBooleanParent,
  onSetConstraints,
  onSetLayoutPositioning,
  onSetFrameLayoutGuides,
  onUpdate,
  onUpdateComponentOverride,
  onSetComponentProperty,
  selectionCount,
  exportFormat,
  rasterExportSettings,
  rasterFeedback,
  svgExportSettings,
  svgFeedback,
  svgOperation,
  onSvgExportSettingsChange,
  onRasterExportSettingsChange,
}: {
  node: DesignNode | undefined;
  componentContext?: ComponentInspectorContext;
  arrangement: ArrangementSelectionMetrics | null;
  booleanOperationEditable: boolean;
  booleanOperandParent?: { id: string; name: string };
  canCombineVariants: boolean;
  canDelete: boolean;
  layoutMode: "constraints" | "sizing" | "wrap-sizing" | "absolute" | null;
  onArrange: (operation: ArrangeOperation) => void;
  onBooleanOperationChange: (operation: BooleanOperation) => void;
  onCreateComponent: () => void;
  onCreateComponentInstance: () => void;
  onCombineVariants: () => void;
  onDelete: () => void;
  onDetachComponentInstance: () => void;
  onDuplicate: () => void;
  onGoToComponentMain: () => void;
  onCancelSvgOperation: () => void;
  onDismissRasterFeedback: () => void;
  onDismissSvgFeedback: () => void;
  onExportSvg: () => void;
  onExportRaster: () => void;
  onExportFormatChange: (format: ExportFormat) => void;
  onReplaceImage: () => void;
  onRemoveComponent: () => void;
  onAddComponentProperty: (input: {
    name: string;
    sourceNodeId: string;
    type: ComponentPropertyType;
  }) => void;
  onRemoveComponentProperty: (propertyName: string) => void;
  onRenameComponentProperty: (propertyName: string, name: string) => void;
  onResetComponentInstance: () => void;
  onResetComponentProperty: (propertyName: string) => void;
  onResetComponentSourceOverride: (sourcePath: readonly string[]) => void;
  onSelectBooleanParent: (nodeId: string) => void;
  onSetConstraints: (nodeId: string, constraints: LayoutConstraints) => void;
  onSetLayoutPositioning: (
    nodeId: string,
    positioning: LayoutPositioning | null,
    constraints?: LayoutConstraints,
  ) => void;
  onSetFrameLayoutGuides: (
    frameId: string,
    layoutGuides: readonly LayoutGuide[],
  ) => void;
  onUpdate: (updates: UpdatePropertiesPatch) => void;
  onUpdateComponentOverride: (
    sourcePath: readonly string[],
    patch: ComponentOverridePatch,
  ) => void;
  onSetComponentProperty: (
    propertyName: string,
    value: ComponentPropertyAssignment,
  ) => void;
  selectionCount: number;
  exportFormat: ExportFormat;
  rasterExportSettings: RasterExportSettings;
  rasterFeedback: RasterExportFeedback | null;
  svgExportSettings: SvgWorkerExportSettings;
  svgFeedback: SvgInterchangeFeedback | null;
  svgOperation: SvgOperationStatus | null;
  onSvgExportSettingsChange: (settings: SvgWorkerExportSettings) => void;
  onRasterExportSettingsChange: (settings: RasterExportSettings) => void;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t("properties.label")} className={styles.root}>
      <div
        aria-label={t("properties.views")}
        className={styles.tabs}
        role="tablist"
      >
        <button
          aria-controls="properties-design-panel"
          aria-selected="true"
          id="properties-design-tab"
          role="tab"
          type="button"
        >
          {t("properties.design")}
        </button>
        <button
          aria-label={t("properties.prototypeUnavailable")}
          aria-selected="false"
          disabled
          id="properties-prototype-tab"
          role="tab"
          tabIndex={-1}
          type="button"
        >
          {t("properties.prototype")}
        </button>
      </div>
      <div
        aria-labelledby="properties-design-tab"
        className={styles.content}
        id="properties-design-panel"
        role="tabpanel"
      >
        {svgOperation && (
          <SvgOperationNotice
            onCancel={onCancelSvgOperation}
            operation={svgOperation}
          />
        )}
        {svgFeedback && (
          <SvgFidelityReport
            feedback={svgFeedback}
            onDismiss={onDismissSvgFeedback}
          />
        )}
        {rasterFeedback && (
          <RasterExportReport
            feedback={rasterFeedback}
            onDismiss={onDismissRasterFeedback}
          />
        )}
        {node ? (
          <SelectedNodeProperties
            key={node.id}
            node={node}
            componentContext={componentContext}
            booleanOperationEditable={booleanOperationEditable}
            booleanOperandParent={booleanOperandParent}
            canDelete={canDelete}
            constraintsAvailable={
              (layoutMode === "constraints" || layoutMode === "absolute") &&
              node.kind !== "group" &&
              node.kind !== "boolean"
            }
            layoutPositioningAvailable={
              layoutMode === "sizing" ||
              layoutMode === "wrap-sizing" ||
              layoutMode === "absolute"
            }
            layoutPositioningConstraintsAvailable={
              node.kind !== "group" && node.kind !== "boolean"
            }
            layoutGuidesAvailable={node.kind === "frame"}
            layoutSizingAvailable={
              layoutMode === "sizing" || layoutMode === "wrap-sizing"
            }
            layoutSizingFillAvailable={layoutMode !== "wrap-sizing"}
            layoutLimitsAvailable={
              layoutMode === "sizing" ||
              layoutMode === "wrap-sizing" ||
              (node.kind === "frame" &&
                node.properties.autoLayout !== undefined &&
                node.properties.autoLayout.mode !== "none")
            }
            onBooleanOperationChange={onBooleanOperationChange}
            onCreateComponent={onCreateComponent}
            onCreateComponentInstance={onCreateComponentInstance}
            onDelete={onDelete}
            onDetachComponentInstance={onDetachComponentInstance}
            onDuplicate={onDuplicate}
            onGoToComponentMain={onGoToComponentMain}
            onReplaceImage={onReplaceImage}
            onRemoveComponent={onRemoveComponent}
            onAddComponentProperty={onAddComponentProperty}
            onRemoveComponentProperty={onRemoveComponentProperty}
            onRenameComponentProperty={onRenameComponentProperty}
            onResetComponentInstance={onResetComponentInstance}
            onResetComponentProperty={onResetComponentProperty}
            onResetComponentSourceOverride={onResetComponentSourceOverride}
            onSelectBooleanParent={onSelectBooleanParent}
            onSetConstraints={onSetConstraints}
            onSetLayoutPositioning={onSetLayoutPositioning}
            onSetFrameLayoutGuides={onSetFrameLayoutGuides}
            onUpdate={onUpdate}
            onUpdateComponentOverride={onUpdateComponentOverride}
            onSetComponentProperty={onSetComponentProperty}
          />
        ) : selectionCount > 1 ? (
          <div className={styles.multiProperties}>
            <div className={styles.noSelection} role="status">
              <Glyph name="layers" size={22} />
              <strong>
                {t("properties.layersSelected", { count: selectionCount })}
              </strong>
              <span>{t("properties.arrangeSelection")}</span>
            </div>
            <div className={styles.multiSection}>
              <span className={styles.multiHeading}>
                {t("properties.alignment")}
              </span>
              <div
                aria-label={t("properties.alignment")}
                className={styles.alignmentGrid}
                role="group"
              >
                {(
                  [
                    ["align-left", "align-left", "properties.alignLeft"],
                    [
                      "align-horizontal-center",
                      "align-h-center",
                      "properties.alignHCenter",
                    ],
                    ["align-right", "align-right", "properties.alignRight"],
                    ["align-top", "align-top", "properties.alignTop"],
                    [
                      "align-vertical-center",
                      "align-v-center",
                      "properties.alignVCenter",
                    ],
                    ["align-bottom", "align-bottom", "properties.alignBottom"],
                  ] as const
                ).map(([action, icon, key]) => (
                  <button
                    aria-label={t(key)}
                    disabled={!arrangement}
                    key={action}
                    onClick={() => onArrange({ action })}
                    type="button"
                  >
                    <Glyph name={icon} size={15} />
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.multiSection}>
              <span className={styles.multiHeading}>
                {t("properties.distribution")}
              </span>
              <div
                aria-label={t("properties.distribution")}
                className={styles.distributionGrid}
                role="group"
              >
                <button
                  aria-label={t("properties.distributeHorizontal")}
                  disabled={!arrangement?.canDistributeHorizontal}
                  onClick={() => onArrange({ action: "distribute-horizontal" })}
                  type="button"
                >
                  <Glyph name="distribute-horizontal" size={15} />
                  {t("properties.horizontal")}
                </button>
                <button
                  aria-label={t("properties.distributeVertical")}
                  disabled={!arrangement?.canDistributeVertical}
                  onClick={() => onArrange({ action: "distribute-vertical" })}
                  type="button"
                >
                  <Glyph name="distribute-vertical" size={15} />
                  {t("properties.vertical")}
                </button>
                <button
                  aria-label={t(
                    arrangement?.tidyUpDimension === "horizontal"
                      ? "properties.tidyUpHorizontal"
                      : arrangement?.tidyUpDimension === "vertical"
                        ? "properties.tidyUpVertical"
                        : "properties.tidyUpGrid",
                  )}
                  className={styles.tidyUp}
                  disabled={!arrangement?.canTidyUp}
                  onClick={() => onArrange({ action: "tidy-up" })}
                  type="button"
                >
                  <Glyph name="tidy-up" size={15} />
                  {t("properties.tidyUp")}
                </button>
              </div>
              <div className={styles.spacingGrid}>
                <Field
                  accessibleLabel={t("properties.horizontalSpacing")}
                  disabled={!arrangement}
                  label="H"
                  max={MAX_ARRANGEMENT_SPACING}
                  min={-MAX_ARRANGEMENT_SPACING}
                  onCommit={(draft) => {
                    if (draft.trim() === "") return null;
                    const spacing = Number(draft);
                    if (
                      !Number.isFinite(spacing) ||
                      Math.abs(spacing) > MAX_ARRANGEMENT_SPACING
                    )
                      return null;
                    onArrange({ action: "set-horizontal-spacing", spacing });
                    return formatNumber(spacing);
                  }}
                  placeholder={t("properties.mixed")}
                  suffix="px"
                  value={
                    arrangement?.horizontalSpacing === null || !arrangement
                      ? ""
                      : formatNumber(arrangement.horizontalSpacing)
                  }
                />
                <Field
                  accessibleLabel={t("properties.verticalSpacing")}
                  disabled={!arrangement}
                  label="V"
                  max={MAX_ARRANGEMENT_SPACING}
                  min={-MAX_ARRANGEMENT_SPACING}
                  onCommit={(draft) => {
                    if (draft.trim() === "") return null;
                    const spacing = Number(draft);
                    if (
                      !Number.isFinite(spacing) ||
                      Math.abs(spacing) > MAX_ARRANGEMENT_SPACING
                    )
                      return null;
                    onArrange({ action: "set-vertical-spacing", spacing });
                    return formatNumber(spacing);
                  }}
                  placeholder={t("properties.mixed")}
                  suffix="px"
                  value={
                    arrangement?.verticalSpacing === null || !arrangement
                      ? ""
                      : formatNumber(arrangement.verticalSpacing)
                  }
                />
              </div>
            </div>
            <div className={styles.multiActions}>
              {canCombineVariants && (
                <button onClick={onCombineVariants} type="button">
                  <Glyph name="component" size={13} />
                  {t("properties.combineAsVariants")}
                </button>
              )}
              <button onClick={onDuplicate} type="button">
                <Glyph name="duplicate" size={13} />
                {t("properties.duplicateLayers")}
              </button>
              <button onClick={onDelete} type="button">
                <Glyph name="trash" size={13} />
                {t("properties.deleteLayers")}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.noSelection} role="status">
            <Glyph name="select" size={22} />
            <strong>{t("properties.noSelection")}</strong>
            <span>{t("properties.selectLayer")}</span>
          </div>
        )}
        {selectionCount > 0 && (
          <ExportSection
            busy={svgOperation !== null}
            format={exportFormat}
            node={node}
            onExportFormatChange={onExportFormatChange}
            onExportRaster={onExportRaster}
            onExportSvg={onExportSvg}
            onRasterSettingsChange={onRasterExportSettingsChange}
            onSvgSettingsChange={onSvgExportSettingsChange}
            rasterSettings={rasterExportSettings}
            selectionCount={selectionCount}
            svgSettings={svgExportSettings}
          />
        )}
      </div>
    </section>
  );
}
