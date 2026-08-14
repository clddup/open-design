import { Button, Glyph } from "@opendesign/ui";
import { useState } from "react";
import { useI18n } from "../../i18n";
import panelStyles from "../PropertiesPanel.module.scss";
import styles from "./VariantMatrixEditor.module.scss";
import type { ComponentInspectorVariantSet } from "./ComponentIdentitySummary";
import { Field } from "./controls";

export function VariantMatrixEditor({
  onAddProperty,
  onRemoveProperty,
  onRenameProperty,
  onRenameValue,
  onReorderProperties,
  onReorderValues,
  onSetMemberProperties,
  variantSet,
}: {
  onAddProperty: (name: string) => void;
  onRemoveProperty: (propertyName: string) => void;
  onRenameProperty: (propertyName: string, name: string) => void;
  onRenameValue: (propertyName: string, value: string, name: string) => void;
  onReorderProperties: (propertyOrder: readonly string[]) => void;
  onReorderValues: (propertyName: string, values: readonly string[]) => void;
  onSetMemberProperties: (
    componentId: string,
    properties: Readonly<Record<string, string>>,
  ) => void;
  variantSet: ComponentInspectorVariantSet;
}) {
  const { t } = useI18n();
  const [propertyName, setPropertyName] = useState("");
  return (
    <div className={styles.variantMatrix}>
      <div className={panelStyles.componentPropertyHeading}>
        <span>{t("properties.variantProperties")}</span>
        <small>{variantSet.propertyOrder.length}</small>
      </div>
      <div className={styles.variantPropertyList}>
        {variantSet.propertyOrder.map((name, index) => (
          <div className={styles.variantProperty} key={name}>
            <Field
              accessibleLabel={t("properties.variantPropertyName", {
                name,
              })}
              label="P"
              onCommit={(draft) => {
                const next = draft.trim();
                if (!next) return null;
                if (next !== name) onRenameProperty(name, next);
                return next;
              }}
              type="text"
              value={name}
            />
            <OrderButtons
              downDisabled={index === variantSet.propertyOrder.length - 1}
              label={name}
              onDown={() =>
                onReorderProperties(
                  moveItem(variantSet.propertyOrder, index, 1),
                )
              }
              onUp={() =>
                onReorderProperties(
                  moveItem(variantSet.propertyOrder, index, -1),
                )
              }
              upDisabled={index === 0}
            />
            <button
              aria-label={t("properties.removeVariantProperty", { name })}
              className={styles.variantRemove}
              onClick={() => onRemoveProperty(name)}
              type="button"
            >
              <Glyph name="close" size={12} />
            </button>
            <div className={styles.variantValues}>
              {variantSet.propertyDefinitions[name]?.variantOptions.map(
                (value, valueIndex, values) => (
                  <div className={styles.variantValue} key={value}>
                    <Field
                      accessibleLabel={t("properties.variantValueName", {
                        name: value,
                      })}
                      label="V"
                      onCommit={(draft) => {
                        const next = draft.trim();
                        if (!next) return null;
                        if (next !== value) onRenameValue(name, value, next);
                        return next;
                      }}
                      type="text"
                      value={value}
                    />
                    <OrderButtons
                      downDisabled={valueIndex === values.length - 1}
                      label={value}
                      onDown={() =>
                        onReorderValues(name, moveItem(values, valueIndex, 1))
                      }
                      onUp={() =>
                        onReorderValues(name, moveItem(values, valueIndex, -1))
                      }
                      upDisabled={valueIndex === 0}
                    />
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.variantPropertyComposer}>
        <Field
          accessibleLabel={t("properties.newVariantProperty")}
          label="P"
          onCommit={(draft) => {
            setPropertyName(draft);
            return draft;
          }}
          placeholder={t("properties.newVariantProperty")}
          type="text"
          value={propertyName}
        />
        <Button
          disabled={!propertyName.trim()}
          onClick={() => {
            const next = propertyName.trim();
            if (!next) return;
            onAddProperty(next);
            setPropertyName("");
          }}
          tone="quiet"
        >
          {t("properties.addVariantProperty")}
        </Button>
      </div>
      <div className={styles.variantMemberMatrix}>
        <div className={panelStyles.componentPropertyHeading}>
          <span>{t("properties.variantCombinations")}</span>
          <small>{variantSet.members.length}</small>
        </div>
        {variantSet.members.map((member) => (
          <div className={styles.variantMember} key={member.componentId}>
            <strong>{member.name}</strong>
            {variantSet.propertyOrder.map((name) => (
              <Field
                accessibleLabel={t("properties.variantMemberValue", {
                  component: member.name,
                  property: name,
                })}
                key={name}
                label={name.slice(0, 1).toUpperCase()}
                onCommit={(draft) => {
                  const next = draft.trim();
                  if (!next) return null;
                  if (next !== member.properties[name]) {
                    onSetMemberProperties(member.componentId, {
                      ...member.properties,
                      [name]: next,
                    });
                  }
                  return next;
                }}
                type="text"
                value={member.properties[name] ?? ""}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderButtons({
  downDisabled,
  label,
  onDown,
  onUp,
  upDisabled,
}: {
  downDisabled: boolean;
  label: string;
  onDown: () => void;
  onUp: () => void;
  upDisabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <span className={styles.variantOrderButtons}>
      <button
        aria-label={t("properties.moveVariantUp", { name: label })}
        disabled={upDisabled}
        onClick={onUp}
        type="button"
      >
        ↑
      </button>
      <button
        aria-label={t("properties.moveVariantDown", { name: label })}
        disabled={downDisabled}
        onClick={onDown}
        type="button"
      >
        ↓
      </button>
    </span>
  );
}

function moveItem<T>(values: readonly T[], index: number, delta: -1 | 1): T[] {
  const next = [...values];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  const [value] = next.splice(index, 1);
  if (value !== undefined) next.splice(target, 0, value);
  return next;
}
