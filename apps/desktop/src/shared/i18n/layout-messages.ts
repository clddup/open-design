const enLayoutMessages = {
  "history.updateConstraints": "Update constraints",
  "history.resizeFrameResponsive": "Resize responsive Frame",
  "properties.layout": "Layout",
  "properties.horizontalConstraint": "Horizontal constraint",
  "properties.verticalConstraint": "Vertical constraint",
  "properties.constraintLeft": "Left",
  "properties.constraintRight": "Right",
  "properties.constraintLeftRight": "Left & right",
  "properties.constraintTop": "Top",
  "properties.constraintBottom": "Bottom",
  "properties.constraintTopBottom": "Top & bottom",
  "properties.constraintCenter": "Center",
  "properties.constraintScale": "Scale",
  "properties.width": "Width",
  "properties.height": "Height",
} as const;

const zhCNLayoutMessages = {
  "history.updateConstraints": "更新约束",
  "history.resizeFrameResponsive": "调整响应式画框",
  "properties.layout": "布局",
  "properties.horizontalConstraint": "水平约束",
  "properties.verticalConstraint": "垂直约束",
  "properties.constraintLeft": "左侧",
  "properties.constraintRight": "右侧",
  "properties.constraintLeftRight": "左右拉伸",
  "properties.constraintTop": "顶部",
  "properties.constraintBottom": "底部",
  "properties.constraintTopBottom": "上下拉伸",
  "properties.constraintCenter": "居中",
  "properties.constraintScale": "等比缩放",
  "properties.width": "宽度",
  "properties.height": "高度",
} satisfies Record<keyof typeof enLayoutMessages, string>;

export const layoutMessages = {
  en: enLayoutMessages,
  "zh-CN": zhCNLayoutMessages,
} as const;
