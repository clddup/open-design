import { Divider, IconButton, type GlyphName } from "@opendesign/ui";
import type { MessageKey } from "../../shared/i18n/messages";
import { useI18n } from "../i18n";
import type { Tool } from "../state/editor";

type ToolbarItem = {
  id: Tool | "pen";
  label: MessageKey;
  icon: GlyphName;
  shortcut: string;
  disabled?: boolean;
};

const tools: ToolbarItem[] = [
  { id: "select", label: "toolbar.select", icon: "select", shortcut: "V" },
  { id: "frame", label: "toolbar.frame", icon: "frame", shortcut: "F" },
  {
    id: "rectangle",
    label: "toolbar.rectangle",
    icon: "rectangle",
    shortcut: "R",
  },
  { id: "ellipse", label: "toolbar.ellipse", icon: "ellipse", shortcut: "O" },
  {
    id: "pen",
    label: "toolbar.penUnavailable",
    icon: "pen",
    shortcut: "P",
    disabled: true,
  },
  { id: "text", label: "toolbar.text", icon: "text", shortcut: "T" },
];

export function Toolbar({
  tool,
  onToolChange,
  canDelete,
  canDuplicate,
  canUndo,
  canRedo,
  onDelete,
  onDuplicate,
  onUndo,
  onRedo,
}: {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  canDelete: boolean;
  canDuplicate: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("toolbar.designTools")} className="toolbar">
      <div
        className="toolbar__group"
        role="group"
        aria-label={t("toolbar.history")}
      >
        <IconButton
          disabled={!canUndo}
          icon="undo"
          label={t("toolbar.undo")}
          onClick={onUndo}
        />
        <IconButton
          disabled={!canRedo}
          icon="redo"
          label={t("toolbar.redo")}
          onClick={onRedo}
        />
      </div>
      <Divider />
      <div
        className="toolbar__group"
        role="group"
        aria-label={t("toolbar.selectionActions")}
      >
        <IconButton
          disabled={!canDuplicate}
          icon="duplicate"
          label={`${t("toolbar.duplicate")} (⌘D)`}
          onClick={onDuplicate}
        />
        <IconButton
          disabled={!canDelete}
          icon="trash"
          label={`${t("toolbar.delete")} (Delete)`}
          onClick={onDelete}
        />
      </div>
      <Divider />
      <div
        className="toolbar__group"
        role="group"
        aria-label={t("toolbar.canvasTools")}
      >
        {tools.map((item) => (
          <IconButton
            disabled={item.disabled}
            icon={item.icon}
            key={item.id}
            label={`${t(item.label)} (${item.shortcut})`}
            onClick={() => {
              if (item.id !== "pen") onToolChange(item.id);
            }}
            selected={item.id !== "pen" && tool === item.id}
          />
        ))}
      </div>
    </nav>
  );
}
