import type { NodeKind } from "@opendesign/design-contracts";
import { DropdownMenu, DropdownMenuItem, Icon } from "@opendesign/ui";
import type { MessageKey } from "@/shared/i18n/messages";
import { useI18n } from "../../../i18n";
import styles from "./Statusbar.module.scss";

const nodeKindKeys: Record<NodeKind, MessageKey> = {
  boolean: "node.boolean",
  ellipse: "node.ellipse",
  frame: "node.frame",
  slot: "node.slot",
  group: "node.group",
  image: "node.image",
  instance: "node.instance",
  line: "node.line",
  path: "node.path",
  polygon: "node.polygon",
  rectangle: "node.rectangle",
  slice: "node.slice",
  star: "node.star",
  text: "node.text",
  vector: "node.vector",
};

export type StatusbarSelection = {
  count: number;
  node?: { kind: NodeKind; name: string };
};

export function Statusbar({
  dirty,
  error,
  onFitPage,
  onFitSelection,
  onToggleRulers,
  onToggleSnapObjects,
  onToggleSnapPixelGrid,
  onZoomChange,
  revision,
  selection,
  rulersVisible,
  snapObjects,
  snapPixelGrid,
  zoom,
}: {
  dirty: boolean;
  error: string | null;
  onFitPage: () => void;
  onFitSelection: () => void;
  onToggleRulers: () => void;
  onToggleSnapObjects: () => void;
  onToggleSnapPixelGrid: () => void;
  onZoomChange: (zoom: number) => void;
  revision: number;
  selection: StatusbarSelection;
  rulersVisible: boolean;
  snapObjects: boolean;
  snapPixelGrid: boolean;
  zoom: number;
}) {
  const { t } = useI18n();
  const selectionSummary = selection.node
    ? t("status.selectedNode", {
        name: selection.node.name,
        kind: t(nodeKindKeys[selection.node.kind]),
      })
    : selection.count > 1
      ? t("status.layersSelected", { count: selection.count })
      : t("status.revision", { revision });

  return (
    <footer className={styles.root}>
      <span className={error ? styles.error : undefined} role="status">
        <span aria-hidden="true" className={styles.indicator} />
        {error ?? (dirty ? t("title.unsaved") : t("status.allSaved"))}
      </span>
      <span className={styles.center}>{selectionSummary}</span>
      <span>
        <DropdownMenu
          contentProps={{ side: "top" }}
          icon={<Icon name="lucide:sliders-horizontal" />}
          label={t("status.viewOptions")}
        >
          <DropdownMenuItem
            icon={rulersVisible ? <Icon name="lucide:check" /> : undefined}
            onSelect={onToggleRulers}
            shortcut="Shift+R"
          >
            {t("status.rulers")}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={snapObjects ? <Icon name="lucide:check" /> : undefined}
            onSelect={onToggleSnapObjects}
          >
            {t("status.snapToObjects")}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={snapPixelGrid ? <Icon name="lucide:check" /> : undefined}
            onSelect={onToggleSnapPixelGrid}
          >
            {t("status.snapToPixelGrid")}
          </DropdownMenuItem>
        </DropdownMenu>
        {t("status.canvas")}{" "}
        <button aria-label={t("status.fitPage")} onClick={onFitPage}>
          {t("status.fit")}
        </button>
        {selection.count > 0 && (
          <button
            aria-label={t("status.fitSelection")}
            onClick={onFitSelection}
          >
            {t("status.selection")}
          </button>
        )}
        <button
          aria-label={t("status.zoomOut")}
          onClick={() => onZoomChange(zoom * 0.9)}
        >
          −
        </button>
        <button
          aria-label={t("status.zoomReset")}
          className={styles.zoomValue}
          onClick={() => onZoomChange(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          aria-label={t("status.zoomIn")}
          onClick={() => onZoomChange(zoom * 1.1)}
        >
          +
        </button>
      </span>
    </footer>
  );
}
