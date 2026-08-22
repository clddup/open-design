import type { imageMessages as enImageMessages } from "./en";

export const imageMessages = {
  "history.relightImage": "更改图片光线",
  "properties.imageChangeLighting": "更改光线…",
  "properties.imageChangingLighting": "正在更改光线…",
  "properties.imageLightingPreset": "光线",
  "properties.imageLightingNaturalSoft": "柔和自然光",
  "properties.imageLightingStudioSoftbox": "影棚柔光箱",
  "properties.imageLightingGoldenHour": "黄金时刻",
  "properties.imageLightingMoonlight": "月光",
  "properties.imageLightingNeon": "霓虹彩光",
  "properties.imageApplyLighting": "更改光线",
} satisfies Record<keyof typeof enImageMessages, string>;
