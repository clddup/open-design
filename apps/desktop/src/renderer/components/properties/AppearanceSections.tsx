import type {
  BlendMode,
  DesignNode,
  Effect,
  ImageFilters,
  ImagePaint,
  MaskMode,
} from "@opendesign/design-contracts";
import { Icon } from "@opendesign/ui";
import { useI18n } from "../../i18n";
import type { UpdatePropertiesPatch } from "../../features/editor/types";
import styles from "../PropertiesPanel.module.scss";
import { Field, Section, commitNumber, cx, formatNumber } from "./controls";
import {
  EffectEditor,
  PaintEditor,
  blendModes,
  defaultEffect,
  isCornerNode,
  isFillNode,
  isStrokeNode,
  maskModes,
} from "./PaintEffectEditors";

export function AppearanceBasicsSection({
  appearanceControlled,
  node,
  onUpdate,
}: {
  appearanceControlled: boolean;
  node: DesignNode;
  onUpdate: (updates: UpdatePropertiesPatch) => void;
}) {
  const { t } = useI18n();
  return (
    <Section title={t("properties.appearance")}>
      <div className={styles.grid}>
        <Field
          accessibleLabel={t("properties.opacity")}
          disabled={appearanceControlled}
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
            disabled={appearanceControlled}
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
            disabled={appearanceControlled}
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
  );
}

export function PaintAndEffectsSections({
  appearanceControlled,
  node,
  onUpdate,
  onUpdateImagePaintFilters,
}: {
  appearanceControlled: boolean;
  node: DesignNode;
  onUpdate: (updates: UpdatePropertiesPatch) => void;
  onUpdateImagePaintFilters: (
    paintField: "fills" | "strokes",
    paintIndex: number,
    expectedPaint: ImagePaint,
    filters: ImageFilters,
  ) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {isFillNode(node) && !appearanceControlled && (
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
              onImageFiltersChange={(filters) => {
                if (paint.type === "image") {
                  onUpdateImagePaintFilters("fills", index, paint, filters);
                }
              }}
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
            <Icon name="lucide:plus" size={13} />
            {t("properties.addFill")}
          </button>
        </Section>
      )}
      {isStrokeNode(node) && !appearanceControlled && (
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
              onImageFiltersChange={(filters) => {
                if (paint.type === "image") {
                  onUpdateImagePaintFilters("strokes", index, paint, filters);
                }
              }}
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
            <Icon name="lucide:plus" size={13} />
            {t("properties.addStroke")}
          </button>
        </Section>
      )}
      {!appearanceControlled && (
        <Section defaultOpen={false} title={t("properties.effects")}>
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
    </>
  );
}
