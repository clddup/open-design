import type { ImageNode, ImagePlacement } from "@opendesign/design-contracts";
import { Icon } from "@opendesign/ui";
import { useI18n } from "../../i18n";
import styles from "../PropertiesPanel.module.scss";
import { Field, Section, commitNumber, cx, formatNumber } from "./controls";

export function ImageSection({
  node,
  onChange,
  onCrop,
  onReplace,
}: {
  node: ImageNode;
  onChange: (placement: ImagePlacement) => void;
  onCrop: () => boolean;
  onReplace: () => void;
}) {
  const { t } = useI18n();
  const placement = node.properties.placement;
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
      </div>
    </Section>
  );
}
