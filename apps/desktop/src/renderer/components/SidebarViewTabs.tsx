import { Glyph, IconButton, type GlyphName } from "@opendesign/ui";
import { useI18n } from "../i18n";
import type { SidebarTab } from "../state/editor";
import styles from "./LeftSidebar.module.scss";

const primaryViews: readonly {
  tab: SidebarTab;
  icon: GlyphName;
  label: "sidebar.layers" | "sidebar.assets";
}[] = [
  { tab: "layers", icon: "layers", label: "sidebar.layers" },
  { tab: "assets", icon: "assets", label: "sidebar.assets" },
];

const libraryViews: readonly {
  tab: SidebarTab;
  icon: GlyphName;
  label: "styles.title" | "variables.title";
}[] = [
  { tab: "styles", icon: "spark", label: "styles.title" },
  { tab: "variables", icon: "component", label: "variables.title" },
];

export function SidebarViewTabs({
  onChange,
  value,
}: {
  onChange: (tab: SidebarTab) => void;
  value: SidebarTab;
}) {
  const { t } = useI18n();
  return (
    <div aria-label={t("sidebar.views")} className={styles.tabs} role="tablist">
      <div className={styles.primaryTabs}>
        {primaryViews.map((view) => (
          <button
            aria-controls={`sidebar-${view.tab}`}
            aria-selected={value === view.tab}
            className={styles.primaryTab}
            id={`sidebar-${view.tab}-tab`}
            key={view.tab}
            onClick={() => onChange(view.tab)}
            role="tab"
            type="button"
          >
            <Glyph name={view.icon} />
            <span>{t(view.label)}</span>
          </button>
        ))}
      </div>
      <div className={styles.libraryTabs}>
        {libraryViews.map((view) => (
          <IconButton
            aria-controls={`sidebar-${view.tab}`}
            aria-selected={value === view.tab}
            icon={view.icon}
            id={`sidebar-${view.tab}-tab`}
            key={view.tab}
            label={t(view.label)}
            onClick={() => onChange(view.tab)}
            role="tab"
            selected={value === view.tab}
          />
        ))}
      </div>
    </div>
  );
}
