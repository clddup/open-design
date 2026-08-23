import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { channels } from "@/shared/desktop-api.js";
import {
  ApplicationPreferencesHost,
  type ApplicationPreferencesIpcRegistrar,
} from "./application-preferences-host.js";

type Handler = Parameters<ApplicationPreferencesIpcRegistrar["handle"]>[1];
const event = {} as IpcMainInvokeEvent;

describe("ApplicationPreferencesHost", () => {
  it("restores only a valid persisted locale", () => {
    const fixture = setup();

    expect(fixture.host.restoreLocale("zh-CN")).toBe(true);
    expect(fixture.host.locale()).toBe("zh-CN");
    expect(fixture.host.restoreLocale("fr")).toBe(false);
    expect(fixture.host.locale()).toBe("zh-CN");
  });

  it("owns Locale persistence, menu refresh and Renderer notification", () => {
    const fixture = setup();

    expect(invoke(fixture, channels.getLocale)).toBe("zh-CN");
    expect(invoke(fixture, channels.setLocale, "en")).toBe("en");
    expect(fixture.persistLocale).toHaveBeenCalledWith("en");
    expect(fixture.installMenu).toHaveBeenCalledOnce();
    expect(fixture.publishLocale).toHaveBeenCalledWith("en");
    expect(fixture.host.locale()).toBe("en");
  });

  it("owns Theme state and delegates native theme projection", () => {
    const fixture = setup();

    expect(invoke(fixture, channels.getTheme)).toBe("system");
    expect(invoke(fixture, channels.setTheme, "dark")).toBe("dark");
    expect(fixture.setNativeTheme).toHaveBeenCalledWith("dark");
    fixture.host.publishNativeThemeUpdated(true);
    expect(fixture.publishTheme).toHaveBeenCalledWith(true);
  });

  it("validates sender before arguments and preference payloads", () => {
    const fixture = setup({
      assertRenderer: vi.fn(() => {
        throw new Error("Request from unknown renderer");
      }),
    });

    expect(() => invoke(fixture, channels.setTheme, "invalid")).toThrow(
      "Request from unknown renderer",
    );
    expect(fixture.setNativeTheme).not.toHaveBeenCalled();

    fixture.assertRenderer.mockImplementation(() => undefined);
    expect(() => invoke(fixture, channels.getTheme, "extra")).toThrow(
      "Unexpected IPC arguments",
    );
    expect(() => invoke(fixture, channels.setTheme, "invalid")).toThrow(
      "Invalid theme preference",
    );
    expect(() => invoke(fixture, channels.setLocale, "fr")).toThrow(
      "Invalid locale preference",
    );
    expect(fixture.persistLocale).not.toHaveBeenCalled();
  });
});

function invoke(
  fixture: ReturnType<typeof setup>,
  channel: string,
  ...args: unknown[]
): unknown {
  const handler = fixture.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler ${channel}`);
  return handler(event, ...args);
}

function setup(
  overrides: {
    assertRenderer?: (event: IpcMainInvokeEvent) => void;
  } = {},
) {
  const handlers = new Map<string, Handler>();
  const installMenu = vi.fn();
  const persistLocale = vi.fn();
  const publishLocale = vi.fn();
  const publishTheme = vi.fn();
  const setNativeTheme = vi.fn();
  const assertRenderer = vi.fn(overrides.assertRenderer ?? (() => undefined));
  const host = new ApplicationPreferencesHost({
    installMenu,
    persistLocale,
    publishLocale,
    publishTheme,
    setNativeTheme,
  });
  host.registerIpc({
    assertRenderer,
    ipc: {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
  });
  return {
    assertRenderer,
    handlers,
    host,
    installMenu,
    persistLocale,
    publishLocale,
    publishTheme,
    setNativeTheme,
  };
}
