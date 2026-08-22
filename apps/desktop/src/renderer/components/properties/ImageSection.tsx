import {
  IMAGE_FILTER_KEYS,
  type DesignAsset,
  type DesignDocument,
  type ImageFilterKey,
  type ImageFilters,
  type ImageNode,
  type ImagePlacement,
} from "@opendesign/design-contracts";
import { getImageAssetFamily } from "@opendesign/editor-runtime";
import { Button, Icon } from "@opendesign/ui";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { MessageKey } from "../../../shared/i18n/messages";
import { useI18n } from "../../i18n";
import { IMAGE_DERIVATION_OPERATION_LABEL_KEYS } from "../../design-assets";
import styles from "../PropertiesPanel.module.scss";
import imageStyles from "./ImageSection.module.scss";
import { Field, Section, commitNumber, cx, formatNumber } from "./controls";

const FILTER_LABEL_KEYS: Record<ImageFilterKey, MessageKey> = {
  exposure: "properties.imageExposure",
  contrast: "properties.imageContrast",
  saturation: "properties.imageSaturation",
  temperature: "properties.imageTemperature",
  tint: "properties.imageTint",
  highlights: "properties.imageHighlights",
  shadows: "properties.imageShadows",
};

export function ImageSection({
  node,
  document,
  onChange,
  onFiltersChange,
  onCrop,
  onReplace,
  editStatus,
  editAction,
  onRemoveBackground,
  onEditWithPrompt,
  onSelectEditReference,
  onCancelEdit,
  onSourceChange,
}: {
  node: ImageNode;
  document: DesignDocument;
  onChange: (placement: ImagePlacement) => void;
  onFiltersChange: (filters: ImageFilters) => void;
  onCrop: () => boolean;
  onReplace: () => void;
  editStatus: "running" | "cancelling" | null;
  editAction: "remove-background" | "prompt-edit" | null;
  onRemoveBackground: () => void;
  onEditWithPrompt: (prompt: string, reference?: DesignAsset) => void;
  onSelectEditReference: () => Promise<DesignAsset | null>;
  onCancelEdit: () => void;
  onSourceChange: (
    nodeId: string,
    assetId: string,
    expectedAssetId: string,
  ) => void;
}) {
  const { t } = useI18n();
  const promptId = useId();
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState<DesignAsset | undefined>();
  const [selectingReference, setSelectingReference] = useState(false);
  useEffect(() => {
    setPromptEditorOpen(false);
    setPrompt("");
    setReference(undefined);
    setSelectingReference(false);
  }, [node.id]);
  const placement = node.properties.placement;
  const filters = node.properties.filters ?? {};
  const sourceFamily = getImageAssetFamily(document, node.properties.assetId);
  const originalAssetId =
    sourceFamily?.rootAssetIds.length === 1
      ? sourceFamily.rootAssetIds[0]
      : undefined;
  const focalPoint =
    placement.mode === "fill" || placement.mode === "crop"
      ? placement.focalPoint
      : { x: 0.5, y: 0.5 };
  const crop =
    placement.mode === "crop"
      ? placement
      : {
          mode: "crop" as const,
          focalPoint,
          zoom: 1,
          rotation: 0,
          flipHorizontal: false,
          flipVertical: false,
        };
  const changeMode = (mode: ImagePlacement["mode"]) => {
    if (mode === "stretch" || mode === "fit") {
      onChange({ mode });
    } else if (mode === "fill") {
      onChange({ mode, focalPoint });
    } else {
      onChange(crop);
    }
  };

  return (
    <Section title={t("properties.image")}>
      <div className={cx(styles.stack, styles.imagePlacementEditor)}>
        <label className={styles.select}>
          <span>{t("properties.imagePlacement")}</span>
          <select
            aria-label={t("properties.imagePlacement")}
            onChange={(event) =>
              changeMode(event.target.value as ImagePlacement["mode"])
            }
            value={placement.mode}
          >
            <option value="stretch">{t("properties.imageStretch")}</option>
            <option value="fit">{t("properties.imageFit")}</option>
            <option value="fill">{t("properties.imageFill")}</option>
            <option value="crop">{t("properties.imageCrop")}</option>
          </select>
        </label>
        {(placement.mode === "fill" || placement.mode === "crop") && (
          <div className={styles.grid}>
            <Field
              accessibleLabel={t("properties.imageFocalX")}
              label="FX"
              max={100}
              min={0}
              onCommit={(draft) =>
                commitNumber(
                  draft,
                  focalPoint.x * 100,
                  (value) =>
                    onChange({
                      ...placement,
                      focalPoint: { ...focalPoint, x: value / 100 },
                    }),
                  { min: 0, max: 100 },
                )
              }
              suffix="%"
              value={formatNumber(focalPoint.x * 100)}
            />
            <Field
              accessibleLabel={t("properties.imageFocalY")}
              label="FY"
              max={100}
              min={0}
              onCommit={(draft) =>
                commitNumber(
                  draft,
                  focalPoint.y * 100,
                  (value) =>
                    onChange({
                      ...placement,
                      focalPoint: { ...focalPoint, y: value / 100 },
                    }),
                  { min: 0, max: 100 },
                )
              }
              suffix="%"
              value={formatNumber(focalPoint.y * 100)}
            />
          </div>
        )}
        {placement.mode === "crop" && (
          <>
            <div className={styles.grid}>
              <Field
                accessibleLabel={t("properties.imageZoom")}
                label="Z"
                max={6_400}
                min={100}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    placement.zoom * 100,
                    (value) => onChange({ ...placement, zoom: value / 100 }),
                    { min: 100, max: 6_400 },
                  )
                }
                suffix="%"
                value={formatNumber(placement.zoom * 100)}
              />
              <Field
                accessibleLabel={t("properties.imageRotation")}
                label="°"
                max={360}
                min={-360}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    placement.rotation,
                    (rotation) => onChange({ ...placement, rotation }),
                    { min: -360, max: 360 },
                  )
                }
                value={formatNumber(placement.rotation)}
              />
            </div>
            <div
              aria-label={t("properties.imageTransform")}
              className={styles.imagePlacementActions}
              role="group"
            >
              <button
                aria-pressed={placement.flipHorizontal}
                className={
                  placement.flipHorizontal
                    ? styles.imagePlacementActive
                    : undefined
                }
                onClick={() =>
                  onChange({
                    ...placement,
                    flipHorizontal: !placement.flipHorizontal,
                  })
                }
                type="button"
              >
                {t("properties.imageFlipHorizontal")}
              </button>
              <button
                aria-pressed={placement.flipVertical}
                className={
                  placement.flipVertical
                    ? styles.imagePlacementActive
                    : undefined
                }
                onClick={() =>
                  onChange({
                    ...placement,
                    flipVertical: !placement.flipVertical,
                  })
                }
                type="button"
              >
                {t("properties.imageFlipVertical")}
              </button>
              <button
                onClick={() =>
                  onChange({
                    mode: "crop",
                    focalPoint: { x: 0.5, y: 0.5 },
                    zoom: 1,
                    rotation: 0,
                    flipHorizontal: false,
                    flipVertical: false,
                  })
                }
                type="button"
              >
                {t("properties.imageReset")}
              </button>
            </div>
          </>
        )}
        <button
          className={cx(styles.addPaint, styles.imageReplaceButton)}
          onClick={onCrop}
          type="button"
        >
          <Icon name="lucide:mouse-pointer-2" size={13} />
          {t("properties.imageEditCrop")}
        </button>
        <button
          className={cx(styles.addPaint, styles.imageReplaceButton)}
          onClick={onReplace}
          type="button"
        >
          <Icon name="lucide:image" size={13} />
          {t("properties.imageReplace")}
        </button>
        <div className={imageStyles.aiEditActions}>
          <Button
            aria-busy={editAction === "prompt-edit" && editStatus !== null}
            aria-expanded={promptEditorOpen}
            disabled={editStatus !== null}
            icon={
              editAction === "prompt-edit" && editStatus
                ? "lucide:loader-circle"
                : "lucide:wand-sparkles"
            }
            onClick={() => setPromptEditorOpen((open) => !open)}
          >
            {editAction === "prompt-edit" && editStatus
              ? t("properties.imageEditingWithPrompt")
              : t("properties.imageEditWithPrompt")}
          </Button>
          <Button
            aria-busy={
              editAction === "remove-background" && editStatus !== null
            }
            disabled={editStatus !== null}
            icon={
              editAction === "remove-background" && editStatus
                ? "lucide:loader-circle"
                : "lucide:scan-line"
            }
            onClick={onRemoveBackground}
          >
            {editAction === "remove-background" && editStatus
              ? t("properties.imageRemovingBackground")
              : t("properties.imageRemoveBackground")}
          </Button>
        </div>
        {promptEditorOpen && (
          <div className={imageStyles.promptEditor}>
            <label htmlFor={promptId}>{t("properties.imageEditPrompt")}</label>
            <textarea
              disabled={editStatus !== null}
              id={promptId}
              maxLength={32_000}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && editStatus === null) {
                  event.preventDefault();
                  setPromptEditorOpen(false);
                }
              }}
              placeholder={t("properties.imageEditPromptPlaceholder")}
              rows={3}
              value={prompt}
            />
            <div className={imageStyles.referenceRow}>
              <span title={reference?.name}>
                {reference?.name ?? t("properties.imageEditNoReference")}
              </span>
              {reference ? (
                <Button
                  disabled={editStatus !== null}
                  onClick={() => setReference(undefined)}
                  tone="quiet"
                >
                  {t("common.remove")}
                </Button>
              ) : (
                <Button
                  disabled={editStatus !== null || selectingReference}
                  icon="lucide:image-plus"
                  onClick={() => {
                    setSelectingReference(true);
                    void onSelectEditReference()
                      .then((asset) => {
                        if (asset) setReference(asset);
                      })
                      .finally(() => setSelectingReference(false));
                  }}
                  tone="quiet"
                >
                  {selectingReference
                    ? t("properties.imageSelectingReference")
                    : t("properties.imageAddReference")}
                </Button>
              )}
            </div>
            <div className={imageStyles.promptActions}>
              {editStatus ? (
                <Button
                  disabled={editStatus === "cancelling"}
                  onClick={onCancelEdit}
                  tone="quiet"
                >
                  {editStatus === "cancelling"
                    ? t("properties.imageCancellingEdit")
                    : t("common.cancel")}
                </Button>
              ) : (
                <Button onClick={() => setPromptEditorOpen(false)} tone="quiet">
                  {t("common.cancel")}
                </Button>
              )}
              <Button
                disabled={editStatus !== null || prompt.trim().length === 0}
                onClick={() => onEditWithPrompt(prompt.trim(), reference)}
                tone="primary"
              >
                {t("properties.imageApplyPromptEdit")}
              </Button>
            </div>
          </div>
        )}
        {editStatus && !promptEditorOpen && (
          <div className={imageStyles.editProgress}>
            <span>
              {editAction === "prompt-edit"
                ? t("properties.imageEditingWithPrompt")
                : t("properties.imageRemovingBackground")}
            </span>
            <Button
              disabled={editStatus === "cancelling"}
              onClick={onCancelEdit}
              tone="quiet"
            >
              {editStatus === "cancelling"
                ? t("properties.imageCancellingEdit")
                : t("common.cancel")}
            </Button>
          </div>
        )}
        {sourceFamily && sourceFamily.assetIds.length > 1 && (
          <div className={imageStyles.sourceVersions}>
            <div className={imageStyles.sourceVersionHeader}>
              <strong>{t("properties.imageSourceHistory")}</strong>
              {originalAssetId && (
                <button
                  disabled={originalAssetId === node.properties.assetId}
                  onClick={() =>
                    onSourceChange(
                      node.id,
                      originalAssetId,
                      node.properties.assetId,
                    )
                  }
                  type="button"
                >
                  <Icon name="lucide:rotate-ccw" size={11} />
                  {t("properties.imageRestoreOriginal")}
                </button>
              )}
            </div>
            <label className={imageStyles.sourceVersionSelect}>
              <span>{t("properties.imageSourceVersion")}</span>
              <select
                aria-label={t("properties.imageSourceVersion")}
                onChange={(event) =>
                  onSourceChange(
                    node.id,
                    event.target.value,
                    node.properties.assetId,
                  )
                }
                value={node.properties.assetId}
              >
                {sourceFamily.assetIds.map((assetId) => {
                  const asset = document.assetsById[assetId];
                  const incoming = sourceFamily.derivationIds
                    .map(
                      (derivationId) =>
                        document.imageAssetDerivationsById[derivationId],
                    )
                    .find(
                      (derivation) => derivation?.resultAssetId === assetId,
                    );
                  const role = sourceFamily.rootAssetIds.includes(assetId)
                    ? t("properties.imageSourceOriginal")
                    : t(
                        IMAGE_DERIVATION_OPERATION_LABEL_KEYS[
                          incoming?.operation ?? "replacement"
                        ],
                      );
                  return (
                    <option key={assetId} value={assetId}>
                      {role} · {asset?.name ?? assetId}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
        )}
        <ImageAdjustmentsEditor
          filters={filters}
          onFiltersChange={onFiltersChange}
        />
      </div>
    </Section>
  );
}

export function ImageAdjustmentsEditor({
  filters,
  onFiltersChange,
}: {
  filters: ImageFilters;
  onFiltersChange: (filters: ImageFilters) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className={imageStyles.adjustmentHeader}>
        <strong>{t("properties.imageAdjustments")}</strong>
        <button
          disabled={IMAGE_FILTER_KEYS.every((key) => !filters[key])}
          onClick={() => onFiltersChange({})}
          type="button"
        >
          {t("properties.imageResetAdjustments")}
        </button>
      </div>
      <div
        aria-label={t("properties.imageAdjustments")}
        className={imageStyles.adjustmentList}
        role="group"
      >
        {IMAGE_FILTER_KEYS.map((key) => (
          <ImageFilterControl
            key={key}
            label={t(FILTER_LABEL_KEYS[key])}
            onCommit={(value) => onFiltersChange({ ...filters, [key]: value })}
            value={filters[key] ?? 0}
          />
        ))}
      </div>
    </>
  );
}

function ImageFilterControl({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const controlId = useId();
  const percent = Math.round(value * 100);
  const [draft, setDraft] = useState(percent);
  const [numberDraft, setNumberDraft] = useState(String(percent));
  useEffect(() => {
    setDraft(percent);
    setNumberDraft(String(percent));
  }, [percent]);

  const commit = (candidate = draft) => {
    if (!Number.isFinite(candidate)) {
      setDraft(percent);
      setNumberDraft(String(percent));
      return;
    }
    const next = Math.min(100, Math.max(-100, Math.round(candidate)));
    setDraft(next);
    setNumberDraft(String(next));
    if (next !== percent) onCommit(next / 100);
  };
  const handleKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key.startsWith("Arrow") ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      commit(Number(event.currentTarget.value));
    }
  };

  return (
    <div className={imageStyles.adjustmentRow}>
      <label htmlFor={`${controlId}-range`}>{label}</label>
      <input
        aria-label={label}
        id={`${controlId}-range`}
        max={100}
        min={-100}
        onBlur={(event) => commit(Number(event.currentTarget.value))}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          setDraft(next);
          setNumberDraft(String(next));
        }}
        onKeyUp={handleKeyUp}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        step={1}
        type="range"
        value={draft}
      />
      <span className={imageStyles.adjustmentValue}>
        <input
          aria-label={`${label} %`}
          max={100}
          min={-100}
          onBlur={() => commit(Number(numberDraft))}
          onChange={(event) => setNumberDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(percent);
              setNumberDraft(String(percent));
              event.currentTarget.blur();
            }
          }}
          type="number"
          value={numberDraft}
        />
        <small>%</small>
      </span>
    </div>
  );
}
