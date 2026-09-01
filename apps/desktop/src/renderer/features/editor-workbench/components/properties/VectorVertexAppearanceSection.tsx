import type {
  DesignNode,
  VectorVertexStrokeCap,
  VectorVertexStrokeJoin,
} from "@opendesign/design-contracts";
import { Button } from "@opendesign/ui";
import { vectorCornerRadiusEligibleVertexIds } from "@opendesign/geometry-service/vector-edit";
import { useI18n } from "../../../../i18n";
import styles from "../PropertiesPanel.module.scss";
import { Field, Section, commitNumber, formatNumber } from "./controls";

export type VectorVertexInspectorSelection = {
  nodeId: string;
  vertexIds: readonly string[];
};

export type VectorVertexAppearancePatch = {
  cornerRadius?: number | null;
  strokeCap?: VectorVertexStrokeCap | null;
  strokeJoin?: VectorVertexStrokeJoin | null;
};

type InspectorValue<T> = T | "inherit" | "mixed";

export function VectorVertexAppearanceSection({
  node,
  onChange,
  selection,
}: {
  node: DesignNode;
  onChange: (patch: VectorVertexAppearancePatch) => void;
  selection: VectorVertexInspectorSelection;
}) {
  const { t } = useI18n();
  if (
    selection.nodeId !== node.id ||
    (node.kind !== "path" && node.kind !== "vector") ||
    !("network" in node.properties)
  ) {
    return null;
  }
  const network = node.properties.network;
  const selectedIds = new Set(selection.vertexIds);
  const vertices = network.vertices.filter((vertex) =>
    selectedIds.has(vertex.id),
  );
  if (vertices.length === 0) return null;

  const cap = commonValue(
    vertices.map((vertex) => vertex.strokeCap ?? "inherit"),
  );
  const join = commonValue(
    vertices.map((vertex) => vertex.strokeJoin ?? "inherit"),
  );
  const cornerRadius = commonValue(
    vertices.map((vertex) => vertex.cornerRadius ?? "inherit"),
  );
  const cornerRadiusVertexIds = new Set(
    vectorCornerRadiusEligibleVertexIds(network),
  );
  const cornerRadiusAvailable = vertices.every((vertex) =>
    cornerRadiusVertexIds.has(vertex.id),
  );

  return (
    <Section
      title={t("properties.selectedVectorVertices", {
        count: vertices.length,
      })}
    >
      <div className={styles.grid}>
        <Field
          accessibleLabel={t("properties.vertexCornerRadius")}
          disabled={!cornerRadiusAvailable}
          label="R"
          min={0}
          onCommit={(draft) =>
            commitNumber(
              draft,
              typeof cornerRadius === "number" ? cornerRadius : 0,
              (value) => onChange({ cornerRadius: value }),
              { min: 0 },
            )
          }
          placeholder={
            cornerRadius === "mixed"
              ? t("properties.mixed")
              : cornerRadius === "inherit"
                ? t("properties.inherit")
                : undefined
          }
          suffix="px"
          value={
            typeof cornerRadius === "number" ? formatNumber(cornerRadius) : ""
          }
        />
        <Button onClick={() => onChange({ cornerRadius: null })} tone="quiet">
          {t("properties.inherit")}
        </Button>
        <label className={styles.select}>
          <span>{t("properties.vertexStrokeCap")}</span>
          <select
            aria-label={t("properties.vertexStrokeCap")}
            onChange={(event) =>
              onChange({
                strokeCap:
                  event.target.value === "inherit"
                    ? null
                    : (event.target.value as VectorVertexStrokeCap),
              })
            }
            value={cap}
          >
            {cap === "mixed" && (
              <option disabled value="mixed">
                {t("properties.mixed")}
              </option>
            )}
            <option value="inherit">{t("properties.inherit")}</option>
            <option value="none">{t("properties.strokeCapNone")}</option>
            <option value="round">{t("properties.strokeCapRound")}</option>
            <option value="square">{t("properties.strokeCapSquare")}</option>
          </select>
        </label>
        <label className={styles.select}>
          <span>{t("properties.vertexStrokeJoin")}</span>
          <select
            aria-label={t("properties.vertexStrokeJoin")}
            onChange={(event) =>
              onChange({
                strokeJoin:
                  event.target.value === "inherit"
                    ? null
                    : (event.target.value as VectorVertexStrokeJoin),
              })
            }
            value={join}
          >
            {join === "mixed" && (
              <option disabled value="mixed">
                {t("properties.mixed")}
              </option>
            )}
            <option value="inherit">{t("properties.inherit")}</option>
            <option value="miter">{t("properties.strokeJoinMiter")}</option>
            <option value="round">{t("properties.strokeJoinRound")}</option>
            <option value="bevel">{t("properties.strokeJoinBevel")}</option>
          </select>
        </label>
      </div>
    </Section>
  );
}

function commonValue<T>(values: readonly T[]): InspectorValue<T> {
  const first = values[0];
  return first !== undefined && values.every((value) => value === first)
    ? first
    : "mixed";
}
