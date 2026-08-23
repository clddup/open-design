import type {
  DesignNode,
  DesignOperation,
  TextParagraphStyle,
  TextRunStyle,
} from "@opendesign/design-contracts";
import type {
  TextFontAvailabilityResult,
  TextFontDescriptor,
} from "@opendesign/text-service";
import { Button } from "@opendesign/ui";
import { useEffect, useState } from "react";
import { useI18n } from "../../../../i18n";
import type { FontBinaryImportState } from "../../hooks/use-font-binary-runtime";
import type { UpdatePropertiesPatch } from "../../../editor";
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
type TextSelectionStyle = TextRunStyle & TextParagraphStyle;

export type FontInspectorContext = {
  availability: TextFontAvailabilityResult;
  importState: FontBinaryImportState;
  matchingNodeCount: number;
  reflowableNodeCount: number;
  onImport: () => Promise<void>;
  onReflow: () => void;
  onReplace: (font: TextFontDescriptor) => void;
  paragraph?: {
    start: number;
    end: number;
    style: TextParagraphStyle;
    mixedFields: readonly (keyof TextParagraphStyle)[];
    onUpdate: (
      style: Extract<
        DesignOperation,
        { type: "update_text_range_style" }
      >["style"],
    ) => void;
  };
  range?: {
    collapsed: boolean;
    start: number;
    end: number;
    text: string;
    style: TextSelectionStyle;
    mixedFields: readonly (keyof TextSelectionStyle)[];
    onUpdate: (
      style: Extract<
        DesignOperation,
        { type: "update_text_range_style" }
      >["style"],
    ) => void;
  };
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
  const [replacementStyleName, setReplacementStyleName] = useState("");
  const [replacementWeight, setReplacementWeight] = useState(
    String(node.properties.fontWeight),
  );
  const [replacementSlant, setReplacementSlant] = useState<
    TextFontDescriptor["fontSlant"]
  >(node.properties.fontSlant);
  useEffect(() => {
    setReplacementFamily("");
    setReplacementStyleName("");
    setReplacementWeight(String(node.properties.fontWeight));
    setReplacementSlant(node.properties.fontSlant);
  }, [
    node.id,
    node.properties.fontFamily,
    node.properties.fontStyleName,
    node.properties.fontWeight,
    node.properties.fontSlant,
  ]);
  const replacementWeightNumber = Number(replacementWeight);
  const replacementValid =
    replacementFamily.trim().length > 0 &&
    Number.isInteger(replacementWeightNumber) &&
    replacementWeightNumber >= 1 &&
    replacementWeightNumber <= 1_000;
  const range = fontContext?.range;
  const activeStyle = range?.style ?? node.properties;
  const paragraph = fontContext?.paragraph;
  const activeParagraphStyle = paragraph?.style ?? {
    listOptions: { type: "none" as const },
    indentation: 0,
    listSpacing: node.properties.listSpacing,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
  };
  const isParagraphMixed = (field: keyof TextParagraphStyle) =>
    paragraph?.mixedFields.includes(field) ?? false;
  const isMixed = (field: keyof TextSelectionStyle) =>
    range?.mixedFields.includes(field) ?? false;
  const updateTextStyle = (
    style: Parameters<
      NonNullable<FontInspectorContext["range"]>["onUpdate"]
    >[0],
  ) => {
    if (range) range.onUpdate(style);
    else onUpdate({ properties: style });
  };
  return (
    <Section title={t("properties.typography")}>
      <div className={styles.stack}>
        <TextAreaField
          label={t("properties.textContent")}
          onCommit={(content) => onUpdate({ properties: { content } })}
          value={node.properties.content}
        />
        {range && (
          <div className={styles.textRangeStatus} role="status">
            <strong>
              {range.collapsed
                ? t("properties.textCaret", { position: range.start })
                : t("properties.textRange", {
                    start: range.start,
                    end: range.end,
                  })}
            </strong>
            {!range.collapsed && <span title={range.text}>{range.text}</span>}
            <small>
              {t(
                range.collapsed
                  ? "properties.textCaretHint"
                  : "properties.textRangeHint",
              )}
            </small>
          </div>
        )}
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
              if (next !== activeStyle.fontFamily || isMixed("fontFamily")) {
                updateTextStyle({ fontFamily: next });
              }
              return next;
            }}
            placeholder={
              isMixed("fontFamily") ? t("properties.mixed") : undefined
            }
            type="text"
            value={isMixed("fontFamily") ? "" : activeStyle.fontFamily}
          />
          <Field
            accessibleLabel={t("properties.fontSize")}
            label="Size"
            min={1}
            onCommit={(draft) =>
              commitNumber(
                draft,
                activeStyle.fontSize,
                (fontSize) => updateTextStyle({ fontSize }),
                { min: 1 },
              )
            }
            placeholder={
              isMixed("fontSize") ? t("properties.mixed") : undefined
            }
            value={
              isMixed("fontSize") ? "" : formatNumber(activeStyle.fontSize)
            }
          />
          <Field
            accessibleLabel={t("properties.fontStyleName")}
            label="Style"
            onCommit={(value) => {
              const fontStyleName = value.trim() || null;
              if (
                fontStyleName !== activeStyle.fontStyleName ||
                isMixed("fontStyleName")
              ) {
                updateTextStyle({ fontStyleName });
              }
              return fontStyleName ?? "";
            }}
            placeholder={
              isMixed("fontStyleName")
                ? t("properties.mixed")
                : t("properties.fontStyleUnresolved")
            }
            type="text"
            value={
              isMixed("fontStyleName") ? "" : (activeStyle.fontStyleName ?? "")
            }
          />
          <Field
            accessibleLabel={t("properties.fontWeight")}
            label="Weight"
            max={1000}
            min={1}
            onCommit={(draft) =>
              commitNumber(
                draft,
                activeStyle.fontWeight,
                (fontWeight) =>
                  updateTextStyle({ fontWeight: Math.round(fontWeight) }),
                { min: 1, max: 1000 },
              )
            }
            placeholder={
              isMixed("fontWeight") ? t("properties.mixed") : undefined
            }
            value={
              isMixed("fontWeight") ? "" : formatNumber(activeStyle.fontWeight)
            }
          />
          <label className={styles.select}>
            <span>{t("properties.fontSlant")}</span>
            <select
              aria-label={t("properties.fontSlant")}
              onChange={(event) =>
                updateTextStyle({
                  fontSlant: event.target
                    .value as TextFontDescriptor["fontSlant"],
                })
              }
              value={isMixed("fontSlant") ? "" : activeStyle.fontSlant}
            >
              {isMixed("fontSlant") && (
                <option value="">{t("properties.mixed")}</option>
              )}
              <option value="normal">{t("properties.fontSlantNormal")}</option>
              <option value="italic">{t("properties.fontSlantItalic")}</option>
            </select>
          </label>
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
                disabled={
                  fontContext.availability.status === "available"
                    ? fontContext.reflowableNodeCount === 0
                    : fontContext.importState.status === "importing"
                }
                onClick={() =>
                  fontContext.availability.status === "available"
                    ? fontContext.onReflow()
                    : void fontContext.onImport()
                }
                tone="quiet"
              >
                {t(
                  fontContext.availability.status === "available"
                    ? "properties.reflowFont"
                    : fontContext.importState.status === "importing"
                      ? "properties.importingFont"
                      : "properties.importFont",
                )}
              </Button>
            </div>
          )}
          {fontContext?.importState.status === "success" && (
            <div className={styles.fontImportFeedback} role="status">
              {t("properties.fontImportSuccess", {
                count: fontContext.importState.count,
              })}
            </div>
          )}
          {fontContext?.importState.status === "error" && (
            <div
              className={cx(styles.fontImportFeedback, styles.fontImportError)}
              role="alert"
            >
              {t("properties.fontImportFailed", {
                message: fontContext.importState.message,
              })}
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
              <Field
                accessibleLabel={t("properties.replacementFontStyleName")}
                label="Style"
                onCommit={(value) => {
                  const next = value.trim();
                  setReplacementStyleName(next);
                  return next;
                }}
                placeholder={t("properties.fontStyleUnresolved")}
                type="text"
                value={replacementStyleName}
              />
              <label className={styles.select}>
                <span>{t("properties.fontSlant")}</span>
                <select
                  aria-label={t("properties.replacementFontSlant")}
                  onChange={(event) =>
                    setReplacementSlant(
                      event.target.value as TextFontDescriptor["fontSlant"],
                    )
                  }
                  value={replacementSlant}
                >
                  <option value="normal">
                    {t("properties.fontSlantNormal")}
                  </option>
                  <option value="italic">
                    {t("properties.fontSlantItalic")}
                  </option>
                </select>
              </label>
              <Button
                disabled={!replacementValid}
                onClick={() => {
                  if (!replacementValid) return;
                  fontContext.onReplace({
                    fontFamily: replacementFamily.trim(),
                    fontStyleName: replacementStyleName.trim() || null,
                    fontWeight: replacementWeightNumber,
                    fontSlant: replacementSlant,
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
                activeStyle.lineHeight,
                (lineHeight) => updateTextStyle({ lineHeight }),
                { min: 1 },
              )
            }
            placeholder={
              isMixed("lineHeight") ? t("properties.mixed") : undefined
            }
            value={
              isMixed("lineHeight") ? "" : formatNumber(activeStyle.lineHeight)
            }
          />
          <Field
            accessibleLabel={t("properties.letterSpacing")}
            label="Track"
            onCommit={(draft) =>
              commitNumber(draft, activeStyle.letterSpacing, (letterSpacing) =>
                updateTextStyle({ letterSpacing }),
              )
            }
            placeholder={
              isMixed("letterSpacing") ? t("properties.mixed") : undefined
            }
            value={
              isMixed("letterSpacing")
                ? ""
                : formatNumber(activeStyle.letterSpacing)
            }
          />
          <Field
            accessibleLabel={t("properties.paragraphIndent")}
            label="Indent"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                activeStyle.paragraphIndent,
                (paragraphIndent) => updateTextStyle({ paragraphIndent }),
                { min: 0 },
              )
            }
            placeholder={
              isMixed("paragraphIndent") ? t("properties.mixed") : undefined
            }
            value={
              isMixed("paragraphIndent")
                ? ""
                : formatNumber(activeStyle.paragraphIndent)
            }
          />
          <Field
            accessibleLabel={t("properties.paragraphSpacing")}
            label="Para"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                activeStyle.paragraphSpacing,
                (paragraphSpacing) => updateTextStyle({ paragraphSpacing }),
                { min: 0 },
              )
            }
            placeholder={
              isMixed("paragraphSpacing") ? t("properties.mixed") : undefined
            }
            value={
              isMixed("paragraphSpacing")
                ? ""
                : formatNumber(activeStyle.paragraphSpacing)
            }
          />
          <label className={styles.select}>
            <span>{t("properties.listStyle")}</span>
            <select
              aria-label={t("properties.listStyle")}
              disabled={!paragraph}
              onChange={(event) =>
                paragraph?.onUpdate({
                  listOptions: {
                    type: event.target
                      .value as TextParagraphStyle["listOptions"]["type"],
                  },
                })
              }
              value={
                isParagraphMixed("listOptions")
                  ? ""
                  : activeParagraphStyle.listOptions.type
              }
            >
              {isParagraphMixed("listOptions") && (
                <option value="">{t("properties.mixed")}</option>
              )}
              <option value="none">{t("properties.listNone")}</option>
              <option value="unordered">{t("properties.listUnordered")}</option>
              <option value="ordered">{t("properties.listOrdered")}</option>
            </select>
          </label>
          <Field
            accessibleLabel={t("properties.listIndentation")}
            disabled={!paragraph}
            label="Level"
            max={5}
            min={activeParagraphStyle.listOptions.type === "none" ? 0 : 1}
            onCommit={(draft) =>
              commitNumber(
                draft,
                activeParagraphStyle.indentation,
                (indentation) => paragraph?.onUpdate({ indentation }),
                {
                  min: activeParagraphStyle.listOptions.type === "none" ? 0 : 1,
                  max: 5,
                  integer: true,
                },
              )
            }
            placeholder={
              isParagraphMixed("indentation")
                ? t("properties.mixed")
                : undefined
            }
            value={
              isParagraphMixed("indentation")
                ? ""
                : formatNumber(activeParagraphStyle.indentation)
            }
          />
          <Field
            accessibleLabel={t("properties.listSpacing")}
            disabled={!paragraph}
            label="List"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                activeParagraphStyle.listSpacing,
                (listSpacing) => paragraph?.onUpdate({ listSpacing }),
                { min: 0 },
              )
            }
            placeholder={
              isParagraphMixed("listSpacing")
                ? t("properties.mixed")
                : undefined
            }
            value={
              isParagraphMixed("listSpacing")
                ? ""
                : formatNumber(activeParagraphStyle.listSpacing)
            }
          />
          <div className={styles.toggles}>
            <label>
              <input
                checked={node.properties.hangingList}
                onChange={(event) =>
                  onUpdate({
                    properties: { hangingList: event.target.checked },
                  })
                }
                type="checkbox"
              />
              {t("properties.hangingList")}
            </label>
          </div>
          <label className={styles.select}>
            <span>{t("properties.textCase")}</span>
            <select
              aria-label={t("properties.textCase")}
              onChange={(event) =>
                updateTextStyle({
                  textCase: event.target
                    .value as TextNode["properties"]["textCase"],
                })
              }
              value={isMixed("textCase") ? "" : activeStyle.textCase}
            >
              {isMixed("textCase") && (
                <option value="">{t("properties.mixed")}</option>
              )}
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
                updateTextStyle({
                  textDecoration: event.target
                    .value as TextNode["properties"]["textDecoration"],
                })
              }
              value={
                isMixed("textDecoration") ? "" : activeStyle.textDecoration
              }
            >
              {isMixed("textDecoration") && (
                <option value="">{t("properties.mixed")}</option>
              )}
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
