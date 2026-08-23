import type {
  ComponentPropertyAssignment,
  ComponentPropertyType,
  ComponentOverridePatch,
  DesignDocument,
  DesignOperation,
  InstanceSwapPreferredValue,
  SlotSettings,
} from "@opendesign/design-contracts";
import {
  componentMainNodeId,
  planAddComponentProperty,
  planAddComponentToVariantSet,
  planClearComponentSlot,
  planCreateComponent,
  planCreateInstance,
  planCreateComponentSlotOverride,
  planCombineComponentsAsVariants,
  planDissolveVariantSet,
  planDuplicateVariant,
  planDetachComponentInstance,
  planResetComponentOverrides,
  planRemoveComponent,
  planRemoveComponentProperty,
  planRemoveVariantFromSet,
  planRenameComponentProperty,
  planResetComponentPropertyValue,
  planResetComponentSlot,
  planSetComponentOverride,
  planSetComponentPropertyValue,
  planSetComponentSlotSettings,
  type ComponentOperationPlan,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import { useCallback } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import type { AssetActionResult } from "../../design-tools/design-assets";
import { useComponentPropertyOrderAction } from "./use-component-property-order-action";
import { useVariantMatrixActions } from "./use-variant-matrix-actions";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useComponentActions({
  activePageId,
  activatePage,
  applyCommands,
  runtime,
  setEditorError,
  t,
  transactionCounter,
}: {
  activePageId: string;
  activatePage: (pageId: string) => void;
  applyCommands: (label: string, commands: DesignOperation[]) => boolean;
  runtime: EditorRuntime;
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
}) {
  const createComponentFromSelection = useCallback(() => {
    const current = runtime.getSnapshot();
    const nodeId = singleSelection(current.state.selection.nodeIds);
    const node = nodeId ? current.document.nodesById[nodeId] : undefined;
    if (!nodeId || !node) return;
    const operationId = `component_create_${Date.now()}_${++transactionCounter.current}`;
    const plan = planCreateComponent(current.document, {
      componentId: operationId,
      nodeId,
      name: node.name || t("properties.untitledComponent"),
      commandPrefix: operationId,
    });
    if (!plan.ok) {
      setEditorError(plan.message);
      return;
    }
    applyCommands(t("history.createComponent"), plan.commands);
  }, [applyCommands, runtime, setEditorError, t, transactionCounter]);

  const createSelectedComponentInstance = useCallback(() => {
    const current = runtime.getSnapshot();
    const nodeId = singleSelection(current.state.selection.nodeIds);
    const component = Object.values(current.document.componentsById).find(
      (candidate) => candidate.rootNodeId === nodeId,
    );
    const page = current.document.pagesById[activePageId];
    if (!component || !page) return;
    const source = current.document.nodesById[component.rootNodeId];
    const operationId = `component_instance_${Date.now()}_${++transactionCounter.current}`;
    const plan = planCreateInstance(current.document, {
      componentId: component.id,
      instanceId: operationId,
      pageId: activePageId,
      parentId: null,
      index: page.rootNodeIds.length,
      transform: source
        ? [
            1,
            0,
            0,
            1,
            source.transform[4] + source.size.width + 32,
            source.transform[5],
          ]
        : [1, 0, 0, 1, 64, 64],
      commandPrefix: operationId,
    });
    applyInstancePlan(plan);
  }, [activePageId, runtime, transactionCounter]);

  const combineSelectedComponentsAsVariants = useCallback(() => {
    const current = runtime.getSnapshot();
    const componentsByRoot = new Map(
      Object.values(current.document.componentsById).map((component) => [
        component.rootNodeId,
        component,
      ]),
    );
    const components = current.state.selection.nodeIds.flatMap((nodeId) => {
      const component = componentsByRoot.get(nodeId);
      return component ? [component] : [];
    });
    if (
      components.length < 2 ||
      components.length !== current.state.selection.nodeIds.length ||
      components.some((component) => component.variantSetId)
    ) {
      return;
    }
    const operationId = `variant_set_${Date.now()}_${++transactionCounter.current}`;
    const inferred = inferVariantFacts(
      components,
      t("properties.componentSet"),
    );
    const plan = planCombineComponentsAsVariants(current.document, {
      pageId: activePageId,
      componentIds: components.map((component) => component.id),
      variantSetId: operationId,
      rootNodeId: `${operationId}_root`,
      name: inferred.setName,
      variantPropertiesByComponentId: Object.fromEntries(
        components.map((component, index) => [
          component.id,
          { [inferred.propertyName]: inferred.values[index] },
        ]),
      ),
      commandPrefix: operationId,
    });
    if (!plan.ok) {
      setEditorError(plan.message);
      return;
    }
    if (applyCommands(t("history.combineAsVariants"), plan.commands)) {
      runtime.setSelection(plan.selectionNodeIds, plan.rootNodeId);
    }
  }, [
    activePageId,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  ]);

  const addSelectedComponentToVariantSet = useCallback(() => {
    const current = runtime.getSnapshot();
    const set = Object.values(current.document.variantSetsById).find(
      (candidate) =>
        current.state.selection.nodeIds.includes(candidate.rootNodeId),
    );
    const component = Object.values(current.document.componentsById).find(
      (candidate) =>
        !candidate.variantSetId &&
        current.state.selection.nodeIds.includes(candidate.rootNodeId),
    );
    if (!set || !component || current.state.selection.nodeIds.length !== 2)
      return;
    const operationId = `variant_add_${Date.now()}_${++transactionCounter.current}`;
    const plan = planAddComponentToVariantSet(current.document, {
      pageId: activePageId,
      variantSetId: set.id,
      componentId: component.id,
      variantProperties: nextVariantProperties(
        current.document,
        set.id,
        component.name,
      ),
      commandPrefix: operationId,
    });
    if (!plan.ok) return setEditorError(plan.message);
    if (applyCommands(t("history.addVariant"), plan.commands))
      runtime.setSelection([component.rootNodeId], component.rootNodeId);
  }, [
    activePageId,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  ]);

  const duplicateSelectedVariant = useCallback(() => {
    const current = runtime.getSnapshot();
    const nodeId = singleSelection(current.state.selection.nodeIds);
    const selectedSet = Object.values(current.document.variantSetsById).find(
      (candidate) => candidate.rootNodeId === nodeId,
    );
    const source = selectedSet
      ? current.document.componentsById[selectedSet.defaultComponentId]
      : Object.values(current.document.componentsById).find(
          (candidate) =>
            candidate.rootNodeId === nodeId && candidate.variantSetId,
        );
    const set = source?.variantSetId
      ? current.document.variantSetsById[source.variantSetId]
      : selectedSet;
    if (!source || !set) return;
    const operationId = `variant_duplicate_${Date.now()}_${++transactionCounter.current}`;
    const rootNodeId = `${operationId}_root`;
    const plan = planDuplicateVariant(current.document, {
      pageId: activePageId,
      variantSetId: set.id,
      sourceComponentId: source.id,
      componentId: operationId,
      rootNodeId,
      variantProperties: nextVariantProperties(
        current.document,
        set.id,
        source.name,
      ),
      commandPrefix: operationId,
    });
    if (!plan.ok) return setEditorError(plan.message);
    if (applyCommands(t("history.duplicateVariant"), plan.commands))
      runtime.setSelection([rootNodeId], rootNodeId);
  }, [
    activePageId,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  ]);

  const removeSelectedVariantFromSet = useCallback(() => {
    const current = runtime.getSnapshot();
    const nodeId = singleSelection(current.state.selection.nodeIds);
    const component = Object.values(current.document.componentsById).find(
      (candidate) => candidate.rootNodeId === nodeId && candidate.variantSetId,
    );
    if (!component?.variantSetId) return;
    const operationId = `variant_remove_${Date.now()}_${++transactionCounter.current}`;
    const plan = planRemoveVariantFromSet(current.document, {
      pageId: activePageId,
      variantSetId: component.variantSetId,
      componentId: component.id,
      commandPrefix: operationId,
    });
    if (!plan.ok) return setEditorError(plan.message);
    if (applyCommands(t("history.removeVariant"), plan.commands))
      runtime.setSelection(plan.selectionNodeIds, plan.selectionNodeIds.at(-1));
  }, [
    activePageId,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  ]);

  const dissolveSelectedVariantSet = useCallback(() => {
    const current = runtime.getSnapshot();
    const nodeId = singleSelection(current.state.selection.nodeIds);
    const set = Object.values(current.document.variantSetsById).find(
      (candidate) => candidate.rootNodeId === nodeId,
    );
    if (!set) return;
    const operationId = `variant_dissolve_${Date.now()}_${++transactionCounter.current}`;
    const plan = planDissolveVariantSet(current.document, {
      pageId: activePageId,
      variantSetId: set.id,
      commandPrefix: operationId,
    });
    if (!plan.ok) return setEditorError(plan.message);
    if (applyCommands(t("history.dissolveVariantSet"), plan.commands))
      runtime.setSelection(plan.selectionNodeIds, plan.selectionNodeIds.at(-1));
  }, [
    activePageId,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  ]);

  const variantMatrixActions = useVariantMatrixActions({
    activePageId,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  });

  const removeSelectedComponent = useCallback(() => {
    const current = runtime.getSnapshot();
    const nodeId = singleSelection(current.state.selection.nodeIds);
    const component = Object.values(current.document.componentsById).find(
      (candidate) => candidate.rootNodeId === nodeId,
    );
    if (!component) return;
    const operationId = `component_remove_${Date.now()}_${++transactionCounter.current}`;
    const plan = planRemoveComponent(current.document, {
      componentId: component.id,
      commandPrefix: operationId,
    });
    if (!plan.ok) {
      setEditorError(plan.message);
      return;
    }
    applyCommands(t("history.removeComponent"), plan.commands);
  }, [applyCommands, runtime, setEditorError, t, transactionCounter]);

  const applyPropertyPlan = useCallback(
    (label: string, plan: ComponentOperationPlan) => {
      if (!plan.ok) {
        setEditorError(plan.code === "no-op" ? null : plan.message);
        return;
      }
      applyCommands(label, plan.commands);
    },
    [applyCommands, setEditorError],
  );

  const addSelectedComponentProperty = useCallback(
    (input: {
      name: string;
      sourceNodeId: string;
      type: ComponentPropertyType;
      preferredComponentIds?: readonly string[];
    }) => {
      const current = runtime.getSnapshot();
      const nodeId = singleSelection(current.state.selection.nodeIds);
      const component = Object.values(current.document.componentsById).find(
        (candidate) => candidate.rootNodeId === nodeId,
      );
      if (!component) return;
      const operationId = `component_property_${Date.now()}_${++transactionCounter.current}`;
      const plan = planAddComponentProperty(current.document, {
        componentId: component.id,
        propertyId: `${component.id}:${transactionCounter.current}`,
        name: input.name,
        type: input.type,
        sourceNodeId: input.sourceNodeId,
        ...(input.preferredComponentIds?.length
          ? {
              preferredValues: input.preferredComponentIds.map((key) => ({
                type: "COMPONENT" as const,
                key,
              })),
            }
          : {}),
        commandPrefix: operationId,
      });
      applyPropertyPlan(t("history.addComponentProperty"), plan);
    },
    [applyPropertyPlan, runtime, t, transactionCounter],
  );

  const renameSelectedComponentProperty = useCallback(
    (propertyName: string, name: string) => {
      const current = runtime.getSnapshot();
      const nodeId = singleSelection(current.state.selection.nodeIds);
      const component = Object.values(current.document.componentsById).find(
        (candidate) => candidate.rootNodeId === nodeId,
      );
      if (!component) return;
      const operationId = `component_property_rename_${Date.now()}_${++transactionCounter.current}`;
      const plan = planRenameComponentProperty(current.document, {
        componentId: component.id,
        propertyName,
        name,
        commandPrefix: operationId,
      });
      applyPropertyPlan(t("history.renameComponentProperty"), plan);
    },
    [applyPropertyPlan, runtime, t, transactionCounter],
  );

  const removeSelectedComponentProperty = useCallback(
    (propertyName: string) => {
      const current = runtime.getSnapshot();
      const nodeId = singleSelection(current.state.selection.nodeIds);
      const component = Object.values(current.document.componentsById).find(
        (candidate) => candidate.rootNodeId === nodeId,
      );
      if (!component) return;
      const operationId = `component_property_remove_${Date.now()}_${++transactionCounter.current}`;
      const plan = planRemoveComponentProperty(current.document, {
        componentId: component.id,
        propertyName,
        commandPrefix: operationId,
      });
      applyPropertyPlan(t("history.removeComponentProperty"), plan);
    },
    [applyPropertyPlan, runtime, t, transactionCounter],
  );

  const reorderSelectedComponentProperties = useComponentPropertyOrderAction({
    applyPlan: applyPropertyPlan,
    label: t("history.reorderComponentProperties"),
    runtime,
    transactionCounter,
  });

  const setSelectedComponentSlotSettings = useCallback(
    (
      propertyName: string,
      input: {
        description?: string;
        preferredValues: readonly InstanceSwapPreferredValue[];
        settings: SlotSettings;
      },
    ) => {
      const current = runtime.getSnapshot();
      const nodeId = singleSelection(current.state.selection.nodeIds);
      const component = Object.values(current.document.componentsById).find(
        (candidate) => candidate.rootNodeId === nodeId,
      );
      if (!component) return;
      const operationId = `component_slot_settings_${Date.now()}_${++transactionCounter.current}`;
      const plan = planSetComponentSlotSettings(current.document, {
        componentId: component.id,
        propertyName,
        settings: input.settings,
        preferredValues: input.preferredValues,
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        commandPrefix: operationId,
      });
      applyPropertyPlan(t("history.setComponentSlotSettings"), plan);
    },
    [applyPropertyPlan, runtime, t, transactionCounter],
  );

  const placeComponentFromAssets = useCallback(
    (componentId: string): AssetActionResult => {
      const current = runtime.getSnapshot();
      const component = current.document.componentsById[componentId];
      const page = current.document.pagesById[activePageId];
      if (!component || !page) {
        return { ok: false, error: t("sidebar.componentActionFailed") };
      }
      const operationId = `component_asset_${Date.now()}_${++transactionCounter.current}`;
      const plan = planCreateInstance(current.document, {
        componentId,
        instanceId: operationId,
        pageId: activePageId,
        parentId: null,
        index: page.rootNodeIds.length,
        transform: [1, 0, 0, 1, 64, 64],
        commandPrefix: operationId,
      });
      if (!plan.ok) return { ok: false, error: plan.message };
      if (!applyCommands(t("history.createComponentInstance"), plan.commands)) {
        return { ok: false, error: t("sidebar.componentActionFailed") };
      }
      runtime.setSelection(plan.selectionNodeIds, plan.instanceId);
      return {
        ok: true,
        message: t("sidebar.componentPlaced", { name: component.name }),
      };
    },
    [activePageId, applyCommands, runtime, t, transactionCounter],
  );

  const locateComponentMain = useCallback(
    (componentId: string) => {
      const document = runtime.getSnapshot().document;
      const mainNodeId = document.componentsById[componentId]?.rootNodeId;
      if (mainNodeId) locateNode(document, mainNodeId);
    },
    [runtime],
  );

  const resetSelectedInstance = useCallback(() => {
    const current = runtime.getSnapshot();
    const instanceId = singleSelection(current.state.selection.nodeIds);
    if (!instanceId) return;
    const plan = planResetComponentOverrides(current.document, {
      instanceId,
      commandPrefix: `component_reset_${Date.now()}`,
    });
    if (!plan.ok) {
      setEditorError(plan.code === "no-op" ? null : plan.message);
      return;
    }
    applyCommands(t("history.resetComponentInstance"), plan.commands);
  }, [applyCommands, runtime, setEditorError, t]);

  const resetSelectedInstanceSource = useCallback(
    (sourcePath: readonly string[]) => {
      const current = runtime.getSnapshot();
      const instanceId = singleSelection(current.state.selection.nodeIds);
      if (!instanceId) return;
      const plan = planResetComponentOverrides(current.document, {
        instanceId,
        sourcePath,
        commandPrefix: `component_reset_source_${Date.now()}_${++transactionCounter.current}`,
      });
      if (!plan.ok) {
        setEditorError(plan.code === "no-op" ? null : plan.message);
        return;
      }
      applyCommands(t("history.resetComponentInstance"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t, transactionCounter],
  );

  const updateInstanceSource = useCallback(
    (
      instanceId: string,
      sourcePath: readonly string[],
      patch: ComponentOverridePatch,
      historyLabel?: string,
    ) => {
      const current = runtime.getSnapshot();
      const plan = planSetComponentOverride(current.document, {
        instanceId,
        sourcePath,
        patch,
        commandPrefix: `component_override_${Date.now()}_${++transactionCounter.current}`,
      });
      if (!plan.ok) {
        setEditorError(plan.message);
        return false;
      }
      return applyCommands(
        historyLabel ?? t("history.updateComponentOverride"),
        plan.commands,
      );
    },
    [applyCommands, runtime, setEditorError, t, transactionCounter],
  );

  const updateSelectedInstanceSource = useCallback(
    (sourcePath: readonly string[], patch: ComponentOverridePatch) => {
      const instanceId = singleSelection(
        runtime.getSnapshot().state.selection.nodeIds,
      );
      if (!instanceId) return;
      updateInstanceSource(instanceId, sourcePath, patch);
    },
    [runtime, updateInstanceSource],
  );

  const setSelectedInstanceComponentProperty = useCallback(
    (propertyName: string, value: ComponentPropertyAssignment) => {
      const current = runtime.getSnapshot();
      const instanceId = singleSelection(current.state.selection.nodeIds);
      if (!instanceId) return;
      const plan = planSetComponentPropertyValue(current.document, {
        instanceId,
        propertyName,
        value,
        commandPrefix: `component_property_value_${Date.now()}_${++transactionCounter.current}`,
      });
      applyPropertyPlan(t("history.setComponentProperty"), plan);
    },
    [applyPropertyPlan, runtime, t, transactionCounter],
  );

  const resetSelectedInstanceComponentProperty = useCallback(
    (propertyName: string) => {
      const current = runtime.getSnapshot();
      const instanceId = singleSelection(current.state.selection.nodeIds);
      if (!instanceId) return;
      const plan = planResetComponentPropertyValue(current.document, {
        instanceId,
        propertyName,
        commandPrefix: `component_property_reset_${Date.now()}_${++transactionCounter.current}`,
      });
      applyPropertyPlan(t("history.resetComponentProperty"), plan);
    },
    [applyPropertyPlan, runtime, t, transactionCounter],
  );

  const createSelectedInstanceSlotOverride = useCallback(
    (propertyName: string) => {
      const current = runtime.getSnapshot();
      const instanceId = singleSelection(current.state.selection.nodeIds);
      if (!instanceId) return;
      const plan = planCreateComponentSlotOverride(current.document, {
        instanceId,
        propertyName,
        commandPrefix: `component_slot_override_${Date.now()}_${++transactionCounter.current}`,
      });
      applyPropertyPlan(t("history.editComponentSlot"), plan);
    },
    [applyPropertyPlan, runtime, t, transactionCounter],
  );

  const clearSelectedInstanceSlot = useCallback(
    (propertyName: string) => {
      const current = runtime.getSnapshot();
      const instanceId = singleSelection(current.state.selection.nodeIds);
      if (!instanceId) return;
      const plan = planClearComponentSlot(current.document, {
        instanceId,
        propertyName,
        commandPrefix: `component_slot_clear_${Date.now()}_${++transactionCounter.current}`,
      });
      applyPropertyPlan(t("history.clearComponentSlot"), plan);
    },
    [applyPropertyPlan, runtime, t, transactionCounter],
  );

  const resetSelectedInstanceSlot = useCallback(
    (propertyName: string) => {
      const current = runtime.getSnapshot();
      const instanceId = singleSelection(current.state.selection.nodeIds);
      if (!instanceId) return;
      const plan = planResetComponentSlot(current.document, {
        instanceId,
        propertyName,
        commandPrefix: `component_slot_reset_${Date.now()}_${++transactionCounter.current}`,
      });
      applyPropertyPlan(t("history.resetComponentSlot"), plan);
    },
    [applyPropertyPlan, runtime, t, transactionCounter],
  );

  const detachSelectedInstance = useCallback(() => {
    const current = runtime.getSnapshot();
    const instanceId = singleSelection(current.state.selection.nodeIds);
    if (!instanceId) return;
    const plan = planDetachComponentInstance(current.document, {
      instanceId,
      commandPrefix: `component_detach_${Date.now()}`,
    });
    if (!plan.ok) {
      setEditorError(plan.message);
      return;
    }
    applyCommands(t("history.detachComponentInstance"), plan.commands);
  }, [applyCommands, runtime, setEditorError, t]);

  const goToSelectedInstanceMain = useCallback(() => {
    const current = runtime.getSnapshot();
    const instanceId = singleSelection(current.state.selection.nodeIds);
    const mainNodeId = instanceId
      ? componentMainNodeId(current.document, instanceId)
      : null;
    if (mainNodeId) locateNode(current.document, mainNodeId);
  }, [runtime]);

  const locateNode = (document: DesignDocument, nodeId: string) => {
    const pageId = pageIdForNode(document, nodeId);
    if (pageId && pageId !== activePageId) activatePage(pageId);
    runtime.setSelection([nodeId], nodeId);
  };

  const applyInstancePlan = (plan: ReturnType<typeof planCreateInstance>) => {
    if (!plan.ok) {
      setEditorError(plan.message);
      return;
    }
    if (applyCommands(t("history.createComponentInstance"), plan.commands)) {
      runtime.setSelection(plan.selectionNodeIds, plan.instanceId);
    }
  };

  return {
    addSelectedComponentProperty,
    addSelectedComponentToVariantSet,
    combineSelectedComponentsAsVariants,
    componentPropertyActions: {
      ...variantMatrixActions,
      onReorderComponentProperties: reorderSelectedComponentProperties,
      onClearComponentSlot: clearSelectedInstanceSlot,
      onCreateComponentSlotOverride: createSelectedInstanceSlotOverride,
      onResetComponentSlot: resetSelectedInstanceSlot,
      onSetComponentSlotSettings: setSelectedComponentSlotSettings,
    },
    createComponentFromSelection,
    createSelectedComponentInstance,
    detachSelectedInstance,
    dissolveSelectedVariantSet,
    duplicateSelectedVariant,
    goToSelectedInstanceMain,
    locateComponentMain,
    placeComponentFromAssets,
    removeSelectedComponent,
    removeSelectedVariantFromSet,
    removeSelectedComponentProperty,
    renameSelectedComponentProperty,
    resetSelectedInstance,
    resetSelectedInstanceSource,
    resetSelectedInstanceComponentProperty,
    setSelectedInstanceComponentProperty,
    updateInstanceSource,
    updateSelectedInstanceSource,
  };
}

function inferVariantFacts(
  components: readonly DesignDocument["componentsById"][string][],
  fallbackSetName: string,
): { propertyName: string; setName: string; values: string[] } {
  const names = components.map((component) => component.name.trim());
  const equals = names.map((name) => {
    const marker = name.indexOf("=");
    return marker > 0
      ? {
          left: name.slice(0, marker).trim(),
          right: name.slice(marker + 1).trim(),
        }
      : null;
  });
  const sameEqualsProperty =
    equals.every((part) => part?.left && part.right) &&
    equals.every((part) => part?.left === equals[0]?.left);
  const slashes = names.map((name) => {
    const marker = name.lastIndexOf("/");
    return marker > 0
      ? {
          left: name.slice(0, marker).trim(),
          right: name.slice(marker + 1).trim(),
        }
      : null;
  });
  const sameSlashSet =
    slashes.every((part) => part?.left && part.right) &&
    slashes.every((part) => part?.left === slashes[0]?.left);
  const rawValues = sameEqualsProperty
    ? equals.map((part) => part!.right)
    : sameSlashSet
      ? slashes.map((part) => part!.right)
      : names;
  const used = new Set<string>();
  const values = rawValues.map((raw, index) => {
    const candidate = raw || `Variant ${index + 1}`;
    const value = used.has(candidate) ? `Variant ${index + 1}` : candidate;
    used.add(value);
    return value;
  });
  return {
    propertyName: sameEqualsProperty ? equals[0]!.left : "State",
    setName: sameSlashSet ? slashes[0]!.left : fallbackSetName,
    values,
  };
}

function nextVariantProperties(
  document: DesignDocument,
  variantSetId: string,
  preferredValue: string,
): Record<string, string> {
  const set = document.variantSetsById[variantSetId];
  if (!set) return {};
  const names = Object.keys(set.componentPropertyDefinitions);
  const members = Object.values(document.componentsById).filter(
    (component) => component.variantSetId === variantSetId,
  );
  const result = Object.fromEntries(
    names.map((name) => [
      name,
      set.componentPropertyDefinitions[name].defaultValue,
    ]),
  );
  const primary = names[0];
  if (!primary) return result;
  const base = preferredValue.trim() || "Variant";
  let candidate = base;
  let suffix = 2;
  const combinationExists = () =>
    members.some((member) =>
      names.every((name) =>
        name === primary
          ? member.variantProperties[name] === candidate
          : member.variantProperties[name] === result[name],
      ),
    );
  while (combinationExists()) candidate = `${base} ${suffix++}`;
  result[primary] = candidate;
  return result;
}

function singleSelection(nodeIds: readonly string[]): string | undefined {
  return nodeIds.length === 1 ? nodeIds[0] : undefined;
}

function pageIdForNode(
  document: DesignDocument,
  targetNodeId: string,
): string | undefined {
  for (const pageId of document.pageOrder) {
    const page = document.pagesById[pageId];
    if (!page) continue;
    const visited = new Set<string>();
    const visit = (nodeId: string): boolean => {
      if (nodeId === targetNodeId) return true;
      if (visited.has(nodeId)) return false;
      visited.add(nodeId);
      return document.nodesById[nodeId]?.childIds.some(visit) ?? false;
    };
    if (page.rootNodeIds.some(visit)) return pageId;
  }
  return undefined;
}
