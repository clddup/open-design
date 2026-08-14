import type {
  DesignDocument,
  DesignNode,
  SharedStyleDefinition,
  SharedStyleType,
  StyleReferenceTarget,
} from "@opendesign/design-contracts";
import { Glyph, IconButton } from "@opendesign/ui";
import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { StyleActions } from "../use-style-actions";
import styles from "./LocalStylesPanel.module.scss";

export type LocalStylesPanelActions = StyleActions;

const styleTypes: readonly SharedStyleType[] = [
  "PAINT",
  "TEXT",
  "EFFECT",
  "GRID",
];

export function LocalStylesPanel({
  actions,
  document,
  selectedNodeIds,
}: {
  actions: LocalStylesPanelActions;
  document: DesignDocument;
  selectedNodeIds: readonly string[];
}) {
  const { t } = useI18n();
  const [activeType, setActiveType] = useState<SharedStyleType>("PAINT");
  const [newName, setNewName] = useState("");
  const [status, setStatus] = useState("");
  const selectedNode =
    selectedNodeIds.length === 1
      ? document.nodesById[selectedNodeIds[0] ?? ""]
      : undefined;
  const selectedField = selectedNode
    ? defaultField(selectedNode, activeType)
    : null;
  const orderedStyles = useMemo(
    () =>
      document.styleOrderByType[activeType].flatMap((styleId) => {
        const style = document.stylesById[styleId];
        return style ? [style] : [];
      }),
    [activeType, document.styleOrderByType, document.stylesById],
  );
  const create = () => {
    if (!selectedNode || !selectedField) return;
    const name = newName.trim() || t("styles.untitled");
    if (actions.createFromNode(selectedNode.id, selectedField, name)) {
      setNewName("");
      setStatus(name);
    }
  };
  return (
    <div
      aria-labelledby="sidebar-styles-tab"
      className={styles.panel}
      id="sidebar-styles"
      role="tabpanel"
    >
      <div className={styles.header}>
        <strong>{t("styles.local")}</strong>
        <span>{t("styles.folderHint")}</span>
      </div>
      <div
        aria-label={t("styles.title")}
        className={styles.tabs}
        role="tablist"
      >
        {styleTypes.map((styleType) => (
          <button
            aria-selected={activeType === styleType}
            key={styleType}
            onClick={() => setActiveType(styleType)}
            role="tab"
            type="button"
          >
            {t(styleTypeKey(styleType))}
            <small>{document.styleOrderByType[styleType].length}</small>
          </button>
        ))}
      </div>
      <div className={styles.list} role="list">
        {orderedStyles.length === 0 ? (
          <div className={styles.empty}>
            <Glyph name="component" size={18} />
            <strong>{t("styles.noStyles")}</strong>
            <span>{t("styles.noStylesHint")}</span>
          </div>
        ) : (
          orderedStyles.map((style, index) => (
            <StyleRow
              actions={actions}
              document={document}
              index={index}
              key={style.id}
              selectedField={
                selectedNode && style.styleType === activeType
                  ? defaultField(selectedNode, style.styleType)
                  : null
              }
              selectedNode={selectedNode}
              style={style}
            />
          ))
        )}
      </div>
      <div className={styles.createBar}>
        <input
          aria-label={t("styles.name")}
          maxLength={512}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") create();
            if (event.key === "Escape") setNewName("");
          }}
          placeholder={t("styles.untitled")}
          value={newName}
        />
        <IconButton
          disabled={!selectedField}
          icon="plus"
          label={
            selectedField
              ? t("styles.create")
              : t("styles.noCompatibleSelection")
          }
          onClick={create}
        />
      </div>
      <span aria-live="polite" className={styles.status}>
        {status}
      </span>
    </div>
  );
}

function StyleRow({
  actions,
  document,
  index,
  selectedField,
  selectedNode,
  style,
}: {
  actions: LocalStylesPanelActions;
  document: DesignDocument;
  index: number;
  selectedField: StyleReferenceTarget["field"] | null;
  selectedNode: DesignNode | undefined;
  style: SharedStyleDefinition;
}) {
  const { t } = useI18n();
  const order = document.styleOrderByType[style.styleType];
  const consumers = Object.values(document.nodesById).filter((node) =>
    styleFields.some((field) => node[field] === style.id),
  ).length;
  return (
    <details className={styles.row}>
      <summary>
        <StylePreview style={style} />
        <span className={styles.identity}>
          <strong>{style.name.split("/").at(-1)}</strong>
          <small>
            {style.name.includes("/")
              ? style.name.slice(0, style.name.lastIndexOf("/"))
              : t(styleTypeKey(style.styleType))}
          </small>
        </span>
        <span className={styles.orderActions}>
          <button
            aria-label={t("styles.moveUp", { name: style.name })}
            disabled={index === 0}
            onClick={(event) => {
              event.preventDefault();
              actions.moveStyle(style.id, index - 1);
            }}
            type="button"
          >
            ↑
          </button>
          <button
            aria-label={t("styles.moveDown", { name: style.name })}
            disabled={index === order.length - 1}
            onClick={(event) => {
              event.preventDefault();
              actions.moveStyle(style.id, index + 1);
            }}
            type="button"
          >
            ↓
          </button>
        </span>
      </summary>
      <div className={styles.details}>
        <label>
          <span>{t("styles.name")}</span>
          <input
            defaultValue={style.name}
            key={`${style.id}:name`}
            maxLength={512}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && name !== style.name)
                actions.updateStyle({ ...style, name });
              else event.target.value = style.name;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.currentTarget.value = style.name;
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <label>
          <span>{t("styles.description")}</span>
          <input
            defaultValue={style.description}
            key={`${style.id}:description`}
            maxLength={2_000}
            onBlur={(event) => {
              if (event.target.value !== style.description) {
                actions.updateStyle({
                  ...style,
                  description: event.target.value,
                });
              }
            }}
          />
        </label>
        <label className={styles.checkbox}>
          <input
            checked={style.hiddenFromPublishing}
            onChange={(event) =>
              actions.updateStyle({
                ...style,
                hiddenFromPublishing: event.target.checked,
              })
            }
            type="checkbox"
          />
          <span>{t("styles.hideFromPublishing")}</span>
        </label>
        <small>{t("styles.consumers", { count: consumers })}</small>
        <div className={styles.actions}>
          <button
            disabled={!selectedNode || !selectedField}
            onClick={() => {
              if (selectedNode && selectedField)
                actions.updateFromNode(
                  style.id,
                  selectedNode.id,
                  selectedField,
                );
            }}
            type="button"
          >
            {t("styles.updateFromSelection")}
          </button>
          <button
            className={styles.danger}
            onClick={() => actions.deleteStyle(style.id)}
            type="button"
          >
            {t("styles.delete")}
          </button>
        </div>
      </div>
    </details>
  );
}

function StylePreview({ style }: { style: SharedStyleDefinition }) {
  const color =
    style.styleType === "PAINT" && style.paints[0]?.type === "solid"
      ? style.paints[0].color
      : undefined;
  return (
    <span
      aria-hidden="true"
      className={styles.preview}
      style={color ? { background: color } : undefined}
    >
      {!color && (
        <Glyph
          name={
            style.styleType === "TEXT"
              ? "text"
              : style.styleType === "GRID"
                ? "frame"
                : "spark"
          }
          size={13}
        />
      )}
    </span>
  );
}

function defaultField(
  node: DesignNode,
  styleType: SharedStyleType,
): StyleReferenceTarget["field"] | null {
  if (styleType === "EFFECT") return "effectStyleId";
  if (styleType === "TEXT") return node.kind === "text" ? "textStyleId" : null;
  if (styleType === "GRID") return node.kind === "frame" ? "gridStyleId" : null;
  return "fills" in node.properties ? "fillStyleId" : null;
}

function styleTypeKey(styleType: SharedStyleType) {
  return `styles.${styleType.toLowerCase()}` as
    "styles.paint" | "styles.text" | "styles.effect" | "styles.grid";
}

const styleFields = [
  "fillStyleId",
  "strokeStyleId",
  "effectStyleId",
  "textStyleId",
  "gridStyleId",
] as const;
