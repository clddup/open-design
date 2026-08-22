import type { diagnosticMessages as englishMessages } from "./en";

export const diagnosticMessages = {
  "diagnostic.notifications": "系统通知",
  "diagnostic.errorTitle": "OpenDesign 遇到错误",
  "diagnostic.warningTitle": "OpenDesign 需要处理",
  "diagnostic.infoTitle": "系统通知",
  "diagnostic.copy": "复制诊断信息",
  "diagnostic.copied": "诊断信息已复制",
  "diagnostic.copyFailed": "复制失败",
  "diagnostic.dismiss": "关闭通知",
} satisfies Record<keyof typeof englishMessages, string>;
