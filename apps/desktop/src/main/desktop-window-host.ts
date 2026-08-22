import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMainInvokeEvent,
  WebContents,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  channels,
  isWindowAction,
  type WindowAction,
} from "../shared/desktop-api.js";
import {
  isAllowedRendererNavigation,
  isExternalHttpUrl,
} from "./navigation-policy.js";
import { resolveRendererUrl } from "./renderer-url.js";

export interface DesktopWindowHostOptions {
  createWindow(options: BrowserWindowConstructorOptions): BrowserWindow;
  environment: Readonly<Record<string, string | undefined>>;
  getAllWindows(): readonly BrowserWindow[];
  getBackgroundColor(): string;
  getIconPath(): string;
  isPackaged: boolean;
  openExternal(url: string): Promise<void> | void;
  packagedRendererPath: string;
  preloadPath: string;
  showWindow(window: BrowserWindow): void;
}

export interface DesktopWindowIpcRegistrar {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void;
}

export class DesktopWindowHost {
  readonly #options: DesktopWindowHostOptions;
  #window: BrowserWindow | null = null;

  constructor(options: DesktopWindowHostOptions) {
    this.#options = options;
  }

  current(): BrowserWindow | null {
    const window = this.#window;
    return window && !window.isDestroyed() ? window : null;
  }

  create(): BrowserWindow {
    const current = this.current();
    if (current) return current;

    const rendererUrl = resolveRendererUrl(this.#options.environment);
    const packagedRendererUrl = pathToFileURL(
      this.#options.packagedRendererPath,
    ).toString();
    const window = this.#options.createWindow({
      width: 1440,
      height: 920,
      minWidth: 920,
      minHeight: 620,
      show: false,
      title: "OpenDesign",
      icon: this.#options.getIconPath(),
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 14, y: 15 },
      backgroundColor: this.#options.getBackgroundColor(),
      webPreferences: {
        preload: this.#options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        // Agent design commits, cancellation and autosave must keep advancing
        // while a native dialog is open or the workbench is occluded.
        backgroundThrottling: false,
        devTools: !this.#options.isPackaged,
      },
    });
    this.#window = window;

    window.once("ready-to-show", () => {
      if (this.current() === window) this.#options.showWindow(window);
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalHttpUrl(url)) void this.#options.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedRendererNavigation(url, rendererUrl, packagedRendererUrl)) {
        event.preventDefault();
      }
    });

    if (rendererUrl) void window.loadURL(rendererUrl);
    else void window.loadFile(this.#options.packagedRendererPath);

    window.on("closed", () => {
      if (this.#window === window) this.#window = null;
    });
    return window;
  }

  activate(): void {
    if (this.#options.getAllWindows().length === 0) this.create();
  }

  registerIpc(ipc: DesktopWindowIpcRegistrar): void {
    ipc.handle(channels.windowAction, (event, ...args) => {
      if (args.length !== 1) throw new TypeError("Unexpected IPC arguments");
      const action = args[0];
      if (!isWindowAction(action)) throw new TypeError("Invalid window action");
      this.handleAction(event.sender, action);
    });
  }

  assertRenderer(
    event: Pick<IpcMainInvokeEvent, "sender">,
    message = "Request from unknown renderer",
  ): void {
    if (event.sender !== this.current()?.webContents) throw new Error(message);
  }

  send(channel: string, ...args: unknown[]): boolean {
    const window = this.current();
    if (!window) return false;
    window.webContents.send(channel, ...args);
    return true;
  }

  handleAction(sender: WebContents, action: WindowAction): void {
    const window = this.current();
    if (!window || sender !== window.webContents) return;
    if (action === "minimize") window.minimize();
    if (action === "toggle-maximize") {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    }
    if (action === "close") window.close();
  }
}

export function resolveApplicationIconPath(input: {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}): string {
  return input.isPackaged
    ? join(input.resourcesPath, "icon.png")
    : join(input.appPath, "build/icon.png");
}
