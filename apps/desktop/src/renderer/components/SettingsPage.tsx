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
  GlobalImageGenerationSettings,
  ImageGenerationApiFormat,
  ModelProfile,
  ModelProviderCatalog,
  ModelProviderProfile,
  ProviderConnectionResult,
  SaveModelProviderProfileRequest,
  SaveGlobalImageGenerationSettingsRequest,
  ThemePreference,
} from "../../shared/desktop-api";
import type { AppLocale } from "../../shared/i18n/locale";
import { useI18n } from "../i18n";
import { HomeTitlebar } from "./HomeTitlebar";
import formStyles from "./SettingsForms.module.scss";
import styles from "./SettingsPage.module.scss";
type SettingsTab = "general" | "models" | "image-generation";

type SettingsPageProps = {
  onClose: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  platform: NodeJS.Platform;
  theme: ThemePreference;
};
const settingsTabs: readonly SettingsTab[] = [
  "general",
  "models",
  "image-generation",
];
export function SettingsPage(props: SettingsPageProps) {
  const { t } = useI18n();
  return (
    <SettingsErrorBoundary
      closeLabel={t("settings.close")}
      description={t("settings.renderFailedDescription")}
      onClose={props.onClose}
      platform={props.platform}
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
  platform,
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
    <div className={styles.shell}>
      <HomeTitlebar
        actions={
          <IconButton
            icon="close"
            label={t("settings.close")}
            onClick={onClose}
          />
        }
        icon="settings"
        identity={<strong>{t("settings.title")}</strong>}
        platform={platform}
        surface="solid"
      />
      <main className={styles.workbench}>
        <aside aria-label={t("settings.title")} className={styles.navigation}>
          <div aria-orientation="vertical" role="tablist">
            {settingsTabs.map((tab) => (
              <button
                aria-controls={`settings-${tab}-panel`}
                aria-selected={activeTab === tab}
                className={styles.navigationItem}
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
                <Glyph
                  name={
                    tab === "general"
                      ? "settings"
                      : tab === "models"
                        ? "agent"
                        : "assets"
                  }
                />
                {t(
                  tab === "general"
                    ? "settings.general"
                    : tab === "models"
                      ? "settings.models"
                      : "settings.imageGeneration",
                )}
              </button>
            ))}
          </div>
        </aside>
        <section className={styles.content}>
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
          <div
            aria-labelledby="settings-image-generation-tab"
            hidden={activeTab !== "image-generation"}
            id="settings-image-generation-panel"
            role="tabpanel"
          >
            <GlobalImageGenerationForm />
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
    platform: NodeJS.Platform;
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
      <div className={styles.shell}>
        <HomeTitlebar
          actions={
            <IconButton
              icon="close"
              label={this.props.closeLabel}
              onClick={this.props.onClose}
            />
          }
          icon="settings"
          identity={<strong>{this.props.title}</strong>}
          platform={this.props.platform}
          surface="solid"
        />
        <main className={styles.recovery} role="alert">
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
    <header className={styles.heading}>
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
    <section className={styles.row}>
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
    <div aria-label={label} className={styles.segmented} role="group">
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

type ImageGenerationDraft = Pick<
  GlobalImageGenerationSettings,
  "enabled" | "apiFormat" | "authMode" | "baseUrl" | "modelId"
>;

function GlobalImageGenerationForm() {
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

  return (
    <form
      className={formStyles.globalImage}
      onSubmit={(event) => void save(event)}
    >
      <SettingsHeading
        description={t("settings.imageGenerationDescription")}
        title={t("settings.imageGenerationTitle")}
      />
      {status && (
        <p
          className={`${formStyles.feedback} ${status.tone === "success" ? formStyles.feedbackSuccess : formStyles.feedbackError}`}
          role="status"
        >
          {status.message}
        </p>
      )}
      {loading || !draft ? (
        <div className={formStyles.providerEmptyDetail}>
          <strong>{t("settings.loadingImageGeneration")}</strong>
        </div>
      ) : (
        <section className={formStyles.globalImageForm}>
          <div className={formStyles.providerDetailHeading}>
            <span>
              <strong>{t("settings.globalImageGeneration")}</strong>
              <small>{t("settings.globalImageGenerationHint")}</small>
            </span>
            <label className={formStyles.checkbox}>
              <input
                checked={draft.enabled}
                disabled={saving}
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
          <div className={formStyles.providerGrid}>
            <label className={`${formStyles.field} ${formStyles.fieldWide}`}>
              <span>{t("settings.baseUrl")}</span>
              <input
                aria-label={t("settings.imageGenerationBaseUrl")}
                autoComplete="url"
                disabled={saving}
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
            <label className={formStyles.field}>
              <span>{t("settings.imageGenerationApi")}</span>
              <select
                aria-label={t("settings.imageGenerationApi")}
                disabled={saving}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    apiFormat: event.target.value as ImageGenerationApiFormat,
                  }))
                }
                value={draft.apiFormat}
              >
                <option value="openai-images">
                  {t("settings.apiOpenAIImages")}
                </option>
              </select>
            </label>
            <label className={formStyles.field}>
              <span>{t("settings.authMode")}</span>
              <select
                aria-label={t("settings.imageGenerationAuthMode")}
                disabled={saving}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    authMode: event.target.value as ModelAuthMode,
                  }))
                }
                value={draft.authMode}
              >
                <option value="bearer">{t("settings.authBearer")}</option>
                <option value="x-api-key">{t("settings.authApiKey")}</option>
                <option value="none">{t("settings.authNone")}</option>
              </select>
            </label>
            <label className={`${formStyles.field} ${formStyles.fieldWide}`}>
              <span>{t("settings.imageGenerationModelId")}</span>
              <input
                aria-label={t("settings.imageGenerationModelId")}
                disabled={saving}
                maxLength={256}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    modelId: event.target.value,
                  }))
                }
                placeholder="gpt-image-2"
                value={draft.modelId}
              />
              <small>{t("settings.imageGenerationModelHint")}</small>
            </label>
            <label className={`${formStyles.field} ${formStyles.fieldWide}`}>
              <span>{t("settings.apiKey")}</span>
              <input
                aria-label={t("settings.imageGenerationApiKey")}
                autoComplete="off"
                disabled={saving || clearApiKey || draft.authMode === "none"}
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
            <label className={formStyles.checkbox}>
              <input
                checked={clearApiKey}
                disabled={saving}
                onChange={(event) => {
                  setClearApiKey(event.target.checked);
                  if (event.target.checked) setApiKey("");
                }}
                type="checkbox"
              />
              <span>{t("settings.clearApiKey")}</span>
            </label>
          )}
          <p className={formStyles.securityNote}>
            <Glyph name="lock" size={14} />
            {t("settings.imageGenerationCredentialBoundary")}
          </p>
          <footer className={formStyles.providerActions}>
            <span />
            <span />
            <span />
            <Button disabled={saving || !valid} tone="primary" type="submit">
              {saving ? t("settings.saving") : t("settings.save")}
            </Button>
          </footer>
        </section>
      )}
    </form>
  );
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
    <form className={formStyles.provider} onSubmit={submit}>
      <SettingsHeading
        description={t("settings.modelsDescription")}
        title={t("settings.modelsTitle")}
      />
      {status && (
        <p
          className={`${formStyles.feedback} ${status.tone === "success" ? formStyles.feedbackSuccess : formStyles.feedbackError}`}
          role="status"
        >
          {status.message}
        </p>
      )}
      <div className={formStyles.providerWorkspace}>
        <aside className={formStyles.providerList}>
          <div className={formStyles.providerListHeading}>
            <strong>{t("settings.providers")}</strong>
            <button onClick={addProvider} type="button">
              <Glyph name="plus" size={14} />
              {t("settings.addProvider")}
            </button>
          </div>
          {loading ? (
            <p className={formStyles.providerEmpty}>
              {t("settings.loadingProviders")}
            </p>
          ) : catalog?.providers.length ? (
            catalog.providers.map((provider) => (
              <button
                aria-pressed={selectedProviderId === provider.providerId}
                className={formStyles.providerListItem}
                key={provider.providerId}
                onClick={() => {
                  if (!dirty || selectedProviderId === provider.providerId) {
                    loadProvider(provider);
                  }
                }}
                type="button"
              >
                <span
                  className={provider.enabled ? formStyles.enabled : undefined}
                />
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
            <p className={formStyles.providerEmpty}>
              {t("settings.noProviders")}
            </p>
          )}
        </aside>
        <section className={formStyles.providerDetail}>
          {loading ? (
            <div className={formStyles.providerEmptyDetail}>
              <strong>{t("settings.loadingProviders")}</strong>
            </div>
          ) : draft ? (
            <>
              <div className={formStyles.providerDetailHeading}>
                <label
                  className={`${formStyles.field} ${formStyles.fieldInline}`}
                >
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
                <label className={formStyles.checkbox}>
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
              <div className={formStyles.providerGrid}>
                <label
                  className={`${formStyles.field} ${formStyles.fieldWide}`}
                >
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
                <label className={formStyles.field}>
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
                <label className={formStyles.field}>
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
                <label
                  className={`${formStyles.field} ${formStyles.fieldWide}`}
                >
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
                <label className={formStyles.checkbox}>
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
                models={draft.models}
                onChange={(models) =>
                  updateDraft((current) => ({ ...current, models }))
                }
              />
              <p className={formStyles.securityNote}>
                <Glyph name="lock" size={14} />
                {t("settings.credentialBoundary")}
              </p>
              <footer className={formStyles.providerActions}>
                <label className={formStyles.checkbox}>
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
            <div className={formStyles.providerEmptyDetail}>
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
  models,
  onChange,
}: {
  busy: boolean;
  models: ModelProfile[];
  onChange: (models: ModelProfile[]) => void;
}) {
  const { t } = useI18n();
  const update = (index: number, model: ModelProfile) =>
    onChange(
      models.map((current, modelIndex) =>
        modelIndex === index ? model : current,
      ),
    );
  return (
    <section className={formStyles.modelsList}>
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
        <div className={formStyles.modelRow} key={index}>
          <label className={formStyles.field}>
            <span>{t("settings.modelId")}</span>
            <input
              aria-label={`${t("settings.modelId")} ${index + 1}`}
              disabled={busy}
              maxLength={256}
              onChange={(event) =>
                update(index, { ...model, modelId: event.target.value })
              }
              placeholder={t("settings.modelPlaceholder")}
              value={model.modelId}
            />
          </label>
          <label className={formStyles.field}>
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
          <label className={`${formStyles.field} ${formStyles.fieldNumber}`}>
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
          <label className={`${formStyles.field} ${formStyles.fieldNumber}`}>
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
          <div className={formStyles.modelCapabilities}>
            <label className={formStyles.checkbox}>
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
            <label className={formStyles.checkbox}>
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
            <label className={formStyles.checkbox}>
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
    apiFormat: "openai-chat-completions",
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
