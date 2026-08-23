import type {
  DesignDocument,
  DesignNode,
  VariableBindingTarget,
  VariableDefinition,
  VariableResolvedDataType,
  VariableScope,
} from "@opendesign/design-contracts";
import { DesktopCombobox, Icon } from "@opendesign/ui";
import {
  resolveVariableForConsumer,
  variableCollectionDefinitions,
} from "@opendesign/variable-service";
import { useI18n } from "../../../../i18n";
import type { ProjectLibraryActions } from "../../hooks/use-project-library-actions";
import { Section } from "./controls";
import styles from "./VariableSection.module.scss";

export function VariableSection({
  activePageId,
  document,
  node,
  onSetBinding,
  onSetExplicitMode,
  projectLibraries,
}: {
  activePageId: string;
  document: DesignDocument;
  node: DesignNode;
  onSetBinding: (
    target: VariableBindingTarget,
    variableId: string | null,
  ) => void;
  onSetExplicitMode: (collectionId: string, modeId: string | null) => void;
  projectLibraries?: ProjectLibraryActions;
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
    <Section defaultOpen={false} title={t("variables.modeOverrides")}>
      <div className={styles.modeRows}>
        {orderedCollections(document).map((collection) => {
          const collectionId = collection.id;
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
            projectLibraries={projectLibraries}
            scopes={row.scopes}
            target={row.target}
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
  projectLibraries,
  scopes,
  target,
  type,
  variableId,
}: {
  activePageId: string;
  document: DesignDocument;
  label: string;
  nodeId: string;
  onChange: (variableId: string | null) => void;
  projectLibraries?: ProjectLibraryActions;
  scopes: readonly VariableScope[];
  target: VariableBindingTarget;
  type: VariableResolvedDataType;
  variableId?: string;
}) {
  const { t } = useI18n();
  const localCandidates: VariableCandidate[] = Object.values(
    document.variablesById,
  ).map((variable) => ({
    variable,
    optionValue: localOptionValue(variable.id),
    source: t("variables.local"),
  }));
  const libraryCandidates: VariableCandidate[] = (
    projectLibraries?.items ?? []
  ).flatMap((item) => {
    if (!item.enabled || !item.release) return [];
    return Object.values(item.release.variablesById).flatMap((source) => {
      const variable = source.variable;
      const collection =
        item.release?.variableCollectionsById[variable.variableCollectionId]
          ?.collection;
      return collection &&
        !collection.hiddenFromPublishing &&
        !variable.hiddenFromPublishing
        ? [
            {
              variable,
              optionValue: libraryOptionValue(
                item.entry.libraryId,
                variable.id,
              ),
              source: item.entry.name,
              libraryId: item.entry.libraryId,
            },
          ]
        : [];
    });
  });
  const currentImported = variableId
    ? document.libraryVariablesById[variableId]
    : undefined;
  const compatible = [
    ...localCandidates,
    ...libraryCandidates,
    ...(currentImported &&
    !libraryCandidates.some(
      (candidate) =>
        candidate.variable.id === variableId &&
        candidate.libraryId === currentImported.source.libraryId,
    )
      ? [
          {
            variable: currentImported.variable,
            optionValue: libraryOptionValue(
              currentImported.source.libraryId,
              currentImported.variable.id,
            ),
            source: t("variables.disabledLibrary"),
            libraryId: currentImported.source.libraryId,
            unavailable: true,
          },
        ]
      : []),
  ]
    .filter((candidate) => candidate.variable.resolvedType === type)
    .sort((left, right) => {
      const leftRecommended = left.variable.scopes.some((scope) =>
        scopes.includes(scope),
      );
      const rightRecommended = right.variable.scopes.some((scope) =>
        scopes.includes(scope),
      );
      return (
        Number(rightRecommended) - Number(leftRecommended) ||
        left.source.localeCompare(right.source) ||
        left.variable.name.localeCompare(right.variable.name)
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
      <DesktopCombobox
        ariaLabel={t("variables.bindingLabel", { name: label })}
        emptyLabel={t("variables.noCompatibleVariables")}
        onValueChange={(value) => {
          if (value === NO_VARIABLE) {
            onChange(null);
            return;
          }
          const candidate = compatible.find(
            (entry) => entry.optionValue === value,
          );
          if (!candidate || candidate.unavailable) return;
          if (candidate.libraryId) {
            void projectLibraries?.applyVariable(
              candidate.libraryId,
              candidate.variable.id,
              target,
            );
            return;
          }
          onChange(candidate.variable.id);
        }}
        options={[
          {
            value: NO_VARIABLE,
            label: t("variables.clearBinding"),
            textValue: t("variables.clearBinding"),
          },
          ...compatible.map((candidate) => ({
            value: candidate.optionValue,
            textValue: `${candidate.variable.name} ${candidate.source}`,
            keywords: candidate.source,
            disabled: candidate.unavailable,
            label: (
              <span className={styles.option}>
                <Icon
                  name={
                    candidate.libraryId ? "lucide:library" : "lucide:variable"
                  }
                  size={12}
                />
                <span>{candidate.variable.name}</span>
                <small>{candidate.source}</small>
              </span>
            ),
          })),
        ]}
        searchAriaLabel={t("variables.search")}
        searchPlaceholder={t("variables.searchPlaceholder")}
        size="compact"
        value={
          currentImported
            ? libraryOptionValue(
                currentImported.source.libraryId,
                currentImported.variable.id,
              )
            : variableId
              ? localOptionValue(variableId)
              : NO_VARIABLE
        }
      />
      {resolved?.ok && (
        <small title={resolved.resolved.aliasChain.join(" → ")}>
          {formatValue(resolved.resolved.value)} ·{" "}
          {resolved.resolved.modes.at(-1)?.modeId}
        </small>
      )}
    </div>
  );
}

const NO_VARIABLE = "__opendesign_no_variable__";

type VariableCandidate = {
  variable: VariableDefinition;
  optionValue: string;
  source: string;
  libraryId?: string;
  unavailable?: boolean;
};

function orderedCollections(document: DesignDocument) {
  const localOrder = new Map(
    document.variableCollectionOrder.map((id, index) => [id, index]),
  );
  return variableCollectionDefinitions(document).sort((left, right) => {
    const leftLocal = localOrder.get(left.id);
    const rightLocal = localOrder.get(right.id);
    if (leftLocal !== undefined || rightLocal !== undefined) {
      return (
        (leftLocal ?? Number.MAX_SAFE_INTEGER) -
        (rightLocal ?? Number.MAX_SAFE_INTEGER)
      );
    }
    return (
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    );
  });
}

function localOptionValue(variableId: string) {
  return `local\u0000${variableId}`;
}

function libraryOptionValue(libraryId: string, variableId: string) {
  return `library\u0000${libraryId}\u0000${variableId}`;
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
