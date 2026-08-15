import { describe, expect, it, vi } from "vitest";
import { channels } from "../../shared/desktop-api";
import {
  registerFontBinaryIpc,
  type FontBinaryIpcRegistrar,
} from "./font-binary-ipc";

describe("font binary IPC", () => {
  it("validates renderer, argument counts, and stable font IDs", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc: FontBinaryIpcRegistrar = {
      handle(channel, handler) {
        handlers.set(channel, handler as (...args: unknown[]) => unknown);
      },
    };
    const host = {
      importFiles: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({}),
    };
    const assertRenderer = vi.fn();
    registerFontBinaryIpc({
      assertRenderer,
      host,
      ipc,
      selectFiles: vi.fn().mockResolvedValue(["/approved/font.ttf"]),
    });
    const event = {} as never;
    await handlers.get(channels.selectFontBinaries)!(event);
    expect(assertRenderer).toHaveBeenCalledWith(event);
    expect(host.importFiles).toHaveBeenCalledWith(["/approved/font.ttf"]);
    expect(() =>
      handlers.get(channels.readFontBinary)!(event, { fontId: "font_bad" }),
    ).toThrow("Invalid font binary read request");
    expect(host.read).not.toHaveBeenCalled();
  });
});
