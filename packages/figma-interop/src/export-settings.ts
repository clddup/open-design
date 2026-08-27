import type { DesignNode } from "@opendesign/design-contracts";

export type FigmaExportSettingsResult =
  | { ok: true; settings: readonly ExportSettings[] }
  | { ok: false; issues: readonly string[] };

export function toFigmaExportSettings(
  node: DesignNode,
): FigmaExportSettingsResult {
  const issues: string[] = [];
  const settings = node.exportSettings.flatMap<ExportSettings>(
    (setting, index) => {
      if (setting.format === "WEBP") {
        issues.push(
          `Export setting ${index} uses OpenDesign WEBP extension, which has no Figma Plugin API equivalent`,
        );
        return [];
      }
      const shared = {
        suffix: setting.suffix,
        contentsOnly: setting.contentsOnly,
        useAbsoluteBounds: setting.useAbsoluteBounds,
        colorProfile: setting.colorProfile,
      };
      if (setting.format === "PNG" || setting.format === "JPG") {
        return [
          {
            ...shared,
            format: setting.format,
            constraint: structuredClone(setting.constraint),
          },
        ];
      }
      if (setting.format === "SVG") {
        return [
          {
            ...shared,
            format: "SVG",
            svgOutlineText: setting.svgOutlineText,
            svgIdAttribute: setting.svgIdAttribute,
            svgSimplifyStroke: setting.svgSimplifyStroke,
          },
        ];
      }
      return [{ ...shared, format: "PDF" }];
    },
  );
  return issues.length > 0 ? { ok: false, issues } : { ok: true, settings };
}

export function toFigmaNodeType(node: DesignNode): SceneNode["type"] {
  if (node.kind === "slice") return "SLICE";
  if (node.kind === "frame" || node.kind === "slot") return "FRAME";
  if (node.kind === "group" || node.kind === "boolean") return "GROUP";
  if (node.kind === "rectangle") return "RECTANGLE";
  if (node.kind === "ellipse") return "ELLIPSE";
  if (node.kind === "line") return "LINE";
  if (node.kind === "polygon") return "POLYGON";
  if (node.kind === "star") return "STAR";
  if (node.kind === "text") return "TEXT";
  if (node.kind === "instance") return "INSTANCE";
  return "VECTOR";
}
