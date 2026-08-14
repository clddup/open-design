import type {
  DesignDocument,
  DesignNode,
  VariableBindingTarget,
  VariableResolvedDataType,
  VariableScope,
} from "@opendesign/design-contracts";
import { resolveVariableForConsumer } from "@opendesign/variable-service";
import { useI18n } from "../../i18n";
import { Section } from "./controls";
import styles from "./VariableSection.module.scss";

export function VariableSection({
  activePageId,
  document,
  node,
  onSetBinding,
  onSetExplicitMode,
}: {
  activePageId: string;
  document: DesignDocument;
  node: DesignNode;
  onSetBinding: (
    target: VariableBindingTarget,
    variableId: string | null,
  ) => void;
  onSetExplicitMode: (collectionId: string, modeId: string | null) => void;
}) {
  const { t } = useI18n();
  const bindingRows: Array<{
    label: string;
    target: VariableBindingTarget;
    type: VariableResolvedDataType;
    scopes: readonly VariableScope[];
    variableId?: string;
  }> = [
    {
      label: t("variables.visible"),
      target: { kind: "node", nodeId: node.id, field: "visible" },
      type: "BOOLEAN",
      scopes: ["ALL_SCOPES"],
      variableId: node.boundVariables?.visible?.id,
    },
    {
      label: t("variables.opacity"),
      target: { kind: "node", nodeId: node.id, field: "opacity" },
      type: "FLOAT",
      scopes: ["OPACITY", "ALL_SCOPES"],
      variableId: node.boundVariables?.opacity?.id,
    },
  ];
  if (node.kind === "text") {
    bindingRows.push({
      label: t("variables.characters"),
      target: { kind: "node", nodeId: node.id, field: "characters" },
      type: "STRING",
      scopes: ["TEXT_CONTENT", "ALL_SCOPES"],
      variableId: node.boundVariables?.characters?.id,
    });
  }
  nodePaints(node)?.fills.forEach((paint, paintIndex) => {
    if (paint.type !== "solid") return;
    bindingRows.push({
      label: t("variables.fillColor", { index: paintIndex + 1 }),
      target: {
        kind: "paint",
        nodeId: node.id,
        paintField: "fills",
        paintIndex,
        field: "color",
      },
      type: "COLOR",
      scopes: fillScopes(node),
      variableId: paint.boundVariables?.color?.id,
    });
  });

  return (
    <Section title={t("variables.modeOverrides")}>
      <div className={styles.modeRows}>
        {document.variableCollectionOrder.map((collectionId) => {
          const collection = document.variableCollectionsById[collectionId];
          if (!collection) return null;
          return (
            <label className={styles.row} key={collectionId}>
              <span title={collection.name}>{collection.name}</span>
              <select
                aria-label={`${collection.name} ${t("variables.mode")}`}
                onChange={(event) =>
                  onSetExplicitMode(collectionId, event.target.value || null)
                }
                value={node.explicitVariableModes?.[collectionId] ?? ""}
              >
                <option value="">{t("variables.inherited")}</option>
                {collection.modes.map((mode) => (
                  <option key={mode.modeId} value={mode.modeId}>
                    {mode.name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <div className={styles.subheading}>{t("variables.bindings")}</div>
      <div className={styles.bindingRows}>
        {bindingRows.map((row) => (
          <BindingRow
            activePageId={activePageId}
            document={document}
            key={bindingKey(row.target)}
            label={row.label}
            nodeId={node.id}
            onChange={(variableId) => onSetBinding(row.target, variableId)}
            scopes={row.scopes}
            type={row.type}
            variableId={row.variableId}
          />
        ))}
      </div>
    </Section>
  );
}

function BindingRow({
  activePageId,
  document,
  label,
  nodeId,
  onChange,
  scopes,
  type,
  variableId,
}: {
  activePageId: string;
  document: DesignDocument;
  label: string;
  nodeId: string;
  onChange: (variableId: string | null) => void;
  scopes: readonly VariableScope[];
  type: VariableResolvedDataType;
  variableId?: string;
}) {
  const { t } = useI18n();
  const compatible = Object.values(document.variablesById)
    .filter((variable) => variable.resolvedType === type)
    .sort((left, right) => {
      const leftRecommended = left.scopes.some((scope) =>
        scopes.includes(scope),
      );
      const rightRecommended = right.scopes.some((scope) =>
        scopes.includes(scope),
      );
      return (
        Number(rightRecommended) - Number(leftRecommended) ||
        left.name.localeCompare(right.name)
      );
    });
  const resolved = variableId
    ? resolveVariableForConsumer(document, variableId, {
        pageId: activePageId,
        nodeId,
      })
    : null;
  return (
    <div className={styles.bindingRow}>
      <span title={label}>{label}</span>
      <select
        aria-label={t("variables.bindingLabel", { name: label })}
        onChange={(event) => onChange(event.target.value || null)}
        value={variableId ?? ""}
      >
        <option value="">{t("variables.clearBinding")}</option>
        {compatible.length === 0 && (
          <option disabled value="__none">
            {t("variables.noCompatibleVariables")}
          </option>
        )}
        {compatible.map((variable) => (
          <option key={variable.id} value={variable.id}>
            {variable.name}
          </option>
        ))}
      </select>
      {resolved?.ok && (
        <small title={resolved.resolved.aliasChain.join(" → ")}>
          {formatValue(resolved.resolved.value)} ·{" "}
          {resolved.resolved.modes.at(-1)?.modeId}
        </small>
      )}
    </div>
  );
}

function nodePaints(node: DesignNode) {
  if (
    node.kind === "frame" ||
    node.kind === "slot" ||
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "line" ||
    node.kind === "polygon" ||
    node.kind === "star" ||
    node.kind === "text" ||
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
  )
    return node.properties;
  return undefined;
}

function fillScopes(node: DesignNode): readonly VariableScope[] {
  if (node.kind === "frame" || node.kind === "slot")
    return ["FRAME_FILL", "ALL_FILLS", "ALL_SCOPES"];
  if (node.kind === "text") return ["TEXT_FILL", "ALL_FILLS", "ALL_SCOPES"];
  return ["SHAPE_FILL", "ALL_FILLS", "ALL_SCOPES"];
}

function bindingKey(target: VariableBindingTarget): string {
  return target.kind === "node"
    ? `${target.nodeId}:${target.field}`
    : `${target.nodeId}:${target.paintField}:${target.paintIndex}:${target.field}`;
}

function formatValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (value && typeof value === "object" && "r" in value) return "RGB";
  if (value && typeof value === "object" && "type" in value)
    return String(value.type);
  return "";
}
