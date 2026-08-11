import type {
  BlendMode,
  BooleanOperation,
  DesignNode,
  Effect,
  ImageNode,
  ImagePlacement,
  LineEndpoint,
  MaskMode,
  Paint,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";
import type {
  ArrangeOperation,
  ArrangementSelectionMetrics,
} from "@opendesign/editor-runtime";
import {
  MAX_ARRANGEMENT_SPACING,
  MAX_SVG_EXPORT_PADDING,
} from "@opendesign/editor-runtime";
import type { SvgInterchangeIssue } from "@opendesign/import-export-service";
import {
  planRasterExportDimensions,
  type RasterExportBackground,
  type RasterExportFormat,
  type RasterExportResampling,
  type RasterExportSize,
} from "@opendesign/import-export-service/raster";
import { Button, Glyph, IconButton, type GlyphName } from "@opendesign/ui";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MessageKey } from "../../shared/i18n/messages";
import { useI18n } from "../i18n";
import type { SvgWorkerExportSettings } from "../svg-interchange-contract";
import styles from "./PropertiesPanel.module.scss";

export type UpdatePropertiesPatch = Omit<
  UpdatePropertiesCommand,
  "commandId" | "nodeId" | "type"
>;

export type ExportFormat = "svg" | RasterExportFormat;

export interface RasterExportSettings {
  format: RasterExportFormat;
  size: RasterExportSize;
  background: RasterExportBackground;
  quality: number;
  resampling: RasterExportResampling;
}

export interface SvgOperationStatus {
  kind: "import" | "export" | "raster-export";
  name: string;
}

export interface SvgInterchangeFeedback {
  kind: "import" | "export";
  name: string;
  issues: readonly SvgInterchangeIssue[];
}

export interface RasterExportFeedback {
  name: string;
  format: RasterExportFormat;
  width: number;
  height: number;
  byteSize: number;
}

type FillNode = Extract<
  DesignNode,
  {
    kind:
      | "boolean"
      | "ellipse"
      | "frame"
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
  { kind: "frame" | "image" | "polygon" | "rectangle" | "star" }
>;
type RegularShapeNode = Extract<DesignNode, { kind: "polygon" | "star" }>;
type StrokeNode = FillNode | Extract<DesignNode, { kind: "line" }>;

function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

const nodeIcons: Record<DesignNode["kind"], GlyphName> = {
  frame: "frame",
  group: "layers",
  boolean: "boolean",
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
  polygon: "polygon",
  star: "star",
  text: "text",
  image: "assets",
  vector: "pen",
  path: "pen",
  instance: "assets",
};

const nodeKindKeys: Record<DesignNode["kind"], MessageKey> = {
  frame: "node.frame",
  group: "node.group",
  boolean: "node.boolean",
  rectangle: "node.rectangle",
  ellipse: "node.ellipse",
  line: "node.line",
  polygon: "node.polygon",
  star: "node.star",
  text: "node.text",
  image: "node.image",
  vector: "node.vector",
  path: "node.path",
  instance: "node.instance",
};

const blendModes: BlendMode[] = [
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

const maskModes: MaskMode[] = [
  "none",
  "alpha",
  "luminance",
  "clipping",
  "outline",
];

const lineEndpoints: readonly LineEndpoint[] = [
  "none",
  "line-arrow",
  "triangle-arrow",
  "reversed-triangle-arrow",
  "circle",
  "diamond",
];

function formatNumber(value: number) {
  return String(Math.round(value * 1000) / 1000);
}

function isFillNode(node: DesignNode): node is FillNode {
  return (
    node.kind === "boolean" ||
    node.kind === "ellipse" ||
    node.kind === "frame" ||
    node.kind === "path" ||
    node.kind === "polygon" ||
    node.kind === "rectangle" ||
    node.kind === "star" ||
    node.kind === "text" ||
    node.kind === "vector"
  );
}

function isCornerNode(node: DesignNode): node is CornerNode {
  return (
    node.kind === "frame" ||
    node.kind === "image" ||
    node.kind === "polygon" ||
    node.kind === "rectangle" ||
    node.kind === "star"
  );
}

function isRegularShapeNode(node: DesignNode): node is RegularShapeNode {
  return node.kind === "polygon" || node.kind === "star";
}

function isStrokeNode(node: DesignNode): node is StrokeNode {
  return node.kind === "line" || isFillNode(node);
}

function lineEndpointKey(endpoint: LineEndpoint): MessageKey {
  return `properties.lineEndpoint.${endpoint}` as MessageKey;
}

function Field({
  label,
  accessibleLabel = label,
  value,
  suffix,
  min,
  max,
  disabled = false,
  placeholder,
  type = "number",
  onCommit,
}: {
  label: string;
  accessibleLabel?: string;
  value: string;
  suffix?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  type?: "number" | "text";
  onCommit: (draft: string) => string | null;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft === value) return;
    setDraft(onCommit(draft) ?? value);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  return (
    <label className={cx(styles.field, disabled && styles.fieldDisabled)}>
      <span>{label}</span>
      <span className={styles.fieldControl}>
        <input
          aria-label={accessibleLabel}
          disabled={disabled}
          inputMode={type === "number" ? "decimal" : undefined}
          max={max}
          min={min}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          type={type}
          value={draft}
        />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className={styles.textarea}>
      <span>{label}</span>
      <textarea
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        value={draft}
      />
    </label>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <input
      aria-label={label}
      className={styles.colorPicker}
      onChange={(event) => onChange(event.target.value)}
      type="color"
      value={isHexColor(value) ? value : "#000000"}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <header>
        <button aria-expanded="true" disabled type="button">
          <Glyph name="chevron-down" size={13} />
          {title}
        </button>
      </header>
      {children}
    </section>
  );
}

function commitNumber(
  draft: string,
  current: number,
  update: (value: number) => void,
  bounds: { min?: number; max?: number; integer?: boolean } = {},
) {
  const normalized = draft.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (bounds.integer && !Number.isInteger(parsed)) return null;

  const next = Math.min(
    bounds.max ?? Number.POSITIVE_INFINITY,
    Math.max(bounds.min ?? Number.NEGATIVE_INFINITY, parsed),
  );
  if (next !== current) update(next);
  return formatNumber(next);
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

function PaintEditor({
  index,
  paint,
  onChange,
  onRemove,
}: {
  index: number;
  paint: Paint;
  onChange: (paint: Paint) => void;
  onRemove: () => void;
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
          <Glyph name="close" size={12} />
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
                <Glyph name="close" size={11} />
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
            <Glyph name="plus" size={13} />
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

function defaultEffect(type: Effect["type"]): Effect {
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

function EffectEditor({
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
          <Glyph name="close" size={12} />
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

function SelectedNodeProperties({
  node,
  booleanOperationEditable,
  booleanOperandParent,
  canDelete,
  onBooleanOperationChange,
  onDelete,
  onDuplicate,
  onReplaceImage,
  onSelectBooleanParent,
  onUpdate,
}: {
  node: DesignNode;
  booleanOperationEditable: boolean;
  booleanOperandParent?: { id: string; name: string };
  canDelete: boolean;
  onBooleanOperationChange: (operation: BooleanOperation) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onReplaceImage: () => void;
  onSelectBooleanParent: (nodeId: string) => void;
  onUpdate: (updates: UpdatePropertiesPatch) => void;
}) {
  const { t } = useI18n();
  const updateTranslation = (index: 4 | 5, value: number) => {
    const transform: DesignNode["transform"] = [...node.transform];
    transform[index] = value;
    onUpdate({ transform });
  };
  const updateSize = (dimension: "height" | "width", value: number) => {
    onUpdate({ size: { ...node.size, [dimension]: value } });
  };

  return (
    <div>
      <div className={styles.selectionHeading}>
        <span className={styles.selectionIcon}>
          <Glyph name={nodeIcons[node.kind]} />
        </span>
        <span>
          <strong>
            {node.name ||
              t("sidebar.untitledNode", { kind: t(nodeKindKeys[node.kind]) })}
          </strong>
          <small>{t(nodeKindKeys[node.kind])}</small>
        </span>
        <span className={styles.selectionActions}>
          <IconButton
            icon="duplicate"
            label={t("properties.duplicateLayer")}
            onClick={onDuplicate}
          />
          <IconButton
            disabled={!canDelete}
            icon="trash"
            label={t("properties.deleteLayer")}
            onClick={onDelete}
          />
        </span>
      </div>
      {booleanOperandParent && (
        <Section title={t("properties.booleanSourceLayer")}>
          <div className={styles.contextNote}>
            <Glyph name="boolean" size={15} />
            <span>
              <strong>{t("properties.booleanAppearanceControlled")}</strong>
              <small>
                {t("properties.booleanAppearanceControlledDetail", {
                  name:
                    booleanOperandParent.name || t("properties.booleanGroup"),
                })}
              </small>
            </span>
            <button
              onClick={() => onSelectBooleanParent(booleanOperandParent.id)}
              type="button"
            >
              {t("properties.selectBooleanGroup")}
            </button>
          </div>
        </Section>
      )}
      <Section title={t("properties.layer")}>
        <div className={styles.stack}>
          <Field
            accessibleLabel={t("properties.layerName")}
            label={t("properties.name")}
            onCommit={(name) => {
              const next = name.trim();
              if (!next) return null;
              if (next !== node.name) onUpdate({ name: next });
              return next;
            }}
            type="text"
            value={node.name}
          />
          <div className={styles.toggles}>
            <label>
              <input
                checked={node.visible}
                onChange={(event) =>
                  onUpdate({ visible: event.target.checked })
                }
                type="checkbox"
              />
              {t("properties.visible")}
            </label>
            <label>
              <input
                checked={node.locked}
                onChange={(event) => onUpdate({ locked: event.target.checked })}
                type="checkbox"
              />
              {t("properties.locked")}
            </label>
          </div>
        </div>
      </Section>
      {node.kind === "boolean" && (
        <Section title={t("properties.booleanGroup")}>
          <label className={styles.select}>
            <span>{t("properties.booleanOperation")}</span>
            <select
              aria-label={t("properties.booleanOperation")}
              disabled={!booleanOperationEditable}
              onChange={(event) =>
                onBooleanOperationChange(event.target.value as BooleanOperation)
              }
              value={node.properties.operation}
            >
              <option value="union">{t("properties.booleanUnion")}</option>
              <option value="subtract">
                {t("properties.booleanSubtract")}
              </option>
              <option value="intersect">
                {t("properties.booleanIntersect")}
              </option>
              <option value="exclude">{t("properties.booleanExclude")}</option>
            </select>
          </label>
        </Section>
      )}
      {node.kind === "line" && (
        <Section title={t("properties.line")}>
          <div className={styles.grid}>
            <label className={styles.select}>
              <span>{t("properties.lineStart")}</span>
              <select
                aria-label={t("properties.lineStart")}
                onChange={(event) =>
                  onUpdate({
                    properties: {
                      startEndpoint: event.target.value as LineEndpoint,
                    },
                  })
                }
                value={node.properties.startEndpoint}
              >
                {lineEndpoints.map((endpoint) => (
                  <option key={endpoint} value={endpoint}>
                    {t(lineEndpointKey(endpoint))}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.select}>
              <span>{t("properties.lineEnd")}</span>
              <select
                aria-label={t("properties.lineEnd")}
                onChange={(event) =>
                  onUpdate({
                    properties: {
                      endEndpoint: event.target.value as LineEndpoint,
                    },
                  })
                }
                value={node.properties.endEndpoint}
              >
                {lineEndpoints.map((endpoint) => (
                  <option key={endpoint} value={endpoint}>
                    {t(lineEndpointKey(endpoint))}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button
            onClick={() =>
              onUpdate({
                properties: {
                  start: node.properties.end,
                  end: node.properties.start,
                },
              })
            }
            tone="quiet"
          >
            {t("properties.reverseLine")}
          </Button>
        </Section>
      )}
      {isRegularShapeNode(node) && (
        <Section title={t("properties.regularShape")}>
          <div className={styles.grid}>
            <Field
              accessibleLabel={t("properties.pointCount")}
              label={t("properties.pointCount")}
              max={60}
              min={3}
              onCommit={(draft) =>
                commitNumber(
                  draft,
                  node.properties.pointCount,
                  (pointCount) => onUpdate({ properties: { pointCount } }),
                  { min: 3, max: 60, integer: true },
                )
              }
              value={formatNumber(node.properties.pointCount)}
            />
            {node.kind === "star" && (
              <Field
                accessibleLabel={t("properties.starInnerRadius")}
                label={t("properties.starInnerRadius")}
                max={100}
                min={0}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    node.properties.innerRadius * 100,
                    (innerRadius) =>
                      onUpdate({
                        properties: { innerRadius: innerRadius / 100 },
                      }),
                    { min: 0, max: 100 },
                  )
                }
                suffix="%"
                value={formatNumber(node.properties.innerRadius * 100)}
              />
            )}
          </div>
        </Section>
      )}
      <Section title={t("properties.layout")}>
        <div className={styles.grid}>
          <Field
            label="X"
            onCommit={(draft) =>
              commitNumber(draft, node.transform[4], (value) =>
                updateTranslation(4, value),
              )
            }
            value={formatNumber(node.transform[4])}
          />
          <Field
            label="Y"
            onCommit={(draft) =>
              commitNumber(draft, node.transform[5], (value) =>
                updateTranslation(5, value),
              )
            }
            value={formatNumber(node.transform[5])}
          />
          <Field
            accessibleLabel={t("properties.width")}
            disabled={node.kind === "boolean"}
            label="W"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                node.size.width,
                (value) => updateSize("width", value),
                { min: 0 },
              )
            }
            value={formatNumber(node.size.width)}
          />
          <Field
            accessibleLabel={t("properties.height")}
            disabled={node.kind === "boolean"}
            label="H"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                node.size.height,
                (value) => updateSize("height", value),
                { min: 0 },
              )
            }
            value={formatNumber(node.size.height)}
          />
        </div>
      </Section>
      <Section title={t("properties.appearance")}>
        <div className={styles.grid}>
          <Field
            accessibleLabel={t("properties.opacity")}
            disabled={booleanOperandParent !== undefined}
            label="O"
            max={100}
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                node.opacity * 100,
                (value) => onUpdate({ opacity: value / 100 }),
                { min: 0, max: 100 },
              )
            }
            suffix="%"
            value={formatNumber(node.opacity * 100)}
          />
          {isCornerNode(node) && (
            <Field
              accessibleLabel={t("properties.cornerRadius")}
              label="R"
              min={0}
              onCommit={(draft) =>
                commitNumber(
                  draft,
                  node.properties.cornerRadius,
                  (cornerRadius) => onUpdate({ properties: { cornerRadius } }),
                  { min: 0 },
                )
              }
              suffix="px"
              value={formatNumber(node.properties.cornerRadius)}
            />
          )}
          <label className={styles.select}>
            <span>{t("properties.blendMode")}</span>
            <select
              aria-label={t("properties.blendMode")}
              disabled={booleanOperandParent !== undefined}
              onChange={(event) =>
                onUpdate({ blendMode: event.target.value as BlendMode })
              }
              value={node.blendMode ?? "pass-through"}
            >
              {blendModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.select}>
            <span>{t("properties.maskMode")}</span>
            <select
              aria-label={t("properties.maskMode")}
              disabled={booleanOperandParent !== undefined}
              onChange={(event) =>
                onUpdate({ maskMode: event.target.value as MaskMode })
              }
              value={node.maskMode ?? "none"}
            >
              {maskModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>
      {node.kind === "image" && (
        <ImagePlacementEditor
          node={node}
          onChange={(placement) => onUpdate({ properties: { placement } })}
          onReplace={onReplaceImage}
        />
      )}
      {node.kind === "text" && (
        <Section title={t("properties.typography")}>
          <div className={styles.stack}>
            <TextAreaField
              label={t("properties.textContent")}
              onCommit={(content) => onUpdate({ properties: { content } })}
              value={node.properties.content}
            />
            <div
              aria-label={t("properties.typography")}
              className={cx(styles.grid, styles.typographyGrid)}
              role="group"
            >
              <Field
                accessibleLabel={t("properties.fontFamily")}
                label="Font"
                onCommit={(fontFamily) => {
                  const next = fontFamily.trim();
                  if (!next) return null;
                  if (next !== node.properties.fontFamily) {
                    onUpdate({ properties: { fontFamily: next } });
                  }
                  return next;
                }}
                type="text"
                value={node.properties.fontFamily}
              />
              <Field
                accessibleLabel={t("properties.fontSize")}
                label="Size"
                min={1}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    node.properties.fontSize,
                    (fontSize) => onUpdate({ properties: { fontSize } }),
                    { min: 1 },
                  )
                }
                value={formatNumber(node.properties.fontSize)}
              />
              <Field
                accessibleLabel={t("properties.fontWeight")}
                label="Weight"
                max={1000}
                min={1}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    node.properties.fontWeight,
                    (fontWeight) =>
                      onUpdate({
                        properties: { fontWeight: Math.round(fontWeight) },
                      }),
                    { min: 1, max: 1000 },
                  )
                }
                value={formatNumber(node.properties.fontWeight)}
              />
              <Field
                accessibleLabel={t("properties.lineHeight")}
                label="Line"
                min={1}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    node.properties.lineHeight,
                    (lineHeight) => onUpdate({ properties: { lineHeight } }),
                    { min: 1 },
                  )
                }
                value={formatNumber(node.properties.lineHeight)}
              />
              <Field
                accessibleLabel={t("properties.letterSpacing")}
                label="Track"
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    node.properties.letterSpacing,
                    (letterSpacing) =>
                      onUpdate({ properties: { letterSpacing } }),
                  )
                }
                value={formatNumber(node.properties.letterSpacing)}
              />
              <label className={styles.select}>
                <span>{t("properties.textAlign")}</span>
                <select
                  aria-label={t("properties.textAlign")}
                  onChange={(event) =>
                    onUpdate({
                      properties: {
                        textAlignHorizontal: event.target.value as
                          "left" | "center" | "right" | "justify",
                      },
                    })
                  }
                  value={node.properties.textAlignHorizontal}
                >
                  <option value="left">{t("properties.alignLeft")}</option>
                  <option value="center">{t("properties.alignCenter")}</option>
                  <option value="right">{t("properties.alignRight")}</option>
                  <option value="justify">{t("properties.justify")}</option>
                </select>
              </label>
              <label className={styles.select}>
                <span>{t("properties.verticalAlign")}</span>
                <select
                  aria-label={t("properties.verticalAlign")}
                  onChange={(event) =>
                    onUpdate({
                      properties: {
                        textAlignVertical: event.target.value as
                          "top" | "center" | "bottom",
                      },
                    })
                  }
                  value={node.properties.textAlignVertical}
                >
                  <option value="top">{t("properties.alignTop")}</option>
                  <option value="center">{t("properties.alignVCenter")}</option>
                  <option value="bottom">{t("properties.alignBottom")}</option>
                </select>
              </label>
              <label className={styles.select}>
                <span>{t("properties.textResize")}</span>
                <select
                  aria-label={t("properties.textResize")}
                  onChange={(event) =>
                    onUpdate({
                      properties: {
                        textResize: event.target.value as
                          "auto-width" | "auto-height" | "fixed",
                      },
                    })
                  }
                  value={node.properties.textResize}
                >
                  <option value="auto-width">
                    {t("properties.textAutoWidth")}
                  </option>
                  <option value="auto-height">
                    {t("properties.textAutoHeight")}
                  </option>
                  <option value="fixed">{t("properties.textFixed")}</option>
                </select>
              </label>
              <label className={styles.select}>
                <span>{t("properties.textWrap")}</span>
                <select
                  aria-label={t("properties.textWrap")}
                  disabled={node.properties.textResize === "auto-width"}
                  onChange={(event) =>
                    onUpdate({
                      properties: {
                        textWrap: event.target.value as
                          "none" | "word" | "character",
                      },
                    })
                  }
                  value={node.properties.textWrap}
                >
                  <option
                    disabled={node.properties.textResize === "auto-height"}
                    value="none"
                  >
                    {t("properties.wrapNone")}
                  </option>
                  <option value="word">{t("properties.wrapWord")}</option>
                  <option value="character">
                    {t("properties.wrapCharacter")}
                  </option>
                </select>
              </label>
              <label className={styles.select}>
                <span>{t("properties.textOverflow")}</span>
                <select
                  aria-label={t("properties.textOverflow")}
                  disabled={node.properties.textResize !== "fixed"}
                  onChange={(event) =>
                    onUpdate({
                      properties: {
                        textOverflow: event.target.value as
                          "visible" | "clip" | "ellipsis",
                      },
                    })
                  }
                  value={node.properties.textOverflow}
                >
                  <option value="visible">
                    {t("properties.overflowVisible")}
                  </option>
                  <option value="clip">{t("properties.overflowClip")}</option>
                  <option value="ellipsis">
                    {t("properties.overflowEllipsis")}
                  </option>
                </select>
              </label>
            </div>
          </div>
        </Section>
      )}
      {isFillNode(node) && !booleanOperandParent && (
        <Section title={t("properties.fill")}>
          {node.properties.fills.map((paint, index) => (
            <PaintEditor
              index={index}
              key={`${node.id}-fill-${index}`}
              onChange={(next) =>
                onUpdate({
                  properties: {
                    fills: node.properties.fills.map((candidate, paintIndex) =>
                      paintIndex === index ? next : candidate,
                    ),
                  },
                })
              }
              onRemove={() =>
                onUpdate({
                  properties: {
                    fills: node.properties.fills.filter(
                      (_, paintIndex) => paintIndex !== index,
                    ),
                  },
                })
              }
              paint={paint}
            />
          ))}
          <button
            className={styles.addPaint}
            onClick={() =>
              onUpdate({
                properties: {
                  fills: [
                    ...node.properties.fills,
                    { type: "solid", color: "#808080", opacity: 1 },
                  ],
                },
              })
            }
            type="button"
          >
            <Glyph name="plus" size={13} />
            {t("properties.addFill")}
          </button>
        </Section>
      )}
      {isStrokeNode(node) && !booleanOperandParent && (
        <Section title={t("properties.stroke")}>
          {node.properties.strokes.map((paint, index) => (
            <PaintEditor
              index={index}
              key={`${node.id}-stroke-${index}`}
              onChange={(next) =>
                onUpdate({
                  properties: {
                    strokes: node.properties.strokes.map(
                      (candidate, paintIndex) =>
                        paintIndex === index ? next : candidate,
                    ),
                  },
                })
              }
              onRemove={() =>
                onUpdate({
                  properties: {
                    strokes: node.properties.strokes.filter(
                      (_, paintIndex) => paintIndex !== index,
                    ),
                  },
                })
              }
              paint={paint}
            />
          ))}
          <div className={styles.grid}>
            <Field
              accessibleLabel={t("properties.strokeWidth")}
              label="W"
              min={0}
              onCommit={(draft) =>
                commitNumber(
                  draft,
                  node.properties.strokeWidth,
                  (strokeWidth) => onUpdate({ properties: { strokeWidth } }),
                  { min: 0 },
                )
              }
              suffix="px"
              value={formatNumber(node.properties.strokeWidth)}
            />
            <label className={styles.select}>
              <span>{t("properties.strokeCap")}</span>
              <select
                aria-label={t("properties.strokeCap")}
                onChange={(event) =>
                  onUpdate({
                    properties: {
                      strokeCap: event.target.value as
                        "none" | "round" | "square",
                    },
                  })
                }
                value={node.properties.strokeCap ?? "none"}
              >
                <option value="none">{t("properties.strokeCapNone")}</option>
                <option value="round">{t("properties.strokeCapRound")}</option>
                <option value="square">
                  {t("properties.strokeCapSquare")}
                </option>
              </select>
            </label>
            <label className={styles.select}>
              <span>{t("properties.strokeJoin")}</span>
              <select
                aria-label={t("properties.strokeJoin")}
                onChange={(event) =>
                  onUpdate({
                    properties: {
                      strokeJoin: event.target.value as
                        "miter" | "round" | "bevel",
                    },
                  })
                }
                value={node.properties.strokeJoin ?? "miter"}
              >
                <option value="miter">{t("properties.strokeJoinMiter")}</option>
                <option value="round">{t("properties.strokeJoinRound")}</option>
                <option value="bevel">{t("properties.strokeJoinBevel")}</option>
              </select>
            </label>
            <Field
              accessibleLabel={t("properties.dashPattern")}
              label={t("properties.dash")}
              onCommit={(draft) => {
                const values = draft
                  .trim()
                  .split(/[\s,]+/)
                  .filter(Boolean)
                  .map(Number);
                if (
                  values.some((value) => !Number.isFinite(value) || value < 0)
                ) {
                  return null;
                }
                onUpdate({ properties: { dashPattern: values } });
                return values.join(", ");
              }}
              placeholder="8, 4"
              type="text"
              value={(node.properties.dashPattern ?? []).join(", ")}
            />
          </div>
          <button
            className={styles.addPaint}
            onClick={() =>
              onUpdate({
                properties: {
                  strokes: [
                    ...node.properties.strokes,
                    { type: "solid", color: "#000000", opacity: 1 },
                  ],
                  strokeWidth: Math.max(1, node.properties.strokeWidth),
                },
              })
            }
            type="button"
          >
            <Glyph name="plus" size={13} />
            {t("properties.addStroke")}
          </button>
        </Section>
      )}
      {!booleanOperandParent && (
        <Section title={t("properties.effects")}>
          {(node.effects ?? []).map((effect, index) => (
            <EffectEditor
              effect={effect}
              index={index}
              key={`${node.id}-effect-${index}`}
              onChange={(next) =>
                onUpdate({
                  effects: (node.effects ?? []).map((candidate, effectIndex) =>
                    effectIndex === index ? next : candidate,
                  ),
                })
              }
              onRemove={() =>
                onUpdate({
                  effects: (node.effects ?? []).filter(
                    (_, effectIndex) => effectIndex !== index,
                  ),
                })
              }
            />
          ))}
          <label className={cx(styles.select, styles.effectAdd)}>
            <span>{t("properties.addEffect")}</span>
            <select
              aria-label={t("properties.addEffect")}
              onChange={(event) => {
                const type = event.target.value as Effect["type"] | "";
                if (!type) return;
                onUpdate({
                  effects: [...(node.effects ?? []), defaultEffect(type)],
                });
                event.target.value = "";
              }}
              value=""
            >
              <option value="">{t("properties.chooseEffect")}</option>
              <option value="drop-shadow">{t("properties.dropShadow")}</option>
              <option value="inner-shadow">
                {t("properties.innerShadow")}
              </option>
              <option value="outer-glow">{t("properties.outerGlow")}</option>
              <option value="inner-glow">{t("properties.innerGlow")}</option>
              <option value="layer-blur">{t("properties.layerBlur")}</option>
              <option value="background-blur">
                {t("properties.backgroundBlur")}
              </option>
              <option value="grayscale">{t("properties.grayscale")}</option>
            </select>
          </label>
        </Section>
      )}
    </div>
  );
}

function ImagePlacementEditor({
  node,
  onChange,
  onReplace,
}: {
  node: ImageNode;
  onChange: (placement: ImagePlacement) => void;
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
          onClick={onReplace}
          type="button"
        >
          <Glyph name="image" size={13} />
          {t("properties.imageReplace")}
        </button>
      </div>
    </Section>
  );
}

function SvgOperationNotice({
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

function RasterExportReport({
  feedback,
  onDismiss,
}: {
  feedback: RasterExportFeedback;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <section aria-live="polite" className={styles.fidelityReport} role="status">
      <header>
        <span aria-hidden="true" className={styles.fidelityMark}>
          ✓
        </span>
        <strong>
          {t("properties.rasterExportComplete", { name: feedback.name })}
        </strong>
        <IconButton
          icon="close"
          label={t("properties.dismissRasterFeedback")}
          onClick={onDismiss}
        />
      </header>
      <p>
        {t("properties.rasterExportSummary", {
          format: feedback.format.toUpperCase(),
          width: feedback.width,
          height: feedback.height,
          size: formatByteSize(feedback.byteSize),
        })}
      </p>
    </section>
  );
}

function SvgFidelityReport({
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
          icon="close"
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

function ExportSection({
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
    <Section title={t("properties.export")}>
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
                      mode: mode as RasterExportSize["mode"],
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

export function PropertiesPanel({
  node,
  arrangement,
  booleanOperationEditable,
  booleanOperandParent,
  canDelete,
  onArrange,
  onBooleanOperationChange,
  onDelete,
  onDuplicate,
  onCancelSvgOperation,
  onDismissRasterFeedback,
  onDismissSvgFeedback,
  onExportSvg,
  onExportRaster,
  onExportFormatChange,
  onReplaceImage,
  onSelectBooleanParent,
  onUpdate,
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
  arrangement: ArrangementSelectionMetrics | null;
  booleanOperationEditable: boolean;
  booleanOperandParent?: { id: string; name: string };
  canDelete: boolean;
  onArrange: (operation: ArrangeOperation) => void;
  onBooleanOperationChange: (operation: BooleanOperation) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCancelSvgOperation: () => void;
  onDismissRasterFeedback: () => void;
  onDismissSvgFeedback: () => void;
  onExportSvg: () => void;
  onExportRaster: () => void;
  onExportFormatChange: (format: ExportFormat) => void;
  onReplaceImage: () => void;
  onSelectBooleanParent: (nodeId: string) => void;
  onUpdate: (updates: UpdatePropertiesPatch) => void;
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
            booleanOperationEditable={booleanOperationEditable}
            booleanOperandParent={booleanOperandParent}
            canDelete={canDelete}
            onBooleanOperationChange={onBooleanOperationChange}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onReplaceImage={onReplaceImage}
            onSelectBooleanParent={onSelectBooleanParent}
            onUpdate={onUpdate}
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

function isHexColor(value: string): boolean {
  return /^#[\da-f]{6}$/i.test(value);
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
