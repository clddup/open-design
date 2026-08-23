import { Icon } from "@opendesign/ui";
import { useI18n } from "../../../../i18n";
import styles from "../PropertiesPanel.module.scss";

export type ComponentInspectorVariantSet = {
  id: string;
  isDefault: boolean;
  isRoot: boolean;
  name: string;
  properties: Readonly<Record<string, string>>;
  variantCount: number;
  propertyOrder: readonly string[];
  propertyDefinitions: Readonly<
    Record<string, { defaultValue: string; variantOptions: readonly string[] }>
  >;
  members: readonly {
    componentId: string;
    name: string;
    rootNodeId: string;
    properties: Readonly<Record<string, string>>;
  }[];
};

export function ComponentIdentitySummary({
  componentName,
  isMain,
  overrideCount,
  variantSet,
}: {
  componentName: string;
  isMain: boolean;
  overrideCount: number;
  variantSet?: ComponentInspectorVariantSet;
}) {
  const { t } = useI18n();
  return (
    <>
      <span>
        <Icon
          name={
            variantSet?.isRoot || isMain ? "lucide:component" : "lucide:diamond"
          }
          size={15}
        />
        <span>
          <strong>{componentName}</strong>
          <small>
            {variantSet?.isRoot
              ? t("properties.componentSetVariantCount", {
                  count: variantSet.variantCount,
                })
              : isMain
                ? variantSet
                  ? variantSet.isDefault
                    ? t("properties.defaultVariant")
                    : t("properties.variant")
                  : t("properties.mainComponent")
                : t("properties.instanceOverrideCount", {
                    count: overrideCount,
                  })}
          </small>
        </span>
      </span>
      {variantSet && !variantSet.isRoot && (
        <div className={styles.variantFacts}>
          {Object.entries(variantSet.properties).map(([name, value]) => (
            <span key={name}>
              <small>{name}</small>
              <strong>{value}</strong>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
