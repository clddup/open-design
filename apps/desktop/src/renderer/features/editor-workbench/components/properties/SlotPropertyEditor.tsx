import type {
  ComponentPropertyDefinition,
  InstanceSwapPreferredValue,
  SlotSettings,
} from "@opendesign/design-contracts";
import { useI18n } from "../../../../i18n";
import type { ComponentInspectorPreferredValueOption } from "../../../editor";
import { Field, TextAreaField } from "./controls";
import styles from "./SlotPropertyEditor.module.scss";

type SlotDefinition = Extract<ComponentPropertyDefinition, { type: "SLOT" }>;

export function SlotPropertyEditor({
  availableValues,
  definition,
  onUpdate,
}: {
  availableValues: readonly ComponentInspectorPreferredValueOption[];
  definition: SlotDefinition;
  onUpdate: (input: {
    description?: string;
    preferredValues: readonly InstanceSwapPreferredValue[];
    settings: SlotSettings;
  }) => void;
}) {
  const { t } = useI18n();
  const preferredValues = definition.preferredValues ?? [];
  const update = (patch: Partial<SlotSettings>) =>
    onUpdate({
      description: definition.description,
      preferredValues,
      settings: { ...(definition.slotSettings ?? {}), ...patch },
    });
  return (
    <details className={styles.root}>
      <summary>{t("properties.slotSettings")}</summary>
      <div className={styles.grid}>
        <SlotCountField
          label={t("properties.minimum")}
          onChange={(value) => update({ minChildren: value })}
          value={definition.slotSettings?.minChildren}
        />
        <SlotCountField
          label={t("properties.maximum")}
          onChange={(value) => update({ maxChildren: value })}
          value={definition.slotSettings?.maxChildren}
        />
      </div>
      <div className={styles.toggles}>
        {(
          [
            ["stretchChildOnInsert", "properties.slotStretchOnInsert"],
            ["displayEmptyByDefault", "properties.slotDisplayEmpty"],
            ["allowPreferredValuesOnly", "properties.slotPreferredOnly"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              checked={definition.slotSettings?.[key] ?? false}
              onChange={(event) => update({ [key]: event.target.checked })}
              type="checkbox"
            />
            {t(label)}
          </label>
        ))}
      </div>
      <label className={styles.select}>
        <span>{t("properties.slotPreferredInstances")}</span>
        <select
          aria-label={t("properties.slotPreferredInstances")}
          multiple
          onChange={(event) =>
            onUpdate({
              description: definition.description,
              preferredValues: Array.from(
                event.target.selectedOptions,
                (option) => decodePreferredValue(option.value),
              ),
              settings: definition.slotSettings ?? {},
            })
          }
          value={preferredValues.map(encodePreferredValue)}
        >
          {availableValues.map((option) => (
            <option
              key={encodePreferredValue(option)}
              value={encodePreferredValue(option)}
            >
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <TextAreaField
        label={t("properties.description")}
        onCommit={(description) =>
          onUpdate({
            description,
            preferredValues,
            settings: definition.slotSettings ?? {},
          })
        }
        value={definition.description ?? ""}
      />
    </details>
  );
}

function SlotCountField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number | null) => void;
  value: number | null | undefined;
}) {
  return (
    <Field
      accessibleLabel={label}
      label={label}
      min={0}
      onCommit={(draft) => {
        const parsed = draft.trim() ? Number.parseInt(draft, 10) : null;
        if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0))
          return null;
        onChange(parsed);
        return parsed === null ? "" : String(parsed);
      }}
      type="number"
      value={String(value ?? "")}
    />
  );
}

function encodePreferredValue(value: InstanceSwapPreferredValue): string {
  return `${value.type}:${value.key}`;
}

function decodePreferredValue(value: string): InstanceSwapPreferredValue {
  const separator = value.indexOf(":");
  const type = value.slice(0, separator);
  return {
    type: type === "COMPONENT_SET" ? "COMPONENT_SET" : "COMPONENT",
    key: value.slice(separator + 1),
  };
}
