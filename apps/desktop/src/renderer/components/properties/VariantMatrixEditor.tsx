import { Button, Glyph } from "@opendesign/ui";
import { useState } from "react";
import { useI18n } from "../../i18n";
import panelStyles from "../PropertiesPanel.module.scss";
import styles from "./VariantMatrixEditor.module.scss";
import type { ComponentInspectorVariantSet } from "./ComponentIdentitySummary";
import { Field } from "./controls";
import { moveOrderedItem, PropertyOrderButtons } from "./PropertyOrderButtons";

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
            <PropertyOrderButtons
              downLabel={t("properties.moveVariantDown", { name })}
              downDisabled={index === variantSet.propertyOrder.length - 1}
              onDown={() =>
                onReorderProperties(
                  moveOrderedItem(variantSet.propertyOrder, index, 1),
                )
              }
              onUp={() =>
                onReorderProperties(
                  moveOrderedItem(variantSet.propertyOrder, index, -1),
                )
              }
              upDisabled={index === 0}
              upLabel={t("properties.moveVariantUp", { name })}
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
                    <PropertyOrderButtons
                      downLabel={t("properties.moveVariantDown", {
                        name: value,
                      })}
                      downDisabled={valueIndex === values.length - 1}
                      onDown={() =>
                        onReorderValues(
                          name,
                          moveOrderedItem(values, valueIndex, 1),
                        )
                      }
                      onUp={() =>
                        onReorderValues(
                          name,
                          moveOrderedItem(values, valueIndex, -1),
                        )
                      }
                      upDisabled={valueIndex === 0}
                      upLabel={t("properties.moveVariantUp", { name: value })}
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
