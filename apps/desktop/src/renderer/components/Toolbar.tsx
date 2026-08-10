import type { BooleanOperation } from "@opendesign/design-contracts";
import type { LayerOrderAction } from "@opendesign/editor-runtime";
import {
  Divider,
  DropdownMenu,
  DropdownMenuItem,
  Glyph,
  IconButton,
  type GlyphName,
} from "@opendesign/ui";
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
  booleanOperation,
  canBooleanAction,
  hierarchyAction,
  canHierarchyAction,
  canReorder,
  canDelete,
  canDuplicate,
  canUndo,
  canRedo,
  onDelete,
  onBooleanOperation,
  onDuplicate,
  onGroup,
  onReorder,
  onUndo,
  onUngroup,
  onRedo,
  platform,
}: {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  booleanOperation: BooleanOperation | null;
  canBooleanAction: boolean;
  hierarchyAction: "group" | "ungroup";
  canHierarchyAction: boolean;
  canReorder: Readonly<Record<LayerOrderAction, boolean>>;
  canDelete: boolean;
  canDuplicate: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onDelete: () => void;
  onBooleanOperation: (operation: BooleanOperation) => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onReorder: (action: LayerOrderAction) => void;
  onUndo: () => void;
  onUngroup: () => void;
  onRedo: () => void;
  platform: NodeJS.Platform;
}) {
  const { t } = useI18n();
  const shortcuts =
    platform === "darwin"
      ? {
          duplicate: "⌘D",
          group: "⌘G",
          ungroup: "⇧⌘G",
          "bring-forward": "⌘]",
          "bring-to-front": "⌥⌘]",
          "send-backward": "⌘[",
          "send-to-back": "⌥⌘[",
          union: "⌥⇧U",
          subtract: "⌥⇧S",
          intersect: "⌥⇧I",
          exclude: "⌥⇧E",
        }
      : {
          duplicate: "Ctrl+D",
          group: "Ctrl+G",
          ungroup: "Ctrl+Shift+G",
          "bring-forward": "Ctrl+]",
          "bring-to-front": "Ctrl+Shift+]",
          "send-backward": "Ctrl+[",
          "send-to-back": "Ctrl+Shift+[",
          union: "Alt+Shift+U",
          subtract: "Alt+Shift+S",
          intersect: "Alt+Shift+I",
          exclude: "Alt+Shift+E",
        };
  const orderItems: ReadonlyArray<{
    action: LayerOrderAction;
    label: MessageKey;
  }> = [
    { action: "bring-forward", label: "toolbar.bringForward" },
    { action: "bring-to-front", label: "toolbar.bringToFront" },
    { action: "send-backward", label: "toolbar.sendBackward" },
    { action: "send-to-back", label: "toolbar.sendToBack" },
  ];
  const hierarchyLabel =
    hierarchyAction === "ungroup"
      ? `${t("toolbar.ungroup")} (${shortcuts.ungroup})`
      : `${t("toolbar.group")} (${shortcuts.group})`;
  const booleanItems: ReadonlyArray<{
    operation: BooleanOperation;
    label: MessageKey;
  }> = [
    { operation: "union", label: "properties.booleanUnion" },
    { operation: "subtract", label: "properties.booleanSubtract" },
    { operation: "intersect", label: "properties.booleanIntersect" },
    { operation: "exclude", label: "properties.booleanExclude" },
  ];
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
          label={`${t("toolbar.duplicate")} (${shortcuts.duplicate})`}
          onClick={onDuplicate}
        />
        <IconButton
          disabled={!canHierarchyAction}
          icon="layers"
          label={hierarchyLabel}
          onClick={hierarchyAction === "ungroup" ? onUngroup : onGroup}
        />
        <DropdownMenu
          disabled={!canBooleanAction}
          icon={<Glyph name="boolean" />}
          label={t("toolbar.booleanOperations")}
        >
          {booleanItems.map(({ operation, label }) => (
            <DropdownMenuItem
              disabled={booleanOperation === operation}
              key={operation}
              onSelect={() => onBooleanOperation(operation)}
              shortcut={shortcuts[operation]}
            >
              {t(label)}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
        <DropdownMenu
          disabled={!orderItems.some(({ action }) => canReorder[action])}
          icon={<Glyph name="more" />}
          label={t("toolbar.layerOrder")}
        >
          {orderItems.map(({ action, label }) => (
            <DropdownMenuItem
              disabled={!canReorder[action]}
              key={action}
              onSelect={() => onReorder(action)}
              shortcut={shortcuts[action]}
            >
              {t(label)}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
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
