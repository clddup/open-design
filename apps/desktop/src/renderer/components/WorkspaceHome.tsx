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
import { WindowControls } from "./WindowControls";

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
    <div className="home-shell">
      <header className="home-titlebar" data-platform={platform}>
        <div aria-hidden="true" className="titlebar__native-safe-zone" />
        <div className="home-titlebar__brand">
          <span className="brand-mark">
            <Glyph name="spark" size={15} />
          </span>
          <strong>OpenDesign</strong>
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
      <main aria-labelledby="workspace-home-title" className="home-content">
        <section className="home-hero">
          <span className="home-eyebrow">{t("workspace.label")}</span>
          <h1 id="workspace-home-title">{t("workspace.title")}</h1>
          <p>{t("workspace.description")}</p>
          <div className="home-actions">
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
              className="home-create-project"
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
            <p className="home-error" role="alert">
              {error}
            </p>
          )}
        </section>

        <div className="home-grid">
          <section
            aria-labelledby="recent-projects-title"
            className="home-panel"
          >
            <div className="home-panel__heading">
              <div>
                <span>{t("workspace.label")}</span>
                <h2 id="recent-projects-title">
                  {t("workspace.recentProjects")}
                </h2>
              </div>
              <span>{recentProjects.length}</span>
            </div>
            {recentProjects.length === 0 ? (
              <div className="home-empty">
                <Glyph name="frame" size={20} />
                <strong>{t("workspace.noRecentProjects")}</strong>
                <p>{t("workspace.noRecentProjectsDetail")}</p>
              </div>
            ) : (
              <div className="recent-projects">
                {recentProjects.map((project) => (
                  <div className="recent-project-row" key={project.projectId}>
                    <button
                      className="recent-project"
                      disabled={busy}
                      onClick={() => onOpenRecentProject(project.projectId)}
                      type="button"
                    >
                      <span className="recent-project__icon">
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
                        className="recent-project-menu__remove"
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
                        className="recent-project-removal"
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

          <section aria-labelledby="global-tasks-title" className="home-panel">
            <div className="home-panel__heading">
              <div>
                <span>{t("workspace.acrossProjects")}</span>
                <h2 id="global-tasks-title">{t("workspace.globalTasks")}</h2>
              </div>
              <span>
                {t("workspace.taskCount", {
                  active: activeTaskCount,
                  total: globalTasks.length,
                })}
              </span>
            </div>
            {globalTasks.length === 0 ? (
              <div className="home-empty home-empty--compact">
                <Glyph name="agent" size={20} />
                <strong>{t("workspace.noAgentTasks")}</strong>
                <p>{t("workspace.noAgentTasksDetail")}</p>
              </div>
            ) : (
              <ul className="global-task-list">
                {globalTasks.map((task) => (
                  <li className="global-task-row" key={task.taskId}>
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
          className="home-compatibility-link"
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
