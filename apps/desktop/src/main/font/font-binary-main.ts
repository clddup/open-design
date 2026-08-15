import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { FontBinaryHost } from "./font-binary-host.js";
import {
  registerFontBinaryIpc,
  type FontBinaryIpcRegistrar,
} from "./font-binary-ipc.js";

export class FontBinaryMainService {
  readonly #host: FontBinaryHost;

  constructor(root: string) {
    this.#host = new FontBinaryHost(root);
  }

  register(
    ipc: FontBinaryIpcRegistrar,
    assertRenderer: (event: IpcMainInvokeEvent) => void,
    getWindow: () => BrowserWindow | null,
  ): void {
    registerFontBinaryIpc({
      ipc,
      assertRenderer,
      host: this.#host,
      selectFiles: async () => {
        const window = getWindow();
        if (!window || window.isDestroyed()) return [];
        const result = await dialog.showOpenDialog(window, {
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "Fonts", extensions: ["ttf", "otf", "ttc"] }],
        });
        return result.canceled ? [] : result.filePaths;
      },
    });
  }
}
