import { describe, expect, it, vi } from "vitest";
import { createApplicationMenuTemplate } from "./application-menu";

function options() {
  return {
    exportSvgLabel: "Export selection as SVG…",
    fileLabel: "File",
    importSvgLabel: "Import SVG…",
    onExportSvg: vi.fn(),
    onImportSvg: vi.fn(),
    onOpenSettings: vi.fn(),
    settingsLabel: "Settings…",
  };
}

describe("createApplicationMenuTemplate", () => {
  it("uses the product name for the macOS application menu", () => {
    const menuOptions = options();
    const template = createApplicationMenuTemplate(
      "OpenDesign",
      "darwin",
      menuOptions,
    );

    const applicationMenu = template[0];
    expect(applicationMenu?.label).toBe("OpenDesign");
    const submenu = Array.isArray(applicationMenu?.submenu)
      ? applicationMenu.submenu
      : [];
    expect(submenu.some((item) => item.role === "about")).toBe(true);
    expect(submenu.some((item) => item.role === "quit")).toBe(true);

    const settingsItem = Array.isArray(applicationMenu?.submenu)
      ? applicationMenu.submenu.find((item) => item.label === "Settings…")
      : undefined;
    expect(settingsItem).toMatchObject({
      accelerator: "CommandOrControl+,",
      label: "Settings…",
    });
    expect(settingsItem?.click).toBe(menuOptions.onOpenSettings);
  });

  it("provides the same SVG commands and platform exit role on macOS and Windows", () => {
    const macOptions = options();
    const mac = createApplicationMenuTemplate(
      "OpenDesign",
      "darwin",
      macOptions,
    );
    const windowsOptions = options();
    const windows = createApplicationMenuTemplate(
      "OpenDesign",
      "win32",
      windowsOptions,
    );
    const macFile = mac[1];
    const windowsFile = windows[0];
    const macItems = Array.isArray(macFile?.submenu) ? macFile.submenu : [];
    const windowsItems = Array.isArray(windowsFile?.submenu)
      ? windowsFile.submenu
      : [];

    expect(macFile?.label).toBe("File");
    expect(windowsFile?.label).toBe("File");
    expect(macItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          click: macOptions.onImportSvg,
          label: "Import SVG…",
        }),
        expect.objectContaining({
          accelerator: "CommandOrControl+Shift+E",
          click: macOptions.onExportSvg,
        }),
        expect.objectContaining({ role: "close" }),
      ]),
    );
    expect(windowsItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          click: windowsOptions.onImportSvg,
          label: "Import SVG…",
        }),
        expect.objectContaining({
          accelerator: "CommandOrControl+Shift+E",
          click: windowsOptions.onExportSvg,
        }),
        expect.objectContaining({ role: "quit" }),
      ]),
    );
  });
});
