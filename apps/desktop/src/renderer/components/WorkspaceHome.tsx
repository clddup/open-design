import type {
  GlobalTaskLifecycle,
  GlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Glyph,
  IconButton,
} from "@opendesign/ui";
import { useState } from "react";
import type { RecentProject, ThemePreference } from "../../shared/desktop-api";
import type { MessageKey } from "../../shared/i18n/messages";
import { useI18n } from "../i18n";
import { HomeTitlebar } from "./HomeTitlebar";
import homeStyles from "./HomeSurface.module.scss";
import styles from "./WorkspaceHome.module.scss";

export type WorkspaceHomeProps = {
  busy: boolean;
  error: string | null;
  globalTasks: GlobalTaskProjection[];
  platform: NodeJS.Platform;
  recentProjects: readonly RecentProject[];
  theme: ThemePreference;
  onCreateProject: (name: string) => Promise<boolean>;
  onOpenDesignFile: () => void;
  onOpenGlobalTask?: (task: GlobalTaskProjection) => void;
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
};

export function WorkspaceHome({
  busy,
  error,
  globalTasks,
  platform,
  recentProjects,
  theme,
  onCreateProject,
  onOpenDesignFile,
  onOpenGlobalTask,
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
              icon="plus"
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
            aria-labelledby="recent-projects-title"
            className={homeStyles.panel}
          >
            <div className={homeStyles.sectionHeading}>
              <div>
                <span className={homeStyles.sectionLabel}>
                  {t("workspace.label")}
                </span>
                <h2 id="recent-projects-title">
                  {t("workspace.recentProjects")}
                </h2>
              </div>
              <span className={homeStyles.sectionCount}>
                {recentProjects.length}
              </span>
            </div>
            {recentProjects.length === 0 ? (
              <div className={homeStyles.empty}>
                <Glyph name="frame" size={20} />
                <strong>{t("workspace.noRecentProjects")}</strong>
                <p>{t("workspace.noRecentProjectsDetail")}</p>
              </div>
            ) : (
              <div className={styles.recentProjects}>
                {recentProjects.map((project) => (
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
                        <Glyph name="layers" size={16} />
                      </span>
                      <span>
                        <strong>{project.name}</strong>
                        <time dateTime={project.lastOpenedAt}>
                          {t("workspace.projectOpened", {
                            date: project.lastOpenedAt.slice(0, 10),
                          })}
                        </time>
                      </span>
                      <Glyph name="chevron-right" size={14} />
                    </button>
                    <DropdownMenu
                      disabled={busy}
                      icon={<Glyph name="more" size={15} />}
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
                        onSelect={() => setPendingRemovalId(project.projectId)}
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
                            void onRemoveRecentProject(project.projectId).then(
                              (removed) => {
                                setRemovingProjectId(null);
                                if (removed) setPendingRemovalId(null);
                              },
                            );
                          }}
                        >
                          {removingProjectId === project.projectId
                            ? t("workspace.removingProject")
                            : t("workspace.confirmRemove")}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
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
                <Glyph name="agent" size={20} />
                <strong>{t("workspace.noAgentTasks")}</strong>
                <p>{t("workspace.noAgentTasksDetail")}</p>
              </div>
            ) : (
              <ul className={styles.taskList}>
                {globalTasks.map((task) => (
                  <li className={styles.taskRow} key={task.taskId}>
                    <span>
                      <strong>{task.title}</strong>
                      <small>
                        {t(taskLifecycleLabels[task.lifecycle])}
                        {task.delivery
                          ? ` · ${t("agent.deliveryCount", {
                              completed: task.delivery.targets.filter(
                                (target) => target.status === "verified",
                              ).length,
                              total: task.delivery.targets.length,
                            })}`
                          : ""}
                      </small>
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
