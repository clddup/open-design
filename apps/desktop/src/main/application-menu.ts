import type { MenuItemConstructorOptions } from "electron";

export interface ApplicationMenuOptions {
  exportSvgLabel: string;
  fileLabel: string;
  importSvgLabel: string;
  onExportSvg: () => void;
  onImportSvg: () => void;
  onOpenSettings: () => void;
  settingsLabel: string;
}

export function createApplicationMenuTemplate(
  applicationName: string,
  platform: NodeJS.Platform,
  options: ApplicationMenuOptions,
): MenuItemConstructorOptions[] {
  return [
    ...(platform === "darwin"
      ? [
          {
            label: applicationName,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                accelerator: "CommandOrControl+,",
                click: options.onOpenSettings,
                label: options.settingsLabel,
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: options.fileLabel,
      submenu: [
        {
          click: options.onImportSvg,
          label: options.importSvgLabel,
        },
        {
          accelerator: "CommandOrControl+Shift+E",
          click: options.onExportSvg,
          label: options.exportSvgLabel,
        },
        { type: "separator" },
        { role: platform === "darwin" ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
}
