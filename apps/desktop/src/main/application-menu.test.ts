import { describe, expect, it, vi } from "vitest";
import { createApplicationMenuTemplate } from "./application-menu";

describe("createApplicationMenuTemplate", () => {
  it("uses the product name for the macOS application menu", () => {
    const onOpenSettings = vi.fn();
    const template = createApplicationMenuTemplate("OpenDesign", "darwin", {
      onOpenSettings,
      settingsLabel: "Settings…",
    });

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
    expect(settingsItem?.click).toBe(onOpenSettings);
  });

  it("keeps the native application menu macOS-only", () => {
    expect(
      createApplicationMenuTemplate("OpenDesign", "win32", {
        onOpenSettings: vi.fn(),
        settingsLabel: "Settings…",
      })[0],
    ).toEqual({ role: "fileMenu" });
  });
});
