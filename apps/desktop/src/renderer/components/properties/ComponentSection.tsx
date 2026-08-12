import type {
  BlendMode,
  ComponentOverridePatch,
  DesignNode,
  Effect,
  MaskMode,
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

export interface ComponentInspectorSource {
  node: DesignNode;
  overridden: boolean;
  sourcePath: readonly string[];
}

export interface ComponentInspectorOption {
  id: string;
  name: string;
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

export type ComponentInspectorContext = {
  availableComponents: readonly ComponentInspectorOption[];
  componentName: string;
  isMain: boolean;
  overrideCount: number;
  sourceNodes: readonly ComponentInspectorSource[];
};

export function ComponentSection({
  componentContext,
  node,
  onCreateComponent,
  onCreateComponentInstance,
  onDetachComponentInstance,
  onGoToComponentMain,
  onRemoveComponent,
  onResetComponentInstance,
  onResetComponentSourceOverride,
  onUpdateComponentOverride,
}: {
  componentContext?: ComponentInspectorContext;
  node: DesignNode;
  onCreateComponent: () => void;
  onCreateComponentInstance: () => void;
  onDetachComponentInstance: () => void;
  onGoToComponentMain: () => void;
  onRemoveComponent: () => void;
  onResetComponentInstance: () => void;
  onResetComponentSourceOverride: (sourcePath: readonly string[]) => void;
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
          <span>
            <Glyph
              name={componentContext.isMain ? "component" : "instance"}
              size={15}
            />
            <span>
              <strong>{componentContext.componentName}</strong>
              <small>
                {componentContext.isMain
                  ? t("properties.mainComponent")
                  : t("properties.instanceOverrideCount", {
                      count: componentContext.overrideCount,
                    })}
              </small>
            </span>
          </span>
          {componentContext.isMain ? (
            <div className={styles.componentActions}>
              <Button onClick={onCreateComponentInstance} tone="quiet">
                {t("properties.createInstance")}
              </Button>
              <Button onClick={onRemoveComponent} tone="quiet">
                {t("properties.removeComponent")}
              </Button>
            </div>
          ) : (
            <div className={styles.componentActions}>
              <Button onClick={onGoToComponentMain} tone="quiet">
                {t("properties.goToMain")}
              </Button>
              <Button
                disabled={componentContext.overrideCount === 0}
                onClick={onResetComponentInstance}
                tone="quiet"
              >
                {t("properties.resetOverrides")}
              </Button>
              <Button onClick={onDetachComponentInstance} tone="quiet">
                {t("properties.detachInstance")}
              </Button>
              <ComponentOverrideEditor
                availableComponents={componentContext.availableComponents}
                onReset={onResetComponentSourceOverride}
                onUpdate={onUpdateComponentOverride}
                sources={componentContext.sourceNodes}
              />
            </div>
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
