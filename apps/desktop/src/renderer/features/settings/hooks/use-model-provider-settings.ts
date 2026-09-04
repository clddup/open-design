import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/renderer/i18n";
import type {
  ModelProfile,
  ModelProviderCatalog,
  ModelProviderProfile,
  ProviderConnectionResult,
  SaveModelProviderProfileRequest,
} from "@/shared/desktop-api";
import {
  newProviderDraft,
  profileDraft,
  selectionForModel,
  validProviderDraft,
  visualCriticModelOptions,
  type ProviderDraft,
} from "../model/model-provider-profile";

export function useModelProviderSettings() {
  const { t } = useI18n();
  const translateRef = useRef(t);
  const addProviderButtonRef = useRef<HTMLButtonElement>(null);
  const providerNameInputRef = useRef<HTMLInputElement>(null);
  const previousProviderIdRef = useRef<string | null>(null);
  const [catalog, setCatalog] = useState<ModelProviderCatalog | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingVisualCritic, setSavingVisualCritic] = useState(false);
  const [status, setStatus] = useState<
    { tone: "success" | "error"; message: string } | undefined
  >();

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    let active = true;
    const desktop = window.desktop;
    if (!desktop || typeof desktop.getModelProviderCatalog !== "function") {
      setStatus({
        tone: "error",
        message: translateRef.current("settings.serviceUnavailable"),
      });
      setLoading(false);
      return;
    }
    void desktop
      .getModelProviderCatalog()
      .then((value) => {
        if (!active) return;
        setCatalog(value);
        const first = value.providers[0];
        if (first) loadProvider(first);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : translateRef.current("settings.loadFailed"),
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []); // Preserve unsaved drafts across locale changes.

  const loadProvider = (profile: ModelProviderProfile) => {
    previousProviderIdRef.current = null;
    setSelectedProviderId(profile.providerId);
    setDraft(profileDraft(profile));
    setHasApiKey(profile.hasApiKey);
    setApiKey("");
    setClearApiKey(false);
    setSetAsDefault(false);
    setDirty(false);
    setConfirmDelete(false);
    setStatus(undefined);
  };

  const updateDraft = (update: (current: ProviderDraft) => ProviderDraft) => {
    setDraft((current) => (current ? update(current) : current));
    setDirty(true);
    setConfirmDelete(false);
  };

  const providerExists = (providerId: string | null) =>
    providerId !== null &&
    Boolean(
      catalog?.providers.some((provider) => provider.providerId === providerId),
    );
  const creatingProvider = draft !== null && !providerExists(draft.providerId);

  const addProvider = () => {
    if (creatingProvider) {
      providerNameInputRef.current?.focus();
      return;
    }
    const next = newProviderDraft();
    previousProviderIdRef.current = selectedProviderId;
    setSelectedProviderId(next.providerId);
    setDraft(next);
    setHasApiKey(false);
    setApiKey("");
    setClearApiKey(false);
    setSetAsDefault(true);
    setDirty(true);
    setConfirmDelete(false);
    setStatus(undefined);
    requestAnimationFrame(() => providerNameInputRef.current?.focus());
  };

  const save = async (testAfterSave: boolean) => {
    const desktop = window.desktop;
    if (!draft || saving || testing) return;
    if (!desktop || typeof desktop.saveModelProviderProfile !== "function") {
      setStatus({ tone: "error", message: t("settings.serviceUnavailable") });
      return;
    }
    setStatus(undefined);
    setSaving(true);
    try {
      const request: SaveModelProviderProfileRequest = {
        ...draft,
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        models: draft.models.map((model) => ({
          ...model,
          modelId: model.modelId.trim(),
          name: model.name.trim() || model.modelId.trim(),
        })),
        ...(apiKey ? { apiKey } : {}),
        ...(clearApiKey ? { clearApiKey: true } : {}),
        ...(setAsDefault ? { setAsDefault: true } : {}),
      };
      const saved = await desktop.saveModelProviderProfile(request);
      setCatalog(saved);
      const savedProfile = saved.providers.find(
        (provider) => provider.providerId === request.providerId,
      );
      if (savedProfile) loadProvider(savedProfile);
      setApiKey("");
      setClearApiKey(false);
      setDirty(false);
      setStatus({ tone: "success", message: t("settings.saved") });
      if (testAfterSave) {
        const model = savedProfile?.models.find(
          (candidate) => candidate.capabilities.toolUse,
        );
        if (model && savedProfile) {
          await testConnection(savedProfile, model);
        }
      }
    } catch (error) {
      setStatus({
        tone: "error",
        message:
          error instanceof Error ? error.message : t("settings.saveFailed"),
      });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (
    provider: ModelProviderProfile,
    model: ModelProfile,
  ) => {
    const desktop = window.desktop;
    if (!desktop || typeof desktop.testModelProviderConnection !== "function") {
      setStatus({ tone: "error", message: t("settings.serviceUnavailable") });
      return;
    }
    setTesting(true);
    try {
      const result: ProviderConnectionResult =
        await desktop.testModelProviderConnection(
          selectionForModel(provider, model),
        );
      setStatus({
        tone: result.ok ? "success" : "error",
        message:
          result.status === "compatible"
            ? t("settings.connected", {
                model: `${provider.name}/${result.modelId}`,
                latency: result.latencyMs,
              })
            : result.status === "text-only"
              ? t("settings.textOnly", { message: result.message })
              : t("settings.connectionFailed", { message: result.message }),
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: t("settings.connectionFailed", {
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      });
    } finally {
      setTesting(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(false);
  };
  const saveVisualCriticSelection = async (value: string) => {
    const desktop = window.desktop;
    if (
      !catalog ||
      !desktop ||
      typeof desktop.saveVisualCriticSelection !== "function"
    ) {
      setStatus({ tone: "error", message: t("settings.serviceUnavailable") });
      return;
    }
    const selected = visualCriticModelOptions(catalog).find(
      (option) => option.value === value,
    );
    setSavingVisualCritic(true);
    setStatus(undefined);
    try {
      const saved = await desktop.saveVisualCriticSelection({
        selection: selected?.selection ?? null,
      });
      setCatalog(saved);
      setStatus({ tone: "success", message: t("settings.visualCriticSaved") });
    } catch (error) {
      setStatus({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : t("settings.visualCriticSaveFailed"),
      });
    } finally {
      setSavingVisualCritic(false);
    }
  };
  const busy = loading || saving || testing || savingVisualCritic;
  const valid = draft !== null && validProviderDraft(draft);

  const cancelDraft = () => {
    if (!draft || busy) return;
    const fallbackId = creatingProvider
      ? previousProviderIdRef.current
      : selectedProviderId;
    const fallback = catalog?.providers.find(
      (provider) => provider.providerId === fallbackId,
    );
    const next = fallback ?? catalog?.providers[0];
    if (next) loadProvider(next);
    else {
      setSelectedProviderId(null);
      setDraft(null);
      setHasApiKey(false);
      setApiKey("");
      setClearApiKey(false);
      setSetAsDefault(false);
      setDirty(false);
      setConfirmDelete(false);
      setStatus(undefined);
    }
    previousProviderIdRef.current = null;
    requestAnimationFrame(() => addProviderButtonRef.current?.focus());
  };

  const deleteProvider = async () => {
    const desktop = window.desktop;
    if (!selectedProviderId || busy) return;
    if (!desktop || typeof desktop.deleteModelProviderProfile !== "function") {
      setStatus({ tone: "error", message: t("settings.serviceUnavailable") });
      return;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      const nextCatalog = await desktop.deleteModelProviderProfile({
        providerId: selectedProviderId,
      });
      setCatalog(nextCatalog);
      const next = nextCatalog.providers[0];
      if (next) loadProvider(next);
      else {
        setSelectedProviderId(null);
        setDraft(null);
        setHasApiKey(false);
        setDirty(false);
      }
      setStatus({ tone: "success", message: t("settings.providerDeleted") });
    } catch (error) {
      setStatus({
        tone: "error",
        message:
          error instanceof Error ? error.message : t("settings.saveFailed"),
      });
    }
  };

  return {
    addProvider,
    addProviderButtonRef,
    apiKey,
    busy,
    cancelDraft,
    catalog,
    clearApiKey,
    confirmDelete,
    creatingProvider,
    deleteProvider,
    dirty,
    draft,
    hasApiKey,
    loadProvider,
    loading,
    providerNameInputRef,
    save,
    saveVisualCriticSelection,
    savingVisualCritic,
    saving,
    selectedProviderId,
    setApiKey,
    setAsDefault,
    setClearApiKey,
    setConfirmDelete,
    setDirty,
    setSetAsDefault,
    status,
    submit,
    testing,
    updateDraft,
    valid,
  } as const;
}
