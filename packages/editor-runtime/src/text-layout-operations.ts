import type { DesignNode, DesignOperation } from "@opendesign/design-contracts";

type TextProperties = Extract<DesignNode, { kind: "text" }>["properties"];
type MutableTextLayoutProperties = {
  maxLines: number | null;
  textOverflow: "visible" | "clip";
  textResize: "auto-width" | "auto-height" | "fixed";
  textTruncation: "disabled" | "ending";
  textWrap: "none" | "word" | "character";
};

export function normalizeTextResizeProperties(
  properties: TextProperties,
): void {
  const layout = properties as unknown as MutableTextLayoutProperties;
  if (layout.textResize === "auto-width") {
    layout.textWrap = "none";
    layout.textOverflow = "visible";
    return;
  }
  if (layout.textResize === "auto-height") {
    if (layout.textWrap === "none") layout.textWrap = "word";
    layout.textOverflow = "visible";
  }
  if (layout.textTruncation === "disabled") layout.maxLines = null;
}

export function textLayoutAffected(
  command: Extract<DesignOperation, { type: "update_properties" }>,
  requestedResize: unknown,
): boolean {
  if (command.size !== undefined || requestedResize !== undefined) return true;
  const properties = command.properties;
  if (!properties) return false;
  return [
    "content",
    "fontFamily",
    "fontStyleName",
    "fontSize",
    "fontWeight",
    "fontSlant",
    "lineHeight",
    "letterSpacing",
    "paragraphIndent",
    "paragraphSpacing",
    "textCase",
    "textTruncation",
    "maxLines",
    "textWrap",
  ].some((field) => Object.hasOwn(properties, field));
}
