import type { BooleanOperation } from "@opendesign/design-contracts";
import type { FlipAxis, LayerOrderAction } from "@opendesign/editor-runtime";
import {
  Divider,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Icon,
  IconButton,
  type IconName,
} from "@opendesign/ui";
import { useEffect, useState } from "react";
import type { MessageKey } from "@/shared/i18n/messages";
import { useI18n } from "../../../i18n";
import type { Tool } from "../../../state/editor";
import styles from "./Toolbar.module.scss";

type ToolbarItem = {
  id: Tool;
  label: MessageKey;
  icon: IconName;
  shortcut?: string;
};

const selectionTool: ToolbarItem = {
  id: "select",
  label: "toolbar.select",
  icon: "lucide:mouse-pointer-2",
  shortcut: "V",
};

const frameTools: ToolbarItem[] = [
  { id: "frame", label: "toolbar.frame", icon: "lucide:frame", shortcut: "F" },
  { id: "slice", label: "toolbar.slice", icon: "lucide:frame", shortcut: "S" },
];

const shapeTools: ToolbarItem[] = [
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
];

const directCreationTools: ToolbarItem[] = [
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
  canFlip,
  canUndo,
  canRedo,
  onDelete,
  onBooleanOperation,
  onDuplicate,
  onFlip,
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
  canFlip: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onDelete: () => void;
  onBooleanOperation: (operation: BooleanOperation) => void;
  onDuplicate: () => void;
  onFlip: (axis: FlipAxis) => void;
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
          flipHorizontal: "⇧H",
          flipVertical: "⇧V",
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
          flipHorizontal: "Shift+H",
          flipVertical: "Shift+V",
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
            disabled={!canFlip}
            onSelect={() => onFlip("horizontal")}
            shortcut={shortcuts.flipHorizontal}
          >
            {t("toolbar.flipHorizontal")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canFlip}
            onSelect={() => onFlip("vertical")}
            shortcut={shortcuts.flipVertical}
          >
            {t("toolbar.flipVertical")}
          </DropdownMenuItem>
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
        <ToolButton
          item={selectionTool}
          onToolChange={onToolChange}
          tool={tool}
        />
        <ToolPicker
          defaultTool="frame"
          items={frameTools}
          label={t("toolbar.frameTools")}
          onToolChange={onToolChange}
          tool={tool}
        />
        <ToolPicker
          defaultTool="rectangle"
          items={shapeTools}
          label={t("toolbar.shapeTools")}
          onToolChange={onToolChange}
          tool={tool}
        />
        {directCreationTools.map((item) => (
          <ToolButton
            item={item}
            key={item.id}
            onToolChange={onToolChange}
            tool={tool}
          />
        ))}
      </div>
    </nav>
  );
}

function ToolButton({
  item,
  onToolChange,
  tool,
}: {
  item: ToolbarItem;
  onToolChange: (tool: Tool) => void;
  tool: Tool;
}) {
  const { t } = useI18n();
  return (
    <IconButton
      icon={item.icon}
      label={toolLabel(item, t)}
      onClick={() => onToolChange(item.id)}
      selected={tool === item.id}
    />
  );
}

function ToolPicker({
  defaultTool,
  items,
  label,
  onToolChange,
  tool,
}: {
  defaultTool: Tool;
  items: readonly ToolbarItem[];
  label: string;
  onToolChange: (tool: Tool) => void;
  tool: Tool;
}) {
  const { t } = useI18n();
  const activeItem = items.find((item) => item.id === tool);
  const [recentTool, setRecentTool] = useState<Tool>(defaultTool);

  useEffect(() => {
    if (activeItem) setRecentTool(activeItem.id);
  }, [activeItem]);

  const recentItem = items.find((item) => item.id === recentTool) ?? items[0];
  if (!recentItem) return null;

  const selectTool = (item: ToolbarItem) => {
    setRecentTool(item.id);
    onToolChange(item.id);
  };

  return (
    <div aria-label={label} className={styles.toolPicker} role="group">
      <IconButton
        icon={recentItem.icon}
        label={toolLabel(recentItem, t)}
        onClick={() => selectTool(recentItem)}
        selected={Boolean(activeItem)}
      />
      <DropdownMenu
        contentProps={{ align: "start", alignOffset: -24 }}
        icon={<Icon name="lucide:chevron-down" size={11} />}
        label={label}
      >
        {items.map((item) => (
          <DropdownMenuItem
            icon={<Icon name={item.icon} />}
            key={item.id}
            onSelect={() => selectTool(item)}
            shortcut={item.shortcut}
          >
            {t(item.label)}
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </div>
  );
}

function toolLabel(
  item: ToolbarItem,
  t: ReturnType<typeof useI18n>["t"],
): string {
  return item.shortcut ? `${t(item.label)} (${item.shortcut})` : t(item.label);
}
