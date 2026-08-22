import type {
  BooleanOperation,
  ComponentPropertyAssignment,
  ComponentPropertyType,
  ComponentOverridePatch,
  DesignAsset,
  DesignDocument,
  DesignNode,
  ExportSetting,
  ImageFilters,
  ImagePaint,
  ImagePlacement,
  InstanceSwapPreferredValue,
  LayoutConstraints,
  LayoutGuide,
  LayoutPositioning,
  SlotSettings,
  VariableBindingTarget,
} from "@opendesign/design-contracts";
import {
  MAX_ARRANGEMENT_SPACING,
  type ArrangeOperation,
  type ArrangementSelectionMetrics,
} from "@opendesign/editor-runtime";
import { Icon } from "@opendesign/ui";
import { useI18n } from "../i18n";
import type { UpdatePropertiesPatch } from "../features/editor/types";
import type { StyleActions } from "../use-style-actions";
import type { ProjectLibraryActions } from "../use-project-library-actions";
import type {
  ExportFormat,
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
  SvgFidelityReport,
  SvgOperationNotice,
} from "./properties/ExportSection";
import { SelectedNodeProperties } from "./properties/SelectedNodeProperties";
import type { FontInspectorContext } from "./properties/TypographySection";
import { ExportSettingsEditor } from "./properties/ExportSettingsEditor";
import { Field, formatNumber } from "./properties/controls";
import styles from "./PropertiesPanel.module.scss";

export type { ComponentInspectorOption, ComponentInspectorSource };

export function PropertiesPanel({
  node,
  activePageId,
  document,
  componentContext,
  arrangement,
  booleanOperationEditable,
  booleanOperandParent,
  canCombineVariants,
  canAddToVariantSet,
  canDelete,
  layoutMode,
  onArrange,
  onBooleanOperationChange,
  onCreateComponent,
  onCreateComponentInstance,
  onCombineVariants,
  onAddToVariantSet,
  onDelete,
  onDetachComponentInstance,
  onDissolveVariantSet,
  onDuplicateVariant,
  onDuplicate,
  onGoToComponentMain,
  onCancelSvgOperation,
  onDismissSvgFeedback,
  onExportSvg,
  onExportRaster,
  onExportStoredSetting,
  onExportFormatChange,
  onCropImage,
  onReplaceImage,
  imageEditStatus,
  imageEditAction,
  onRemoveImageBackground,
  onEditImageWithPrompt,
  onSelectImageEditReference,
  onCancelImageEdit,
  onSwitchImageSource,
  onUpdateImageFilters,
  onUpdateImagePaintFilters,
  onUpdateImagePlacement,
  onRemoveComponent,
  onRemoveVariant,
  onAddComponentProperty,
  onAddVariantProperty,
  onRemoveComponentProperty,
  onRemoveVariantProperty,
  onRenameComponentProperty,
  onReorderComponentProperties,
  onRenameVariantProperty,
  onRenameVariantValue,
  onReorderVariantProperties,
  onReorderVariantValues,
  onResetComponentInstance,
  onResetComponentProperty,
  onResetComponentSourceOverride,
  onSelectBooleanParent,
  onSetConstraints,
  onSetLayoutPositioning,
  onSetFrameLayoutGuides,
  onReorderGridTracks,
  onUpdate,
  onUpdateComponentOverride,
  onSetComponentProperty,
  onClearComponentSlot,
  onCreateComponentSlotOverride,
  onResetComponentSlot,
  onSetComponentSlotSettings,
  onSetVariantProperties,
  onSetVariableBinding,
  onSetVariableMode,
  styleActions,
  projectLibraries,
  selectionCount,
  exportFormat,
  rasterExportSettings,
  svgExportSettings,
  svgFeedback,
  svgOperation,
  onSvgExportSettingsChange,
  onRasterExportSettingsChange,
  fontContext,
}: {
  node: DesignNode | undefined;
  activePageId: string;
  document: DesignDocument;
  componentContext?: ComponentInspectorContext;
  arrangement: ArrangementSelectionMetrics | null;
  booleanOperationEditable: boolean;
  booleanOperandParent?: { id: string; name: string };
  canCombineVariants: boolean;
  canAddToVariantSet: boolean;
  canDelete: boolean;
  layoutMode: "constraints" | "sizing" | "wrap-sizing" | "absolute" | null;
  onArrange: (operation: ArrangeOperation) => void;
  onBooleanOperationChange: (operation: BooleanOperation) => void;
  onCreateComponent: () => void;
  onCreateComponentInstance: () => void;
  onCombineVariants: () => void;
  onAddToVariantSet: () => void;
  onDelete: () => void;
  onDetachComponentInstance: () => void;
  onDissolveVariantSet: () => void;
  onDuplicateVariant: () => void;
  onDuplicate: () => void;
  onGoToComponentMain: () => void;
  onCancelSvgOperation: () => void;
  onDismissSvgFeedback: () => void;
  onExportSvg: () => void;
  onExportRaster: () => void;
  onExportStoredSetting: (setting: ExportSetting) => void;
  onExportFormatChange: (format: ExportFormat) => void;
  onCropImage: () => boolean;
  onReplaceImage: () => void;
  imageEditStatus: "running" | "cancelling" | null;
  imageEditAction: "remove-background" | "prompt-edit" | null;
  onRemoveImageBackground: () => void;
  onEditImageWithPrompt: (prompt: string, reference?: DesignAsset) => void;
  onSelectImageEditReference: () => Promise<DesignAsset | null>;
  onCancelImageEdit: () => void;
  onSwitchImageSource: (
    nodeId: string,
    assetId: string,
    expectedAssetId: string,
  ) => void;
  onUpdateImageFilters: (filters: ImageFilters) => void;
  onUpdateImagePaintFilters: (
    nodeId: string,
    paintField: "fills" | "strokes",
    paintIndex: number,
    expectedPaint: ImagePaint,
    filters: ImageFilters,
  ) => void;
  onUpdateImagePlacement: (placement: ImagePlacement) => void;
  onRemoveComponent: () => void;
  onRemoveVariant: () => void;
  onAddComponentProperty: (input: {
    name: string;
    sourceNodeId: string;
    type: ComponentPropertyType;
  }) => void;
  onAddVariantProperty: (name: string) => void;
  onRemoveComponentProperty: (propertyName: string) => void;
  onRemoveVariantProperty: (propertyName: string) => void;
  onRenameComponentProperty: (propertyName: string, name: string) => void;
  onReorderComponentProperties: (
    componentPropertyOrder: readonly string[],
  ) => void;
  onRenameVariantProperty: (propertyName: string, name: string) => void;
  onRenameVariantValue: (
    propertyName: string,
    value: string,
    name: string,
  ) => void;
  onReorderVariantProperties: (propertyOrder: readonly string[]) => void;
  onReorderVariantValues: (
    propertyName: string,
    values: readonly string[],
  ) => void;
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
  onReorderGridTracks: (
    frameId: string,
    axis: "rows" | "columns",
    fromIndices: readonly number[],
    insertionIndex: number,
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
  onClearComponentSlot: (propertyName: string) => void;
  onCreateComponentSlotOverride: (propertyName: string) => void;
  onResetComponentSlot: (propertyName: string) => void;
  onSetComponentSlotSettings: (
    propertyName: string,
    input: {
      description?: string;
      preferredValues: readonly InstanceSwapPreferredValue[];
      settings: SlotSettings;
    },
  ) => void;
  onSetVariantProperties: (
    componentId: string,
    properties: Readonly<Record<string, string>>,
  ) => void;
  onSetVariableBinding: (
    target: VariableBindingTarget,
    variableId: string | null,
  ) => void;
  onSetVariableMode: (collectionId: string, modeId: string | null) => void;
  styleActions?: StyleActions;
  projectLibraries?: ProjectLibraryActions;
  selectionCount: number;
  exportFormat: ExportFormat;
  rasterExportSettings: RasterExportSettings;
  svgExportSettings: SvgWorkerExportSettings;
  svgFeedback: SvgInterchangeFeedback | null;
  svgOperation: SvgOperationStatus | null;
  onSvgExportSettingsChange: (settings: SvgWorkerExportSettings) => void;
  onRasterExportSettingsChange: (settings: RasterExportSettings) => void;
  fontContext?: FontInspectorContext;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t("properties.label")} className={styles.root}>
      <div className={styles.content}>
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
        {node ? (
          <SelectedNodeProperties
            activePageId={activePageId}
            document={document}
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
              ((node.kind === "frame" || node.kind === "slot") &&
                node.properties.autoLayout !== undefined &&
                node.properties.autoLayout.mode !== "none")
            }
            onBooleanOperationChange={onBooleanOperationChange}
            onCreateComponent={onCreateComponent}
            onCreateComponentInstance={onCreateComponentInstance}
            onDuplicateVariant={onDuplicateVariant}
            onDissolveVariantSet={onDissolveVariantSet}
            onDelete={onDelete}
            onDetachComponentInstance={onDetachComponentInstance}
            onDuplicate={onDuplicate}
            onGoToComponentMain={onGoToComponentMain}
            onCropImage={onCropImage}
            onReplaceImage={onReplaceImage}
            imageEditStatus={imageEditStatus}
            imageEditAction={imageEditAction}
            onRemoveImageBackground={onRemoveImageBackground}
            onEditImageWithPrompt={onEditImageWithPrompt}
            onSelectImageEditReference={onSelectImageEditReference}
            onCancelImageEdit={onCancelImageEdit}
            onSwitchImageSource={onSwitchImageSource}
            onUpdateImageFilters={onUpdateImageFilters}
            onUpdateImagePaintFilters={onUpdateImagePaintFilters}
            onUpdateImagePlacement={onUpdateImagePlacement}
            onRemoveComponent={onRemoveComponent}
            onRemoveVariant={onRemoveVariant}
            onAddComponentProperty={onAddComponentProperty}
            onAddVariantProperty={onAddVariantProperty}
            onRemoveComponentProperty={onRemoveComponentProperty}
            onRemoveVariantProperty={onRemoveVariantProperty}
            onRenameComponentProperty={onRenameComponentProperty}
            onReorderComponentProperties={onReorderComponentProperties}
            onRenameVariantProperty={onRenameVariantProperty}
            onRenameVariantValue={onRenameVariantValue}
            onReorderVariantProperties={onReorderVariantProperties}
            onReorderVariantValues={onReorderVariantValues}
            onResetComponentInstance={onResetComponentInstance}
            onResetComponentProperty={onResetComponentProperty}
            onResetComponentSourceOverride={onResetComponentSourceOverride}
            onSelectBooleanParent={onSelectBooleanParent}
            onSetConstraints={onSetConstraints}
            onSetLayoutPositioning={onSetLayoutPositioning}
            onSetFrameLayoutGuides={onSetFrameLayoutGuides}
            onReorderGridTracks={onReorderGridTracks}
            onUpdate={onUpdate}
            onUpdateComponentOverride={onUpdateComponentOverride}
            onSetComponentProperty={onSetComponentProperty}
            onClearComponentSlot={onClearComponentSlot}
            onCreateComponentSlotOverride={onCreateComponentSlotOverride}
            onResetComponentSlot={onResetComponentSlot}
            onSetComponentSlotSettings={onSetComponentSlotSettings}
            onSetVariantProperties={onSetVariantProperties}
            onSetVariableBinding={onSetVariableBinding}
            onSetVariableMode={onSetVariableMode}
            styleActions={styleActions}
            projectLibraries={projectLibraries}
            fontContext={fontContext}
          />
        ) : selectionCount > 1 ? (
          <div className={styles.multiProperties}>
            <div className={styles.noSelection} role="status">
              <Icon name="lucide:layers" size={22} />
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
                    [
                      "align-left",
                      "lucide:align-start-horizontal",
                      "properties.alignLeft",
                    ],
                    [
                      "align-horizontal-center",
                      "lucide:align-center-horizontal",
                      "properties.alignHCenter",
                    ],
                    [
                      "align-right",
                      "lucide:align-end-horizontal",
                      "properties.alignRight",
                    ],
                    [
                      "align-top",
                      "lucide:align-start-vertical",
                      "properties.alignTop",
                    ],
                    [
                      "align-vertical-center",
                      "lucide:align-center-vertical",
                      "properties.alignVCenter",
                    ],
                    [
                      "align-bottom",
                      "lucide:align-end-vertical",
                      "properties.alignBottom",
                    ],
                  ] as const
                ).map(([action, icon, key]) => (
                  <button
                    aria-label={t(key)}
                    disabled={!arrangement}
                    key={action}
                    onClick={() => onArrange({ action })}
                    type="button"
                  >
                    <Icon name={icon} size={15} />
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
                  <Icon
                    name="lucide:align-horizontal-distribute-center"
                    size={15}
                  />
                  {t("properties.horizontal")}
                </button>
                <button
                  aria-label={t("properties.distributeVertical")}
                  disabled={!arrangement?.canDistributeVertical}
                  onClick={() => onArrange({ action: "distribute-vertical" })}
                  type="button"
                >
                  <Icon
                    name="lucide:align-vertical-distribute-center"
                    size={15}
                  />
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
                  <Icon name="lucide:panels-top-left" size={15} />
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
                  <Icon name="lucide:component" size={13} />
                  {t("properties.combineAsVariants")}
                </button>
              )}
              {canAddToVariantSet && (
                <button onClick={onAddToVariantSet} type="button">
                  <Icon name="lucide:component" size={13} />
                  {t("properties.addToVariantSet")}
                </button>
              )}
              <button onClick={onDuplicate} type="button">
                <Icon name="lucide:copy" size={13} />
                {t("properties.duplicateLayers")}
              </button>
              <button onClick={onDelete} type="button">
                <Icon name="lucide:trash-2" size={13} />
                {t("properties.deleteLayers")}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.noSelection} role="status">
            <Icon name="lucide:mouse-pointer-2" size={22} />
            <strong>{t("properties.noSelection")}</strong>
            <span>{t("properties.selectLayer")}</span>
          </div>
        )}
        {selectionCount > 0 && node && !componentContext?.activeSourcePath && (
          <ExportSettingsEditor
            busy={svgOperation !== null}
            node={node}
            onChange={(exportSettings) =>
              onUpdate({ exportSettings: [...exportSettings] })
            }
            onExport={onExportStoredSetting}
          />
        )}
        {selectionCount > 0 && !componentContext?.activeSourcePath && (
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
