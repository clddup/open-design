import type { ModelProviderCatalog } from "@/shared/desktop-api";
import { useI18n } from "@/renderer/i18n";
import formStyles from "../SettingsForms.module.scss";
import {
  modelSelectionValue,
  visualCriticModelOptions,
} from "../model/model-provider-profile";

export function VisualCriticModelSetting({
  catalog,
  disabled,
  onSelectionChange,
}: {
  catalog: ModelProviderCatalog | null;
  disabled: boolean;
  onSelectionChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const options = catalog ? visualCriticModelOptions(catalog) : [];
  const value = catalog?.visualCriticSelection
    ? modelSelectionValue(catalog.visualCriticSelection)
    : "";

  return (
    <section className={formStyles.criticSetting}>
      <span>
        <strong>{t("settings.visualCriticModel")}</strong>
        <small>{t("settings.visualCriticDescription")}</small>
      </span>
      <label className={formStyles.field}>
        <span>{t("settings.visualCriticSelection")}</span>
        <select
          aria-label={t("settings.visualCriticSelection")}
          disabled={disabled}
          onChange={(event) => onSelectionChange(event.target.value)}
          value={value}
        >
          <option value="">{t("settings.visualCriticFollowAuthor")}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
