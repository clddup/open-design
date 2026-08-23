import { useCallback, useEffect, useState } from "react";
import type { UtilityDockTab } from "../editor-workbench/components/UtilityDock";
import type { SidebarTab } from "../../state/editor";

const NAVIGATOR_AUTO_COLLAPSE_WIDTH = 960;
const UTILITY_AUTO_COLLAPSE_WIDTH = 760;
const PANEL_STORAGE_PREFIX = "opendesign.workbench.panel";

export function useWorkbenchLayoutController() {
  const [leftWidth, setLeftWidth] = useState(() =>
    readPanelWidth("navigator", 236, 184, 360),
  );
  const [utilityWidth, setUtilityWidth] = useState(() =>
    readPanelWidth("utility", 320, 280, 400),
  );
  const [leftPanelVisible, setLeftPanelVisible] = useState(() =>
    readPanelVisibility("navigator"),
  );
  const [utilityPanelVisible, setUtilityPanelVisible] = useState(() =>
    readPanelVisibility("utility"),
  );
  const [utilityTab, setUtilityTab] = useState<UtilityDockTab>("agent");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("layers");

  const toggleLeftPanel = useCallback(() => {
    setLeftPanelVisible((current) => {
      const next = !current;
      persistPanelVisibility("navigator", next);
      return next;
    });
  }, []);

  const toggleUtilityPanel = useCallback(() => {
    setUtilityPanelVisible((current) => {
      const next = !current;
      persistPanelVisibility("utility", next);
      return next;
    });
  }, []);

  const showUtilityTab = useCallback((tab: UtilityDockTab) => {
    setUtilityTab(tab);
    setUtilityPanelVisible(true);
    persistPanelVisibility("utility", true);
  }, []);

  const resizeLeftPanel = useCallback((width: number) => {
    setLeftWidth(width);
    persistPanelWidth("navigator", width);
  }, []);

  const resizeUtilityPanel = useCallback((width: number) => {
    setUtilityWidth(width);
    persistPanelWidth("utility", width);
  }, []);

  useEffect(() => {
    let previousWidth = Number.POSITIVE_INFINITY;
    const prioritizeCanvas = () => {
      const width = window.innerWidth;
      if (
        previousWidth > NAVIGATOR_AUTO_COLLAPSE_WIDTH &&
        width <= NAVIGATOR_AUTO_COLLAPSE_WIDTH
      ) {
        setLeftPanelVisible(false);
      }
      if (
        previousWidth > UTILITY_AUTO_COLLAPSE_WIDTH &&
        width <= UTILITY_AUTO_COLLAPSE_WIDTH
      ) {
        setUtilityPanelVisible(false);
      }
      previousWidth = width;
    };
    prioritizeCanvas();
    window.addEventListener("resize", prioritizeCanvas);
    return () => window.removeEventListener("resize", prioritizeCanvas);
  }, []);

  return {
    leftPanelVisible,
    leftWidth,
    resizeLeftPanel,
    resizeUtilityPanel,
    setSidebarTab,
    setUtilityTab,
    showUtilityTab,
    sidebarTab,
    toggleLeftPanel,
    toggleUtilityPanel,
    utilityPanelVisible,
    utilityTab,
    utilityWidth,
  };
}

function readPanelVisibility(panel: "navigator" | "utility"): boolean {
  try {
    return (
      window.localStorage.getItem(`${PANEL_STORAGE_PREFIX}.${panel}`) !==
      "hidden"
    );
  } catch {
    return true;
  }
}

function persistPanelVisibility(
  panel: "navigator" | "utility",
  visible: boolean,
) {
  try {
    window.localStorage.setItem(
      `${PANEL_STORAGE_PREFIX}.${panel}`,
      visible ? "visible" : "hidden",
    );
  } catch {
    // Session persistence is best-effort and never blocks the editor shell.
  }
}

function readPanelWidth(
  panel: "navigator" | "utility",
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const stored = window.localStorage.getItem(
      `${PANEL_STORAGE_PREFIX}.${panel}.width`,
    );
    if (stored === null) return fallback;
    const value = Number(stored);
    return Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  } catch {
    return fallback;
  }
}

function persistPanelWidth(panel: "navigator" | "utility", width: number) {
  try {
    window.localStorage.setItem(
      `${PANEL_STORAGE_PREFIX}.${panel}.width`,
      String(Math.round(width)),
    );
  } catch {
    // Panel sizing remains usable when persistence is unavailable.
  }
}
