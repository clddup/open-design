import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Glyph,
  IconButton,
} from "@opendesign/ui";
import type { ThemePreference } from "../../shared/desktop-api";
import { useI18n } from "../i18n";
import styles from "./Titlebar.module.scss";
import { WindowControls } from "./WindowControls";

export function Titlebar({
  theme,
  platform,
  projectName,
  documentName,
  pageName,
  dirty,
  onThemeChange,
  onOpen,
  onImportSvg,
  onSave,
  onSaveAs,
  onExportSvg,
  canExportSvg,
  svgBusy,
  onWorkspace,
  onProject,
  onSettings,
  leftPanelVisible,
  utilityPanelVisible,
  onToggleLeftPanel,
  onToggleUtilityPanel,
}: {
  theme: ThemePreference;
  platform: NodeJS.Platform;
  projectName?: string;
  documentName: string;
  pageName?: string;
  dirty: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  onOpen?: () => void;
  onImportSvg: () => void;
  onSave: () => void;
  onSaveAs?: () => void;
  onExportSvg: () => void;
  canExportSvg: boolean;
  svgBusy: boolean;
  onWorkspace: () => void;
  onProject?: () => void;
  onSettings: () => void;
  leftPanelVisible?: boolean;
  utilityPanelVisible?: boolean;
  onToggleLeftPanel?: () => void;
  onToggleUtilityPanel?: () => void;
}) {
  const { t } = useI18n();
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <header className={styles.root} data-platform={platform}>
      <div aria-hidden="true" className={styles.nativeSafeZone} />
      <div className={styles.project}>
        <button
          aria-label={t("title.workspaceHome")}
          className={`${styles.brandMark} no-drag`}
          onClick={onWorkspace}
          type="button"
        >
          <Glyph name="spark" size={15} />
        </button>
        {projectName && (
          <>
            <button
              className={`${styles.breadcrumb} no-drag`}
              onClick={onProject}
              type="button"
            >
              {projectName}
            </button>
            <Glyph name="chevron-right" size={12} />
          </>
        )}
        <span className={styles.file} title={documentName}>
          {documentName}
        </span>
        {pageName && (
          <>
            <Glyph name="chevron-right" size={12} />
            <span className={styles.page}>{pageName}</span>
          </>
        )}
        <span className={styles.status} role="status">
          {dirty ? t("title.unsaved") : t("title.saved")}
        </span>
      </div>
      <div className={`${styles.actions} no-drag`}>
        {(onToggleLeftPanel || onToggleUtilityPanel) && (
          <span className={styles.panelActions}>
            {onToggleLeftPanel && (
              <IconButton
                icon="layers"
                label={t("title.toggleNavigator")}
                onClick={onToggleLeftPanel}
                selected={leftPanelVisible}
              />
            )}
            {onToggleUtilityPanel && (
              <IconButton
                icon="agent"
                label={t("title.toggleUtility")}
                onClick={onToggleUtilityPanel}
                selected={utilityPanelVisible}
              />
            )}
          </span>
        )}
        <Button onClick={onSave} tone="quiet">
          {t("common.save")}
        </Button>
        <DropdownMenu
          icon={<Glyph name="more" />}
          label={t("title.fileActions")}
        >
          {onOpen && (
            <DropdownMenuItem onSelect={onOpen}>
              {t("title.openFile")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={svgBusy} onSelect={onImportSvg}>
            {t("title.importSvg")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {onSaveAs && (
            <DropdownMenuItem onSelect={onSaveAs}>
              {t("title.saveAs")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={svgBusy || !canExportSvg}
            onSelect={onExportSvg}
            shortcut={platform === "darwin" ? "⇧⌘E" : "Ctrl+Shift+E"}
          >
            {t("title.exportSvgSelection")}
          </DropdownMenuItem>
        </DropdownMenu>
        <IconButton
          icon="settings"
          label={t("settings.open")}
          onClick={onSettings}
        />
        <IconButton
          icon={theme === "dark" ? "sun" : "moon"}
          label={t(nextTheme === "dark" ? "theme.useDark" : "theme.useLight")}
          onClick={() => onThemeChange(nextTheme)}
        />
        {platform !== "darwin" && <WindowControls />}
      </div>
    </header>
  );
}
