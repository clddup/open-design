import type { DesignNode } from "@opendesign/design-contracts";
import { useI18n } from "../../i18n";
import type { UpdatePropertiesPatch } from "../../features/editor/types";
import styles from "../PropertiesPanel.module.scss";
import {
  Field,
  Section,
  TextAreaField,
  commitNumber,
  cx,
  formatNumber,
} from "./controls";

type TextNode = Extract<DesignNode, { kind: "text" }>;

export function TypographySection({
  node,
  onUpdate,
}: {
  node: TextNode;
  onUpdate: (updates: UpdatePropertiesPatch) => void;
}) {
  const { t } = useI18n();
  return (
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
                (letterSpacing) => onUpdate({ properties: { letterSpacing } }),
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
              <option value="character">{t("properties.wrapCharacter")}</option>
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
              <option value="visible">{t("properties.overflowVisible")}</option>
              <option value="clip">{t("properties.overflowClip")}</option>
              <option value="ellipsis">
                {t("properties.overflowEllipsis")}
              </option>
            </select>
          </label>
        </div>
      </div>
    </Section>
  );
}
