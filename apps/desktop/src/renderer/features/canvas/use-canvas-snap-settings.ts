import type { LeaferSnapSettings } from "@opendesign/leafer-engine";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "opendesign.canvas.snap-settings";
const DEFAULT_SETTINGS: LeaferSnapSettings = {
  geometry: true,
  objects: true,
  pixelGrid: true,
};

export function useCanvasSnapSettings() {
  const [settings, setSettings] = useState<LeaferSnapSettings>(readSettings);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // The editor preference remains available for this session when storage
      // is disabled by the host.
    }
  }, [settings]);

  const toggleObjects = useCallback(() => {
    setSettings((current) => ({ ...current, objects: !current.objects }));
  }, []);
  const toggleGeometry = useCallback(() => {
    setSettings((current) => ({ ...current, geometry: !current.geometry }));
  }, []);
  const togglePixelGrid = useCallback(() => {
    setSettings((current) => ({
      ...current,
      pixelGrid: !current.pixelGrid,
    }));
  }, []);

  return { settings, toggleGeometry, toggleObjects, togglePixelGrid };
}

function readSettings(): LeaferSnapSettings {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<LeaferSnapSettings> | null;
    return {
      geometry:
        typeof value?.geometry === "boolean"
          ? value.geometry
          : DEFAULT_SETTINGS.geometry,
      objects:
        typeof value?.objects === "boolean"
          ? value.objects
          : DEFAULT_SETTINGS.objects,
      pixelGrid:
        typeof value?.pixelGrid === "boolean"
          ? value.pixelGrid
          : DEFAULT_SETTINGS.pixelGrid,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
