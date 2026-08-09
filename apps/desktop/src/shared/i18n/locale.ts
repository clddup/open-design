export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh-CN" || value === "en";
}
