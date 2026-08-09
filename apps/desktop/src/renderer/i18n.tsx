import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_APP_LOCALE, type AppLocale } from "../shared/i18n/locale";
import {
  translate,
  type MessageKey,
  type MessageParameters,
} from "../shared/i18n/messages";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

interface I18nContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => Promise<void>;
  t: Translate;
}

const fallbackValue: I18nContextValue = {
  locale: "en",
  setLocale: () => Promise.resolve(),
  t: (key, parameters) => translate("en", key, parameters),
};

const I18nContext = createContext<I18nContextValue>(fallbackValue);

export function I18nProvider({
  children,
  initialLocale = DEFAULT_APP_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: AppLocale;
}) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    let active = true;
    const desktop = window.desktop;
    if (!desktop) return;
    void desktop.getLocale().then((value) => {
      if (active) setLocaleState(value);
    });
    const unsubscribe = desktop.onLocaleChange((value) => {
      if (active) setLocaleState(value);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const setLocale = useCallback(async (value: AppLocale) => {
    const next = await window.desktop?.setLocale(value);
    setLocaleState(next ?? value);
  }, []);
  const t = useCallback<Translate>(
    (key, parameters) => translate(locale, key, parameters),
    [locale],
  );
  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
