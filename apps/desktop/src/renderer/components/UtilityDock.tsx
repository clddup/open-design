import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../i18n";

export type UtilityDockTab = "agent" | "properties";

const tabs: readonly UtilityDockTab[] = ["agent", "properties"];

export function UtilityDock({
  activeTab,
  agent,
  agentRunning,
  onTabChange,
  properties,
}: {
  activeTab: UtilityDockTab;
  agent: ReactNode;
  agentRunning: boolean;
  onTabChange: (tab: UtilityDockTab) => void;
  properties: ReactNode;
}) {
  const { t } = useI18n();
  const agentTab = useRef<HTMLButtonElement>(null);
  const propertiesTab = useRef<HTMLButtonElement>(null);
  const activityLabel = agentRunning ? t("utility.requestProgress") : null;

  const activateTab = (tab: UtilityDockTab) => {
    onTabChange(tab);
    (tab === "agent" ? agentTab : propertiesTab).current?.focus();
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: UtilityDockTab,
  ) => {
    const index = tabs.indexOf(tab);
    let next: UtilityDockTab | undefined;
    if (event.key === "ArrowLeft") {
      next = tabs[(index - 1 + tabs.length) % tabs.length];
    } else if (event.key === "ArrowRight") {
      next = tabs[(index + 1) % tabs.length];
    } else if (event.key === "Home") {
      next = tabs[0];
    } else if (event.key === "End") {
      next = tabs[tabs.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    activateTab(next);
  };

  return (
    <aside aria-label={t("utility.dock")} className="utility-dock">
      <div
        aria-label={t("utility.views")}
        className="utility-dock__tabs"
        role="tablist"
      >
        <button
          aria-controls="utility-agent-panel"
          aria-describedby={
            activityLabel ? "utility-agent-activity" : undefined
          }
          aria-selected={activeTab === "agent"}
          id="utility-agent-tab"
          onClick={() => onTabChange("agent")}
          onKeyDown={(event) => handleTabKeyDown(event, "agent")}
          ref={agentTab}
          role="tab"
          tabIndex={activeTab === "agent" ? 0 : -1}
          type="button"
        >
          {t("utility.agent")}
          {activityLabel && (
            <span
              aria-hidden="true"
              className={`utility-dock__activity-badge${agentRunning ? " is-running" : ""}`}
            />
          )}
        </button>
        <button
          aria-controls="utility-properties-panel"
          aria-selected={activeTab === "properties"}
          id="utility-properties-tab"
          onClick={() => onTabChange("properties")}
          onKeyDown={(event) => handleTabKeyDown(event, "properties")}
          ref={propertiesTab}
          role="tab"
          tabIndex={activeTab === "properties" ? 0 : -1}
          type="button"
        >
          {t("utility.properties")}
        </button>
      </div>
      {activityLabel && (
        <span className="visually-hidden" id="utility-agent-activity">
          {activityLabel}
        </span>
      )}
      <div className="utility-dock__panels">
        <div
          aria-labelledby="utility-agent-tab"
          className="utility-dock__panel"
          hidden={activeTab !== "agent"}
          id="utility-agent-panel"
          role="tabpanel"
        >
          {agent}
        </div>
        <div
          aria-labelledby="utility-properties-tab"
          className="utility-dock__panel"
          hidden={activeTab !== "properties"}
          id="utility-properties-panel"
          role="tabpanel"
        >
          {properties}
        </div>
      </div>
    </aside>
  );
}
