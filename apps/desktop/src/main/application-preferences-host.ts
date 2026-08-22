import type { IpcMainInvokeEvent } from "electron";
import {
  channels,
  isLocalePreference,
  isThemePreference,
  type ThemePreference,
} from "../shared/desktop-api.js";
import { DEFAULT_APP_LOCALE, type AppLocale } from "../shared/i18n/locale.js";

type ApplicationPreferencesIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface ApplicationPreferencesIpcRegistrar {
  handle(channel: string, listener: ApplicationPreferencesIpcHandler): void;
}

export interface ApplicationPreferencesHostOptions {
  installMenu(): void;
  persistLocale(locale: AppLocale): void;
  publishLocale(locale: AppLocale): void;
  publishTheme(isDark: boolean): void;
  setNativeTheme(theme: ThemePreference): void;
}

export class ApplicationPreferencesHost {
  readonly #options: ApplicationPreferencesHostOptions;
  #locale: AppLocale = DEFAULT_APP_LOCALE;
  #theme: ThemePreference = "system";

  constructor(options: ApplicationPreferencesHostOptions) {
    this.#options = options;
  }

  locale(): AppLocale {
    return this.#locale;
  }

  theme(): ThemePreference {
    return this.#theme;
  }

  restoreLocale(value: unknown): boolean {
    if (!isLocalePreference(value)) return false;
    this.#locale = value;
    return true;
  }

  publishNativeThemeUpdated(isDark: boolean): void {
    this.#options.publishTheme(isDark);
  }

  registerIpc(options: {
    assertRenderer(event: IpcMainInvokeEvent): void;
    ipc: ApplicationPreferencesIpcRegistrar;
  }): void {
    options.ipc.handle(channels.getLocale, (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 0);
      return this.#locale;
    });
    options.ipc.handle(channels.setLocale, (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      const locale = args[0];
      if (!isLocalePreference(locale)) {
        throw new TypeError("Invalid locale preference");
      }
      this.#locale = locale;
      this.#options.persistLocale(locale);
      this.#options.installMenu();
      this.#options.publishLocale(locale);
      return this.#locale;
    });
    options.ipc.handle(channels.getTheme, (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 0);
      return this.#theme;
    });
    options.ipc.handle(channels.setTheme, (event, ...args: unknown[]) => {
      options.assertRenderer(event);
      assertArgumentCount(args, 1);
      const theme = args[0];
      if (!isThemePreference(theme)) {
        throw new TypeError("Invalid theme preference");
      }
      this.#theme = theme;
      this.#options.setNativeTheme(theme);
      return this.#theme;
    });
  }
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}
