import type { DesignDocument } from "@opendesign/design-contracts";
import type { HarfBuzzFontFaceDescriptor } from "@opendesign/text-service/harfbuzz";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  collectDocumentFontFamilies,
  createLocalFontAccessRuntime,
  localFontQueryFromWindow,
  type LocalFontAccessRuntime,
} from "@/renderer/services/text/local-font-access";

type RegisterFont = (
  fontId: `font_${string}`,
  bytes: Uint8Array,
) => Promise<readonly HarfBuzzFontFaceDescriptor[]>;

export function useSystemFontRuntime(
  document: DesignDocument,
  registerFont: RegisterFont,
) {
  const access = useRef<LocalFontAccessRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

  const requireAccess = useCallback(() => {
    const query = localFontQueryFromWindow(window);
    if (!query) return null;
    access.current ??= createLocalFontAccessRuntime({ query, registerFont });
    return access.current;
  }, [registerFont]);

  const ensureDocumentFonts = useCallback(
    async (target: DesignDocument, signal?: AbortSignal) => {
      const runtime = requireAccess();
      if (!runtime) return;
      try {
        const result = await runtime.hydrateFamilies(
          collectDocumentFontFamilies(target),
          signal,
        );
        if (result.loadedFaceCount > 0) setEpoch((value) => value + 1);
        setError(formatFailures(result.failures));
      } catch (cause) {
        if (signal?.aborted) throw cause;
        setError(
          cause instanceof Error ? cause.message : "Local font access failed",
        );
      }
    },
    [requireAccess],
  );

  useEffect(() => {
    void ensureDocumentFonts(document);
  }, [document, ensureDocumentFonts]);

  return { ensureDocumentFonts, epoch, error };
}

function formatFailures(
  failures: readonly { font: string; message: string }[],
): string | null {
  if (failures.length === 0) return null;
  const summary = failures
    .slice(0, 3)
    .map(
      (failure) =>
        `${failure.font.slice(0, 120)}: ${failure.message.slice(0, 240)}`,
    )
    .join("; ");
  const remaining = failures.length - 3;
  return remaining > 0 ? `${summary}; +${remaining} more` : summary;
}
