import type {
  ComponentPropertyAssignment,
  ComponentPropertyType,
  DesignNode,
  InstanceSwapPreferredValue,
  SlotSettings,
} from "@opendesign/design-contracts";
import { Button, Icon } from "@opendesign/ui";
import { useEffect, useState } from "react";
import type { MessageKey } from "@/shared/i18n/messages";
import { useI18n } from "../../../../i18n";
import styles from "../PropertiesPanel.module.scss";
import type {
  ComponentInspectorOption,
  ComponentInspectorPreferredValueOption,
  ComponentInspectorPropertyDefinition,
  ComponentInspectorPropertyValue,
  ComponentInspectorSource,
} from "@/renderer/features/editor";
import { Field, TextAreaField } from "./controls";
import { SlotPropertyEditor } from "./SlotPropertyEditor";
import { moveOrderedItem, PropertyOrderButtons } from "./PropertyOrderButtons";

const nodeKindKeys: Record<DesignNode["kind"], MessageKey> = {
  frame: "node.frame",
  slot: "node.slot",
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
  slice: "node.slice",
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
  if (type === "INSTANCE_SWAP") return t("properties.instanceSwapProperty");
  return t("properties.slotProperty");
}

function propertySourceCandidates(
  sources: readonly ComponentInspectorSource[],
  type: ComponentPropertyType,
): readonly ComponentInspectorSource[] {
  if (type === "SLOT") {
    return sources.filter(
      (source) =>
        source.node.kind === "frame" &&
        (source.node.properties.layoutGuides?.length ?? 0) === 0,
    );
  }
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
  availableSlotPreferredValues,
  definitions,
  onAdd,
  onRemove,
  onRename,
  onReorder,
  onUpdateSlot,
  sources,
}: {
  availableSlotPreferredValues: readonly ComponentInspectorPreferredValueOption[];
  definitions: readonly ComponentInspectorPropertyDefinition[];
  onAdd: (input: {
    name: string;
    sourceNodeId: string;
    type: ComponentPropertyType;
  }) => void;
  onRemove: (propertyName: string) => void;
  onRename: (propertyName: string, name: string) => void;
  onReorder: (componentPropertyOrder: readonly string[]) => void;
  onUpdateSlot: (
    propertyName: string,
    input: {
      description?: string;
      preferredValues: readonly InstanceSwapPreferredValue[];
      settings: SlotSettings;
    },
  ) => void;
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
          {definitions.map((property, index) => {
            const slotDefinition =
              property.definition.type === "SLOT" ? property.definition : null;
            return (
              <div key={property.propertyName}>
                <div className={styles.componentPropertyDefinition}>
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
                  <PropertyOrderButtons
                    downDisabled={index === definitions.length - 1}
                    downLabel={t("properties.movePropertyDown", {
                      name: propertyLabel(property.propertyName),
                    })}
                    onDown={() =>
                      onReorder(
                        moveOrderedItem(
                          definitions.map((item) => item.propertyName),
                          index,
                          1,
                        ),
                      )
                    }
                    onUp={() =>
                      onReorder(
                        moveOrderedItem(
                          definitions.map((item) => item.propertyName),
                          index,
                          -1,
                        ),
                      )
                    }
                    upDisabled={index === 0}
                    upLabel={t("properties.movePropertyUp", {
                      name: propertyLabel(property.propertyName),
                    })}
                  />
                  <button
                    aria-label={`${t("properties.removeProperty")} ${propertyLabel(property.propertyName)}`}
                    onClick={() => onRemove(property.propertyName)}
                    type="button"
                  >
                    <Icon name="lucide:x" size={12} />
                  </button>
                </div>
                {slotDefinition && (
                  <SlotPropertyEditor
                    availableValues={availableSlotPreferredValues}
                    definition={slotDefinition}
                    onUpdate={(input) =>
                      onUpdateSlot(property.propertyName, input)
                    }
                  />
                )}
              </div>
            );
          })}
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
            <option value="SLOT">{t("properties.slotProperty")}</option>
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
  onClearSlot,
  onCreateSlotOverride,
  onResetSlot,
  properties,
}: {
  availableComponents: readonly ComponentInspectorOption[];
  onReset: (propertyName: string) => void;
  onSet: (propertyName: string, value: ComponentPropertyAssignment) => void;
  onClearSlot: (propertyName: string) => void;
  onCreateSlotOverride: (propertyName: string) => void;
  onResetSlot: (propertyName: string) => void;
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
            {property.definition.type === "SLOT" ? (
              <div className={styles.componentSlotValue}>
                <span>
                  {property.slot?.overridden
                    ? t("properties.slotOverridden", {
                        count: property.slot.childCount,
                      })
                    : t("properties.slotDefault", {
                        count: property.slot?.childCount ?? 0,
                      })}
                </span>
                {property.slot && property.slot.limitViolations.length > 0 && (
                  <small role="status">
                    {t("properties.slotLimitsViolated", {
                      count: property.slot.limitViolations.length,
                    })}
                  </small>
                )}
                <div className={styles.componentActions}>
                  {!property.slot?.overridden && (
                    <button
                      onClick={() =>
                        onCreateSlotOverride(property.propertyName)
                      }
                      type="button"
                    >
                      {t("properties.editSlotContents")}
                    </button>
                  )}
                  <button
                    onClick={() => onClearSlot(property.propertyName)}
                    type="button"
                  >
                    {t("properties.clearSlot")}
                  </button>
                  <button
                    disabled={!property.slot?.overridden}
                    onClick={() => onResetSlot(property.propertyName)}
                    type="button"
                  >
                    {t("properties.resetSlot")}
                  </button>
                </div>
              </div>
            ) : property.definition.type === "VARIANT" ? (
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
