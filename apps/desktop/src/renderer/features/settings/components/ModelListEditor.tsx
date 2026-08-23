import { Icon, IconButton } from "@opendesign/ui";
import { useI18n } from "@/renderer/i18n";
import type { ModelProfile } from "@/shared/desktop-api";
import formStyles from "../SettingsForms.module.scss";
import { newModelProfile } from "../model/model-provider-profile";

export function ModelListEditor({
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
          <Icon name="lucide:plus" size={14} />
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
            icon="lucide:x"
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
