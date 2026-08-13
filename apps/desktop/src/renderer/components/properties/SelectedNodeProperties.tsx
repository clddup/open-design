import type {
  BooleanOperation,
  ComponentOverridePatch,
  DesignNode,
  LayoutConstraints,
  LineEndpoint,
} from "@opendesign/design-contracts";
import { Button, Glyph, IconButton, type GlyphName } from "@opendesign/ui";
import type { MessageKey } from "../../../shared/i18n/messages";
import { useI18n } from "../../i18n";
import type { UpdatePropertiesPatch } from "../../features/editor/types";
import styles from "../PropertiesPanel.module.scss";
import {
  AppearanceBasicsSection,
  PaintAndEffectsSections,
} from "./AppearanceSections";
import {
  ComponentSection,
  type ComponentInspectorContext,
} from "./ComponentSection";
import { ImageSection } from "./ImageSection";
import { TypographySection } from "./TypographySection";
import { Field, Section, commitNumber, formatNumber } from "./controls";

const nodeIcons: Record<DesignNode["kind"], GlyphName> = {
  frame: "frame",
  group: "layers",
  boolean: "boolean",
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
  polygon: "polygon",
  star: "star",
  text: "text",
  image: "assets",
  vector: "pen",
  path: "pen",
  instance: "instance",
};

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

const lineEndpoints: readonly LineEndpoint[] = [
  "none",
  "line-arrow",
  "triangle-arrow",
  "reversed-triangle-arrow",
  "circle",
  "diamond",
];

type RegularShapeNode = Extract<DesignNode, { kind: "polygon" | "star" }>;

function isRegularShapeNode(node: DesignNode): node is RegularShapeNode {
  return node.kind === "polygon" || node.kind === "star";
}

function lineEndpointKey(endpoint: LineEndpoint): MessageKey {
  return `properties.lineEndpoint.${endpoint}` as MessageKey;
}

export function SelectedNodeProperties({
  node,
  componentContext,
  booleanOperationEditable,
  booleanOperandParent,
  canDelete,
  constraintsAvailable,
  onBooleanOperationChange,
  onCreateComponent,
  onCreateComponentInstance,
  onDelete,
  onDetachComponentInstance,
  onDuplicate,
  onGoToComponentMain,
  onReplaceImage,
  onRemoveComponent,
  onResetComponentInstance,
  onResetComponentSourceOverride,
  onSelectBooleanParent,
  onSetConstraints,
  onUpdate,
  onUpdateComponentOverride,
}: {
  node: DesignNode;
  componentContext?: ComponentInspectorContext;
  booleanOperationEditable: boolean;
  booleanOperandParent?: { id: string; name: string };
  canDelete: boolean;
  constraintsAvailable: boolean;
  onBooleanOperationChange: (operation: BooleanOperation) => void;
  onCreateComponent: () => void;
  onCreateComponentInstance: () => void;
  onDelete: () => void;
  onDetachComponentInstance: () => void;
  onDuplicate: () => void;
  onGoToComponentMain: () => void;
  onReplaceImage: () => void;
  onRemoveComponent: () => void;
  onResetComponentInstance: () => void;
  onResetComponentSourceOverride: (sourcePath: readonly string[]) => void;
  onSelectBooleanParent: (nodeId: string) => void;
  onSetConstraints: (constraints: LayoutConstraints) => void;
  onUpdate: (updates: UpdatePropertiesPatch) => void;
  onUpdateComponentOverride: (
    sourcePath: readonly string[],
    patch: ComponentOverridePatch,
  ) => void;
}) {
  const { t } = useI18n();
  const updateTranslation = (index: 4 | 5, value: number) => {
    const transform: DesignNode["transform"] = [...node.transform];
    transform[index] = value;
    onUpdate({ transform });
  };
  const updateSize = (dimension: "height" | "width", value: number) => {
    onUpdate({ size: { ...node.size, [dimension]: value } });
  };

  return (
    <div>
      <div className={styles.selectionHeading}>
        <span className={styles.selectionIcon}>
          <Glyph name={nodeIcons[node.kind]} />
        </span>
        <span>
          <strong>
            {node.name ||
              t("sidebar.untitledNode", { kind: t(nodeKindKeys[node.kind]) })}
          </strong>
          <small>{t(nodeKindKeys[node.kind])}</small>
        </span>
        <span className={styles.selectionActions}>
          <IconButton
            icon="duplicate"
            label={t("properties.duplicateLayer")}
            onClick={onDuplicate}
          />
          <IconButton
            disabled={!canDelete}
            icon="trash"
            label={t("properties.deleteLayer")}
            onClick={onDelete}
          />
        </span>
      </div>
      {booleanOperandParent && (
        <Section title={t("properties.booleanSourceLayer")}>
          <div className={styles.contextNote}>
            <Glyph name="boolean" size={15} />
            <span>
              <strong>{t("properties.booleanAppearanceControlled")}</strong>
              <small>
                {t("properties.booleanAppearanceControlledDetail", {
                  name:
                    booleanOperandParent.name || t("properties.booleanGroup"),
                })}
              </small>
            </span>
            <button
              onClick={() => onSelectBooleanParent(booleanOperandParent.id)}
              type="button"
            >
              {t("properties.selectBooleanGroup")}
            </button>
          </div>
        </Section>
      )}
      <ComponentSection
        componentContext={componentContext}
        node={node}
        onCreateComponent={onCreateComponent}
        onCreateComponentInstance={onCreateComponentInstance}
        onDetachComponentInstance={onDetachComponentInstance}
        onGoToComponentMain={onGoToComponentMain}
        onRemoveComponent={onRemoveComponent}
        onResetComponentInstance={onResetComponentInstance}
        onResetComponentSourceOverride={onResetComponentSourceOverride}
        onUpdateComponentOverride={onUpdateComponentOverride}
      />
      <Section title={t("properties.layer")}>
        <div className={styles.stack}>
          <Field
            accessibleLabel={t("properties.layerName")}
            label={t("properties.name")}
            onCommit={(name) => {
              const next = name.trim();
              if (!next) return null;
              if (next !== node.name) onUpdate({ name: next });
              return next;
            }}
            type="text"
            value={node.name}
          />
          <div className={styles.toggles}>
            <label>
              <input
                checked={node.visible}
                onChange={(event) =>
                  onUpdate({ visible: event.target.checked })
                }
                type="checkbox"
              />
              {t("properties.visible")}
            </label>
            <label>
              <input
                checked={node.locked}
                onChange={(event) => onUpdate({ locked: event.target.checked })}
                type="checkbox"
              />
              {t("properties.locked")}
            </label>
          </div>
        </div>
      </Section>
      {node.kind === "boolean" && (
        <Section title={t("properties.booleanGroup")}>
          <label className={styles.select}>
            <span>{t("properties.booleanOperation")}</span>
            <select
              aria-label={t("properties.booleanOperation")}
              disabled={!booleanOperationEditable}
              onChange={(event) =>
                onBooleanOperationChange(event.target.value as BooleanOperation)
              }
              value={node.properties.operation}
            >
              <option value="union">{t("properties.booleanUnion")}</option>
              <option value="subtract">
                {t("properties.booleanSubtract")}
              </option>
              <option value="intersect">
                {t("properties.booleanIntersect")}
              </option>
              <option value="exclude">{t("properties.booleanExclude")}</option>
            </select>
          </label>
        </Section>
      )}
      {node.kind === "line" && (
        <Section title={t("properties.line")}>
          <div className={styles.grid}>
            <label className={styles.select}>
              <span>{t("properties.lineStart")}</span>
              <select
                aria-label={t("properties.lineStart")}
                onChange={(event) =>
                  onUpdate({
                    properties: {
                      startEndpoint: event.target.value as LineEndpoint,
                    },
                  })
                }
                value={node.properties.startEndpoint}
              >
                {lineEndpoints.map((endpoint) => (
                  <option key={endpoint} value={endpoint}>
                    {t(lineEndpointKey(endpoint))}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.select}>
              <span>{t("properties.lineEnd")}</span>
              <select
                aria-label={t("properties.lineEnd")}
                onChange={(event) =>
                  onUpdate({
                    properties: {
                      endEndpoint: event.target.value as LineEndpoint,
                    },
                  })
                }
                value={node.properties.endEndpoint}
              >
                {lineEndpoints.map((endpoint) => (
                  <option key={endpoint} value={endpoint}>
                    {t(lineEndpointKey(endpoint))}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button
            onClick={() =>
              onUpdate({
                properties: {
                  start: node.properties.end,
                  end: node.properties.start,
                },
              })
            }
            tone="quiet"
          >
            {t("properties.reverseLine")}
          </Button>
        </Section>
      )}
      {isRegularShapeNode(node) && (
        <Section title={t("properties.regularShape")}>
          <div className={styles.grid}>
            <Field
              accessibleLabel={t("properties.pointCount")}
              label={t("properties.pointCount")}
              max={60}
              min={3}
              onCommit={(draft) =>
                commitNumber(
                  draft,
                  node.properties.pointCount,
                  (pointCount) => onUpdate({ properties: { pointCount } }),
                  { min: 3, max: 60, integer: true },
                )
              }
              value={formatNumber(node.properties.pointCount)}
            />
            {node.kind === "star" && (
              <Field
                accessibleLabel={t("properties.starInnerRadius")}
                label={t("properties.starInnerRadius")}
                max={100}
                min={0}
                onCommit={(draft) =>
                  commitNumber(
                    draft,
                    node.properties.innerRadius * 100,
                    (innerRadius) =>
                      onUpdate({
                        properties: { innerRadius: innerRadius / 100 },
                      }),
                    { min: 0, max: 100 },
                  )
                }
                suffix="%"
                value={formatNumber(node.properties.innerRadius * 100)}
              />
            )}
          </div>
        </Section>
      )}
      <Section title={t("properties.layout")}>
        <div className={styles.grid}>
          <Field
            label="X"
            onCommit={(draft) =>
              commitNumber(draft, node.transform[4], (value) =>
                updateTranslation(4, value),
              )
            }
            value={formatNumber(node.transform[4])}
          />
          <Field
            label="Y"
            onCommit={(draft) =>
              commitNumber(draft, node.transform[5], (value) =>
                updateTranslation(5, value),
              )
            }
            value={formatNumber(node.transform[5])}
          />
          <Field
            accessibleLabel={t("properties.width")}
            disabled={node.kind === "boolean" || node.kind === "instance"}
            label="W"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                node.size.width,
                (value) => updateSize("width", value),
                { min: 0 },
              )
            }
            value={formatNumber(node.size.width)}
          />
          <Field
            accessibleLabel={t("properties.height")}
            disabled={node.kind === "boolean" || node.kind === "instance"}
            label="H"
            min={0}
            onCommit={(draft) =>
              commitNumber(
                draft,
                node.size.height,
                (value) => updateSize("height", value),
                { min: 0 },
              )
            }
            value={formatNumber(node.size.height)}
          />
        </div>
        {constraintsAvailable && (
          <div className={styles.grid}>
            <label className={styles.select}>
              <span>{t("properties.horizontalConstraint")}</span>
              <select
                aria-label={t("properties.horizontalConstraint")}
                onChange={(event) =>
                  onSetConstraints({
                    horizontal: event.target
                      .value as LayoutConstraints["horizontal"],
                    vertical: node.constraints?.vertical ?? "top",
                  })
                }
                value={node.constraints?.horizontal ?? "left"}
              >
                <option value="left">{t("properties.constraintLeft")}</option>
                <option value="right">{t("properties.constraintRight")}</option>
                <option value="left-right">
                  {t("properties.constraintLeftRight")}
                </option>
                <option value="center">
                  {t("properties.constraintCenter")}
                </option>
                <option value="scale">{t("properties.constraintScale")}</option>
              </select>
            </label>
            <label className={styles.select}>
              <span>{t("properties.verticalConstraint")}</span>
              <select
                aria-label={t("properties.verticalConstraint")}
                onChange={(event) =>
                  onSetConstraints({
                    horizontal: node.constraints?.horizontal ?? "left",
                    vertical: event.target
                      .value as LayoutConstraints["vertical"],
                  })
                }
                value={node.constraints?.vertical ?? "top"}
              >
                <option value="top">{t("properties.constraintTop")}</option>
                <option value="bottom">
                  {t("properties.constraintBottom")}
                </option>
                <option value="top-bottom">
                  {t("properties.constraintTopBottom")}
                </option>
                <option value="center">
                  {t("properties.constraintCenter")}
                </option>
                <option value="scale">{t("properties.constraintScale")}</option>
              </select>
            </label>
          </div>
        )}
      </Section>
      <AppearanceBasicsSection
        appearanceControlled={booleanOperandParent !== undefined}
        node={node}
        onUpdate={onUpdate}
      />
      {node.kind === "image" && (
        <ImageSection
          node={node}
          onChange={(placement) => onUpdate({ properties: { placement } })}
          onReplace={onReplaceImage}
        />
      )}
      {node.kind === "text" && (
        <TypographySection node={node} onUpdate={onUpdate} />
      )}
      <PaintAndEffectsSections
        appearanceControlled={booleanOperandParent !== undefined}
        node={node}
        onUpdate={onUpdate}
      />
    </div>
  );
}
