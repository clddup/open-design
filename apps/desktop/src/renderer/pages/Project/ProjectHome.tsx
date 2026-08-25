import type {
  ConversationDescriptor,
  ProjectManifest,
} from "@opendesign/workspace-contracts";
import { Button, Icon, IconButton } from "@opendesign/ui";
import type { ThemePreference } from "@/shared/desktop-api";
import { HomeTitlebar } from "../../components/app-window/HomeTitlebar";
import homeStyles from "../../components/app-window/HomeSurface.module.scss";
import { ConversationActions } from "../../features/agent-conversation/components/ConversationActions";
import { useI18n } from "../../i18n";
import styles from "./ProjectHome.module.scss";

export type ProjectHomeProps = {
  activeConversationId: string | null;
  busy: boolean;
  conversations: ConversationDescriptor[];
  conversationDeleteBlockedIds: readonly string[];
  error: string | null;
  manifest: ProjectManifest;
  platform: NodeJS.Platform;
  theme: ThemePreference;
  onBack: () => void;
  onRequestDeleteConversation: (conversationId: string) => void;
  onOpenDesignFile: (designFileId: string) => void;
  onOpenConversation: (conversationId: string) => void;
  onSettings: () => void;
  onThemeChange: (theme: ThemePreference) => void;
};

export function ProjectHome({
  activeConversationId,
  busy,
  conversations,
  conversationDeleteBlockedIds,
  error,
  manifest,
  platform,
  theme,
  onBack,
  onRequestDeleteConversation,
  onOpenDesignFile,
  onOpenConversation,
  onSettings,
  onThemeChange,
}: ProjectHomeProps) {
  const { t } = useI18n();
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <div className={homeStyles.shell}>
      <HomeTitlebar
        actions={
          <>
            <Button
              aria-label={t("settings.open")}
              icon="lucide:settings-2"
              onClick={onSettings}
            >
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
        icon="lucide:sparkles"
        identity={
          <>
            <button
              className={styles.breadcrumb}
              onClick={onBack}
              type="button"
            >
              {t("workspace.label")}
            </button>
            <Icon name="lucide:chevron-right" size={13} />
            <strong>{manifest.name}</strong>
          </>
        }
        platform={platform}
      />
      <main
        aria-labelledby="project-home-title"
        className={`${homeStyles.viewport} ${styles.content}`}
      >
        <header className={styles.header}>
          <div>
            <span className={homeStyles.eyebrow}>{t("project.label")}</span>
            <h1 className={homeStyles.title} id="project-home-title">
              {manifest.name}
            </h1>
            <p className={homeStyles.description}>
              {t("project.designFileSummary", {
                count: manifest.designFiles.length,
              })}
            </p>
          </div>
          <Button disabled={busy} onClick={onBack} tone="quiet">
            {t("project.allProjects")}
          </Button>
        </header>

        {error && (
          <p className={homeStyles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.layout}>
          <section
            aria-labelledby="design-files-title"
            className={homeStyles.panel}
          >
            <div
              className={`${homeStyles.sectionHeading} ${styles.sectionHeading}`}
            >
              <div>
                <span className={homeStyles.sectionLabel}>
                  {t("project.canvasSources")}
                </span>
                <h2 id="design-files-title">{t("project.designFiles")}</h2>
              </div>
              <span className={homeStyles.sectionCount}>
                {manifest.designFiles.length}
              </span>
            </div>
            <div className={styles.designFileList}>
              {manifest.designFiles.map((file) => (
                <button
                  className={styles.designFileRow}
                  disabled={busy}
                  key={file.designFileId}
                  onClick={() => onOpenDesignFile(file.designFileId)}
                  type="button"
                >
                  <span className={styles.designFileIcon}>
                    <Icon name="lucide:frame" size={15} />
                  </span>
                  <span className={styles.designFileMeta}>
                    <strong>{file.name}</strong>
                    <small>{file.relativePath}</small>
                  </span>
                  <Icon name="lucide:chevron-right" size={14} />
                </button>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="project-conversations-title"
            className={homeStyles.panel}
          >
            <div
              className={`${homeStyles.sectionHeading} ${styles.sectionHeading}`}
            >
              <div>
                <span className={homeStyles.sectionLabel}>
                  {t("project.activity")}
                </span>
                <h2 id="project-conversations-title">
                  {t("project.conversations")}
                </h2>
              </div>
              <span className={homeStyles.sectionCount}>
                {conversations.length}
              </span>
            </div>
            {conversations.length === 0 ? (
              <div className={`${homeStyles.empty} ${homeStyles.emptyCompact}`}>
                <Icon name="lucide:message-square" size={20} />
                <strong>{t("project.noConversations")}</strong>
                <p>{t("project.noConversationsDetail")}</p>
              </div>
            ) : (
              <ul
                aria-labelledby="project-conversations-title"
                className={styles.conversationList}
              >
                {conversations.map((conversation) => {
                  const active =
                    conversation.conversationId === activeConversationId;
                  const deleteBlocked = conversationDeleteBlockedIds.includes(
                    conversation.conversationId,
                  );
                  return (
                    <li
                      className={styles.conversationItem}
                      key={conversation.conversationId}
                    >
                      <button
                        aria-label={conversation.title}
                        aria-current={active ? "true" : undefined}
                        className={`${styles.conversationRow}${active ? ` ${styles.conversationActive}` : ""}`}
                        disabled={busy}
                        onClick={() =>
                          onOpenConversation(conversation.conversationId)
                        }
                        type="button"
                      >
                        <span>
                          <strong>{conversation.title}</strong>
                          <time dateTime={conversation.updatedAt}>
                            {t("project.conversationUpdated", {
                              date: conversation.updatedAt.slice(0, 10),
                            })}
                          </time>
                        </span>
                        <Icon name="lucide:chevron-right" size={13} />
                      </button>
                      <ConversationActions
                        conversationId={conversation.conversationId}
                        deleteBlocked={deleteBlocked}
                        disabled={busy}
                        onRequestDelete={onRequestDeleteConversation}
                        title={conversation.title}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
