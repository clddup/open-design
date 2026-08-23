import type { LayerOrderAction } from "@opendesign/editor-runtime";
import { Icon, IconButton } from "@opendesign/ui";
import { useI18n } from "../../../i18n";
import styles from "./CanvasSelectionActions.module.scss";

export function CanvasSelectionActions({
  canDelete,
  canDuplicate,
  canHierarchyAction,
  canReorder,
  count,
  hierarchyAction,
  name,
  onDelete,
  onDuplicate,
  onGroup,
  onOpenProperties,
  onReorder,
  onUngroup,
  platform,
}: {
  canDelete: boolean;
  canDuplicate: boolean;
  canHierarchyAction: boolean;
  canReorder: Readonly<Record<LayerOrderAction, boolean>>;
  count: number;
  hierarchyAction: "group" | "ungroup";
  name?: string;
  onDelete: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onOpenProperties: () => void;
  onReorder: (action: LayerOrderAction) => void;
  onUngroup: () => void;
  platform: NodeJS.Platform;
}) {
  const { t } = useI18n();
  const modifier = platform === "darwin" ? "⌘" : "Ctrl+";
  return (
    <div
      aria-label={t("canvas.selectionActions")}
      className={styles.root}
      role="toolbar"
    >
      <span className={styles.selection} title={name}>
        <Icon name="lucide:mouse-pointer-2" size={14} />
        <span>
          {count === 1 && name
            ? name
            : t("properties.layersSelected", { count })}
        </span>
      </span>
      <span aria-hidden="true" className={styles.divider} />
      <IconButton
        disabled={!canDuplicate}
        icon="lucide:copy"
        label={t("canvas.duplicateSelection", { shortcut: `${modifier}D` })}
        onClick={onDuplicate}
      />
      <IconButton
        disabled={!canHierarchyAction}
        icon="lucide:layers"
        label={t(
          hierarchyAction === "ungroup"
            ? "canvas.ungroupSelection"
            : "canvas.groupSelection",
        )}
        onClick={hierarchyAction === "ungroup" ? onUngroup : onGroup}
      />
      <button
        aria-label={t("canvas.bringForward")}
        className={styles.orderAction}
        disabled={!canReorder["bring-forward"]}
        onClick={() => onReorder("bring-forward")}
        type="button"
      >
        ↑
      </button>
      <button
        aria-label={t("canvas.sendBackward")}
        className={styles.orderAction}
        disabled={!canReorder["send-backward"]}
        onClick={() => onReorder("send-backward")}
        type="button"
      >
        ↓
      </button>
      <span aria-hidden="true" className={styles.divider} />
      <IconButton
        icon="lucide:settings-2"
        label={t("canvas.openProperties")}
        onClick={onOpenProperties}
      />
      <IconButton
        className={styles.deleteAction}
        disabled={!canDelete}
        icon="lucide:trash-2"
        label={t("canvas.deleteSelection")}
        onClick={onDelete}
      />
    </div>
  );
}
