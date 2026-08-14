import type { DesignNode } from "@opendesign/design-contracts";
import type {
  TextFontAvailabilityResult,
  TextFontDescriptor,
} from "@opendesign/text-service";
import { Button } from "@opendesign/ui";
import { useEffect, useState } from "react";
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

export type FontInspectorContext = {
  availability: TextFontAvailabilityResult;
  matchingNodeCount: number;
  reflowableNodeCount: number;
  onReflow: () => void;
  onReplace: (font: TextFontDescriptor) => void;
};

export function TypographySection({
  node,
  onUpdate,
  fontContext,
}: {
  node: TextNode;
  onUpdate: (updates: UpdatePropertiesPatch) => void;
  fontContext?: FontInspectorContext;
}) {
  const { t } = useI18n();
  const [replacementFamily, setReplacementFamily] = useState("");
  const [replacementWeight, setReplacementWeight] = useState(
    String(node.properties.fontWeight),
  );
  useEffect(() => {
    setReplacementFamily("");
    setReplacementWeight(String(node.properties.fontWeight));
  }, [node.id, node.properties.fontFamily, node.properties.fontWeight]);
  const replacementWeightNumber = Number(replacementWeight);
  const replacementValid =
    replacementFamily.trim().length > 0 &&
    Number.isInteger(replacementWeightNumber) &&
    replacementWeightNumber >= 1 &&
    replacementWeightNumber <= 1_000;
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
          {fontContext && (
            <div className={styles.fontAvailability} role="status">
              <span
                className={cx(
                  styles.fontAvailabilityMark,
                  fontContext.availability.status === "available"
                    ? styles.fontAvailable
                    : fontContext.availability.status === "missing"
                      ? styles.fontMissing
                      : styles.fontUnknown,
                )}
              />
              <span>
                <strong>
                  {t(
                    fontContext.availability.status === "available"
                      ? "properties.fontAvailable"
                      : fontContext.availability.status === "missing"
                        ? "properties.fontMissing"
                        : "properties.fontUnknown",
                  )}
                </strong>
                <small>
                  {t("properties.fontMatches", {
                    count: fontContext.matchingNodeCount,
                  })}
                </small>
              </span>
              <Button
                disabled={fontContext.reflowableNodeCount === 0}
                onClick={fontContext.onReflow}
                tone="quiet"
              >
                {t("properties.reflowFont")}
              </Button>
            </div>
          )}
          {fontContext && fontContext.availability.status !== "available" && (
            <div className={styles.fontReplacement}>
              <Field
                accessibleLabel={t("properties.replacementFontFamily")}
                label="Replace"
                onCommit={(value) => {
                  const next = value.trim();
                  setReplacementFamily(next);
                  return next;
                }}
                placeholder={t("properties.replacementFontFamily")}
                type="text"
                value={replacementFamily}
              />
              <Field
                accessibleLabel={t("properties.replacementFontWeight")}
                label="Weight"
                max={1_000}
                min={1}
                onCommit={(value) => {
                  const parsed = Number(value);
                  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000)
                    return null;
                  const next = String(parsed);
                  setReplacementWeight(next);
                  return next;
                }}
                value={replacementWeight}
              />
              <Button
                disabled={!replacementValid}
                onClick={() => {
                  if (!replacementValid) return;
                  fontContext.onReplace({
                    fontFamily: replacementFamily.trim(),
                    fontWeight: replacementWeightNumber,
                  });
                }}
                tone="quiet"
              >
                {t("properties.replaceFontInFile", {
                  count: fontContext.matchingNodeCount,
                })}
              </Button>
            </div>
          )}
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
          <Field
            accessibleLabel={t("properties.paragraphIndent")}
            label="Indent"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                node.properties.paragraphIndent,
                (paragraphIndent) =>
                  onUpdate({ properties: { paragraphIndent } }),
                { min: 0 },
              )
            }
            value={formatNumber(node.properties.paragraphIndent)}
          />
          <Field
            accessibleLabel={t("properties.paragraphSpacing")}
            label="Para"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                node.properties.paragraphSpacing,
                (paragraphSpacing) =>
                  onUpdate({ properties: { paragraphSpacing } }),
                { min: 0 },
              )
            }
            value={formatNumber(node.properties.paragraphSpacing)}
          />
          <label className={styles.select}>
            <span>{t("properties.textCase")}</span>
            <select
              aria-label={t("properties.textCase")}
              onChange={(event) =>
                onUpdate({
                  properties: {
                    textCase: event.target
                      .value as TextNode["properties"]["textCase"],
                  },
                })
              }
              value={node.properties.textCase}
            >
              <option value="original">{t("properties.caseOriginal")}</option>
              <option value="uppercase">{t("properties.caseUppercase")}</option>
              <option value="lowercase">{t("properties.caseLowercase")}</option>
              <option value="title-case">{t("properties.caseTitle")}</option>
              <option value="small-caps">
                {t("properties.caseSmallCaps")}
              </option>
            </select>
          </label>
          <label className={styles.select}>
            <span>{t("properties.textDecoration")}</span>
            <select
              aria-label={t("properties.textDecoration")}
              onChange={(event) =>
                onUpdate({
                  properties: {
                    textDecoration: event.target
                      .value as TextNode["properties"]["textDecoration"],
                  },
                })
              }
              value={node.properties.textDecoration}
            >
              <option value="none">{t("properties.decorationNone")}</option>
              <option value="underline">
                {t("properties.decorationUnderline")}
              </option>
              <option value="strikethrough">
                {t("properties.decorationStrikethrough")}
              </option>
            </select>
          </label>
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
              onChange={(event) => {
                const textResize = event.target.value as
                  "auto-width" | "auto-height" | "fixed";
                onUpdate({
                  properties: {
                    textResize,
                    ...(textResize === "auto-width"
                      ? {
                          textWrap: "none" as const,
                          textOverflow: "visible" as const,
                        }
                      : textResize === "auto-height"
                        ? {
                            textWrap:
                              node.properties.textWrap === "none"
                                ? ("word" as const)
                                : node.properties.textWrap,
                            textOverflow: "visible" as const,
                          }
                        : node.properties.textTruncation === "ending"
                          ? { textOverflow: "clip" as const }
                          : {}),
                    ...(textResize !== "fixed" &&
                    node.properties.textTruncation === "ending" &&
                    node.properties.maxLines === null
                      ? { maxLines: 3 }
                      : {}),
                  },
                });
              }}
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
              disabled={
                node.properties.textResize !== "fixed" ||
                node.properties.textTruncation === "ending"
              }
              onChange={(event) =>
                onUpdate({
                  properties: {
                    textOverflow: event.target.value as "visible" | "clip",
                  },
                })
              }
              value={node.properties.textOverflow}
            >
              <option value="visible">{t("properties.overflowVisible")}</option>
              <option value="clip">{t("properties.overflowClip")}</option>
            </select>
          </label>
          <label className={styles.select}>
            <span>{t("properties.textTruncation")}</span>
            <select
              aria-label={t("properties.textTruncation")}
              onChange={(event) => {
                const textTruncation = event.target.value as
                  "disabled" | "ending";
                onUpdate({
                  properties: {
                    textTruncation,
                    ...(textTruncation === "disabled"
                      ? { maxLines: null }
                      : {
                          ...(node.properties.textResize === "fixed"
                            ? { textOverflow: "clip" as const }
                            : { textOverflow: "visible" as const }),
                          maxLines:
                            node.properties.textResize === "fixed"
                              ? node.properties.maxLines
                              : (node.properties.maxLines ?? 3),
                        }),
                  },
                });
              }}
              value={node.properties.textTruncation}
            >
              <option value="disabled">
                {t("properties.truncationDisabled")}
              </option>
              <option value="ending">{t("properties.truncationEnding")}</option>
            </select>
          </label>
          <Field
            accessibleLabel={t("properties.maxLines")}
            disabled={node.properties.textTruncation === "disabled"}
            label="Lines"
            min={1}
            onCommit={(draft) => {
              const normalized = draft.trim();
              if (!normalized && node.properties.textResize === "fixed") {
                if (node.properties.maxLines !== null) {
                  onUpdate({ properties: { maxLines: null } });
                }
                return "";
              }
              return commitNumber(
                normalized,
                node.properties.maxLines ?? 1,
                (maxLines) =>
                  onUpdate({ properties: { maxLines: Math.round(maxLines) } }),
                { min: 1, integer: true },
              );
            }}
            placeholder={t("properties.maxLinesByBox")}
            value={
              node.properties.maxLines === null
                ? ""
                : formatNumber(node.properties.maxLines)
            }
          />
        </div>
      </div>
    </Section>
  );
}
