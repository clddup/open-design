import { Glyph, type GlyphName } from "@opendesign/ui";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import type { SidebarTab } from "../state/editor";
import styles from "./LeftSidebar.module.scss";

const primaryViews: readonly {
  tab: "layers" | "assets" | "library";
  icon: GlyphName;
  label: "sidebar.layers" | "sidebar.assets" | "sidebar.library";
}[] = [
  { tab: "layers", icon: "layers", label: "sidebar.layers" },
  { tab: "assets", icon: "assets", label: "sidebar.assets" },
  { tab: "library", icon: "component", label: "sidebar.library" },
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
  const libraryActive = value === "styles" || value === "variables";
  const lastLibraryView = useRef<"styles" | "variables">("styles");
  useEffect(() => {
    if (value === "styles" || value === "variables") {
      lastLibraryView.current = value;
    }
  }, [value]);
  return (
    <div className={styles.viewNavigation}>
      <div
        aria-label={t("sidebar.views")}
        className={styles.tabs}
        role="tablist"
      >
        {primaryViews.map((view) => (
          <button
            aria-controls={
              view.tab === "library" ? "sidebar-library" : `sidebar-${view.tab}`
            }
            aria-selected={
              view.tab === "library" ? libraryActive : value === view.tab
            }
            className={styles.primaryTab}
            id={`sidebar-${view.tab}-tab`}
            key={view.tab}
            onClick={() =>
              onChange(
                view.tab === "library" ? lastLibraryView.current : view.tab,
              )
            }
            role="tab"
            type="button"
          >
            <Glyph name={view.icon} />
            <span>{t(view.label)}</span>
          </button>
        ))}
      </div>
      {libraryActive && (
        <div
          aria-label={t("sidebar.libraryViews")}
          className={styles.libraryTabs}
          role="group"
        >
          {libraryViews.map((view) => (
            <button
              aria-pressed={value === view.tab}
              key={view.tab}
              onClick={() => onChange(view.tab)}
              type="button"
            >
              <Glyph name={view.icon} size={13} />
              <span>{t(view.label)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
