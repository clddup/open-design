import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/renderer/i18n";
import type {
  GlobalImageGenerationSettings,
  SaveGlobalImageGenerationSettingsRequest,
} from "@/shared/desktop-api";

type ImageGenerationDraft = Pick<
  GlobalImageGenerationSettings,
  "enabled" | "apiFormat" | "authMode" | "baseUrl" | "modelId"
>;

export function useGlobalImageGenerationSettings() {
  const { t } = useI18n();
  const translateRef = useRef(t);
  const [draft, setDraft] = useState<ImageGenerationDraft | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<
    { tone: "success" | "error"; message: string } | undefined
  >();

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    let active = true;
    const desktop = window.desktop;
    if (
      !desktop ||
      typeof desktop.getGlobalImageGenerationSettings !== "function"
    ) {
      setStatus({
        tone: "error",
        message: translateRef.current("settings.serviceUnavailable"),
      });
      setLoading(false);
      return;
    }
    void desktop
      .getGlobalImageGenerationSettings()
      .then((settings) => {
        if (!active) return;
        setDraft(imageGenerationDraft(settings));
        setHasApiKey(settings.hasApiKey);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : translateRef.current("settings.imageGenerationLoadFailed"),
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateDraft = (
    update: (current: ImageGenerationDraft) => ImageGenerationDraft,
  ) => setDraft((current) => (current ? update(current) : current));

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const desktop = window.desktop;
    if (!draft || saving) return;
    if (
      !desktop ||
      typeof desktop.saveGlobalImageGenerationSettings !== "function"
    ) {
      setStatus({ tone: "error", message: t("settings.serviceUnavailable") });
      return;
    }
    setSaving(true);
    setStatus(undefined);
    try {
      const request: SaveGlobalImageGenerationSettingsRequest = {
        ...draft,
        baseUrl: draft.baseUrl.trim(),
        modelId: draft.modelId.trim(),
        ...(apiKey ? { apiKey } : {}),
        ...(clearApiKey ? { clearApiKey: true } : {}),
      };
      const saved = await desktop.saveGlobalImageGenerationSettings(request);
      setDraft(imageGenerationDraft(saved));
      setHasApiKey(saved.hasApiKey);
      setApiKey("");
      setClearApiKey(false);
      setStatus({
        tone: "success",
        message: t("settings.imageGenerationSaved"),
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : t("settings.imageGenerationSaveFailed"),
      });
    } finally {
      setSaving(false);
    }
  };

  const valid =
    draft !== null &&
    draft.baseUrl.trim().length > 0 &&
    (!draft.enabled || draft.modelId.trim().length > 0);

  return {
    apiKey,
    clearApiKey,
    draft,
    hasApiKey,
    loading,
    save,
    saving,
    setApiKey,
    setClearApiKey,
    status,
    updateDraft,
    valid,
  } as const;
}

function imageGenerationDraft(
  settings: GlobalImageGenerationSettings,
): ImageGenerationDraft {
  return {
    enabled: settings.enabled,
    apiFormat: settings.apiFormat,
    authMode: settings.authMode,
    baseUrl: settings.baseUrl,
    modelId: settings.modelId,
  };
}
