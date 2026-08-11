import type {
  ConversationDescriptor,
  ProjectManifest,
} from "@opendesign/workspace-contracts";
import { Button, Glyph, IconButton } from "@opendesign/ui";
import { useState, type FormEvent } from "react";
import type { ThemePreference } from "../../shared/desktop-api";
import { useI18n } from "../i18n";
import { HomeTitlebar } from "./HomeTitlebar";
import homeStyles from "./HomeSurface.module.scss";
import styles from "./ProjectHome.module.scss";

export type ProjectHomeProps = {
  activeConversationId: string | null;
  busy: boolean;
  conversations: ConversationDescriptor[];
  error: string | null;
  manifest: ProjectManifest;
  platform: NodeJS.Platform;
  theme: ThemePreference;
  onBack: () => void;
  onCreateConversation: (title: string) => Promise<boolean>;
  onOpenDesignFile: (designFileId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onSettings: () => void;
  onThemeChange: (theme: ThemePreference) => void;
};

export function ProjectHome({
  activeConversationId,
  busy,
  conversations,
  error,
  manifest,
  platform,
  theme,
  onBack,
  onCreateConversation,
  onOpenDesignFile,
  onSelectConversation,
  onSettings,
  onThemeChange,
}: ProjectHomeProps) {
  const { t } = useI18n();
  const [conversationTitle, setConversationTitle] = useState("");
  const [creatingConversation, setCreatingConversation] = useState(false);
  const nextTheme = theme === "dark" ? "light" : "dark";

  const createConversation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = conversationTitle.trim();
    if (!title || busy || creatingConversation) return;
    setCreatingConversation(true);
    try {
      if (await onCreateConversation(title)) setConversationTitle("");
    } finally {
      setCreatingConversation(false);
    }
  };
  return (
    <div className={homeStyles.shell}>
      <HomeTitlebar
        actions={
          <>
            <Button
              aria-label={t("settings.open")}
              icon="settings"
              onClick={onSettings}
            >
              {t("settings.title")}
            </Button>
            <IconButton
              icon={theme === "dark" ? "sun" : "moon"}
              label={t(
                nextTheme === "dark" ? "theme.useDark" : "theme.useLight",
              )}
              onClick={() => onThemeChange(nextTheme)}
            />
          </>
        }
        icon="spark"
        identity={
          <>
            <button
              className={styles.breadcrumb}
              onClick={onBack}
              type="button"
            >
              {t("workspace.label")}
            </button>
            <Glyph name="chevron-right" size={13} />
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
          <section aria-labelledby="design-files-title">
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
            <div className={styles.designFileCards}>
              {manifest.designFiles.map((file, index) => (
                <button
                  className={styles.designFileCard}
                  disabled={busy}
                  key={file.designFileId}
                  onClick={() => onOpenDesignFile(file.designFileId)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`${styles.preview}${index % 3 === 1 ? ` ${styles.previewAlternate}` : ""}`}
                  >
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className={styles.designFileMeta}>
                    <span>
                      <strong>{file.name}</strong>
                      <small>{file.relativePath}</small>
                    </span>
                    <Glyph name="chevron-right" size={14} />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside className={styles.aside}>
            <section className={`${homeStyles.panel} ${styles.summary}`}>
              <span className={styles.summaryLabel}>
                {t("project.activity")}
              </span>
              <div className={styles.summaryHeading}>
                <h2 id="project-conversations-title">
                  {t("project.conversations")}
                </h2>
                <span>{conversations.length}</span>
              </div>
              <form
                aria-label={t("project.createConversation")}
                className={styles.conversationCreate}
                onSubmit={(event) => void createConversation(event)}
              >
                <label className="visually-hidden" htmlFor="conversation-title">
                  {t("project.conversationTitle")}
                </label>
                <input
                  disabled={busy || creatingConversation}
                  id="conversation-title"
                  maxLength={2_000}
                  onChange={(event) => setConversationTitle(event.target.value)}
                  placeholder={t("project.newConversation")}
                  value={conversationTitle}
                />
                <Button
                  disabled={
                    busy ||
                    creatingConversation ||
                    conversationTitle.trim().length === 0
                  }
                  icon="plus"
                  tone="primary"
                  type="submit"
                >
                  {creatingConversation
                    ? t("common.creating")
                    : t("common.create")}
                </Button>
              </form>
              {conversations.length === 0 ? (
                <div
                  className={`${homeStyles.empty} ${homeStyles.emptyCompact} ${styles.summaryEmpty}`}
                >
                  <Glyph name="comment" size={20} />
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
                    return (
                      <li key={conversation.conversationId}>
                        <button
                          aria-current={active ? "true" : undefined}
                          className={`${styles.conversationRow}${active ? ` ${styles.conversationActive}` : ""}`}
                          disabled={busy}
                          onClick={() =>
                            onSelectConversation(conversation.conversationId)
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
                          <Glyph name="chevron-right" size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section className={`${homeStyles.panel} ${styles.summary}`}>
              <span className={styles.summaryLabel}>
                {t("project.workingSet")}
              </span>
              <h2>{t("project.assetsAccess")}</h2>
              <dl>
                <div>
                  <dt>{t("project.projectFiles")}</dt>
                  <dd>{t("project.readWrite")}</dd>
                </div>
                <div>
                  <dt>{t("project.externalRoots")}</dt>
                  <dd>{t("project.noneAttached")}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
