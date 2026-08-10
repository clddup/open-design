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
  onSave,
  onSaveAs,
  onWorkspace,
  onProject,
  onSettings,
}: {
  theme: ThemePreference;
  platform: NodeJS.Platform;
  projectName?: string;
  documentName: string;
  pageName?: string;
  dirty: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  onOpen?: () => void;
  onSave: () => void;
  onSaveAs?: () => void;
  onWorkspace: () => void;
  onProject?: () => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <header className="titlebar" data-platform={platform}>
      <div aria-hidden="true" className="titlebar__native-safe-zone" />
      <div className="titlebar__project">
        <button
          aria-label={t("title.workspaceHome")}
          className="brand-mark no-drag"
          onClick={onWorkspace}
          type="button"
        >
          <Glyph name="spark" size={15} />
        </button>
        {projectName && (
          <>
            <button
              className="titlebar__breadcrumb no-drag"
              onClick={onProject}
              type="button"
            >
              {projectName}
            </button>
            <Glyph name="chevron-right" size={12} />
          </>
        )}
        <span className="titlebar__file" title={documentName}>
          {documentName}
        </span>
        {pageName && (
          <>
            <Glyph name="chevron-right" size={12} />
            <span className="titlebar__page">{pageName}</span>
          </>
        )}
        <span className="titlebar__status" role="status">
          {dirty ? t("title.unsaved") : t("title.saved")}
        </span>
      </div>
      <div className="titlebar__actions no-drag">
        <Button onClick={onSave} tone="quiet">
          {t("common.save")}
        </Button>
        {(onOpen || onSaveAs) && (
          <DropdownMenu
            icon={<Glyph name="more" />}
            label={t("title.fileActions")}
          >
            {onOpen && (
              <DropdownMenuItem onSelect={onOpen}>
                {t("title.openFile")}
              </DropdownMenuItem>
            )}
            {onOpen && onSaveAs && <DropdownMenuSeparator />}
            {onSaveAs && (
              <DropdownMenuItem onSelect={onSaveAs}>
                {t("title.saveAs")}
              </DropdownMenuItem>
            )}
          </DropdownMenu>
        )}
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
  );
}
