import type {
  ComponentPropertyAssignment,
  ComponentPropertyType,
  DesignNode,
} from "@opendesign/design-contracts";
import { Button, Glyph } from "@opendesign/ui";
import { useEffect, useState } from "react";
import type { MessageKey } from "../../../shared/i18n/messages";
import { useI18n } from "../../i18n";
import styles from "../PropertiesPanel.module.scss";
import type {
  ComponentInspectorOption,
  ComponentInspectorPropertyDefinition,
  ComponentInspectorPropertyValue,
  ComponentInspectorSource,
} from "./ComponentSection";
import { Field, TextAreaField } from "./controls";

const nodeKindKeys: Record<DesignNode["kind"], MessageKey> = {
  frame: "node.frame",
  group: "node.group",
  boolean: "node.boolean",
  rectangle: "node.rectangle",
  ellipse: "node.ellipse",
  line: "node.line",
  polygon: "node.polygon",
  star: "node.star",
  text: "node.text",
  image: "node.image",
  vector: "node.vector",
  path: "node.path",
  instance: "node.instance",
};

function propertyLabel(propertyName: string): string {
  const marker = propertyName.lastIndexOf("#");
  return marker > 0 ? propertyName.slice(0, marker) : propertyName;
}

function propertyTypeLabel(
  type: ComponentPropertyType,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (type === "BOOLEAN") return t("properties.booleanProperty");
  if (type === "TEXT") return t("properties.textProperty");
  return t("properties.instanceSwapProperty");
}

function propertySourceCandidates(
  sources: readonly ComponentInspectorSource[],
  type: ComponentPropertyType,
): readonly ComponentInspectorSource[] {
  const field =
    type === "BOOLEAN"
      ? "visible"
      : type === "TEXT"
        ? "characters"
        : "mainComponent";
  return sources.filter(
    (source) =>
      (type === "BOOLEAN" ||
        (type === "TEXT" && source.node.kind === "text") ||
        (type === "INSTANCE_SWAP" && source.node.kind === "instance")) &&
      !source.node.componentPropertyReferences?.[field],
  );
}

export function ComponentPropertyAuthoring({
  definitions,
  onAdd,
  onRemove,
  onRename,
  sources,
}: {
  definitions: readonly ComponentInspectorPropertyDefinition[];
  onAdd: (input: {
    name: string;
    sourceNodeId: string;
    type: ComponentPropertyType;
  }) => void;
  onRemove: (propertyName: string) => void;
  onRename: (propertyName: string, name: string) => void;
  sources: readonly ComponentInspectorSource[];
}) {
  const { t } = useI18n();
  const [type, setType] = useState<ComponentPropertyType>("BOOLEAN");
  const candidates = propertySourceCandidates(sources, type);
  const [sourceNodeId, setSourceNodeId] = useState(
    () => candidates[0]?.node.id ?? "",
  );
  const source =
    candidates.find((candidate) => candidate.node.id === sourceNodeId) ??
    candidates[0];
  const [name, setName] = useState(() => source?.node.name ?? "");

  useEffect(() => {
    const selected = candidates.find(
      (candidate) => candidate.node.id === sourceNodeId,
    );
    if (selected) return;
    const first = candidates[0];
    setSourceNodeId(first?.node.id ?? "");
    setName(first?.node.name ?? "");
  }, [candidates, sourceNodeId]);

  return (
    <div className={styles.componentPropertySection}>
      <div className={styles.componentPropertyHeading}>
        <span>{t("properties.componentProperties")}</span>
        <small>{definitions.length}</small>
      </div>
      {definitions.length === 0 ? (
        <p className={styles.componentPropertyEmpty}>
          {t("properties.noComponentProperties")}
        </p>
      ) : (
        <div className={styles.componentPropertyList}>
          {definitions.map((property) => (
            <div
              className={styles.componentPropertyDefinition}
              key={property.propertyName}
            >
              <Field
                accessibleLabel={t("properties.propertyName")}
                label="P"
                onCommit={(draft) => {
                  const next = draft.trim();
                  if (!next) return null;
                  if (next !== propertyLabel(property.propertyName)) {
                    onRename(property.propertyName, next);
                  }
                  return next;
                }}
                type="text"
                value={propertyLabel(property.propertyName)}
              />
              <span>{propertyTypeLabel(property.definition.type, t)}</span>
              <button
                aria-label={`${t("properties.removeProperty")} ${propertyLabel(property.propertyName)}`}
                onClick={() => onRemove(property.propertyName)}
                type="button"
              >
                <Glyph name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={styles.componentPropertyComposer}>
        <label className={styles.select}>
          <span>{t("properties.propertyType")}</span>
          <select
            aria-label={t("properties.propertyType")}
            onChange={(event) => {
              const next = event.target.value as ComponentPropertyType;
              const first = propertySourceCandidates(sources, next)[0];
              setType(next);
              setSourceNodeId(first?.node.id ?? "");
              setName(first?.node.name ?? "");
            }}
            value={type}
          >
            <option value="BOOLEAN">{t("properties.booleanProperty")}</option>
            <option value="TEXT">{t("properties.textProperty")}</option>
            <option value="INSTANCE_SWAP">
              {t("properties.instanceSwapProperty")}
            </option>
          </select>
        </label>
        <label className={styles.select}>
          <span>{t("properties.sourceLayer")}</span>
          <select
            aria-label={t("properties.sourceLayer")}
            disabled={candidates.length === 0}
            onChange={(event) => {
              const next = candidates.find(
                (candidate) => candidate.node.id === event.target.value,
              );
              setSourceNodeId(event.target.value);
              setName(next?.node.name ?? "");
            }}
            value={source?.node.id ?? ""}
          >
            {candidates.map((candidate) => (
              <option key={candidate.node.id} value={candidate.node.id}>
                {candidate.node.name || t(nodeKindKeys[candidate.node.kind])}
              </option>
            ))}
          </select>
        </label>
        <Field
          accessibleLabel={t("properties.propertyName")}
          label="P"
          onCommit={(draft) => {
            setName(draft);
            return draft;
          }}
          type="text"
          value={name}
        />
        <Button
          disabled={!source || !name.trim()}
          onClick={() => {
            if (!source || !name.trim()) return;
            onAdd({ name: name.trim(), sourceNodeId: source.node.id, type });
          }}
          tone="quiet"
        >
          {t("properties.addComponentProperty")}
        </Button>
      </div>
    </div>
  );
}

export function ComponentPropertyValues({
  availableComponents,
  onReset,
  onSet,
  properties,
}: {
  availableComponents: readonly ComponentInspectorOption[];
  onReset: (propertyName: string) => void;
  onSet: (propertyName: string, value: ComponentPropertyAssignment) => void;
  properties: readonly ComponentInspectorPropertyValue[];
}) {
  const { t } = useI18n();
  if (properties.length === 0) return null;
  return (
    <div className={styles.componentPropertySection}>
      <div className={styles.componentPropertyHeading}>
        <span>{t("properties.componentProperties")}</span>
      </div>
      <div className={styles.componentPropertyList}>
        {properties.map((property) => (
          <div
            className={styles.componentPropertyValue}
            key={property.propertyName}
          >
            <div>
              <strong>{propertyLabel(property.propertyName)}</strong>
              <button
                disabled={!property.assigned}
                onClick={() => onReset(property.propertyName)}
                type="button"
              >
                {t("properties.resetProperty")}
              </button>
            </div>
            {property.definition.type === "VARIANT" ? (
              <label className={styles.select}>
                <span>{t("properties.variant")}</span>
                <select
                  aria-label={propertyLabel(property.propertyName)}
                  onChange={(event) =>
                    onSet(property.propertyName, event.target.value)
                  }
                  value={String(property.value)}
                >
                  {property.definition.variantOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ) : property.definition.type === "BOOLEAN" ? (
              <label className={styles.componentPropertyToggle}>
                <input
                  checked={property.value === true}
                  onChange={(event) =>
                    onSet(property.propertyName, event.target.checked)
                  }
                  type="checkbox"
                />
                {t("properties.visible")}
              </label>
            ) : property.definition.type === "TEXT" ? (
              <TextAreaField
                label={propertyLabel(property.propertyName)}
                onCommit={(value) => onSet(property.propertyName, value)}
                value={String(property.value)}
              />
            ) : (
              <label className={styles.select}>
                <span>{t("properties.instanceSwap")}</span>
                <select
                  aria-label={propertyLabel(property.propertyName)}
                  onChange={(event) =>
                    onSet(property.propertyName, event.target.value)
                  }
                  value={String(property.value)}
                >
                  {availableComponents.map((component) => (
                    <option key={component.id} value={component.id}>
                      {component.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
