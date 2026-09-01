import {
  createHarfBuzzTextRunLayoutRuntime,
  type HarfBuzzFontFaceDescriptor,
  type HarfBuzzTextRunLayoutRuntime,
} from "@opendesign/text-service/harfbuzz";
import { loadBrowserVectorGeometryProvider } from "@opendesign/geometry-service/browser-vector-path";
import {
  type TextRunLayoutProvider,
  type TextRunLayoutStyle,
} from "@opendesign/text-service";
import type { DesignDocument } from "@opendesign/design-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FontBinaryDescriptor } from "@/shared/desktop-api";
import { useSystemFontRuntime } from "./use-system-font-runtime";

export type FontBinaryImportState =
  | { status: "idle" }
  | { status: "importing" }
  | { count: number; status: "success" }
  | { message: string; status: "error" };

export type RendererTextRunStyle = TextRunLayoutStyle & { fill: unknown };
export type FontBinaryRuntime = ReturnType<typeof useFontBinaryRuntime>;

export function useFontBinaryRuntime(document: DesignDocument) {
  const runtime = useRef<Promise<
    HarfBuzzTextRunLayoutRuntime<RendererTextRunStyle>
  > | null>(null);
  const hydratedFontIds = useRef(new Set<string>());
  const loadedBrowserFaces = useRef(new Set<string>());
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<FontBinaryImportState>({ status: "idle" });
  const [provider, setProvider] = useState<
    TextRunLayoutProvider<RendererTextRunStyle> | undefined
  >();

  const requireRuntime = useCallback(() => {
    runtime.current ??=
      createHarfBuzzTextRunLayoutRuntime<RendererTextRunStyle>({
        decorationGeometryProvider: loadBrowserVectorGeometryProvider(),
      }).then((value) => {
        setProvider(() => value.provider);
        return value;
      });
    return runtime.current;
  }, []);

  const registerFont = useCallback(
    async (fontId: `font_${string}`, bytes: Uint8Array) => {
      const shaping = await requireRuntime();
      const existing = shaping
        .listFonts()
        .filter((face) => face.fontId === fontId);
      return existing.length > 0
        ? existing
        : shaping.registerFont(fontId, bytes);
    },
    [requireRuntime],
  );

  const systemFonts = useSystemFontRuntime(document, registerFont);

  const hydrate = useCallback(
    async (descriptors: readonly FontBinaryDescriptor[]) => {
      const desktop = window.desktop;
      if (!desktop) throw new Error("Desktop font service is unavailable");
      const faces: HarfBuzzFontFaceDescriptor[] = [];
      for (const descriptor of descriptors) {
        if (hydratedFontIds.current.has(descriptor.fontId)) continue;
        const payload = await desktop.readFontBinary({
          fontId: descriptor.fontId,
        });
        const registered = await registerFont(payload.fontId, payload.bytes);
        for (const face of registered) {
          await loadBrowserFace(
            payload.bytes,
            face,
            loadedBrowserFaces.current,
          );
          faces.push(face);
        }
        hydratedFontIds.current.add(descriptor.fontId);
      }
      if (faces.length > 0) setEpoch((value) => value + 1);
      return faces;
    },
    [registerFont],
  );

  const importFonts = useCallback(async () => {
    const desktop = window.desktop;
    if (!desktop) {
      setState({
        message: "Desktop font service is unavailable",
        status: "error",
      });
      return [];
    }
    setState({ status: "importing" });
    try {
      const selected = await desktop.selectFontBinaries();
      if (selected.length === 0) {
        setState({ status: "idle" });
        return [];
      }
      const faces = await hydrate(selected);
      setState({ count: faces.length, status: "success" });
      return faces;
    } catch (error) {
      setState({
        message: error instanceof Error ? error.message : "Font import failed",
        status: "error",
      });
      return [];
    }
  }, [hydrate]);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idleId: number | undefined;
    const restore = (descriptors: readonly FontBinaryDescriptor[]) => {
      if (!cancelled) void hydrate(descriptors).catch(() => undefined);
    };
    void desktop
      .listFontBinaries()
      .then((descriptors) => {
        if (cancelled || descriptors.length === 0) return;
        if (typeof window.requestIdleCallback === "function") {
          idleId = window.requestIdleCallback(() => restore(descriptors), {
            timeout: 2_000,
          });
        } else {
          timer = setTimeout(() => restore(descriptors), 250);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
    };
  }, [hydrate]);

  return {
    ensureDocumentFonts: systemFonts.ensureDocumentFonts,
    epoch: epoch + systemFonts.epoch,
    importFonts,
    provider,
    state,
    systemFontError: systemFonts.error,
  };
}

async function loadBrowserFace(
  bytes: Uint8Array,
  descriptor: HarfBuzzFontFaceDescriptor,
  loaded: Set<string>,
): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts?.add) return;
  const key = [
    descriptor.fontId,
    descriptor.faceIndex,
    descriptor.family,
    descriptor.styleName,
    descriptor.weight,
    descriptor.slant,
  ].join("\u0000");
  if (loaded.has(key)) return;
  const source = Uint8Array.from(bytes).buffer;
  const face = new FontFace(descriptor.family, source, {
    style: descriptor.slant,
    weight: String(descriptor.weight),
  });
  await face.load();
  document.fonts.add(face);
  loaded.add(key);
}
