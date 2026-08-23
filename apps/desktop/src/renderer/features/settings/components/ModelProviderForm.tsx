import type { ModelApiFormat, ModelAuthMode } from "@opendesign/model-gateway";
import { Button, Icon, IconButton } from "@opendesign/ui";
import { useI18n } from "@/renderer/i18n";
import formStyles from "../SettingsForms.module.scss";
import { useModelProviderSettings } from "../hooks/use-model-provider-settings";
import { ModelListEditor } from "./ModelListEditor";
import { SettingsHeading } from "./SettingsPrimitives";

export function ModelProviderForm() {
  const { t } = useI18n();
  const {
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
  } = useModelProviderSettings();

  return (
    <form
      className={formStyles.provider}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !dirty || busy) return;
        event.preventDefault();
        cancelDraft();
      }}
      onSubmit={submit}
    >
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
            <button
              disabled={busy || (dirty && !creatingProvider)}
              onClick={addProvider}
              ref={addProviderButtonRef}
              type="button"
            >
              <Icon name="lucide:plus" size={14} />
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
                disabled={
                  busy || (dirty && selectedProviderId !== provider.providerId)
                }
                key={provider.providerId}
                onClick={() => {
                  if (selectedProviderId !== provider.providerId)
                    loadProvider(provider);
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
              <header className={formStyles.providerDetailHeading}>
                <div className={formStyles.providerIdentity}>
                  {creatingProvider && (
                    <IconButton
                      icon="lucide:arrow-left"
                      label={t("settings.backToProviders")}
                      onClick={cancelDraft}
                      type="button"
                    />
                  )}
                  <span>
                    <strong>
                      {creatingProvider
                        ? t("settings.newProvider")
                        : draft.name || t("settings.provider")}
                    </strong>
                    <small>
                      {creatingProvider
                        ? t("settings.newProviderDescription")
                        : t("settings.editProviderDescription")}
                    </small>
                  </span>
                </div>
                <div className={formStyles.providerState}>
                  {dirty && (
                    <span className={formStyles.unsavedIndicator}>
                      {t("settings.unsavedChanges")}
                    </span>
                  )}
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
              </header>
              <div className={formStyles.providerGrid}>
                <label
                  className={`${formStyles.field} ${formStyles.fieldWide}`}
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
                    ref={providerNameInputRef}
                    value={draft.name}
                  />
                </label>
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
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setDirty(true);
                      setConfirmDelete(false);
                    }}
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
                      setDirty(true);
                      setConfirmDelete(false);
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
                <Icon name="lucide:lock" size={14} />
                {t("settings.credentialBoundary")}
              </p>
              <footer className={formStyles.providerActions}>
                <label className={formStyles.checkbox}>
                  <input
                    checked={setAsDefault}
                    disabled={busy}
                    onChange={(event) => {
                      setSetAsDefault(event.target.checked);
                      setDirty(true);
                      setConfirmDelete(false);
                    }}
                    type="checkbox"
                  />
                  <span>{t("settings.useAsDefault")}</span>
                </label>
                <span className={formStyles.providerActionSpacer} />
                {dirty && (
                  <Button
                    disabled={busy}
                    onClick={cancelDraft}
                    tone="quiet"
                    type="button"
                  >
                    {t("settings.cancelChanges")}
                  </Button>
                )}
                <Button
                  disabled={creatingProvider || busy}
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

function apiFormatLabel(
  format: ModelApiFormat,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (format === "openai-responses") return t("settings.apiOpenAIResponses");
  if (format === "openai-chat-completions") return t("settings.apiOpenAIChat");
  return t("settings.apiAnthropicMessages");
}
