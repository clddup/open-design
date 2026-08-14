import { Glyph, type GlyphName } from "@opendesign/ui";
import { useI18n } from "../i18n";
import type { SidebarTab } from "../state/editor";
import styles from "./LeftSidebar.module.scss";

const views: readonly {
  tab: SidebarTab;
  icon: GlyphName;
  label:
    "sidebar.layers" | "sidebar.assets" | "styles.title" | "variables.title";
}[] = [
  { tab: "layers", icon: "layers", label: "sidebar.layers" },
  { tab: "assets", icon: "assets", label: "sidebar.assets" },
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
      {views.map((view) => (
        <button
          aria-controls={`sidebar-${view.tab}`}
          aria-selected={value === view.tab}
          id={`sidebar-${view.tab}-tab`}
          key={view.tab}
          onClick={() => onChange(view.tab)}
          role="tab"
          type="button"
        >
          <Glyph name={view.icon} />
          {t(view.label)}
        </button>
      ))}
    </div>
  );
}
