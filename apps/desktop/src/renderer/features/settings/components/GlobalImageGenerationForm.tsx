import type { ModelAuthMode } from "@opendesign/model-gateway";
import { Button, Icon } from "@opendesign/ui";
import { useI18n } from "@/renderer/i18n";
import type { ImageGenerationApiFormat } from "@/shared/desktop-api";
import formStyles from "../SettingsForms.module.scss";
import { useGlobalImageGenerationSettings } from "../hooks/use-global-image-generation-settings";
import { SettingsHeading } from "./SettingsPrimitives";

export function GlobalImageGenerationForm() {
  const { t } = useI18n();
  const {
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
  } = useGlobalImageGenerationSettings();

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
            <Icon name="lucide:lock" size={14} />
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
