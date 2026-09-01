import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMainInvokeEvent,
  WebContents,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopWindowHost,
  type DesktopWindowIpcRegistrar,
  resolveApplicationIconPath,
} from "./desktop-window-host.js";
import { channels } from "@/shared/desktop-api.js";

describe("DesktopWindowHost", () => {
  it("creates one secure desktop workbench and loads the development renderer", () => {
    const fixture = setup({
      environment: { VITE_DEV_SERVER_URL: "http://127.0.0.1:5173/editor" },
      isPackaged: false,
    });

    const window = fixture.host.create();

    expect(fixture.createWindow).toHaveBeenCalledOnce();
    expect(fixture.createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1440,
        height: 920,
        minWidth: 920,
        minHeight: 620,
        show: false,
        title: "OpenDesign",
        icon: "/application/icon.png",
        titleBarStyle: "hidden",
        backgroundColor: "#191a1b",
      }),
    );
    const createOptions = fixture.createWindow.mock.calls[0]?.[0];
    expect(createOptions?.webPreferences).toMatchObject({
      preload: "/application/preload.cjs",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      devTools: true,
    });
    expect(fixture.window.loadURL).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/editor",
    );
    expect(fixture.window.loadFile).not.toHaveBeenCalled();
    expect(fixture.host.create()).toBe(window);
    expect(fixture.createWindow).toHaveBeenCalledOnce();
  });

  it("loads the packaged renderer and enforces navigation and external-link policy", () => {
    const fixture = setup({ isPackaged: true });
    fixture.host.create();

    expect(fixture.window.loadFile).toHaveBeenCalledWith(
      "/application/renderer/index.html",
    );
    const open = fixture.handlers.openWindow;
    const navigate = fixture.handlers.navigate;
    if (!open || !navigate)
      throw new Error("Window policy handlers are missing");

    expect(open({ url: "https://example.com/docs" })).toEqual({
      action: "deny",
    });
    expect(fixture.openExternal).toHaveBeenCalledWith(
      "https://example.com/docs",
    );
    expect(open({ url: "file:///tmp/untrusted.html" })).toEqual({
      action: "deny",
    });
    expect(fixture.openExternal).toHaveBeenCalledOnce();

    const allowed = { preventDefault: vi.fn() };
    navigate(
      allowed,
      pathToFileURL("/application/renderer/index.html").toString(),
    );
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    const denied = { preventDefault: vi.fn() };
    navigate(
      denied,
      pathToFileURL("/application/renderer/other.html").toString(),
    );
    expect(denied.preventDefault).toHaveBeenCalledOnce();
  });

  it("grants only local font access to the trusted renderer", () => {
    const fixture = setup({ isPackaged: true });
    fixture.host.create();
    const check = fixture.handlers.permissionCheck;
    const request = fixture.handlers.permissionRequest;
    if (!check || !request) throw new Error("Permission policy is missing");

    const renderer = fixture.webContents as unknown as WebContents;
    const mainFrame = {
      isMainFrame: true,
      requestingUrl: pathToFileURL(
        "/application/renderer/index.html",
      ).toString(),
    };
    expect(check(renderer, "local-fonts", "file://", mainFrame)).toBe(true);
    expect(check(renderer, "media", "file://", mainFrame)).toBe(false);
    expect(check({} as WebContents, "local-fonts", "file://", mainFrame)).toBe(
      false,
    );
    expect(
      check(renderer, "local-fonts", "https://untrusted.example", {
        isMainFrame: false,
        requestingUrl: "https://untrusted.example/frame",
      }),
    ).toBe(false);
    const callback = vi.fn();
    request(renderer, "local-fonts", callback, mainFrame);
    expect(callback).toHaveBeenCalledWith(true);
    request(renderer, "clipboard-read", callback, mainFrame);
    expect(callback).toHaveBeenLastCalledWith(false);

    fixture.host.dispose();
    expect(fixture.session.setPermissionCheckHandler).toHaveBeenLastCalledWith(
      null,
    );
    expect(
      fixture.session.setPermissionRequestHandler,
    ).toHaveBeenLastCalledWith(null);
  });

  it("shows and clears only the current window and recreates it on activation", () => {
    const fixture = setup();
    fixture.host.create();
    fixture.handlers.ready?.();
    expect(fixture.showWindow).toHaveBeenCalledWith(fixture.browserWindow);

    fixture.handlers.closed?.();
    expect(fixture.host.current()).toBeNull();

    fixture.getAllWindows.mockReturnValueOnce([fixture.browserWindow]);
    fixture.host.activate();
    expect(fixture.createWindow).toHaveBeenCalledOnce();
    fixture.getAllWindows.mockReturnValueOnce([]);
    fixture.host.activate();
    expect(fixture.createWindow).toHaveBeenCalledTimes(2);
  });

  it("destroys an unpublished startup window during rollback", () => {
    const fixture = setup();
    fixture.host.create();

    fixture.host.dispose();
    fixture.host.dispose();

    expect(fixture.window.destroy).toHaveBeenCalledOnce();
    expect(fixture.host.current()).toBeNull();
  });

  it("fails startup and destroys the window when the renderer cannot load", async () => {
    const fixture = setup();
    fixture.window.loadFile.mockRejectedValueOnce(
      new Error("renderer bundle is missing"),
    );
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(fixture.host.createAndLoad()).rejects.toThrow(
      "renderer bundle is missing",
    );

    expect(fixture.window.destroy).toHaveBeenCalledOnce();
    expect(fixture.host.current()).toBeNull();
    expect(error).toHaveBeenCalledWith(
      "Desktop renderer failed to load: renderer bundle is missing",
    );
    error.mockRestore();
  });

  it("keeps a loaded startup window unpublished until the application commits", async () => {
    const fixture = setup();
    const loading = fixture.host.createAndLoad();
    fixture.handlers.ready?.();

    expect(fixture.showWindow).not.toHaveBeenCalled();
    await loading;
    fixture.host.publish();

    expect(fixture.showWindow).toHaveBeenCalledOnce();
    expect(fixture.showWindow).toHaveBeenCalledWith(fixture.browserWindow);
  });

  it("ignores late lifecycle events from a replaced destroyed window", () => {
    const first = setup();
    first.host.create();
    first.window.isDestroyed.mockReturnValue(true);
    const replacement = setup();
    first.createWindow.mockReturnValueOnce(replacement.browserWindow);

    expect(first.host.create()).toBe(replacement.browserWindow);
    first.handlers.ready?.();
    first.handlers.closed?.();
    expect(first.showWindow).not.toHaveBeenCalled();
    expect(first.host.current()).toBe(replacement.browserWindow);

    replacement.handlers.ready?.();
    expect(first.showWindow).toHaveBeenCalledWith(replacement.browserWindow);
  });

  it("owns renderer identity, outbound events and native window actions", () => {
    const fixture = setup();
    fixture.host.create();
    const sender = fixture.browserWindow.webContents;
    const otherSender = {} as WebContents;

    expect(() => fixture.host.assertRenderer({ sender })).not.toThrow();
    expect(() => fixture.host.assertRenderer({ sender: otherSender })).toThrow(
      "Request from unknown renderer",
    );
    expect(fixture.host.send("design:event", { revision: 4 })).toBe(true);
    expect(fixture.webContents.send).toHaveBeenCalledWith("design:event", {
      revision: 4,
    });

    fixture.host.handleAction(otherSender, "minimize");
    expect(fixture.window.minimize).not.toHaveBeenCalled();
    fixture.host.handleAction(sender, "minimize");
    expect(fixture.window.minimize).toHaveBeenCalledOnce();
    fixture.host.handleAction(sender, "toggle-maximize");
    expect(fixture.window.maximize).toHaveBeenCalledOnce();
    fixture.window.isMaximized.mockReturnValueOnce(true);
    fixture.host.handleAction(sender, "toggle-maximize");
    expect(fixture.window.unmaximize).toHaveBeenCalledOnce();
    fixture.host.handleAction(sender, "close");
    expect(fixture.window.close).toHaveBeenCalledOnce();

    fixture.window.isDestroyed.mockReturnValueOnce(true);
    expect(fixture.host.send("ignored")).toBe(false);
  });

  it("registers and validates the native window action boundary", () => {
    const fixture = setup();
    fixture.host.create();
    const handlers = new Map<
      string,
      Parameters<DesktopWindowIpcRegistrar["handle"]>[1]
    >();
    fixture.host.registerIpc({
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    });
    const handler = handlers.get(channels.windowAction);
    if (!handler) throw new Error("Window action handler is missing");
    const event = {
      sender: fixture.browserWindow.webContents,
    } as IpcMainInvokeEvent;

    expect(() => handler(event)).toThrow("Unexpected IPC arguments");
    expect(() => handler(event, "unsupported")).toThrow(
      "Invalid window action",
    );
    handler(event, "minimize");
    expect(fixture.window.minimize).toHaveBeenCalledOnce();
  });
});

describe("resolveApplicationIconPath", () => {
  it("uses the packaged resource and development build locations", () => {
    expect(
      resolveApplicationIconPath({
        appPath: "/repo/apps/desktop",
        isPackaged: true,
        resourcesPath: "/bundle/resources",
      }),
    ).toBe(join("/bundle/resources", "icon.png"));
    expect(
      resolveApplicationIconPath({
        appPath: "/repo/apps/desktop",
        isPackaged: false,
        resourcesPath: "/bundle/resources",
      }),
    ).toBe(join("/repo/apps/desktop", "build/icon.png"));
  });
});

function setup(
  overrides: {
    environment?: Readonly<Record<string, string | undefined>>;
    isPackaged?: boolean;
  } = {},
) {
  const handlers: {
    closed?: () => void;
    navigate?: (event: { preventDefault(): void }, url: string) => void;
    openWindow?: (details: { url: string }) => { action: "deny" };
    permissionCheck?: (
      webContents: WebContents | null,
      permission: string,
      requestingOrigin: string,
      details: { isMainFrame: boolean; requestingUrl?: string },
    ) => boolean;
    permissionRequest?: (
      webContents: WebContents,
      permission: string,
      callback: (granted: boolean) => void,
      details: { isMainFrame: boolean; requestingUrl?: string },
    ) => void;
    ready?: () => void;
  } = {};
  let currentUrl = "";
  const session = {
    setPermissionCheckHandler: vi.fn(
      (handler: typeof handlers.permissionCheck | null) => {
        if (handler) handlers.permissionCheck = handler;
        else delete handlers.permissionCheck;
      },
    ),
    setPermissionRequestHandler: vi.fn(
      (handler: typeof handlers.permissionRequest | null) => {
        if (handler) handlers.permissionRequest = handler;
        else delete handlers.permissionRequest;
      },
    ),
  };
  const webContents = {
    getURL: vi.fn(() => currentUrl),
    on: vi.fn((event: string, handler: typeof handlers.navigate) => {
      if (event === "will-navigate") handlers.navigate = handler;
    }),
    session,
    send: vi.fn(),
    setWindowOpenHandler: vi.fn((handler: typeof handlers.openWindow) => {
      handlers.openWindow = handler;
    }),
  };
  const window = {
    close: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    loadFile: vi.fn((path: string) => {
      currentUrl = pathToFileURL(path).toString();
      return Promise.resolve();
    }),
    loadURL: vi.fn((url: string) => {
      currentUrl = url;
      return Promise.resolve();
    }),
    maximize: vi.fn(),
    minimize: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "closed") handlers.closed = handler;
    }),
    once: vi.fn((event: string, handler: () => void) => {
      if (event === "ready-to-show") handlers.ready = handler;
    }),
    unmaximize: vi.fn(),
    webContents,
  };
  const browserWindow = window as unknown as BrowserWindow;
  const createWindow = vi.fn((options: BrowserWindowConstructorOptions) => {
    void options;
    return browserWindow;
  });
  const getAllWindows = vi.fn<() => readonly BrowserWindow[]>(() => []);
  const openExternal = vi.fn(() => Promise.resolve());
  const showWindow = vi.fn();
  const host = new DesktopWindowHost({
    createWindow,
    environment: overrides.environment ?? {},
    getAllWindows,
    getBackgroundColor: () => "#191a1b",
    getIconPath: () => "/application/icon.png",
    isPackaged: overrides.isPackaged ?? false,
    openExternal,
    packagedRendererPath: "/application/renderer/index.html",
    preloadPath: "/application/preload.cjs",
    showWindow,
  });
  return {
    browserWindow,
    createWindow,
    getAllWindows,
    handlers,
    host,
    openExternal,
    session,
    showWindow,
    webContents,
    window,
  };
}
