import type {
  ConversationDescriptor,
  GlobalTaskLifecycle,
  GlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Icon,
  IconButton,
} from "@opendesign/ui";
import { useState } from "react";
import type {
  RecentProject,
  ThemePreference,
} from "../../../shared/desktop-api";
import type { MessageKey } from "../../../shared/i18n/messages";
import { HomeTitlebar } from "../../components/app-window/HomeTitlebar";
import homeStyles from "../../components/app-window/HomeSurface.module.scss";
import { ConversationActions } from "../../features/agent-conversation/components/ConversationActions";
import { useI18n } from "../../i18n";
import styles from "./WorkspaceHome.module.scss";

export type WorkspaceHomeProps = {
  busy: boolean;
  error: string | null;
  globalTasks: GlobalTaskProjection[];
  conversations: readonly ConversationDescriptor[];
  platform: NodeJS.Platform;
  recentProjects: readonly RecentProject[];
  theme: ThemePreference;
  onCreateProject: (name: string) => Promise<boolean>;
  onRequestDeleteConversation: (conversationId: string) => void;
  onOpenDesignFile: () => void;
  onOpenGlobalTask?: (task: GlobalTaskProjection) => void;
  onOpenConversation: (conversation: ConversationDescriptor) => void;
  onOpenProject: () => void;
  onOpenRecentProject: (projectId: string) => void;
  onRemoveRecentProject: (projectId: string) => Promise<boolean>;
  onRevealRecentProject: (projectId: string) => void;
  onSettings: () => void;
  onThemeChange: (theme: ThemePreference) => void;
};

const activeTaskLifecycles = new Set<GlobalTaskLifecycle>([
  "queued",
  "running",
  "waiting_approval",
]);

const taskLifecycleLabels: Record<GlobalTaskLifecycle, MessageKey> = {
  queued: "task.queued",
  running: "task.running",
  waiting_approval: "task.waitingApproval",
  conflict: "task.conflict",
  completed: "task.completed",
  cancelled: "task.cancelled",
  failed: "task.failed",
  interrupted: "task.interrupted",
  needs_attention: "agent.requestFailed",
};

export function WorkspaceHome({
  busy,
  error,
  globalTasks,
  conversations,
  platform,
  recentProjects,
  theme,
  onCreateProject,
  onRequestDeleteConversation,
  onOpenDesignFile,
  onOpenGlobalTask,
  onOpenConversation,
  onOpenProject,
  onOpenRecentProject,
  onRemoveRecentProject,
  onRevealRecentProject,
  onSettings,
  onThemeChange,
}: WorkspaceHomeProps) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(
    null,
  );
  const nextTheme = theme === "dark" ? "light" : "dark";
  const activeTaskCount = globalTasks.filter((task) =>
    activeTaskLifecycles.has(task.lifecycle),
  ).length;
  const activeConversationIds = new Set(
    globalTasks
      .filter((task) => activeTaskLifecycles.has(task.lifecycle))
      .map((task) => task.conversationId),
  );

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
        identity={<strong>OpenDesign</strong>}
        platform={platform}
      />
      <main
        aria-labelledby="workspace-home-title"
        className={`${homeStyles.viewport} ${styles.content}`}
      >
        <section className={styles.hero}>
          <span className={homeStyles.eyebrow}>{t("workspace.label")}</span>
          <h1 className={homeStyles.title} id="workspace-home-title">
            {t("workspace.title")}
          </h1>
          <p className={homeStyles.description}>{t("workspace.description")}</p>
          <div className={styles.actions}>
            <Button
              disabled={busy}
              icon="lucide:plus"
              onClick={() => setCreating(true)}
              tone="primary"
            >
              {t("workspace.createProject")}
            </Button>
            <Button disabled={busy} onClick={onOpenProject}>
              {t("workspace.openProject")}
            </Button>
          </div>
          {creating && (
            <form
              aria-label={t("workspace.createProjectForm")}
              className={styles.createProject}
              onSubmit={(event) => {
                event.preventDefault();
                void onCreateProject(projectName).then((created) => {
                  if (created) {
                    setCreating(false);
                    setProjectName("");
                  }
                });
              }}
            >
              <label htmlFor="project-name">{t("workspace.projectName")}</label>
              <div>
                <input
                  autoFocus
                  disabled={busy}
                  id="project-name"
                  maxLength={256}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder={t("workspace.projectNamePlaceholder")}
                  value={projectName}
                />
                <Button
                  disabled={busy || projectName.trim().length === 0}
                  tone="primary"
                  type="submit"
                >
                  {t("workspace.chooseFolder")}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setCreating(false)}
                  tone="quiet"
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          )}
          {error && (
            <p className={homeStyles.error} role="alert">
              {error}
            </p>
          )}
        </section>

        <div className={styles.grid}>
          <section
            aria-labelledby="recent-conversations-title"
            className={`${homeStyles.panel} ${styles.conversationPanel}`}
          >
            <div className={homeStyles.sectionHeading}>
              <div>
                <span className={homeStyles.sectionLabel}>
                  {t("workspace.continueWorking")}
                </span>
                <h2 id="recent-conversations-title">
                  {t("workspace.recentConversations")}
                </h2>
              </div>
              <span className={homeStyles.sectionCount}>
                {conversations.length}
              </span>
            </div>
            {conversations.length === 0 ? (
              <div className={`${homeStyles.empty} ${homeStyles.emptyCompact}`}>
                <Icon name="lucide:message-square" size={20} />
                <strong>{t("workspace.noConversations")}</strong>
                <p>{t("workspace.noConversationsDetail")}</p>
              </div>
            ) : (
              <div className={styles.conversationList}>
                {conversations.map((conversation) => {
                  const task = globalTasks.find(
                    (candidate) =>
                      candidate.conversationId === conversation.conversationId,
                  );
                  const deleteBlocked = activeConversationIds.has(
                    conversation.conversationId,
                  );
                  const projectName = conversation.filedProjectId
                    ? recentProjects.find(
                        (project) =>
                          project.projectId === conversation.filedProjectId,
                      )?.name
                    : undefined;
                  return (
                    <div
                      className={styles.conversationRow}
                      key={conversation.conversationId}
                    >
                      <button
                        aria-label={conversation.title}
                        className={styles.conversation}
                        disabled={busy}
                        onClick={() => onOpenConversation(conversation)}
                        type="button"
                      >
                        <span className={styles.conversationIcon}>
                          <Icon name="lucide:message-square" size={13} />
                        </span>
                        <span>
                          <strong>{conversation.title}</strong>
                          <small>
                            {projectName ?? t("workspace.unfiledConversation")}
                            {task
                              ? ` · ${t(taskLifecycleLabels[task.lifecycle])}`
                              : ` · ${t("workspace.conversationUpdated", {
                                  date: conversation.updatedAt.slice(0, 10),
                                })}`}
                          </small>
                        </span>
                      </button>
                      <ConversationActions
                        conversationId={conversation.conversationId}
                        deleteBlocked={deleteBlocked}
                        disabled={busy}
                        onRequestDelete={onRequestDeleteConversation}
                        title={conversation.title}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section
            aria-labelledby="recent-projects-title"
            className={homeStyles.panel}
          >
            <div className={homeStyles.sectionHeading}>
              <div>
                <span className={homeStyles.sectionLabel}>
                  {t("workspace.label")}
                </span>
                <h2 id="recent-projects-title">{t("workspace.projects")}</h2>
              </div>
              <span className={homeStyles.sectionCount}>
                {recentProjects.length}
              </span>
            </div>
            {recentProjects.length === 0 ? (
              <div className={homeStyles.empty}>
                <Icon name="lucide:frame" size={20} />
                <strong>{t("workspace.noRecentProjects")}</strong>
                <p>{t("workspace.noRecentProjectsDetail")}</p>
              </div>
            ) : (
              <div className={styles.recentProjects}>
                {recentProjects.map((project) => {
                  return (
                    <div
                      className={styles.recentProjectRow}
                      key={project.projectId}
                    >
                      <button
                        className={styles.recentProject}
                        disabled={busy}
                        onClick={() => onOpenRecentProject(project.projectId)}
                        type="button"
                      >
                        <span className={styles.recentProjectIcon}>
                          <Icon name="lucide:layers" size={16} />
                        </span>
                        <span>
                          <strong>{project.name}</strong>
                          <time dateTime={project.lastOpenedAt}>
                            {t("workspace.projectOpened", {
                              date: project.lastOpenedAt.slice(0, 10),
                            })}
                          </time>
                        </span>
                        <Icon name="lucide:chevron-right" size={14} />
                      </button>
                      <DropdownMenu
                        disabled={busy}
                        icon={<Icon name="lucide:ellipsis" size={15} />}
                        label={t("workspace.projectActions", {
                          name: project.name,
                        })}
                      >
                        <DropdownMenuItem
                          onSelect={() =>
                            onRevealRecentProject(project.projectId)
                          }
                        >
                          {t("workspace.revealProject")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className={styles.removeAction}
                          onSelect={() =>
                            setPendingRemovalId(project.projectId)
                          }
                        >
                          {t("workspace.removeProject")}
                        </DropdownMenuItem>
                      </DropdownMenu>
                      {pendingRemovalId === project.projectId && (
                        <div
                          aria-label={t("workspace.confirmRemoveProject", {
                            name: project.name,
                          })}
                          className={styles.recentProjectRemoval}
                          role="group"
                        >
                          <span>{t("workspace.removeProjectDescription")}</span>
                          <Button
                            disabled={removingProjectId !== null}
                            onClick={() => setPendingRemovalId(null)}
                            tone="quiet"
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button
                            disabled={removingProjectId !== null}
                            onClick={() => {
                              setRemovingProjectId(project.projectId);
                              void onRemoveRecentProject(
                                project.projectId,
                              ).then((removed) => {
                                setRemovingProjectId(null);
                                if (removed) setPendingRemovalId(null);
                              });
                            }}
                          >
                            {removingProjectId === project.projectId
                              ? t("workspace.removingProject")
                              : t("workspace.confirmRemove")}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section
            aria-labelledby="global-tasks-title"
            className={homeStyles.panel}
          >
            <div className={homeStyles.sectionHeading}>
              <div>
                <span className={homeStyles.sectionLabel}>
                  {t("workspace.acrossProjects")}
                </span>
                <h2 id="global-tasks-title">{t("workspace.globalTasks")}</h2>
              </div>
              <span className={homeStyles.sectionCount}>
                {t("workspace.taskCount", {
                  active: activeTaskCount,
                  total: globalTasks.length,
                })}
              </span>
            </div>
            {globalTasks.length === 0 ? (
              <div className={`${homeStyles.empty} ${homeStyles.emptyCompact}`}>
                <Icon name="lucide:bot" size={20} />
                <strong>{t("workspace.noAgentTasks")}</strong>
                <p>{t("workspace.noAgentTasksDetail")}</p>
              </div>
            ) : (
              <ul className={styles.taskList}>
                {globalTasks.map((task) => (
                  <li className={styles.taskRow} key={task.taskId}>
                    <span>
                      <strong>{task.title}</strong>
                      <small>{t(taskLifecycleLabels[task.lifecycle])}</small>
                    </span>
                    {onOpenGlobalTask && (
                      <Button
                        disabled={busy}
                        onClick={() => onOpenGlobalTask(task)}
                        tone="quiet"
                      >
                        {t("common.open")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <button
          className={styles.compatibilityLink}
          disabled={busy}
          onClick={onOpenDesignFile}
          type="button"
        >
          {t("workspace.openStandalone")}
        </button>
      </main>
    </div>
  );
}
