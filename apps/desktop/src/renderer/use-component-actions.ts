import type {
  ComponentOverridePatch,
  DesignDocument,
  DesignOperation,
} from "@opendesign/design-contracts";
import {
  componentMainNodeId,
  planCreateComponent,
  planCreateInstance,
  planDetachComponentInstance,
  planResetComponentOverrides,
  planRemoveComponent,
  planSetComponentOverride,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import { useCallback } from "react";
import type { MessageKey, MessageParameters } from "../shared/i18n/messages";
import type { AssetActionResult } from "./design-assets";

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

  const updateSelectedInstanceSource = useCallback(
    (sourcePath: readonly string[], patch: ComponentOverridePatch) => {
      const current = runtime.getSnapshot();
      const instanceId = singleSelection(current.state.selection.nodeIds);
      if (!instanceId) return;
      const plan = planSetComponentOverride(current.document, {
        instanceId,
        sourcePath,
        patch,
        commandPrefix: `component_override_${Date.now()}_${++transactionCounter.current}`,
      });
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.updateComponentOverride"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t, transactionCounter],
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
    createComponentFromSelection,
    createSelectedComponentInstance,
    detachSelectedInstance,
    goToSelectedInstanceMain,
    locateComponentMain,
    placeComponentFromAssets,
    removeSelectedComponent,
    resetSelectedInstance,
    resetSelectedInstanceSource,
    updateSelectedInstanceSource,
  };
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
