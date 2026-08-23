import type { BooleanOperation } from "@opendesign/design-contracts";
import type { LayerOrderAction } from "@opendesign/editor-runtime";
import {
  Divider,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Icon,
  IconButton,
  type IconName,
} from "@opendesign/ui";
import type { MessageKey } from "../../../../shared/i18n/messages";
import { useI18n } from "../../../i18n";
import type { Tool } from "../../../state/editor";
import styles from "./Toolbar.module.scss";

type ToolbarItem = {
  id: Tool;
  label: MessageKey;
  icon: IconName;
  shortcut?: string;
};

const tools: ToolbarItem[] = [
  {
    id: "select",
    label: "toolbar.select",
    icon: "lucide:mouse-pointer-2",
    shortcut: "V",
  },
  { id: "frame", label: "toolbar.frame", icon: "lucide:frame", shortcut: "F" },
  { id: "slice", label: "toolbar.slice", icon: "lucide:frame", shortcut: "S" },
  {
    id: "rectangle",
    label: "toolbar.rectangle",
    icon: "lucide:rectangle-horizontal",
    shortcut: "R",
  },
  {
    id: "ellipse",
    label: "toolbar.ellipse",
    icon: "lucide:circle",
    shortcut: "O",
  },
  { id: "line", label: "toolbar.line", icon: "lucide:slash", shortcut: "L" },
  {
    id: "arrow",
    label: "toolbar.arrow",
    icon: "lucide:arrow-up-right",
    shortcut: "Shift+L",
  },
  { id: "polygon", label: "toolbar.polygon", icon: "lucide:pentagon" },
  { id: "star", label: "toolbar.star", icon: "lucide:star" },
  {
    id: "pen",
    label: "toolbar.pen",
    icon: "lucide:pen",
    shortcut: "P",
  },
  { id: "text", label: "toolbar.text", icon: "lucide:type", shortcut: "T" },
];

export function Toolbar({
  tool,
  onToolChange,
  booleanOperation,
  canBooleanAction,
  hierarchyAction,
  canHierarchyAction,
  maskAction,
  canReorder,
  canDelete,
  canDuplicate,
  canUndo,
  canRedo,
  onDelete,
  onBooleanOperation,
  onDuplicate,
  onGroup,
  onToggleMask,
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
  maskAction: "create" | "remove" | null;
  canReorder: Readonly<Record<LayerOrderAction, boolean>>;
  canDelete: boolean;
  canDuplicate: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onDelete: () => void;
  onBooleanOperation: (operation: BooleanOperation) => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onToggleMask: () => void;
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
          mask: "⌃⌘M",
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
          mask: "Ctrl+Alt+M",
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
    <nav aria-label={t("toolbar.designTools")} className={styles.root}>
      <div
        className={styles.group}
        role="group"
        aria-label={t("toolbar.history")}
      >
        <IconButton
          disabled={!canUndo}
          icon="lucide:undo-2"
          label={t("toolbar.undo")}
          onClick={onUndo}
        />
        <IconButton
          disabled={!canRedo}
          icon="lucide:redo-2"
          label={t("toolbar.redo")}
          onClick={onRedo}
        />
      </div>
      <Divider />
      <div
        className={styles.group}
        role="group"
        aria-label={t("toolbar.selectionActions")}
      >
        <IconButton
          disabled={!canDuplicate}
          icon="lucide:copy"
          label={`${t("toolbar.duplicate")} (${shortcuts.duplicate})`}
          onClick={onDuplicate}
        />
        <IconButton
          disabled={!canHierarchyAction}
          icon="lucide:layers"
          label={hierarchyLabel}
          onClick={hierarchyAction === "ungroup" ? onUngroup : onGroup}
        />
        <DropdownMenu
          disabled={!canBooleanAction}
          icon={<Icon name="lucide:combine" />}
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
          disabled={
            maskAction === null &&
            !orderItems.some(({ action }) => canReorder[action])
          }
          icon={<Icon name="lucide:ellipsis" />}
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
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={maskAction === null}
            onSelect={onToggleMask}
            shortcut={shortcuts.mask}
          >
            {t(
              maskAction === "remove"
                ? "toolbar.removeMask"
                : "toolbar.useAsMask",
            )}
          </DropdownMenuItem>
        </DropdownMenu>
        <IconButton
          disabled={!canDelete}
          icon="lucide:trash-2"
          label={`${t("toolbar.delete")} (Delete)`}
          onClick={onDelete}
        />
      </div>
      <Divider />
      <div
        className={styles.group}
        role="group"
        aria-label={t("toolbar.canvasTools")}
      >
        {tools.map((item) => (
          <IconButton
            icon={item.icon}
            key={item.id}
            label={
              item.shortcut
                ? `${t(item.label)} (${item.shortcut})`
                : t(item.label)
            }
            onClick={() => onToolChange(item.id)}
            selected={tool === item.id}
          />
        ))}
      </div>
    </nav>
  );
}
