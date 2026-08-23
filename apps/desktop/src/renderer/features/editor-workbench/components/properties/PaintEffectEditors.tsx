import type {
  BlendMode,
  DesignNode,
  Effect,
  ImageFilters,
  MaskMode,
  Paint,
} from "@opendesign/design-contracts";
import { Icon } from "@opendesign/ui";
import type { MessageKey } from "@/shared/i18n/messages";
import { useI18n } from "../../../../i18n";
import styles from "../PropertiesPanel.module.scss";
import {
  ColorPicker,
  Field,
  commitNumber,
  formatNumber,
  isHexColor,
} from "./controls";
import { ImageAdjustmentsEditor } from "./ImageSection";

type FillNode = Extract<
  DesignNode,
  {
    kind:
      | "boolean"
      | "ellipse"
      | "frame"
      | "slot"
      | "path"
      | "polygon"
      | "rectangle"
      | "star"
      | "text"
      | "vector";
  }
>;
type CornerNode = Extract<
  DesignNode,
  { kind: "frame" | "slot" | "image" | "polygon" | "rectangle" | "star" }
>;
type StrokeNode = FillNode | Extract<DesignNode, { kind: "line" }>;

export const blendModes: BlendMode[] = [
  "pass-through",
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];

export const maskModes: MaskMode[] = [
  "none",
  "alpha",
  "outline",
  "luminance",
  "clipping",
];

export const maskModeLabelKeys: Record<MaskMode, MessageKey> = {
  none: "properties.maskNone",
  alpha: "properties.maskAlpha",
  outline: "properties.maskVector",
  luminance: "properties.maskLuminance",
  clipping: "properties.maskClipping",
};

export function isFillNode(node: DesignNode): node is FillNode {
  return (
    node.kind === "boolean" ||
    node.kind === "ellipse" ||
    node.kind === "frame" ||
    node.kind === "slot" ||
    node.kind === "path" ||
    node.kind === "polygon" ||
    node.kind === "rectangle" ||
    node.kind === "star" ||
    node.kind === "text" ||
    node.kind === "vector"
  );
}

export function isCornerNode(node: DesignNode): node is CornerNode {
  return (
    node.kind === "frame" ||
    node.kind === "slot" ||
    node.kind === "image" ||
    node.kind === "polygon" ||
    node.kind === "rectangle" ||
    node.kind === "star"
  );
}

export function isStrokeNode(node: DesignNode): node is StrokeNode {
  return node.kind === "line" || isFillNode(node);
}

function paintColor(paint: Paint): string {
  if (paint.type === "solid") return paint.color;
  if (paint.type === "image") return "#7c8494";
  return paint.stops[0]?.color ?? "#000000";
}

function changePaintType(
  paint: Paint,
  type: "solid" | "linear-gradient" | "radial-gradient" | "angular-gradient",
): Paint {
  if (type === "solid") {
    return {
      type,
      color: paintColor(paint),
      opacity: paint.opacity,
      ...(paint.visible === undefined ? {} : { visible: paint.visible }),
      ...(paint.blendMode === undefined ? {} : { blendMode: paint.blendMode }),
    };
  }
  const stops =
    paint.type !== "solid" && paint.type !== "image"
      ? paint.stops
      : [
          { offset: 0, color: paintColor(paint), opacity: 1 },
          { offset: 1, color: "#ffffff", opacity: 1 },
        ];
  return {
    type,
    stops,
    opacity: paint.opacity,
    from: { x: 0, y: 0.5 },
    to: { x: 1, y: 0.5 },
    rotation: 0,
    ...(paint.visible === undefined ? {} : { visible: paint.visible }),
    ...(paint.blendMode === undefined ? {} : { blendMode: paint.blendMode }),
  };
}

export function PaintEditor({
  index,
  paint,
  onChange,
  onRemove,
  onImageFiltersChange,
}: {
  index: number;
  paint: Paint;
  onChange: (paint: Paint) => void;
  onRemove: () => void;
  onImageFiltersChange?: (filters: ImageFilters) => void;
}) {
  const { t } = useI18n();
  const gradient =
    paint.type === "linear-gradient" ||
    paint.type === "radial-gradient" ||
    paint.type === "angular-gradient";
  return (
    <div className={styles.paintEditor}>
      <div className={styles.paintRow}>
        <ColorPicker
          label={t("properties.paintPreview", { index: index + 1 })}
          onChange={(color) => {
            if (paint.type === "solid") onChange({ ...paint, color });
            else if (gradient) {
              onChange({
                ...paint,
                stops: paint.stops.map((stop, stopIndex) =>
                  stopIndex === 0 ? { ...stop, color } : stop,
                ),
              });
            }
          }}
          value={paintColor(paint)}
        />
        <label className={styles.paintType}>
          <span className="sr-only">
            {t("properties.paintType", { index: index + 1 })}
          </span>
          <select
            aria-label={t("properties.paintType", { index: index + 1 })}
            onChange={(event) =>
              onChange(
                changePaintType(
                  paint,
                  event.target.value as Exclude<Paint["type"], "image">,
                ),
              )
            }
            value={paint.type}
          >
            <option value="solid">{t("properties.paintSolid")}</option>
            <option value="linear-gradient">
              {t("properties.paintLinear")}
            </option>
            <option value="radial-gradient">
              {t("properties.paintRadial")}
            </option>
            <option value="angular-gradient">
              {t("properties.paintAngular")}
            </option>
            {paint.type === "image" && (
              <option value="image">{t("properties.paintImage")}</option>
            )}
          </select>
        </label>
        <button
          aria-label={t("properties.removePaint", { index: index + 1 })}
          className={styles.paintRemove}
          onClick={onRemove}
          type="button"
        >
          <Icon name="lucide:x" size={12} />
        </button>
      </div>
      {paint.type === "solid" && (
        <div className={styles.grid}>
          <Field
            accessibleLabel={t("properties.paintColor", { index: index + 1 })}
            label="C"
            onCommit={(draft) => {
              const color = draft.trim().toLowerCase();
              if (!isHexColor(color)) return null;
              if (color !== paint.color) onChange({ ...paint, color });
              return color;
            }}
            type="text"
            value={paint.color}
          />
          <PaintOpacity paint={paint} onChange={onChange} />
        </div>
      )}
      {gradient && (
        <div className={styles.gradient}>
          {paint.stops.map((stop, stopIndex) => (
            <div className={styles.paintStop} key={`${index}-${stopIndex}`}>
              <ColorPicker
                label={t("properties.gradientStopColor", {
                  index: stopIndex + 1,
                })}
                onChange={(color) =>
                  onChange({
                    ...paint,
                    stops: paint.stops.map((candidate, candidateIndex) =>
                      candidateIndex === stopIndex
                        ? { ...candidate, color }
                        : candidate,
                    ),
                  })
                }
                value={stop.color}
              />
              <Field
                accessibleLabel={t("properties.gradientStopPosition", {
                  index: stopIndex + 1,
                })}
                label="P"
                max={100}
                min={0}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    stop.offset * 100,
                    (value) =>
                      onChange({
                        ...paint,
                        stops: paint.stops.map((candidate, candidateIndex) =>
                          candidateIndex === stopIndex
                            ? { ...candidate, offset: value / 100 }
                            : candidate,
                        ),
                      }),
                    { min: 0, max: 100 },
                  )
                }
                suffix="%"
                value={formatNumber(stop.offset * 100)}
              />
              <Field
                accessibleLabel={t("properties.gradientStopOpacity", {
                  index: stopIndex + 1,
                })}
                label="O"
                max={100}
                min={0}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    stop.opacity * 100,
                    (value) =>
                      onChange({
                        ...paint,
                        stops: paint.stops.map((candidate, candidateIndex) =>
                          candidateIndex === stopIndex
                            ? { ...candidate, opacity: value / 100 }
                            : candidate,
                        ),
                      }),
                    { min: 0, max: 100 },
                  )
                }
                suffix="%"
                value={formatNumber(stop.opacity * 100)}
              />
              <button
                aria-label={t("properties.removeGradientStop", {
                  index: stopIndex + 1,
                })}
                className={styles.paintRemove}
                disabled={paint.stops.length <= 2}
                onClick={() =>
                  onChange({
                    ...paint,
                    stops: paint.stops.filter(
                      (_, candidateIndex) => candidateIndex !== stopIndex,
                    ),
                  })
                }
                type="button"
              >
                <Icon name="lucide:x" size={11} />
              </button>
            </div>
          ))}
          <div className={styles.grid}>
            <Field
              accessibleLabel={t("properties.gradientRotation")}
              label="°"
              onCommit={(draft) =>
                commitNumber(draft, paint.rotation ?? 0, (rotation) =>
                  onChange({ ...paint, rotation }),
                )
              }
              suffix="°"
              value={formatNumber(paint.rotation ?? 0)}
            />
            <PaintOpacity paint={paint} onChange={onChange} />
          </div>
          <button
            className={styles.addPaint}
            onClick={() =>
              onChange({
                ...paint,
                stops: [
                  ...paint.stops,
                  { offset: 0.5, color: "#808080", opacity: 1 },
                ].sort((left, right) => left.offset - right.offset),
              })
            }
            type="button"
          >
            <Icon name="lucide:plus" size={13} />
            {t("properties.addGradientStop")}
          </button>
        </div>
      )}
      {paint.type === "image" && (
        <div className={styles.stack}>
          <small className={styles.help}>
            {t("properties.imagePaintAsset", { assetId: paint.assetId })}
          </small>
          <PaintOpacity paint={paint} onChange={onChange} />
          <ImageAdjustmentsEditor
            filters={paint.filters ?? {}}
            onFiltersChange={(filters) =>
              onImageFiltersChange
                ? onImageFiltersChange(filters)
                : onChange({ ...paint, filters })
            }
          />
        </div>
      )}
    </div>
  );
}

function PaintOpacity({
  paint,
  onChange,
}: {
  paint: Paint;
  onChange: (paint: Paint) => void;
}) {
  const { t } = useI18n();
  return (
    <Field
      accessibleLabel={t("properties.paintOpacity")}
      label="O"
      max={100}
      min={0}
      onCommit={(draft) =>
        commitNumber(
          draft,
          paint.opacity * 100,
          (value) => onChange({ ...paint, opacity: value / 100 }),
          { min: 0, max: 100 },
        )
      }
      suffix="%"
      value={formatNumber(paint.opacity * 100)}
    />
  );
}

export function defaultEffect(type: Effect["type"]): Effect {
  if (type === "layer-blur" || type === "background-blur") {
    return { type, radius: 12 };
  }
  if (type === "grayscale") return { type, amount: 1 };
  if (type === "outer-glow" || type === "inner-glow") {
    return {
      type,
      color: "#4f7fff",
      opacity: 0.5,
      radius: 24,
      spread: 0,
    };
  }
  return {
    type,
    color: "#000000",
    opacity: 0.25,
    offset: { x: 0, y: 8 },
    blur: 24,
    spread: 0,
  };
}

export function EffectEditor({
  effect,
  index,
  onChange,
  onRemove,
}: {
  effect: Effect;
  index: number;
  onChange: (effect: Effect) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const blur =
    effect.type === "layer-blur" || effect.type === "background-blur";
  const glow = effect.type === "outer-glow" || effect.type === "inner-glow";
  const shadow =
    effect.type === "drop-shadow" || effect.type === "inner-shadow";
  return (
    <div className={styles.effectEditor}>
      <div className={styles.paintRow}>
        {!blur && effect.type !== "grayscale" && (
          <ColorPicker
            label={t("properties.effectColor", { index: index + 1 })}
            onChange={(color) => onChange({ ...effect, color })}
            value={effect.color}
          />
        )}
        <span className={styles.paintValue}>{effect.type}</span>
        <label className={styles.effectVisible}>
          <input
            aria-label={t("properties.effectVisible", { index: index + 1 })}
            checked={effect.visible ?? true}
            onChange={(event) =>
              onChange({ ...effect, visible: event.target.checked })
            }
            type="checkbox"
          />
        </label>
        <button
          aria-label={t("properties.removeEffect", { index: index + 1 })}
          className={styles.paintRemove}
          onClick={onRemove}
          type="button"
        >
          <Icon name="lucide:x" size={12} />
        </button>
      </div>
      {blur && (
        <div className={styles.grid}>
          <Field
            accessibleLabel={t("properties.effectRadius")}
            label="R"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                effect.radius,
                (radius) => onChange({ ...effect, radius }),
                { min: 0 },
              )
            }
            suffix="px"
            value={formatNumber(effect.radius)}
          />
        </div>
      )}
      {effect.type === "grayscale" && (
        <div className={styles.grid}>
          <Field
            accessibleLabel={t("properties.effectAmount")}
            label="A"
            max={100}
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                effect.amount * 100,
                (amount) => onChange({ ...effect, amount: amount / 100 }),
                { min: 0, max: 100 },
              )
            }
            suffix="%"
            value={formatNumber(effect.amount * 100)}
          />
        </div>
      )}
      {glow && (
        <div className={styles.grid}>
          <Field
            accessibleLabel={t("properties.effectRadius")}
            label="R"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                effect.radius,
                (radius) => onChange({ ...effect, radius }),
                { min: 0 },
              )
            }
            suffix="px"
            value={formatNumber(effect.radius)}
          />
          <Field
            accessibleLabel={t("properties.effectSpread")}
            label="S"
            onCommit={(draft) =>
              commitNumber(draft, effect.spread, (spread) =>
                onChange({ ...effect, spread }),
              )
            }
            suffix="px"
            value={formatNumber(effect.spread)}
          />
          <Field
            accessibleLabel={t("properties.effectOpacity")}
            label="O"
            max={100}
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                effect.opacity * 100,
                (opacity) => onChange({ ...effect, opacity: opacity / 100 }),
                { min: 0, max: 100 },
              )
            }
            suffix="%"
            value={formatNumber(effect.opacity * 100)}
          />
        </div>
      )}
      {shadow && (
        <div className={styles.grid}>
          <Field
            accessibleLabel={t("properties.effectOffsetX")}
            label="X"
            onCommit={(draft) =>
              commitNumber(draft, effect.offset.x, (x) =>
                onChange({ ...effect, offset: { ...effect.offset, x } }),
              )
            }
            value={formatNumber(effect.offset.x)}
          />
          <Field
            accessibleLabel={t("properties.effectOffsetY")}
            label="Y"
            onCommit={(draft) =>
              commitNumber(draft, effect.offset.y, (y) =>
                onChange({ ...effect, offset: { ...effect.offset, y } }),
              )
            }
            value={formatNumber(effect.offset.y)}
          />
          <Field
            accessibleLabel={t("properties.effectBlur")}
            label="B"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                effect.blur,
                (blurValue) => onChange({ ...effect, blur: blurValue }),
                { min: 0 },
              )
            }
            suffix="px"
            value={formatNumber(effect.blur)}
          />
          <Field
            accessibleLabel={t("properties.effectSpread")}
            label="S"
            onCommit={(draft) =>
              commitNumber(draft, effect.spread, (spread) =>
                onChange({ ...effect, spread }),
              )
            }
            suffix="px"
            value={formatNumber(effect.spread)}
          />
          <Field
            accessibleLabel={t("properties.effectOpacity")}
            label="O"
            max={100}
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                effect.opacity * 100,
                (opacity) => onChange({ ...effect, opacity: opacity / 100 }),
                { min: 0, max: 100 },
              )
            }
            suffix="%"
            value={formatNumber(effect.opacity * 100)}
          />
        </div>
      )}
    </div>
  );
}
