import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkbenchLayoutController } from "./use-workbench-layout-controller";

describe("useWorkbenchLayoutController", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
      writable: true,
    });
  });

  it("owns panel visibility, sizing, tabs, and persistence", () => {
    const { result } = renderHook(() => useWorkbenchLayoutController());

    expect(result.current.leftPanelVisible).toBe(true);
    expect(result.current.utilityPanelVisible).toBe(true);
    expect(result.current.leftWidth).toBe(236);
    expect(result.current.utilityWidth).toBe(320);

    act(() => {
      result.current.resizeLeftPanel(301.6);
      result.current.resizeUtilityPanel(347.2);
      result.current.toggleLeftPanel();
      result.current.showUtilityTab("properties");
      result.current.setSidebarTab("assets");
    });

    expect(result.current.leftPanelVisible).toBe(false);
    expect(result.current.utilityPanelVisible).toBe(true);
    expect(result.current.utilityTab).toBe("properties");
    expect(result.current.sidebarTab).toBe("assets");
    expect(result.current.leftWidth).toBe(301.6);
    expect(result.current.utilityWidth).toBe(347.2);
    expect(
      window.localStorage.getItem("opendesign.workbench.panel.navigator"),
    ).toBe("hidden");
    expect(
      window.localStorage.getItem("opendesign.workbench.panel.utility"),
    ).toBe("visible");
    expect(
      window.localStorage.getItem("opendesign.workbench.panel.navigator.width"),
    ).toBe("302");
    expect(
      window.localStorage.getItem("opendesign.workbench.panel.utility.width"),
    ).toBe("347");
  });

  it("prioritizes the canvas when the window crosses compact thresholds", () => {
    const { result } = renderHook(() => useWorkbenchLayoutController());

    act(() => {
      window.innerWidth = 700;
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current.leftPanelVisible).toBe(false);
    expect(result.current.utilityPanelVisible).toBe(false);
  });
});
