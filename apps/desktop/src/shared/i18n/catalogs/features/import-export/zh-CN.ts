import type { importExportMessages as englishMessages } from "./en";

export const importExportMessages = {
  "history.importSvg": "导入 {{name}}",
  "error.importSvg": "无法导入 SVG",
  "error.exportSvg": "无法导出 SVG",
  "error.exportSvgSelection": "请选择一个或多个要导出的图层",
  "error.exportRaster": "无法导出图片",
  "error.exportRasterSelection": "请选择一个图层或画板导出图片",
} satisfies Record<keyof typeof englishMessages, string>;
