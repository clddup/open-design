import type {
  ConversationDescriptor,
  ProjectManifest,
} from "@opendesign/workspace-contracts";
import { Button, Glyph, IconButton } from "@opendesign/ui";
import { useState, type FormEvent } from "react";
import type { ThemePreference } from "../../shared/desktop-api";
import { useI18n } from "../i18n";
import { WindowControls } from "./WindowControls";

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
    <div className="home-shell">
      <header className="home-titlebar" data-platform={platform}>
        <div aria-hidden="true" className="titlebar__native-safe-zone" />
        <div className="home-titlebar__brand">
          <span className="brand-mark">
            <Glyph name="spark" size={15} />
          </span>
          <button className="home-breadcrumb" onClick={onBack} type="button">
            {t("workspace.label")}
          </button>
          <Glyph name="chevron-right" size={13} />
          <strong>{manifest.name}</strong>
        </div>
        <div className="home-titlebar__actions no-drag">
          <Button
            aria-label={t("settings.open")}
            icon="settings"
            onClick={onSettings}
          >
            {t("settings.title")}
          </Button>
          <IconButton
            icon={theme === "dark" ? "sun" : "moon"}
            label={t(nextTheme === "dark" ? "theme.useDark" : "theme.useLight")}
            onClick={() => onThemeChange(nextTheme)}
          />
          {platform !== "darwin" && <WindowControls />}
        </div>
      </header>
      <main aria-labelledby="project-home-title" className="project-home">
        <header className="project-home__header">
          <div>
            <span className="home-eyebrow">{t("project.label")}</span>
            <h1 id="project-home-title">{manifest.name}</h1>
            <p>
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
          <p className="home-error" role="alert">
            {error}
          </p>
        )}

        <div className="project-home__layout">
          <section aria-labelledby="design-files-title">
            <div className="project-section-heading">
              <div>
                <span>{t("project.canvasSources")}</span>
                <h2 id="design-files-title">{t("project.designFiles")}</h2>
              </div>
              <span>{manifest.designFiles.length}</span>
            </div>
            <div className="design-file-cards">
              {manifest.designFiles.map((file, index) => (
                <button
                  className="design-file-card"
                  disabled={busy}
                  key={file.designFileId}
                  onClick={() => onOpenDesignFile(file.designFileId)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`design-file-card__preview preview-${index % 3}`}
                  >
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="design-file-card__meta">
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

          <aside className="project-home__aside">
            <section className="project-summary">
              <span>{t("project.activity")}</span>
              <div className="project-summary__heading">
                <h2 id="project-conversations-title">
                  {t("project.conversations")}
                </h2>
                <span>{conversations.length}</span>
              </div>
              <form
                aria-label={t("project.createConversation")}
                className="conversation-create"
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
                <div className="home-empty home-empty--compact">
                  <Glyph name="comment" size={20} />
                  <strong>{t("project.noConversations")}</strong>
                  <p>{t("project.noConversationsDetail")}</p>
                </div>
              ) : (
                <ul
                  aria-labelledby="project-conversations-title"
                  className="conversation-list"
                >
                  {conversations.map((conversation) => {
                    const active =
                      conversation.conversationId === activeConversationId;
                    return (
                      <li key={conversation.conversationId}>
                        <button
                          aria-current={active ? "true" : undefined}
                          className={`conversation-row${active ? " conversation-row--active" : ""}`}
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
            <section className="project-summary">
              <span>{t("project.workingSet")}</span>
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
