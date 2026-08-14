import type { DesignNode, ExportSetting } from "@opendesign/design-contracts";
import type { RasterExportFormat, RasterExportSize } from "./raster.js";

export type StoredExportExecutionPlan =
  | {
      ok: true;
      kind: "raster";
      format: RasterExportFormat;
      size: RasterExportSize;
      suffix: string;
    }
  | {
      ok: true;
      kind: "svg";
      includeLayerIds: boolean;
      suffix: string;
    }
  | { ok: false; code: "unsupported"; message: string };

export function planStoredExportSetting(
  node: DesignNode,
  setting: ExportSetting,
): StoredExportExecutionPlan {
  if (setting.colorProfile === "DISPLAY_P3_V4") {
    return unsupported("Display P3 export is not implemented yet");
  }
  if (!setting.contentsOnly) {
    return unsupported(
      "Exporting overlapping canvas content is not implemented yet",
    );
  }
  if (setting.useAbsoluteBounds) {
    return unsupported("Absolute-bounds export is not implemented yet");
  }
  if (setting.format === "PDF") {
    return unsupported("PDF export is not implemented yet");
  }
  if (setting.format === "SVG") {
    if (node.kind === "slice") {
      return unsupported("Slice SVG crop semantics are not implemented yet");
    }
    if (setting.svgOutlineText) {
      return unsupported("SVG text outlining is not implemented yet");
    }
    if (!setting.svgSimplifyStroke) {
      return unsupported(
        "Unsimplified SVG stroke expansion is not implemented yet",
      );
    }
    return {
      ok: true,
      kind: "svg",
      includeLayerIds: setting.svgIdAttribute,
      suffix: setting.suffix,
    };
  }
  return {
    ok: true,
    kind: "raster",
    format:
      setting.format === "JPG"
        ? "jpeg"
        : setting.format === "PNG"
          ? "png"
          : "webp",
    size:
      setting.constraint.type === "SCALE"
        ? { mode: "scale", value: setting.constraint.value }
        : setting.constraint.type === "WIDTH"
          ? { mode: "width", value: setting.constraint.value }
          : { mode: "height", value: setting.constraint.value },
    suffix: setting.suffix,
  };
}

function unsupported(message: string): StoredExportExecutionPlan {
  return { ok: false, code: "unsupported", message };
}
