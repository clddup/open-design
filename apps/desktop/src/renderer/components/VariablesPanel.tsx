import type {
  DesignDocument,
  VariableBindingTarget,
  VariableCollectionDefinition,
  VariableDefinition,
  VariableResolvedDataType,
  VariableScope,
  VariableValue,
} from "@opendesign/design-contracts";
import { Glyph, IconButton } from "@opendesign/ui";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import styles from "./VariablesPanel.module.scss";

const variableTypes: readonly VariableResolvedDataType[] = [
  "COLOR",
  "FLOAT",
  "STRING",
  "BOOLEAN",
  "TIMING",
  "EASING",
];

const scopes: readonly VariableScope[] = [
  "ALL_SCOPES",
  "TEXT_CONTENT",
  "ALL_FILLS",
  "FRAME_FILL",
  "SHAPE_FILL",
  "TEXT_FILL",
  "OPACITY",
];

export interface VariablesPanelActions {
  createCollection(this: void, name: string): boolean;
  updateCollection(
    this: void,
    collection: VariableCollectionDefinition,
  ): boolean;
  moveCollection(this: void, collectionId: string, index: number): boolean;
  deleteCollection(this: void, collectionId: string): boolean;
  addMode(
    this: void,
    collectionId: string,
    name: string,
    sourceModeId?: string,
  ): boolean;
  removeMode(
    this: void,
    collectionId: string,
    modeId: string,
    replacementModeId: string,
  ): boolean;
  createVariable(
    this: void,
    collectionId: string,
    name: string,
    type: VariableResolvedDataType,
  ): boolean;
  updateVariable(this: void, variable: VariableDefinition): boolean;
  deleteVariable(this: void, variableId: string): boolean;
  setBinding(
    this: void,
    target: VariableBindingTarget,
    variableId: string | null,
  ): boolean;
  setExplicitMode(
    this: void,
    target: { kind: "page" | "node"; id: string },
    collectionId: string,
    modeId: string | null,
  ): boolean;
}

export function VariablesPanel({
  actions,
  activePageId,
  document,
}: {
  actions: VariablesPanelActions;
  activePageId: string;
  document: DesignDocument;
}) {
  const { t } = useI18n();
  const [selectedCollectionId, setSelectedCollectionId] = useState(
    document.variableCollectionOrder[0] ?? "",
  );
  const collection =
    document.variableCollectionsById[selectedCollectionId] ??
    document.variableCollectionsById[document.variableCollectionOrder[0] ?? ""];
  const [activeModeId, setActiveModeId] = useState(
    collection?.defaultModeId ?? "",
  );
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<VariableResolvedDataType>("COLOR");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!collection) return;
    setSelectedCollectionId(collection.id);
    if (!collection.modes.some((mode) => mode.modeId === activeModeId)) {
      setActiveModeId(collection.defaultModeId);
    }
  }, [activeModeId, collection]);

  const variables = useMemo(
    () =>
      collection?.variableIds.flatMap((id) => {
        const variable = document.variablesById[id];
        return variable ? [variable] : [];
      }) ?? [],
    [collection, document.variablesById],
  );
  const report = (ok: boolean, message: string) => setStatus(ok ? message : "");

  const createCollection = () => {
    const name = newName.trim() || t("variables.untitledCollection");
    report(actions.createCollection(name), t("variables.collectionCreated"));
    setNewName("");
  };
  const createVariable = () => {
    if (!collection) return;
    const name = newName.trim() || t("variables.untitledVariable");
    report(
      actions.createVariable(collection.id, name, newType),
      t("variables.variableCreated"),
    );
    setNewName("");
  };

  return (
    <div
      aria-labelledby="sidebar-variables-tab"
      className={styles.panel}
      id="sidebar-variables"
      role="tabpanel"
    >
      <div className={styles.collectionRail}>
        <div className={styles.heading}>
          <span>{t("variables.collections")}</span>
          <IconButton
            icon="plus"
            label={t("variables.createCollection")}
            onClick={createCollection}
          />
        </div>
        {document.variableCollectionOrder.length === 0 ? (
          <div className={styles.empty}>
            <Glyph name="assets" size={18} />
            <strong>{t("variables.noCollections")}</strong>
            <span>{t("variables.noCollectionsHint")}</span>
          </div>
        ) : (
          <div className={styles.collectionList} role="listbox">
            {document.variableCollectionOrder.map((collectionId, index) => {
              const item = document.variableCollectionsById[collectionId];
              if (!item) return null;
              return (
                <div
                  aria-selected={item.id === collection?.id}
                  className={styles.collectionItem}
                  data-selected={item.id === collection?.id}
                  key={item.id}
                  role="option"
                >
                  <button
                    className={styles.collectionMain}
                    onClick={() => {
                      setSelectedCollectionId(item.id);
                      setActiveModeId(item.defaultModeId);
                    }}
                    type="button"
                  >
                    <span>{item.name}</span>
                    <small>
                      {t("variables.variableCount", {
                        count: item.variableIds.length,
                      })}
                    </small>
                  </button>
                  <span className={styles.orderActions}>
                    <button
                      aria-label={t("variables.moveCollectionUp", {
                        name: item.name,
                      })}
                      disabled={index === 0}
                      onClick={(event) => {
                        event.stopPropagation();
                        actions.moveCollection(item.id, index - 1);
                      }}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label={t("variables.moveCollectionDown", {
                        name: item.name,
                      })}
                      disabled={
                        index === document.variableCollectionOrder.length - 1
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        actions.moveCollection(item.id, index + 1);
                      }}
                      type="button"
                    >
                      ↓
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {collection && (
        <div className={styles.workspace}>
          <div className={styles.collectionHeader}>
            <input
              aria-label={t("variables.collectionName")}
              defaultValue={collection.name}
              key={collection.id}
              maxLength={256}
              onBlur={(event) => {
                const name = event.target.value.trim();
                if (name && name !== collection.name) {
                  actions.updateCollection({ ...collection, name });
                } else event.target.value = collection.name;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  event.currentTarget.value = collection.name;
                  event.currentTarget.blur();
                }
              }}
            />
            <button
              className={styles.danger}
              onClick={() => actions.deleteCollection(collection.id)}
              type="button"
            >
              {t("variables.deleteCollection")}
            </button>
          </div>
          <div
            aria-label={t("variables.modes")}
            className={styles.modeTabs}
            role="tablist"
          >
            {collection.modes.map((mode) => (
              <button
                aria-selected={activeModeId === mode.modeId}
                key={mode.modeId}
                onClick={() => setActiveModeId(mode.modeId)}
                role="tab"
                type="button"
              >
                {mode.name}
                {mode.modeId === collection.defaultModeId && (
                  <small>{t("variables.default")}</small>
                )}
              </button>
            ))}
            <button
              aria-label={t("variables.addMode")}
              onClick={() => {
                const name = `${t("variables.mode")} ${collection.modes.length + 1}`;
                actions.addMode(collection.id, name, activeModeId);
              }}
              type="button"
            >
              +
            </button>
          </div>
          <label className={styles.pageMode}>
            <span>{t("variables.pageMode")}</span>
            <select
              onChange={(event) =>
                actions.setExplicitMode(
                  { kind: "page", id: activePageId },
                  collection.id,
                  event.target.value || null,
                )
              }
              value={
                document.pagesById[activePageId]?.explicitVariableModes?.[
                  collection.id
                ] ?? ""
              }
            >
              <option value="">{t("variables.inherited")}</option>
              {collection.modes.map((mode) => (
                <option key={mode.modeId} value={mode.modeId}>
                  {mode.name}
                </option>
              ))}
            </select>
          </label>
          <ModeEditor
            actions={actions}
            activeModeId={activeModeId}
            collection={collection}
          />
          <div className={styles.variableRows}>
            {variables.length === 0 ? (
              <div className={styles.emptyCompact}>
                {t("variables.noVariables")}
              </div>
            ) : (
              variables.map((variable) => (
                <VariableRow
                  actions={actions}
                  document={document}
                  key={variable.id}
                  modeId={activeModeId}
                  variable={variable}
                />
              ))
            )}
          </div>
        </div>
      )}
      <div className={styles.createBar}>
        <input
          aria-label={t("variables.newName")}
          maxLength={512}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (collection) createVariable();
              else createCollection();
            }
          }}
          placeholder={
            collection
              ? t("variables.newVariablePlaceholder")
              : t("variables.newCollectionPlaceholder")
          }
          value={newName}
        />
        {collection && (
          <select
            aria-label={t("variables.variableType")}
            onChange={(event) =>
              setNewType(event.target.value as VariableResolvedDataType)
            }
            value={newType}
          >
            {variableTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        )}
        <button
          onClick={collection ? createVariable : createCollection}
          type="button"
        >
          {t("common.create")}
        </button>
      </div>
      <span aria-live="polite" className={styles.status}>
        {status}
      </span>
    </div>
  );
}

function ModeEditor({
  actions,
  activeModeId,
  collection,
}: {
  actions: VariablesPanelActions;
  activeModeId: string;
  collection: VariableCollectionDefinition;
}) {
  const { t } = useI18n();
  const mode = collection.modes.find(
    (candidate) => candidate.modeId === activeModeId,
  );
  if (!mode) return null;
  return (
    <div className={styles.modeEditor}>
      <input
        aria-label={t("variables.modeName")}
        defaultValue={mode.name}
        key={mode.modeId}
        onBlur={(event) => {
          const name = event.target.value.trim();
          if (!name || name === mode.name) return;
          actions.updateCollection({
            ...collection,
            modes: collection.modes.map((candidate) =>
              candidate.modeId === mode.modeId
                ? { ...candidate, name }
                : candidate,
            ),
          });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.currentTarget.value = mode.name;
            event.currentTarget.blur();
          }
        }}
      />
      <button
        disabled={mode.modeId === collection.defaultModeId}
        onClick={() =>
          actions.updateCollection({
            ...collection,
            defaultModeId: mode.modeId,
          })
        }
        type="button"
      >
        {t("variables.makeDefault")}
      </button>
      <button
        className={styles.danger}
        disabled={collection.modes.length === 1}
        onClick={() => {
          const replacement = collection.modes.find(
            (candidate) => candidate.modeId !== mode.modeId,
          );
          if (replacement)
            actions.removeMode(collection.id, mode.modeId, replacement.modeId);
        }}
        type="button"
      >
        {t("variables.deleteMode")}
      </button>
    </div>
  );
}

function VariableRow({
  actions,
  document,
  modeId,
  variable,
}: {
  actions: VariablesPanelActions;
  document: DesignDocument;
  modeId: string;
  variable: VariableDefinition;
}) {
  const { t } = useI18n();
  const value = variable.valuesByMode[modeId];
  const aliases = Object.values(document.variablesById).filter(
    (candidate) =>
      candidate.id !== variable.id &&
      candidate.resolvedType === variable.resolvedType,
  );
  const update = (patch: Partial<VariableDefinition>) =>
    actions.updateVariable({ ...variable, ...patch });
  const setValue = (next: VariableValue) =>
    update({ valuesByMode: { ...variable.valuesByMode, [modeId]: next } });
  return (
    <details className={styles.variableRow}>
      <summary>
        <span className={styles.typeBadge}>{variable.resolvedType}</span>
        <input
          aria-label={t("variables.variableName")}
          defaultValue={variable.name}
          key={`${variable.id}:name`}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== variable.name) update({ name });
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <VariableValueEditor
          aliases={aliases}
          onChange={setValue}
          type={variable.resolvedType}
          value={value}
        />
      </summary>
      <div className={styles.variableDetails}>
        <label>
          <span>{t("variables.description")}</span>
          <input
            defaultValue={variable.description}
            onBlur={(event) => update({ description: event.target.value })}
          />
        </label>
        <label>
          <span>{t("variables.scope")}</span>
          <select
            onChange={(event) =>
              update({ scopes: [event.target.value as VariableScope] })
            }
            value={variable.scopes[0] ?? "ALL_SCOPES"}
          >
            {scopes.map((scope) => (
              <option key={scope}>{scope}</option>
            ))}
          </select>
        </label>
        {(["WEB", "ANDROID", "iOS"] as const).map((platform) => (
          <label key={platform}>
            <span>{platform}</span>
            <input
              defaultValue={variable.codeSyntax[platform] ?? ""}
              onBlur={(event) => {
                const codeSyntax = { ...variable.codeSyntax };
                if (event.target.value)
                  codeSyntax[platform] = event.target.value;
                else delete codeSyntax[platform];
                update({ codeSyntax });
              }}
            />
          </label>
        ))}
        <label className={styles.checkbox}>
          <input
            checked={variable.hiddenFromPublishing}
            onChange={(event) =>
              update({ hiddenFromPublishing: event.target.checked })
            }
            type="checkbox"
          />
          <span>{t("variables.hideFromPublishing")}</span>
        </label>
        <button
          className={styles.danger}
          onClick={() => actions.deleteVariable(variable.id)}
          type="button"
        >
          {t("variables.deleteVariable")}
        </button>
      </div>
    </details>
  );
}

function VariableValueEditor({
  aliases,
  onChange,
  type,
  value,
}: {
  aliases: readonly VariableDefinition[];
  onChange: (value: VariableValue) => void;
  type: VariableResolvedDataType;
  value: VariableValue | undefined;
}) {
  if (isAlias(value)) {
    return (
      <select
        aria-label="Alias"
        onChange={(event) =>
          onChange({ type: "VARIABLE_ALIAS", id: event.target.value })
        }
        onClick={(event) => event.stopPropagation()}
        value={value.id}
      >
        {aliases.map((alias) => (
          <option key={alias.id} value={alias.id}>
            ↳ {alias.name}
          </option>
        ))}
      </select>
    );
  }
  if (type === "BOOLEAN") {
    return (
      <input
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
        onClick={(event) => event.stopPropagation()}
        type="checkbox"
      />
    );
  }
  if (type === "COLOR") {
    return (
      <input
        onChange={(event) => onChange(hexToColor(event.target.value))}
        onClick={(event) => event.stopPropagation()}
        type="color"
        value={colorToHex(value)}
      />
    );
  }
  if (type === "EASING") {
    const easing =
      typeof value === "object" && value && "type" in value
        ? value.type
        : "LINEAR";
    return (
      <select
        onChange={(event) => onChange({ type: event.target.value as "LINEAR" })}
        onClick={(event) => event.stopPropagation()}
        value={easing}
      >
        {[
          "LINEAR",
          "EASE_IN",
          "EASE_OUT",
          "EASE_IN_AND_OUT",
          "GENTLE",
          "QUICK",
          "BOUNCY",
          "SLOW",
          "HOLD",
        ].map((entry) => (
          <option key={entry}>{entry}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      defaultValue={
        typeof value === "string" || typeof value === "number" ? value : ""
      }
      key={JSON.stringify(value)}
      onBlur={(event) =>
        onChange(
          type === "STRING" ? event.target.value : Number(event.target.value),
        )
      }
      onClick={(event) => event.stopPropagation()}
      type={type === "STRING" ? "text" : "number"}
    />
  );
}

function isAlias(
  value: VariableValue | undefined,
): value is { type: "VARIABLE_ALIAS"; id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "VARIABLE_ALIAS"
  );
}

function colorToHex(value: VariableValue | undefined): string {
  if (!value || typeof value !== "object" || !("r" in value)) return "#000000";
  const channel = (number: number) =>
    Math.round(number * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(value.r)}${channel(value.g)}${channel(value.b)}`;
}

function hexToColor(value: string): VariableValue {
  return {
    r: Number.parseInt(value.slice(1, 3), 16) / 255,
    g: Number.parseInt(value.slice(3, 5), 16) / 255,
    b: Number.parseInt(value.slice(5, 7), 16) / 255,
    a: 1,
  };
}
