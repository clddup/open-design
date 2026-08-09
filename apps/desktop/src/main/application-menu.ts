import type { MenuItemConstructorOptions } from "electron";

export function createApplicationMenuTemplate(
  applicationName: string,
  platform: NodeJS.Platform,
  {
    onOpenSettings,
    settingsLabel,
  }: { onOpenSettings: () => void; settingsLabel: string },
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
                click: onOpenSettings,
                label: settingsLabel,
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
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
}
