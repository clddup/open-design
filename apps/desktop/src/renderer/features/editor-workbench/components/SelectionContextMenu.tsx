import type { FlipAxis, LayerOrderAction } from "@opendesign/editor-runtime";
import {
  ContextMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@opendesign/ui";
import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";

export type SelectionContextMenuActions = {
  canDelete: boolean;
  canDuplicate: boolean;
  canFlip: boolean;
  canGroup: boolean;
  canReorder: Readonly<Record<LayerOrderAction, boolean>>;
  canSplitVector: boolean;
  canUngroup: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onFlip: (axis: FlipAxis) => void;
  onGroup: () => void;
  onReorder: (action: LayerOrderAction) => void;
  onSplitVector: () => void;
  onUngroup: () => void;
  platform: NodeJS.Platform;
  splitVectorRelevant: boolean;
};

export function SelectionContextMenu({
  actions,
  onOpen,
  trigger,
}: {
  actions: SelectionContextMenuActions;
  onOpen?: () => void;
  trigger: ReactElement;
}) {
  const { t } = useI18n();
  const shortcut = actions.platform === "darwin" ? "⇧" : "Shift+";
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
      trigger={trigger}
    >
      <DropdownMenuItem
        disabled={!actions.canDuplicate}
        onSelect={actions.onDuplicate}
        shortcut={actions.platform === "darwin" ? "⌘D" : "Ctrl+D"}
      >
        {t("toolbar.duplicate")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!actions.canGroup && !actions.canUngroup}
        onSelect={actions.canUngroup ? actions.onUngroup : actions.onGroup}
      >
        {t(actions.canUngroup ? "toolbar.ungroup" : "toolbar.group")}
      </DropdownMenuItem>
      {actions.splitVectorRelevant ? (
        <DropdownMenuItem
          disabled={!actions.canSplitVector}
          onSelect={actions.onSplitVector}
        >
          {t("toolbar.splitVector")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={!actions.canFlip}
        onSelect={() => actions.onFlip("horizontal")}
        shortcut={`${shortcut}H`}
      >
        {t("toolbar.flipHorizontal")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!actions.canFlip}
        onSelect={() => actions.onFlip("vertical")}
        shortcut={`${shortcut}V`}
      >
        {t("toolbar.flipVertical")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={!actions.canReorder["bring-forward"]}
        onSelect={() => actions.onReorder("bring-forward")}
      >
        {t("toolbar.bringForward")}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!actions.canReorder["send-backward"]}
        onSelect={() => actions.onReorder("send-backward")}
      >
        {t("toolbar.sendBackward")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={!actions.canDelete}
        onSelect={actions.onDelete}
      >
        {t("toolbar.delete")}
      </DropdownMenuItem>
    </ContextMenu>
  );
}
