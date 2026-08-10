import { Button, Glyph, IconButton } from "@opendesign/ui";
import {
  Component,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ModelApiFormat, ModelAuthMode } from "@opendesign/model-gateway";
import type {
  ImageGenerationSelection,
  ImageGenerationApiFormat,
  ModelProfile,
  ModelProviderCatalog,
  ModelProviderProfile,
  ProviderConnectionResult,
  SaveModelProviderProfileRequest,
  ThemePreference,
} from "../../shared/desktop-api";
import type { AppLocale } from "../../shared/i18n/locale";
import { useI18n } from "../i18n";

type SettingsTab = "general" | "models";

type SettingsPageProps = {
  onClose: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  theme: ThemePreference;
};

const settingsTabs: readonly SettingsTab[] = ["general", "models"];

export function SettingsPage(props: SettingsPageProps) {
  const { t } = useI18n();
  return (
    <SettingsErrorBoundary
      closeLabel={t("settings.close")}
      description={t("settings.renderFailedDescription")}
      onClose={props.onClose}
      retryLabel={t("settings.retry")}
      title={t("settings.renderFailedTitle")}
    >
      <SettingsPageContent {...props} />
    </SettingsErrorBoundary>
  );
}

function SettingsPageContent({
  onClose,
  onThemeChange,
  theme,
}: SettingsPageProps) {
  const { locale, setLocale, t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const tabRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());

  const activateTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    tabRefs.current.get(tab)?.focus();
  };
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: SettingsTab,
  ) => {
    const index = settingsTabs.indexOf(tab);
    let next: SettingsTab | undefined;
    if (event.key === "ArrowUp") {
      next =
        settingsTabs[(index - 1 + settingsTabs.length) % settingsTabs.length];
    } else if (event.key === "ArrowDown") {
      next = settingsTabs[(index + 1) % settingsTabs.length];
    } else if (event.key === "Home") {
      next = settingsTabs[0];
    } else if (event.key === "End") {
      next = settingsTabs[settingsTabs.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    activateTab(next);
  };

  return (
    <div className="settings-shell">
      <header className="home-titlebar settings-titlebar">
        <div aria-hidden="true" className="titlebar__native-safe-zone" />
        <div className="home-titlebar__brand">
          <span className="brand-mark">
            <Glyph name="settings" size={15} />
          </span>
          <strong>{t("settings.title")}</strong>
        </div>
        <div className="home-titlebar__actions no-drag">
          <IconButton
            icon="close"
            label={t("settings.close")}
            onClick={onClose}
          />
        </div>
      </header>
      <main className="settings-workbench">
        <aside aria-label={t("settings.title")} className="settings-navigation">
          <div aria-orientation="vertical" role="tablist">
            {settingsTabs.map((tab) => (
              <button
                aria-controls={`settings-${tab}-panel`}
                aria-selected={activeTab === tab}
                className="settings-navigation__item"
                id={`settings-${tab}-tab`}
                key={tab}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tab)}
                ref={(element) => {
                  if (element) tabRefs.current.set(tab, element);
                  else tabRefs.current.delete(tab);
                }}
                role="tab"
                tabIndex={activeTab === tab ? 0 : -1}
                type="button"
              >
                <Glyph name={tab === "general" ? "settings" : "agent"} />
                {t(tab === "general" ? "settings.general" : "settings.models")}
              </button>
            ))}
          </div>
        </aside>
        <section className="settings-content">
          <div
            aria-labelledby="settings-general-tab"
            hidden={activeTab !== "general"}
            id="settings-general-panel"
            role="tabpanel"
          >
            <SettingsHeading
              description={t("settings.generalDescription")}
              title={t("settings.generalTitle")}
            />
            <SettingsRow
              description={t("settings.languageDescription")}
              label={t("settings.language")}
            >
              <SegmentedControl<AppLocale>
                label={t("settings.language")}
                onChange={(value) => void setLocale(value)}
                options={[
                  { value: "zh-CN", label: t("settings.chinese") },
                  { value: "en", label: t("settings.english") },
                ]}
                value={locale}
              />
            </SettingsRow>
            <SettingsRow label={t("settings.appearance")}>
              <SegmentedControl<ThemePreference>
                label={t("settings.appearance")}
                onChange={onThemeChange}
                options={[
                  { value: "light", label: t("settings.light") },
                  { value: "dark", label: t("settings.dark") },
                  { value: "system", label: t("settings.system") },
                ]}
                value={theme}
              />
            </SettingsRow>
          </div>
          <div
            aria-labelledby="settings-models-tab"
            hidden={activeTab !== "models"}
            id="settings-models-panel"
            role="tabpanel"
          >
            <ModelProviderForm />
          </div>
        </section>
      </main>
    </div>
  );
}

class SettingsErrorBoundary extends Component<
  {
    children: ReactNode;
    closeLabel: string;
    description: string;
    onClose: () => void;
    retryLabel: string;
    title: string;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="settings-shell">
        <header className="home-titlebar settings-titlebar">
          <div aria-hidden="true" className="titlebar__native-safe-zone" />
          <div className="home-titlebar__brand">
            <span className="brand-mark">
              <Glyph name="settings" size={15} />
            </span>
            <strong>{this.props.title}</strong>
          </div>
          <div className="home-titlebar__actions no-drag">
            <IconButton
              icon="close"
              label={this.props.closeLabel}
              onClick={this.props.onClose}
            />
          </div>
        </header>
        <main className="settings-recovery" role="alert">
          <Glyph name="settings" size={22} />
          <h1>{this.props.title}</h1>
          <p>{this.props.description}</p>
          <div>
            <Button
              onClick={() => this.setState({ failed: false })}
              tone="primary"
            >
              {this.props.retryLabel}
            </Button>
            <Button onClick={this.props.onClose} tone="quiet">
              {this.props.closeLabel}
            </Button>
          </div>
        </main>
      </div>
    );
  }
}

function SettingsHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="settings-heading">
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function SettingsRow({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) {
  return (
    <section className="settings-row">
      <div>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </div>
      {children}
    </section>
  );
}

function SegmentedControl<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: ReadonlyArray<{ value: Value; label: string }>;
  value: Value;
}) {
  return (
    <div aria-label={label} className="settings-segmented" role="group">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ModelProviderForm() {
  const { t } = useI18n();
  const translateRef = useRef(t);
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
  const [defaultImageGenerationSelection, setDefaultImageGenerationSelection] =
    useState<ImageGenerationSelection | null>(null);
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
        setDefaultImageGenerationSelection(
          value.defaultImageGenerationSelection ?? null,
        );
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

  const addProvider = () => {
    const next = newProviderDraft();
    setSelectedProviderId(next.providerId);
    setDraft(next);
    setHasApiKey(false);
    setApiKey("");
    setClearApiKey(false);
    setSetAsDefault(true);
    setDirty(true);
    setConfirmDelete(false);
    setStatus(undefined);
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
      let saved = await desktop.saveModelProviderProfile(request);
      const desiredImageGenerationSelection = imageGenerationSelectionAfterSave(
        defaultImageGenerationSelection,
        request,
      );
      if (
        !sameImageGenerationSelection(
          saved.defaultImageGenerationSelection ?? null,
          desiredImageGenerationSelection,
        )
      ) {
        if (typeof desktop.setDefaultImageGenerationSelection !== "function") {
          throw new Error(t("settings.serviceUnavailable"));
        }
        saved = await desktop.setDefaultImageGenerationSelection({
          selection: desiredImageGenerationSelection,
        });
      }
      setCatalog(saved);
      setDefaultImageGenerationSelection(
        saved.defaultImageGenerationSelection ?? null,
      );
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
        message: result.ok
          ? t("settings.connected", {
              model: `${provider.name}/${result.modelId}`,
              latency: result.latencyMs,
            })
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
  const busy = loading || saving || testing;
  const valid = draft !== null && validProviderDraft(draft);

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
      setDefaultImageGenerationSelection(
        nextCatalog.defaultImageGenerationSelection ?? null,
      );
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

  return (
    <form className="settings-provider" onSubmit={submit}>
      <SettingsHeading
        description={t("settings.modelsDescription")}
        title={t("settings.modelsTitle")}
      />
      {status && (
        <p className={`settings-feedback is-${status.tone}`} role="status">
          {status.message}
        </p>
      )}
      <div className="settings-provider__workspace">
        <aside className="settings-provider__list">
          <div className="settings-provider__list-heading">
            <strong>{t("settings.providers")}</strong>
            <button onClick={addProvider} type="button">
              <Glyph name="plus" size={14} />
              {t("settings.addProvider")}
            </button>
          </div>
          {loading ? (
            <p className="settings-provider__empty">
              {t("settings.loadingProviders")}
            </p>
          ) : catalog?.providers.length ? (
            catalog.providers.map((provider) => (
              <button
                aria-pressed={selectedProviderId === provider.providerId}
                className="settings-provider__list-item"
                key={provider.providerId}
                onClick={() => {
                  if (!dirty || selectedProviderId === provider.providerId) {
                    loadProvider(provider);
                  }
                }}
                type="button"
              >
                <span className={provider.enabled ? "is-enabled" : undefined} />
                <span>
                  <strong>{provider.name}</strong>
                  <small>
                    {apiFormatLabel(provider.apiFormat, t)} ·{" "}
                    {provider.models.length}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="settings-provider__empty">
              {t("settings.noProviders")}
            </p>
          )}
        </aside>
        <section className="settings-provider__detail">
          {loading ? (
            <div className="settings-provider__empty-detail">
              <strong>{t("settings.loadingProviders")}</strong>
            </div>
          ) : draft ? (
            <>
              <div className="settings-provider__detail-heading">
                <label className="settings-field is-inline">
                  <span>{t("settings.providerName")}</span>
                  <input
                    aria-label={t("settings.providerName")}
                    disabled={busy}
                    maxLength={256}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    value={draft.name}
                  />
                </label>
                <label className="settings-checkbox">
                  <input
                    checked={draft.enabled}
                    disabled={busy}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        enabled: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{t("settings.enabled")}</span>
                </label>
              </div>
              <div className="settings-provider__grid">
                <label className="settings-field is-wide">
                  <span>{t("settings.baseUrl")}</span>
                  <input
                    aria-label={t("settings.baseUrl")}
                    autoComplete="url"
                    disabled={busy}
                    maxLength={2_048}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                    type="url"
                    value={draft.baseUrl}
                  />
                  <small>{t("settings.baseUrlHint")}</small>
                </label>
                <label className="settings-field">
                  <span>{t("settings.apiFormat")}</span>
                  <select
                    aria-label={t("settings.apiFormat")}
                    disabled={busy}
                    onChange={(event) => {
                      const apiFormat = event.target.value as ModelApiFormat;
                      updateDraft((current) => ({
                        ...current,
                        apiFormat,
                        authMode:
                          apiFormat === "anthropic-messages"
                            ? "x-api-key"
                            : "bearer",
                      }));
                    }}
                    value={draft.apiFormat}
                  >
                    <option value="openai-responses">
                      {t("settings.apiOpenAIResponses")}
                    </option>
                    <option value="openai-chat-completions">
                      {t("settings.apiOpenAIChat")}
                    </option>
                    <option value="anthropic-messages">
                      {t("settings.apiAnthropicMessages")}
                    </option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{t("settings.imageGenerationApi")}</span>
                  <select
                    aria-label={t("settings.imageGenerationApi")}
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value;
                      updateDraft((current) => {
                        const rest: ProviderDraft = { ...current };
                        delete rest.imageGenerationApiFormat;
                        return value
                          ? {
                              ...rest,
                              imageGenerationApiFormat:
                                value as ImageGenerationApiFormat,
                            }
                          : rest;
                      });
                    }}
                    value={draft.imageGenerationApiFormat ?? ""}
                  >
                    <option value="">{t("settings.notConfigured")}</option>
                    <option value="openai-images">
                      {t("settings.apiOpenAIImages")}
                    </option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{t("settings.authMode")}</span>
                  <select
                    aria-label={t("settings.authMode")}
                    disabled={busy}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        authMode: event.target.value as ModelAuthMode,
                      }))
                    }
                    value={draft.authMode}
                  >
                    <option value="bearer">{t("settings.authBearer")}</option>
                    <option value="x-api-key">
                      {t("settings.authApiKey")}
                    </option>
                    <option value="none">{t("settings.authNone")}</option>
                  </select>
                </label>
                <label className="settings-field is-wide">
                  <span>{t("settings.apiKey")}</span>
                  <input
                    aria-label={t("settings.apiKey")}
                    autoComplete="off"
                    disabled={busy || clearApiKey || draft.authMode === "none"}
                    maxLength={8_192}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={t("settings.apiKeyPlaceholder")}
                    type="password"
                    value={apiKey}
                  />
                  <small>
                    {hasApiKey
                      ? t("settings.apiKeyConfigured")
                      : t("settings.apiKeyOptional")}
                  </small>
                </label>
              </div>
              {hasApiKey && draft.authMode !== "none" && (
                <label className="settings-checkbox">
                  <input
                    checked={clearApiKey}
                    disabled={busy}
                    onChange={(event) => {
                      setClearApiKey(event.target.checked);
                      if (event.target.checked) setApiKey("");
                    }}
                    type="checkbox"
                  />
                  <span>{t("settings.clearApiKey")}</span>
                </label>
              )}
              <ModelListEditor
                busy={busy}
                defaultImageGenerationSelection={
                  defaultImageGenerationSelection
                }
                imageGenerationAdapterConfigured={
                  draft.imageGenerationApiFormat !== undefined
                }
                models={draft.models}
                onChange={(models) =>
                  updateDraft((current) => ({ ...current, models }))
                }
                onDefaultImageGenerationSelectionChange={(selection) => {
                  setDefaultImageGenerationSelection(selection);
                  setDirty(true);
                }}
                providerId={draft.providerId}
              />
              <p className="settings-security-note">
                <Glyph name="lock" size={14} />
                {t("settings.credentialBoundary")}
              </p>
              <footer className="settings-provider__actions">
                <label className="settings-checkbox">
                  <input
                    checked={setAsDefault}
                    disabled={busy}
                    onChange={(event) => setSetAsDefault(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{t("settings.useAsDefault")}</span>
                </label>
                <span />
                <Button
                  disabled={
                    !catalog?.providers.some(
                      (provider) => provider.providerId === draft.providerId,
                    ) || busy
                  }
                  onClick={() => void deleteProvider()}
                  tone="quiet"
                  type="button"
                >
                  {confirmDelete
                    ? t("settings.confirmDelete")
                    : t("settings.deleteProvider")}
                </Button>
                <Button disabled={busy || !valid} tone="primary" type="submit">
                  {saving ? t("settings.saving") : t("settings.save")}
                </Button>
                <Button
                  disabled={busy || !valid}
                  onClick={() => void save(true)}
                  type="button"
                >
                  {testing ? t("settings.testing") : t("settings.saveAndTest")}
                </Button>
              </footer>
            </>
          ) : (
            <div className="settings-provider__empty-detail">
              <strong>{t("settings.noProviders")}</strong>
              <Button onClick={addProvider} type="button">
                {t("settings.addProvider")}
              </Button>
            </div>
          )}
        </section>
      </div>
    </form>
  );
}

type ProviderDraft = Omit<ModelProviderProfile, "hasApiKey" | "updatedAt">;

function ModelListEditor({
  busy,
  defaultImageGenerationSelection,
  imageGenerationAdapterConfigured,
  models,
  onChange,
  onDefaultImageGenerationSelectionChange,
  providerId,
}: {
  busy: boolean;
  defaultImageGenerationSelection: ImageGenerationSelection | null;
  imageGenerationAdapterConfigured: boolean;
  models: ModelProfile[];
  onChange: (models: ModelProfile[]) => void;
  onDefaultImageGenerationSelectionChange: (
    selection: ImageGenerationSelection | null,
  ) => void;
  providerId: string;
}) {
  const { t } = useI18n();
  const update = (index: number, model: ModelProfile) =>
    onChange(
      models.map((current, modelIndex) =>
        modelIndex === index ? model : current,
      ),
    );
  return (
    <section className="settings-models-list">
      <header>
        <span>
          <strong>{t("settings.modelList")}</strong>
          <small>{t("settings.modelListDescription")}</small>
        </span>
        <button
          disabled={busy}
          onClick={() => onChange([...models, newModelProfile()])}
          type="button"
        >
          <Glyph name="plus" size={14} />
          {t("settings.addModel")}
        </button>
      </header>
      {models.map((model, index) => (
        <div className="settings-model-row" key={index}>
          <label className="settings-field">
            <span>{t("settings.modelId")}</span>
            <input
              aria-label={`${t("settings.modelId")} ${index + 1}`}
              disabled={busy}
              maxLength={256}
              onChange={(event) => {
                const modelId = event.target.value;
                update(index, { ...model, modelId });
                if (
                  defaultImageGenerationSelection?.providerId === providerId &&
                  defaultImageGenerationSelection.modelId === model.modelId
                ) {
                  onDefaultImageGenerationSelectionChange(
                    modelId ? { providerId, modelId } : null,
                  );
                }
              }}
              placeholder={t("settings.modelPlaceholder")}
              value={model.modelId}
            />
          </label>
          <label className="settings-field">
            <span>{t("settings.modelName")}</span>
            <input
              aria-label={`${t("settings.modelName")} ${index + 1}`}
              disabled={busy}
              maxLength={256}
              onChange={(event) =>
                update(index, { ...model, name: event.target.value })
              }
              value={model.name}
            />
          </label>
          <label className="settings-field is-number">
            <span>{t("settings.contextWindow")}</span>
            <input
              aria-label={`${t("settings.contextWindow")} ${index + 1}`}
              disabled={busy}
              max={10_000_000}
              min={1_024}
              onChange={(event) =>
                update(index, {
                  ...model,
                  contextWindow: Number(event.target.value),
                })
              }
              type="number"
              value={model.contextWindow}
            />
          </label>
          <label className="settings-field is-number">
            <span>{t("settings.maxOutput")}</span>
            <input
              aria-label={`${t("settings.maxOutput")} ${index + 1}`}
              disabled={busy}
              max={2_000_000}
              min={1}
              onChange={(event) =>
                update(index, {
                  ...model,
                  maxOutputTokens: Number(event.target.value),
                })
              }
              type="number"
              value={model.maxOutputTokens}
            />
          </label>
          <div className="settings-model-row__capabilities">
            <label className="settings-checkbox">
              <input
                checked={model.capabilities.toolUse}
                disabled={busy}
                onChange={(event) =>
                  update(index, {
                    ...model,
                    capabilities: {
                      ...model.capabilities,
                      toolUse: event.target.checked,
                    },
                  })
                }
                type="checkbox"
              />
              <span>{t("settings.toolUse")}</span>
            </label>
            <label className="settings-checkbox">
              <input
                checked={model.capabilities.imageInput}
                disabled={busy}
                onChange={(event) =>
                  update(index, {
                    ...model,
                    capabilities: {
                      ...model.capabilities,
                      imageInput: event.target.checked,
                    },
                  })
                }
                type="checkbox"
              />
              <span>{t("settings.imageInput")}</span>
            </label>
            <label className="settings-checkbox">
              <input
                checked={
                  defaultImageGenerationSelection?.providerId === providerId &&
                  defaultImageGenerationSelection.modelId === model.modelId
                }
                disabled={
                  busy ||
                  !imageGenerationAdapterConfigured ||
                  !model.modelId.trim()
                }
                onChange={(event) => {
                  const selected = event.target.checked;
                  onChange(
                    models.map((candidate, modelIndex) => ({
                      ...candidate,
                      capabilities: {
                        ...candidate.capabilities,
                        imageGeneration:
                          modelIndex === index
                            ? selected
                            : candidate.capabilities.imageGeneration,
                      },
                    })),
                  );
                  onDefaultImageGenerationSelectionChange(
                    selected
                      ? { providerId, modelId: model.modelId.trim() }
                      : null,
                  );
                }}
                type="checkbox"
              />
              <span>{t("settings.useForGlobalImageGeneration")}</span>
            </label>
            <label className="settings-checkbox">
              <input
                checked={model.capabilities.reasoning}
                disabled={busy}
                onChange={(event) =>
                  update(index, {
                    ...model,
                    capabilities: {
                      ...model.capabilities,
                      reasoning: event.target.checked,
                    },
                    reasoningEfforts: event.target.checked
                      ? ["off", "low", "medium", "high", "xhigh"]
                      : ["off"],
                  })
                }
                type="checkbox"
              />
              <span>{t("settings.reasoning")}</span>
            </label>
          </div>
          <IconButton
            disabled={busy || models.length === 1}
            icon="close"
            label={`${t("settings.removeModel")} ${model.name || index + 1}`}
            onClick={() => {
              if (
                defaultImageGenerationSelection?.providerId === providerId &&
                defaultImageGenerationSelection.modelId === model.modelId
              ) {
                onDefaultImageGenerationSelectionChange(null);
              }
              onChange(models.filter((_, modelIndex) => modelIndex !== index));
            }}
          />
        </div>
      ))}
    </section>
  );
}

function profileDraft(profile: ModelProviderProfile): ProviderDraft {
  return {
    providerId: profile.providerId,
    name: profile.name,
    enabled: profile.enabled,
    apiFormat: profile.apiFormat,
    ...(profile.imageGenerationApiFormat === undefined
      ? {}
      : {
          imageGenerationApiFormat: profile.imageGenerationApiFormat,
        }),
    authMode: profile.authMode,
    baseUrl: profile.baseUrl,
    models: profile.models.map((model) => ({
      ...model,
      capabilities: { ...model.capabilities },
      reasoningEfforts: [...model.reasoningEfforts],
    })),
  };
}

function newProviderDraft(): ProviderDraft {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
  return {
    providerId: `provider-${suffix}`,
    name: "Custom provider",
    enabled: true,
    apiFormat: "openai-responses",
    imageGenerationApiFormat: "openai-images",
    authMode: "bearer",
    baseUrl: "https://api.openai.com/v1",
    models: [newModelProfile()],
  };
}

function newModelProfile(): ModelProfile {
  return {
    modelId: "",
    name: "",
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    capabilities: {
      toolUse: true,
      imageInput: false,
      imageGeneration: false,
      reasoning: true,
    },
    reasoningEfforts: ["off", "low", "medium", "high", "xhigh"],
  };
}

function validProviderDraft(draft: ProviderDraft): boolean {
  if (!draft.name.trim() || !draft.baseUrl.trim() || draft.models.length === 0)
    return false;
  const modelIds = draft.models.map((model) => model.modelId.trim());
  return (
    modelIds.every(Boolean) &&
    new Set(modelIds).size === modelIds.length &&
    draft.models.every(
      (model) =>
        Number.isInteger(model.contextWindow) &&
        model.contextWindow >= 1_024 &&
        Number.isInteger(model.maxOutputTokens) &&
        model.maxOutputTokens >= 1,
    )
  );
}

function imageGenerationSelectionAfterSave(
  selection: ImageGenerationSelection | null,
  request: SaveModelProviderProfileRequest,
): ImageGenerationSelection | null {
  if (!selection || selection.providerId !== request.providerId)
    return selection;
  const selectedModelId = selection.modelId.trim();
  const model = request.models.find(
    (candidate) => candidate.modelId === selectedModelId,
  );
  return request.enabled &&
    request.imageGenerationApiFormat !== undefined &&
    model?.capabilities.imageGeneration
    ? { providerId: selection.providerId, modelId: selectedModelId }
    : null;
}

function sameImageGenerationSelection(
  left: ImageGenerationSelection | null,
  right: ImageGenerationSelection | null,
): boolean {
  return (
    left?.providerId === right?.providerId && left?.modelId === right?.modelId
  );
}

function selectionForModel(
  provider: ModelProviderProfile,
  model: ModelProfile,
) {
  const preferred = model.reasoningEfforts.includes("medium")
    ? "medium"
    : model.reasoningEfforts[0];
  return {
    providerId: provider.providerId,
    modelId: model.modelId,
    ...(preferred === undefined ? {} : { reasoningEffort: preferred }),
  };
}

function apiFormatLabel(
  format: ModelApiFormat,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (format === "openai-responses") return t("settings.apiOpenAIResponses");
  if (format === "openai-chat-completions") return t("settings.apiOpenAIChat");
  return t("settings.apiAnthropicMessages");
}
