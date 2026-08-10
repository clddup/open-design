import type {
  BlendMode,
  BooleanOperation,
  DesignNode,
  Effect,
  ImageNode,
  ImagePlacement,
  MaskMode,
  Paint,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";
import type {
  ArrangeOperation,
  ArrangementSelectionMetrics,
} from "@opendesign/editor-runtime";
import { MAX_ARRANGEMENT_SPACING } from "@opendesign/editor-runtime";
import { Glyph, IconButton, type GlyphName } from "@opendesign/ui";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MessageKey } from "../../shared/i18n/messages";
import { useI18n } from "../i18n";

export type UpdatePropertiesPatch = Omit<
  UpdatePropertiesCommand,
  "commandId" | "nodeId" | "type"
>;

type FillNode = Extract<
  DesignNode,
  {
    kind:
      | "boolean"
      | "ellipse"
      | "frame"
      | "path"
      | "rectangle"
      | "text"
      | "vector";
  }
>;
type CornerNode = Extract<
  DesignNode,
  { kind: "frame" | "image" | "rectangle" }
>;

const nodeIcons: Record<DesignNode["kind"], GlyphName> = {
  frame: "frame",
  group: "layers",
  boolean: "boolean",
  rectangle: "rectangle",
  ellipse: "ellipse",
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

function formatNumber(value: number) {
  return String(Math.round(value * 1000) / 1000);
}

function isFillNode(node: DesignNode): node is FillNode {
  return (
    node.kind === "boolean" ||
    node.kind === "ellipse" ||
    node.kind === "frame" ||
    node.kind === "path" ||
    node.kind === "rectangle" ||
    node.kind === "text" ||
    node.kind === "vector"
  );
}

function isCornerNode(node: DesignNode): node is CornerNode {
  return (
    node.kind === "frame" || node.kind === "image" || node.kind === "rectangle"
  );
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
    <label className={`property-field${disabled ? " is-disabled" : ""}`}>
      <span>{label}</span>
      <span className="property-field__control">
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
    <label className="property-textarea">
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
      className="paint-color-picker"
      onChange={(event) => onChange(event.target.value)}
      type="color"
      value={isHexColor(value) ? value : "#000000"}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="property-section">
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
  bounds: { min?: number; max?: number } = {},
) {
  const normalized = draft.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

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
    <div className="paint-editor">
      <div className="paint-row">
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
        <label className="paint-row__type">
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
          className="paint-row__remove"
          onClick={onRemove}
          type="button"
        >
          <Glyph name="close" size={12} />
        </button>
      </div>
      {paint.type === "solid" && (
        <div className="property-grid">
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
        <div className="paint-gradient">
          {paint.stops.map((stop, stopIndex) => (
            <div className="paint-stop" key={`${index}-${stopIndex}`}>
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
                className="paint-row__remove"
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
          <div className="property-grid">
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
            className="property-add-paint"
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
        <div className="property-stack">
          <small className="property-help">
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
    <div className="effect-editor">
      <div className="paint-row">
        {!blur && effect.type !== "grayscale" && (
          <ColorPicker
            label={t("properties.effectColor", { index: index + 1 })}
            onChange={(color) => onChange({ ...effect, color })}
            value={effect.color}
          />
        )}
        <span className="paint-row__value">{effect.type}</span>
        <label className="effect-editor__visible">
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
          className="paint-row__remove"
          onClick={onRemove}
          type="button"
        >
          <Glyph name="close" size={12} />
        </button>
      </div>
      {blur && (
        <div className="property-grid">
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
        <div className="property-grid">
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
        <div className="property-grid">
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
        <div className="property-grid">
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
    <div className="properties-scroll">
      <div className="selection-heading">
        <span className="selection-heading__icon">
          <Glyph name={nodeIcons[node.kind]} />
        </span>
        <span>
          <strong>
            {node.name ||
              t("sidebar.untitledNode", { kind: t(nodeKindKeys[node.kind]) })}
          </strong>
          <small>{t(nodeKindKeys[node.kind])}</small>
        </span>
        <span className="selection-heading__actions">
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
          <div className="property-context-note">
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
        <div className="property-stack">
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
          <div className="property-toggles">
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
          <label className="property-select">
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
      <Section title={t("properties.layout")}>
        <div className="property-grid">
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
        <div className="property-grid">
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
          <label className="property-select">
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
          <label className="property-select">
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
          <div className="property-stack">
            <TextAreaField
              label={t("properties.textContent")}
              onCommit={(content) => onUpdate({ properties: { content } })}
              value={node.properties.content}
            />
            <div className="property-grid property-grid--typography">
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
              <label className="property-select">
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
            className="property-add-paint"
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
      {isFillNode(node) && !booleanOperandParent && (
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
          <div className="property-grid">
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
          </div>
          <button
            className="property-add-paint"
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
          <label className="property-select property-effect-add">
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
      <div className="property-stack image-placement-editor">
        <label className="property-select">
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
          <div className="property-grid">
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
            <div className="property-grid">
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
              className="image-placement-actions"
              role="group"
            >
              <button
                aria-pressed={placement.flipHorizontal}
                className={placement.flipHorizontal ? "is-active" : undefined}
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
                className={placement.flipVertical ? "is-active" : undefined}
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
          className="property-add-paint image-replace-button"
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
  onReplaceImage,
  onSelectBooleanParent,
  onUpdate,
  selectionCount,
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
  onReplaceImage: () => void;
  onSelectBooleanParent: (nodeId: string) => void;
  onUpdate: (updates: UpdatePropertiesPatch) => void;
  selectionCount: number;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t("properties.label")} className="properties-panel">
      <div
        aria-label={t("properties.views")}
        className="properties-tabs"
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
        className="properties-panel__content"
        id="properties-design-panel"
        role="tabpanel"
      >
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
          <div className="multi-selection-properties">
            <div className="no-selection" role="status">
              <Glyph name="layers" size={22} />
              <strong>
                {t("properties.layersSelected", { count: selectionCount })}
              </strong>
              <span>{t("properties.arrangeSelection")}</span>
            </div>
            <div className="multi-selection-section">
              <span className="multi-selection-section__heading">
                {t("properties.alignment")}
              </span>
              <div
                aria-label={t("properties.alignment")}
                className="alignment-grid"
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
            <div className="multi-selection-section">
              <span className="multi-selection-section__heading">
                {t("properties.distribution")}
              </span>
              <div
                aria-label={t("properties.distribution")}
                className="distribution-grid"
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
              </div>
              <div className="spacing-grid">
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
            <div className="multi-selection-actions">
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
          <div className="no-selection" role="status">
            <Glyph name="select" size={22} />
            <strong>{t("properties.noSelection")}</strong>
            <span>{t("properties.selectLayer")}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function isHexColor(value: string): boolean {
  return /^#[\da-f]{6}$/i.test(value);
}
