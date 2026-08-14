import type { NodeKind } from "@opendesign/design-contracts";
import type { MessageKey } from "../../shared/i18n/messages";
import { useI18n } from "../i18n";
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
  onZoomChange,
  revision,
  selection,
  zoom,
}: {
  dirty: boolean;
  error: string | null;
  onFitPage: () => void;
  onFitSelection: () => void;
  onZoomChange: (zoom: number) => void;
  revision: number;
  selection: StatusbarSelection;
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
