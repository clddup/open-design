import type {
  BlendMode,
  ComponentPropertyAssignment,
  ComponentPropertyDefinition,
  ComponentPropertyType,
  ComponentOverridePatch,
  DesignNode,
  Effect,
  MaskMode,
  VariantPropertyDefinition,
} from "@opendesign/design-contracts";
import { Button, Glyph } from "@opendesign/ui";
import { useEffect, useState } from "react";
import type { MessageKey } from "../../../shared/i18n/messages";
import { useI18n } from "../../i18n";
import styles from "../PropertiesPanel.module.scss";
import {
  Field,
  Section,
  TextAreaField,
  commitNumber,
  cx,
  formatNumber,
} from "./controls";
import {
  EffectEditor,
  PaintEditor,
  blendModes,
  defaultEffect,
  isFillNode,
  isStrokeNode,
  maskModes,
} from "./PaintEffectEditors";
import {
  ComponentIdentitySummary,
  type ComponentInspectorVariantSet,
} from "./ComponentIdentitySummary";

export interface ComponentInspectorSource {
  node: DesignNode;
  overridden: boolean;
  sourcePath: readonly string[];
}

export interface ComponentInspectorOption {
  id: string;
  name: string;
}

export interface ComponentInspectorPropertyDefinition {
  definition: ComponentPropertyDefinition;
  propertyName: string;
  sourceNodeIds: readonly string[];
}

export interface ComponentInspectorPropertyValue {
  assigned: boolean;
  definition: ComponentPropertyDefinition | VariantPropertyDefinition;
  propertyName: string;
  value: ComponentPropertyAssignment;
}

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

function ComponentOverrideEditor({
  availableComponents,
  onReset,
  onUpdate,
  sources,
}: {
  availableComponents: readonly ComponentInspectorOption[];
  onReset: (sourcePath: readonly string[]) => void;
  onUpdate: (
    sourcePath: readonly string[],
    patch: ComponentOverridePatch,
  ) => void;
  sources: readonly ComponentInspectorSource[];
}) {
  const { t } = useI18n();
  const [selectedKey, setSelectedKey] = useState(
    () => sources[0]?.sourcePath.join("\u0000") ?? "",
  );
  const source =
    sources.find(
      (candidate) => candidate.sourcePath.join("\u0000") === selectedKey,
    ) ?? sources[0];

  useEffect(() => {
    if (!source && sources[0]) {
      setSelectedKey(sources[0].sourcePath.join("\u0000"));
    }
  }, [source, sources]);

  if (!source) return null;
  const sourceNode = source.node;
  const patchProperties = (properties: ComponentOverridePatch["properties"]) =>
    onUpdate(source.sourcePath, { properties });

  return (
    <div className={styles.componentOverrideEditor}>
      <div className={styles.componentOverrideHeading}>
        <span>{t("properties.instanceLayerOverride")}</span>
        <button
          disabled={!source.overridden}
          onClick={() => onReset(source.sourcePath)}
          type="button"
        >
          {t("properties.resetLayerOverride")}
        </button>
      </div>
      <label className={styles.select}>
        <span>{t("properties.sourceLayer")}</span>
        <select
          aria-label={t("properties.sourceLayer")}
          onChange={(event) => setSelectedKey(event.target.value)}
          value={source.sourcePath.join("\u0000")}
        >
          {sources.map((candidate) => {
            const key = candidate.sourcePath.join("\u0000");
            return (
              <option key={key} value={key}>
                {candidate.node.name || t(nodeKindKeys[candidate.node.kind])}
                {candidate.overridden ? ` · ${t("properties.overridden")}` : ""}
              </option>
            );
          })}
        </select>
      </label>
      <div className={styles.stack}>
        <Field
          accessibleLabel={t("properties.layerName")}
          label={t("properties.name")}
          onCommit={(name) => {
            const next = name.trim();
            if (!next) return null;
            if (next !== sourceNode.name)
              onUpdate(source.sourcePath, { name: next });
            return next;
          }}
          type="text"
          value={sourceNode.name}
        />
        <div className={styles.toggles}>
          <label>
            <input
              checked={sourceNode.visible}
              onChange={(event) =>
                onUpdate(source.sourcePath, { visible: event.target.checked })
              }
              type="checkbox"
            />
            {t("properties.visible")}
          </label>
        </div>
      </div>
      <div className={styles.grid}>
        <Field
          accessibleLabel={t("properties.opacity")}
          label="O"
          max={100}
          min={0}
          onCommit={(draft) =>
            commitNumber(
              draft,
              sourceNode.opacity * 100,
              (value) => onUpdate(source.sourcePath, { opacity: value / 100 }),
              { min: 0, max: 100 },
            )
          }
          suffix="%"
          value={formatNumber(sourceNode.opacity * 100)}
        />
        <label className={styles.select}>
          <span>{t("properties.blendMode")}</span>
          <select
            aria-label={t("properties.blendMode")}
            onChange={(event) =>
              onUpdate(source.sourcePath, {
                blendMode: event.target.value as BlendMode,
              })
            }
            value={sourceNode.blendMode ?? "pass-through"}
          >
            {blendModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.select}>
          <span>{t("properties.maskMode")}</span>
          <select
            aria-label={t("properties.maskMode")}
            onChange={(event) =>
              onUpdate(source.sourcePath, {
                maskMode: event.target.value as MaskMode,
              })
            }
            value={sourceNode.maskMode ?? "none"}
          >
            {maskModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
      </div>
      {sourceNode.kind === "text" && (
        <TextAreaField
          label={t("properties.textContent")}
          onCommit={(content) => patchProperties({ content })}
          value={sourceNode.properties.content}
        />
      )}
      {sourceNode.kind === "instance" && (
        <label className={styles.select}>
          <span>{t("properties.instanceSwap")}</span>
          <select
            aria-label={t("properties.instanceSwap")}
            onChange={(event) =>
              patchProperties({ componentId: event.target.value })
            }
            value={sourceNode.properties.componentId}
          >
            {availableComponents.map((component) => (
              <option key={component.id} value={component.id}>
                {component.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {isFillNode(sourceNode) && (
        <div className={styles.componentOverrideGroup}>
          <span>{t("properties.fill")}</span>
          {sourceNode.properties.fills.map((paint, index) => (
            <PaintEditor
              index={index}
              key={`${selectedKey}-fill-${index}`}
              onChange={(next) =>
                patchProperties({
                  fills: sourceNode.properties.fills.map(
                    (candidate, paintIndex) =>
                      paintIndex === index ? next : candidate,
                  ),
                })
              }
              onRemove={() =>
                patchProperties({
                  fills: sourceNode.properties.fills.filter(
                    (_, paintIndex) => paintIndex !== index,
                  ),
                })
              }
              paint={paint}
            />
          ))}
          <button
            className={styles.addPaint}
            onClick={() =>
              patchProperties({
                fills: [
                  ...sourceNode.properties.fills,
                  { type: "solid", color: "#808080", opacity: 1 },
                ],
              })
            }
            type="button"
          >
            <Glyph name="plus" size={13} />
            {t("properties.addFill")}
          </button>
        </div>
      )}
      {isStrokeNode(sourceNode) && (
        <div className={styles.componentOverrideGroup}>
          <span>{t("properties.stroke")}</span>
          {sourceNode.properties.strokes.map((paint, index) => (
            <PaintEditor
              index={index}
              key={`${selectedKey}-stroke-${index}`}
              onChange={(next) =>
                patchProperties({
                  strokes: sourceNode.properties.strokes.map(
                    (candidate, paintIndex) =>
                      paintIndex === index ? next : candidate,
                  ),
                })
              }
              onRemove={() =>
                patchProperties({
                  strokes: sourceNode.properties.strokes.filter(
                    (_, paintIndex) => paintIndex !== index,
                  ),
                })
              }
              paint={paint}
            />
          ))}
        </div>
      )}
      <div className={styles.componentOverrideGroup}>
        <span>{t("properties.effects")}</span>
        {(sourceNode.effects ?? []).map((effect, index) => (
          <EffectEditor
            effect={effect}
            index={index}
            key={`${selectedKey}-effect-${index}`}
            onChange={(next) =>
              onUpdate(source.sourcePath, {
                effects: (sourceNode.effects ?? []).map(
                  (candidate, effectIndex) =>
                    effectIndex === index ? next : candidate,
                ),
              })
            }
            onRemove={() =>
              onUpdate(source.sourcePath, {
                effects: (sourceNode.effects ?? []).filter(
                  (_, effectIndex) => effectIndex !== index,
                ),
              })
            }
          />
        ))}
        <label className={cx(styles.select, styles.effectAdd)}>
          <span>{t("properties.addEffect")}</span>
          <select
            aria-label={t("properties.addEffect")}
            onChange={(event) => {
              const type = event.target.value as Effect["type"] | "";
              if (!type) return;
              onUpdate(source.sourcePath, {
                effects: [...(sourceNode.effects ?? []), defaultEffect(type)],
              });
              event.target.value = "";
            }}
            value=""
          >
            <option value="">{t("properties.chooseEffect")}</option>
            <option value="drop-shadow">{t("properties.dropShadow")}</option>
            <option value="inner-shadow">{t("properties.innerShadow")}</option>
            <option value="outer-glow">{t("properties.outerGlow")}</option>
            <option value="inner-glow">{t("properties.innerGlow")}</option>
            <option value="layer-blur">{t("properties.layerBlur")}</option>
          </select>
        </label>
      </div>
    </div>
  );
}

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

function ComponentPropertyAuthoring({
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

function ComponentPropertyValues({
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

export type ComponentInspectorContext = {
  availableComponents: readonly ComponentInspectorOption[];
  componentName: string;
  componentProperties: readonly ComponentInspectorPropertyValue[];
  componentPropertyDefinitions: readonly ComponentInspectorPropertyDefinition[];
  isMain: boolean;
  overrideCount: number;
  sourceNodes: readonly ComponentInspectorSource[];
  variantSet?: ComponentInspectorVariantSet;
};

export function ComponentSection({
  componentContext,
  node,
  onCreateComponent,
  onCreateComponentInstance,
  onDuplicateVariant,
  onDissolveVariantSet,
  onDetachComponentInstance,
  onGoToComponentMain,
  onRemoveComponent,
  onRemoveVariant,
  onAddComponentProperty,
  onRemoveComponentProperty,
  onRenameComponentProperty,
  onResetComponentInstance,
  onResetComponentSourceOverride,
  onResetComponentProperty,
  onSetComponentProperty,
  onUpdateComponentOverride,
}: {
  componentContext?: ComponentInspectorContext;
  node: DesignNode;
  onCreateComponent: () => void;
  onCreateComponentInstance: () => void;
  onDuplicateVariant: () => void;
  onDissolveVariantSet: () => void;
  onDetachComponentInstance: () => void;
  onGoToComponentMain: () => void;
  onRemoveComponent: () => void;
  onRemoveVariant: () => void;
  onAddComponentProperty: (input: {
    name: string;
    sourceNodeId: string;
    type: ComponentPropertyType;
  }) => void;
  onRemoveComponentProperty: (propertyName: string) => void;
  onRenameComponentProperty: (propertyName: string, name: string) => void;
  onResetComponentInstance: () => void;
  onResetComponentSourceOverride: (sourcePath: readonly string[]) => void;
  onResetComponentProperty: (propertyName: string) => void;
  onSetComponentProperty: (
    propertyName: string,
    value: ComponentPropertyAssignment,
  ) => void;
  onUpdateComponentOverride: (
    sourcePath: readonly string[],
    patch: ComponentOverridePatch,
  ) => void;
}) {
  const { t } = useI18n();
  if (!componentContext && node.kind !== "frame" && node.kind !== "group") {
    return null;
  }
  return (
    <Section title={t("properties.component")}>
      {componentContext ? (
        <div className={styles.componentCard}>
          <ComponentIdentitySummary
            componentName={componentContext.componentName}
            isMain={componentContext.isMain}
            overrideCount={componentContext.overrideCount}
            variantSet={componentContext.variantSet}
          />
          {componentContext.variantSet?.isRoot ? (
            <div className={styles.componentActions}>
              <Button onClick={onDuplicateVariant} tone="quiet">
                {t("properties.addVariant")}
              </Button>
              <Button onClick={onDissolveVariantSet} tone="quiet">
                {t("properties.dissolveVariantSet")}
              </Button>
            </div>
          ) : componentContext.isMain ? (
            <>
              <div className={styles.componentActions}>
                <Button onClick={onCreateComponentInstance} tone="quiet">
                  {t("properties.createInstance")}
                </Button>
                {!componentContext.variantSet && (
                  <Button onClick={onRemoveComponent} tone="quiet">
                    {t("properties.removeComponent")}
                  </Button>
                )}
                {componentContext.variantSet && (
                  <>
                    <Button onClick={onDuplicateVariant} tone="quiet">
                      {t("properties.duplicateVariant")}
                    </Button>
                    <Button onClick={onRemoveVariant} tone="quiet">
                      {t("properties.removeVariant")}
                    </Button>
                  </>
                )}
              </div>
              <ComponentPropertyAuthoring
                definitions={componentContext.componentPropertyDefinitions}
                onAdd={onAddComponentProperty}
                onRemove={onRemoveComponentProperty}
                onRename={onRenameComponentProperty}
                sources={componentContext.sourceNodes}
              />
            </>
          ) : (
            <>
              <ComponentPropertyValues
                availableComponents={componentContext.availableComponents}
                onReset={onResetComponentProperty}
                onSet={onSetComponentProperty}
                properties={componentContext.componentProperties}
              />
              <div className={styles.componentActions}>
                <Button onClick={onGoToComponentMain} tone="quiet">
                  {t("properties.goToMain")}
                </Button>
                <Button onClick={onDetachComponentInstance} tone="quiet">
                  {t("properties.detachInstance")}
                </Button>
              </div>
              <details className={styles.componentAdvancedOverrides}>
                <summary>{t("properties.advancedOverrides")}</summary>
                <Button
                  disabled={componentContext.overrideCount === 0}
                  onClick={onResetComponentInstance}
                  tone="quiet"
                >
                  {t("properties.resetOverrides")}
                </Button>
                <ComponentOverrideEditor
                  availableComponents={componentContext.availableComponents}
                  onReset={onResetComponentSourceOverride}
                  onUpdate={onUpdateComponentOverride}
                  sources={componentContext.sourceNodes}
                />
              </details>
            </>
          )}
        </div>
      ) : (
        <Button onClick={onCreateComponent} tone="quiet">
          {t("properties.createComponent")}
        </Button>
      )}
    </Section>
  );
}
