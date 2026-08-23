import { Button, Icon, IconButton } from "@opendesign/ui";
import {
  Component,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ThemePreference } from "@/shared/desktop-api";
import type { AppLocale } from "@/shared/i18n/locale";
import { HomeTitlebar } from "@/renderer/components/app-window/HomeTitlebar";
import { useI18n } from "@/renderer/i18n";
import styles from "./SettingsFeature.module.scss";
import { GlobalImageGenerationForm } from "./components/GlobalImageGenerationForm";
import { ModelProviderForm } from "./components/ModelProviderForm";
import {
  SegmentedControl,
  SettingsHeading,
  SettingsRow,
} from "./components/SettingsPrimitives";
type SettingsTab = "general" | "models" | "image-generation";

export type SettingsFeatureProps = {
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
export function SettingsFeature(props: SettingsFeatureProps) {
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
}: SettingsFeatureProps) {
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
            icon="lucide:x"
            label={t("settings.close")}
            onClick={onClose}
          />
        }
        icon="lucide:settings-2"
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
                <Icon
                  name={
                    tab === "general"
                      ? "lucide:settings-2"
                      : tab === "models"
                        ? "lucide:bot"
                        : "lucide:shapes"
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
              icon="lucide:x"
              label={this.props.closeLabel}
              onClick={this.props.onClose}
            />
          }
          icon="lucide:settings-2"
          identity={<strong>{this.props.title}</strong>}
          platform={this.props.platform}
          surface="solid"
        />
        <main className={styles.recovery} role="alert">
          <Icon name="lucide:settings-2" size={22} />
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
