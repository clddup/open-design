import type { AppLocale } from "./locale";
import { enMessages } from "./catalogs/en";
import { zhCNMessages } from "./catalogs/zh-CN";

export { enMessages } from "./catalogs/en";

export type MessageKey = keyof typeof enMessages;
export type MessageParameters = Readonly<Record<string, string | number>>;

const catalogs = {
  en: enMessages,
  "zh-CN": zhCNMessages,
} satisfies Record<AppLocale, Record<MessageKey, string>>;

export function translate(
  locale: AppLocale,
  key: MessageKey,
  parameters: MessageParameters = {},
): string {
  const template = catalogs[locale][key];
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.hasOwn(parameters, name) ? String(parameters[name]) : match,
  );
}
