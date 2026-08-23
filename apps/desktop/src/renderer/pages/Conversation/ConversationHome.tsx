import { Button, IconButton } from "@opendesign/ui";
import type { ReactNode } from "react";
import type { ThemePreference } from "../../../shared/desktop-api";
import { HomeTitlebar } from "../../components/app-window/HomeTitlebar";
import { useI18n } from "../../i18n";
import styles from "./ConversationHome.module.scss";

export type ConversationHomeProps = {
  children: ReactNode;
  issue:
    | "project-unavailable"
    | "design-file-unavailable"
    | "page-unavailable"
    | "no-target";
  onBack: () => void;
  onSettings: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  platform: NodeJS.Platform;
  theme: ThemePreference;
  title: string;
};

export function ConversationHome({
  children,
  issue,
  onBack,
  onSettings,
  onThemeChange,
  platform,
  theme,
  title,
}: ConversationHomeProps) {
  const { t } = useI18n();
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <div className={styles.shell}>
      <HomeTitlebar
        actions={
          <>
            <Button icon="lucide:settings-2" onClick={onSettings}>
              {t("settings.title")}
            </Button>
            <IconButton
              icon={theme === "dark" ? "lucide:sun" : "lucide:moon"}
              label={t(
                nextTheme === "dark" ? "theme.useDark" : "theme.useLight",
              )}
              onClick={() => onThemeChange(nextTheme)}
            />
          </>
        }
        icon="lucide:message-square"
        identity={<strong>{title}</strong>}
        platform={platform}
      />
      <main className={styles.main}>
        <header className={styles.context}>
          <Button onClick={onBack} tone="quiet">
            {t("common.back")}
          </Button>
          <span className={styles.warning}>
            <span aria-hidden="true" className={styles.warningMark}>
              !
            </span>
            <span className={styles.warningContent}>
              <strong>{t("workspace.conversationTargetUnavailable")}</strong>
              <small>{t(`workspace.conversationTarget.${issue}`)}</small>
            </span>
          </span>
        </header>
        <div className={styles.timeline}>{children}</div>
      </main>
    </div>
  );
}
