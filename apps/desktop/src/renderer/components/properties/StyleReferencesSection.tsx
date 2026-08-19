import type {
  DesignDocument,
  DesignNode,
  SharedStyleType,
  StyleReferenceTarget,
} from "@opendesign/design-contracts";
import { IconButton } from "@opendesign/ui";
import { useI18n } from "../../i18n";
import type { StyleActions } from "../../use-style-actions";
import panelStyles from "../PropertiesPanel.module.scss";
import styles from "./StyleReferencesSection.module.scss";
import { Section } from "./controls";

export function StyleReferencesSection({
  actions,
  document,
  node,
}: {
  actions: StyleActions;
  document: DesignDocument;
  node: DesignNode;
}) {
  const { t } = useI18n();
  const fields = compatibleFields(node);
  if (fields.length === 0) return null;
  return (
    <Section defaultOpen={false} title={t("styles.title")}>
      <div className={styles.stack}>
        {fields.map((field) => (
          <StyleReferenceRow
            actions={actions}
            document={document}
            field={field}
            key={field}
            node={node}
          />
        ))}
      </div>
    </Section>
  );
}

function StyleReferenceRow({
  actions,
  document,
  field,
  node,
}: {
  actions: StyleActions;
  document: DesignDocument;
  field: StyleReferenceTarget["field"];
  node: DesignNode;
}) {
  const { t } = useI18n();
  const styleType = styleTypeForField(field);
  const candidates = document.styleOrderByType[styleType].flatMap((styleId) => {
    const style = document.stylesById[styleId];
    return style ? [style] : [];
  });
  const current = node[field] ?? "";
  return (
    <div className={styles.row}>
      <label className={panelStyles.select}>
        <span>{fieldLabel(field, t)}</span>
        <select
          aria-label={t("styles.apply", { type: t(styleTypeKey(styleType)) })}
          onChange={(event) =>
            actions.setReference(
              { nodeId: node.id, field },
              event.target.value || null,
            )
          }
          value={current}
        >
          <option value="">{t("styles.noStyle")}</option>
          {candidates.map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </select>
      </label>
      <IconButton
        icon="lucide:plus"
        label={t("styles.createForProperty")}
        onClick={() =>
          actions.createFromNode(node.id, field, t("styles.untitled"))
        }
      />
      <button
        aria-label={t("styles.updateFromSelection")}
        className={styles.update}
        disabled={!current}
        onClick={() =>
          current && actions.updateFromNode(current, node.id, field)
        }
        type="button"
      >
        ↻
      </button>
    </div>
  );
}

function compatibleFields(node: DesignNode): StyleReferenceTarget["field"][] {
  const fields: StyleReferenceTarget["field"][] = [];
  if ("fills" in node.properties) fields.push("fillStyleId");
  if ("strokes" in node.properties) fields.push("strokeStyleId");
  if (node.kind === "text") fields.push("textStyleId");
  fields.push("effectStyleId");
  if (node.kind === "frame") fields.push("gridStyleId");
  return fields;
}

function styleTypeForField(
  field: StyleReferenceTarget["field"],
): SharedStyleType {
  if (field === "fillStyleId" || field === "strokeStyleId") return "PAINT";
  if (field === "textStyleId") return "TEXT";
  if (field === "effectStyleId") return "EFFECT";
  return "GRID";
}

function styleTypeKey(styleType: SharedStyleType) {
  return `styles.${styleType.toLowerCase()}` as
    "styles.paint" | "styles.text" | "styles.effect" | "styles.grid";
}

function fieldLabel(
  field: StyleReferenceTarget["field"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (field === "fillStyleId") return t("properties.fill");
  if (field === "strokeStyleId") return t("properties.stroke");
  if (field === "textStyleId") return t("styles.text");
  if (field === "effectStyleId") return t("properties.effects");
  return t("styles.grid");
}
