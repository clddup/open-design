import type {
  ComponentOverridePatch,
  ComponentSelectionTarget,
  DesignDocument,
  DesignNode,
} from "@opendesign/design-contracts";
import { resolveComponentInstance } from "@opendesign/component-service";
import { resolveBooleanEditScope } from "@opendesign/editor-runtime";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Icon,
  IconButton,
} from "@opendesign/ui";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { AssetActionResult, DesignAssetReference } from "../design-assets";
import type {
  LayerDropPosition,
  LayerActionResult,
  LayerRenameTarget,
  LayerReparentRequest,
  LayerReparentResult,
  PageActionResult,
} from "../features/editor/types";
import { useI18n } from "../i18n";
import type { LayerHoverTarget } from "../layer-hover-target";
import type { SidebarTab } from "../state/editor";
import type { ProjectLibraryActions } from "../use-project-library-actions";
import { AssetsPanel } from "./AssetsPanel";
import { VariablesPanel, type VariablesPanelActions } from "./VariablesPanel";
import {
  LocalStylesPanel,
  type LocalStylesPanelActions,
} from "./LocalStylesPanel";
import {
  layerNodeIcons as nodeIcons,
  layerNodeKindKeys as nodeKindKeys,
} from "./layer-node-presentation";
import styles from "./LeftSidebar.module.scss";
import { SidebarViewTabs } from "./SidebarViewTabs";

type TreeEntry = {
  componentTarget?: ComponentSelectionTarget;
  node: DesignNode;
  depth: number;
  effectiveLocked: boolean;
  hasChildren: boolean;
  inheritedLocked: boolean;
  key: string;
  selectionNodeId: string;
  virtual: boolean;
};

type ActiveLayerDrop = {
  nodeId: string;
  position: LayerDropPosition;
};

type PageDropPosition = "before" | "after";

type ActivePageDrop = {
  pageId: string;
  position: PageDropPosition;
};

function sameParentSelection(
  document: DesignDocument,
  draggedNodeId: string,
  selectedNodeIds: readonly string[],
): string[] {
  if (!selectedNodeIds.includes(draggedNodeId)) return [draggedNodeId];
  const parentId = document.nodesById[draggedNodeId]?.parentId;
  const selected = [...new Set(selectedNodeIds)].filter(
    (nodeId) => document.nodesById[nodeId]?.parentId === parentId,
  );
  return selected.length === selectedNodeIds.length
    ? selected
    : [draggedNodeId];
}

function dropPosition(
  event: ReactDragEvent<HTMLElement>,
  node: DesignNode,
  canDropInside: boolean,
): LayerDropPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  const ratio =
    bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;
  if (
    canDropInside &&
    (node.kind === "frame" || node.kind === "slot" || node.kind === "group")
  ) {
    if (ratio < 0.25) return "before";
    if (ratio > 0.75) return "after";
    return "inside";
  }
  return ratio < 0.5 ? "before" : "after";
}

function reparentRequest(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  targetNode: DesignNode,
  position: LayerDropPosition,
): LayerReparentRequest | null {
  if (position === "inside") {
    const selected = new Set(nodeIds);
    return {
      nodeIds,
      parentId: targetNode.id,
      index: targetNode.childIds.filter((nodeId) => !selected.has(nodeId))
        .length,
      position,
      targetNodeId: targetNode.id,
    };
  }
  const parentId = targetNode.parentId;
  const siblings = parentId
    ? document.nodesById[parentId]?.childIds
    : document.pagesById[pageId]?.rootNodeIds;
  if (!siblings) return null;
  const selected = new Set(nodeIds);
  const remaining = siblings.filter((nodeId) => !selected.has(nodeId));
  const targetIndex = remaining.indexOf(targetNode.id);
  if (targetIndex < 0) return null;
  return {
    nodeIds,
    parentId,
    index: targetIndex + (position === "after" ? 1 : 0),
    position,
    targetNodeId: targetNode.id,
  };
}

function flattenPageTree(
  document: DesignDocument,
  pageId: string | undefined,
  collapsedNodeIds: ReadonlySet<string>,
): TreeEntry[] {
  if (!pageId) return [];
  const page = document.pagesById[pageId];
  if (!page) return [];

  const entries: TreeEntry[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string, depth: number, inheritedLocked: boolean) => {
    if (visited.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;

    visited.add(nodeId);
    const effectiveLocked = node.locked || inheritedLocked;
    let hasProjectedChildren = false;
    const resolution =
      node.kind === "instance"
        ? resolveComponentInstance(document, node.id)
        : null;
    if (resolution?.ok) {
      const root = resolution.nodes.find((candidate) => candidate.root);
      hasProjectedChildren = Boolean(
        root &&
        resolution.nodes.some(
          (candidate) =>
            candidate.parentProjectionId === root.projectionId &&
            candidate.editableNodeId === undefined,
        ),
      );
    }
    entries.push({
      node,
      depth,
      effectiveLocked,
      hasChildren: node.childIds.length > 0 || hasProjectedChildren,
      inheritedLocked,
      key: node.id,
      selectionNodeId: node.id,
      virtual: false,
    });
    if (collapsedNodeIds.has(nodeId)) return;
    if (resolution?.ok) {
      const root = resolution.nodes.find((candidate) => candidate.root);
      const visitProjected = (
        parentProjectionId: string,
        projectedDepth: number,
        projectedInheritedLocked: boolean,
      ) => {
        for (const candidate of resolution.nodes) {
          if (candidate.parentProjectionId !== parentProjectionId) continue;
          if (candidate.editableNodeId !== undefined) continue;
          const projectedLocked =
            candidate.node.locked || projectedInheritedLocked;
          const projectedChildren = resolution.nodes.filter(
            (child) =>
              child.parentProjectionId === candidate.projectionId &&
              child.editableNodeId === undefined,
          );
          const componentTarget = {
            instanceId: candidate.selectionInstanceId,
            sourcePath: [...candidate.selectionSourcePath],
          };
          entries.push({
            componentTarget,
            node: candidate.node,
            depth: projectedDepth,
            effectiveLocked: projectedLocked,
            hasChildren: projectedChildren.length > 0,
            inheritedLocked: projectedInheritedLocked,
            key: candidate.projectionId,
            selectionNodeId: candidate.selectionInstanceId,
            virtual: true,
          });
          if (!collapsedNodeIds.has(candidate.projectionId)) {
            visitProjected(
              candidate.projectionId,
              projectedDepth + 1,
              projectedLocked,
            );
          }
        }
      };
      if (root) visitProjected(root.projectionId, depth + 1, effectiveLocked);
    }
    for (const childId of node.childIds) {
      visit(childId, depth + 1, effectiveLocked);
    }
  };

  for (const rootNodeId of page.rootNodeIds) visit(rootNodeId, 0, false);
  return entries;
}

function collectAncestorIds(
  document: DesignDocument,
  nodeIds: readonly string[],
): Set<string> {
  const ancestors = new Set<string>();
  nodeIds.forEach((nodeId) => {
    let parentId = document.nodesById[nodeId]?.parentId;
    while (parentId && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      parentId = document.nodesById[parentId]?.parentId;
    }
  });
  return ancestors;
}

function collectTreeAncestorKeys(
  entries: readonly TreeEntry[],
  matchingKeys: ReadonlySet<string>,
): Set<string> {
  const ancestors = new Set<string>();
  const path: string[] = [];
  for (const entry of entries) {
    path.length = entry.depth;
    if (matchingKeys.has(entry.key)) path.forEach((key) => ancestors.add(key));
    path[entry.depth] = entry.key;
  }
  return ancestors;
}

export function layerPanelSelection(
  visibleNodeIds: readonly string[],
  selectedNodeIds: readonly string[],
  anchorNodeId: string | undefined,
  nodeId: string,
  modifiers: Pick<ReactMouseEvent, "ctrlKey" | "metaKey" | "shiftKey">,
): { nodeIds: string[]; anchorNodeId?: string } {
  if (modifiers.shiftKey && anchorNodeId) {
    const anchorIndex = visibleNodeIds.indexOf(anchorNodeId);
    const targetIndex = visibleNodeIds.indexOf(nodeId);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      return {
        nodeIds: visibleNodeIds.slice(
          Math.min(anchorIndex, targetIndex),
          Math.max(anchorIndex, targetIndex) + 1,
        ),
        anchorNodeId,
      };
    }
  }
  if (modifiers.metaKey || modifiers.ctrlKey) {
    const selected = new Set(selectedNodeIds);
    if (selected.has(nodeId)) selected.delete(nodeId);
    else selected.add(nodeId);
    const nodeIds = visibleNodeIds.filter((candidate) =>
      selected.has(candidate),
    );
    return {
      nodeIds,
      ...(nodeIds.length > 0
        ? {
            anchorNodeId: selected.has(nodeId) ? nodeId : nodeIds.at(-1),
          }
        : {}),
    };
  }
  return { nodeIds: [nodeId], anchorNodeId: nodeId };
}

function sameComponentTarget(
  left: ComponentSelectionTarget | undefined,
  right: ComponentSelectionTarget | undefined,
): boolean {
  if (!left || !right) return false;
  return (
    left.instanceId === right.instanceId &&
    left.sourcePath.length === right.sourcePath.length &&
    left.sourcePath.every((value, index) => value === right.sourcePath[index])
  );
}

function componentTargetExists(
  document: DesignDocument,
  target: ComponentSelectionTarget,
): boolean {
  const resolution = resolveComponentInstance(document, target.instanceId);
  return (
    resolution.ok &&
    resolution.nodes.some(
      (candidate) =>
        candidate.selectionSourcePath.length === target.sourcePath.length &&
        candidate.selectionSourcePath.every(
          (value, index) => value === target.sourcePath[index],
        ),
    )
  );
}

const unavailableProjectLibraries: ProjectLibraryActions = {
  available: false,
  busyKey: null,
  error: null,
  items: [],
  loading: false,
  notice: null,
  published: false,
  publish: () => Promise.resolve(),
  setEnabled: () => Promise.resolve(),
  placeComponent: () =>
    Promise.resolve({
      ok: false,
      error: "Project Library is unavailable",
    }),
  applyStyle: () =>
    Promise.resolve({
      ok: false,
      error: "Project Library is unavailable",
    }),
  applyVariable: () =>
    Promise.resolve({
      ok: false,
      error: "Project Library is unavailable",
    }),
  acceptUpdate: () => Promise.resolve(),
  ignoreUpdate: () => Promise.resolve(),
  clearError: () => undefined,
};

export function LeftSidebar({
  className = "",
  document,
  hidden = false,
  activePageId,
  selectedNodeIds,
  selectionAnchorNodeId,
  selectionComponentTarget,
  tab,
  onTabChange,
  onPageChange,
  onCreatePage,
  onDeletePage,
  onDuplicatePage,
  onRenamePage,
  onReorderPage,
  onDeleteAsset,
  onLocateComponent,
  onImportAsset,
  onLocateAsset,
  onPlaceAsset,
  onPlaceComponent,
  onReplaceAsset,
  onLayerHoverChange,
  onSelect,
  onReparent,
  onRenameLayer,
  onUpdateComponentLayer,
  onToggleLock,
  onToggleVisibility,
  variableActions,
  styleActions,
  projectLibraries = unavailableProjectLibraries,
}: {
  className?: string;
  document: DesignDocument;
  hidden?: boolean;
  activePageId: string;
  selectedNodeIds: readonly string[];
  selectionAnchorNodeId?: string;
  selectionComponentTarget?: ComponentSelectionTarget;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onPageChange: (pageId: string) => void;
  onCreatePage: () => PageActionResult;
  onDeletePage: (pageId: string) => PageActionResult;
  onDuplicatePage: (pageId: string) => PageActionResult;
  onRenamePage: (pageId: string, name: string) => PageActionResult;
  onReorderPage: (pageId: string, index: number) => PageActionResult;
  onDeleteAsset: (assetId: string) => AssetActionResult;
  onLocateComponent: (componentId: string) => void;
  onImportAsset: () => Promise<AssetActionResult>;
  onLocateAsset: (reference: DesignAssetReference) => void;
  onPlaceAsset: (assetId: string) => AssetActionResult;
  onPlaceComponent: (componentId: string) => AssetActionResult;
  onReplaceAsset: (assetId: string) => Promise<AssetActionResult>;
  onLayerHoverChange?: (target: LayerHoverTarget | null) => void;
  onSelect: (
    nodeIds: readonly string[],
    anchorNodeId?: string,
    componentTarget?: ComponentSelectionTarget,
  ) => void;
  onReparent: (request: LayerReparentRequest) => LayerReparentResult;
  onRenameLayer: (target: LayerRenameTarget, name: string) => LayerActionResult;
  onUpdateComponentLayer: (
    target: ComponentSelectionTarget,
    patch: ComponentOverridePatch,
  ) => void;
  onToggleLock: (nodeId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
  variableActions: VariablesPanelActions;
  styleActions?: LocalStylesPanelActions;
  projectLibraries?: ProjectLibraryActions;
}) {
  const { t } = useI18n();
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [activeDrop, setActiveDrop] = useState<ActiveLayerDrop | null>(null);
  const [activePageDrop, setActivePageDrop] = useState<ActivePageDrop | null>(
    null,
  );
  const [dragStatus, setDragStatus] = useState("");
  const [pageStatus, setPageStatus] = useState("");
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pageNameDraft, setPageNameDraft] = useState("");
  const [pageNameError, setPageNameError] = useState<string | null>(null);
  const [editingLayer, setEditingLayer] = useState<
    | (LayerRenameTarget & {
        key: string;
      })
    | null
  >(null);
  const [layerNameDraft, setLayerNameDraft] = useState("");
  const [layerNameError, setLayerNameError] = useState<string | null>(null);
  const [assetQuery, setAssetQuery] = useState("");
  const [layerQuery, setLayerQuery] = useState("");
  const draggedNodeIds = useRef<readonly string[] | null>(null);
  const draggedPageId = useRef<string | null>(null);
  const pageNameInput = useRef<HTMLInputElement | null>(null);
  const layerNameInput = useRef<HTMLInputElement | null>(null);
  const composingPageName = useRef(false);
  const composingLayerName = useRef(false);
  const revealedSelectionKey = useRef<string | null>(null);
  const normalizedLayerQuery = layerQuery.trim().toLocaleLowerCase();
  const allLayers = flattenPageTree(
    document,
    activePageId,
    normalizedLayerQuery ? new Set() : collapsedNodeIds,
  );
  const matchingLayerIds = new Set(
    normalizedLayerQuery
      ? allLayers
          .filter(({ node }) =>
            `${node.name} ${t(nodeKindKeys[node.kind])}`
              .toLocaleLowerCase()
              .includes(normalizedLayerQuery),
          )
          .map(({ key }) => key)
      : [],
  );
  if (normalizedLayerQuery) {
    collectTreeAncestorKeys(allLayers, matchingLayerIds).forEach((key) =>
      matchingLayerIds.add(key),
    );
  }
  const layers = normalizedLayerQuery
    ? allLayers.filter(({ key }) => matchingLayerIds.has(key))
    : allLayers;
  const selectedIds = new Set(selectedNodeIds);
  const componentIdentityNodeIds = new Set<string>();
  for (const component of Object.values(document.componentsById))
    componentIdentityNodeIds.add(component.rootNodeId);
  for (const variantSet of Object.values(document.variantSetsById))
    componentIdentityNodeIds.add(variantSet.rootNodeId);
  const booleanEditScope = resolveBooleanEditScope(
    document,
    activePageId,
    selectedNodeIds,
  );
  const firstFocusableId =
    layers.find(({ componentTarget, selectionNodeId }) =>
      componentTarget
        ? sameComponentTarget(componentTarget, selectionComponentTarget)
        : !selectionComponentTarget && selectedIds.has(selectionNodeId),
    )?.key ?? layers[0]?.key;

  useEffect(() => {
    const selectionKey = `${document.documentId}:${activePageId}:${selectedNodeIds.join("\u0000")}:${selectionComponentTarget?.sourcePath.join("\u0000") ?? ""}`;
    if (revealedSelectionKey.current === selectionKey) return;
    revealedSelectionKey.current = selectionKey;
    const ancestors = collectAncestorIds(document, selectedNodeIds);
    if (selectionComponentTarget) {
      ancestors.add(selectionComponentTarget.instanceId);
      const resolution = resolveComponentInstance(
        document,
        selectionComponentTarget.instanceId,
      );
      if (resolution.ok) {
        const target = resolution.nodes.find(
          (candidate) =>
            candidate.selectionInstanceId ===
              selectionComponentTarget.instanceId &&
            candidate.selectionSourcePath.length ===
              selectionComponentTarget.sourcePath.length &&
            candidate.selectionSourcePath.every(
              (value, index) =>
                value === selectionComponentTarget.sourcePath[index],
            ),
        );
        let parentProjectionId = target?.parentProjectionId ?? null;
        while (parentProjectionId) {
          ancestors.add(parentProjectionId);
          parentProjectionId =
            resolution.nodes.find(
              (candidate) => candidate.projectionId === parentProjectionId,
            )?.parentProjectionId ?? null;
        }
      }
    }
    if (ancestors.size === 0) return;
    setCollapsedNodeIds((current) => {
      if (![...ancestors].some((nodeId) => current.has(nodeId))) return current;
      const next = new Set(current);
      ancestors.forEach((nodeId) => next.delete(nodeId));
      return next;
    });
  }, [activePageId, document, selectedNodeIds, selectionComponentTarget]);

  useEffect(() => {
    setCollapsedNodeIds(new Set());
    setEditingLayer(null);
    setLayerNameError(null);
    revealedSelectionKey.current = null;
    draggedNodeIds.current = null;
    setActiveDrop(null);
    setDragStatus("");
  }, [activePageId, document.documentId]);

  useEffect(() => {
    setAssetQuery("");
    setLayerQuery("");
  }, [document.documentId]);

  useEffect(() => {
    if (!editingPageId) return;
    if (!document.pagesById[editingPageId]) {
      setEditingPageId(null);
      setPageNameError(null);
      return;
    }
    pageNameInput.current?.focus();
    pageNameInput.current?.select();
  }, [document, editingPageId]);

  useEffect(() => {
    if (!editingLayer) return;
    layerNameInput.current?.focus();
    layerNameInput.current?.select();
  }, [editingLayer]);

  useEffect(() => {
    if (!editingLayer) return;
    const available = editingLayer.componentTarget
      ? componentTargetExists(document, editingLayer.componentTarget)
      : document.nodesById[editingLayer.nodeId] !== undefined;
    if (!available) {
      setEditingLayer(null);
      setLayerNameError(null);
    }
  }, [activePageId, document, editingLayer]);

  const beginPageRename = (pageId: string, name: string) => {
    setEditingPageId(pageId);
    setPageNameDraft(name);
    setPageNameError(null);
    setPageStatus("");
  };

  const beginLayerRename = (entry: TreeEntry) => {
    setEditingLayer({
      key: entry.key,
      nodeId: entry.selectionNodeId,
      ...(entry.componentTarget
        ? { componentTarget: entry.componentTarget }
        : {}),
    });
    setLayerNameDraft(entry.node.name);
    setLayerNameError(null);
  };

  const cancelLayerRename = () => {
    setEditingLayer(null);
    setLayerNameError(null);
  };

  const commitLayerRename = () => {
    if (!editingLayer) return;
    const entry = allLayers.find(({ key }) => key === editingLayer.key);
    if (!entry) {
      cancelLayerRename();
      return;
    }
    const nextName = layerNameDraft.trim();
    if (nextName === entry.node.name) {
      cancelLayerRename();
      return;
    }
    if (nextName.length === 0 || nextName.length > 256) {
      setLayerNameError(
        nextName.length === 0
          ? t("renameLayers.emptyName")
          : t("renameLayers.nameTooLong"),
      );
      queueMicrotask(() => layerNameInput.current?.focus());
      return;
    }
    const result = onRenameLayer(
      {
        nodeId: editingLayer.nodeId,
        ...(editingLayer.componentTarget
          ? { componentTarget: editingLayer.componentTarget }
          : {}),
      },
      nextName,
    );
    if (!result.ok) {
      setLayerNameError(result.error);
      queueMicrotask(() => layerNameInput.current?.focus());
      return;
    }
    cancelLayerRename();
  };

  const cancelPageRename = () => {
    setEditingPageId(null);
    setPageNameError(null);
  };

  const commitPageRename = () => {
    if (!editingPageId) return;
    const currentName = document.pagesById[editingPageId]?.name;
    if (pageNameDraft.trim() === currentName) {
      cancelPageRename();
      return;
    }
    const result = onRenamePage(editingPageId, pageNameDraft);
    if (!result.ok) {
      setPageNameError(result.error);
      return;
    }
    setPageStatus("");
    cancelPageRename();
  };

  const createPage = () => {
    const result = onCreatePage();
    if (!result.ok) {
      setPageStatus(result.error);
      return;
    }
    onPageChange(result.pageId);
    beginPageRename(result.pageId, result.name ?? t("sidebar.newPage"));
  };

  const duplicatePage = (pageId: string) => {
    const result = onDuplicatePage(pageId);
    if (!result.ok) {
      setPageStatus(result.error);
      return;
    }
    onPageChange(result.pageId);
    setPageStatus("");
  };

  const deletePage = (pageId: string) => {
    const result = onDeletePage(pageId);
    setPageStatus(result.ok ? "" : result.error);
  };

  const clearPageDrag = () => {
    draggedPageId.current = null;
    setActivePageDrop(null);
  };

  const finishPageDrop = (targetPageId: string, position: PageDropPosition) => {
    const sourcePageId = draggedPageId.current;
    clearPageDrag();
    if (!sourcePageId || sourcePageId === targetPageId) return;
    const remaining = document.pageOrder.filter(
      (pageId) => pageId !== sourcePageId,
    );
    const targetIndex = remaining.indexOf(targetPageId);
    if (targetIndex < 0) return;
    const index = targetIndex + (position === "after" ? 1 : 0);
    const result = onReorderPage(sourcePageId, index);
    setPageStatus(result.ok ? "" : result.error);
  };

  const expandNode = (nodeId: string) => {
    setCollapsedNodeIds((current) => {
      if (!current.has(nodeId)) return current;
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
  };

  const toggleNode = (nodeId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const clearDrag = () => {
    draggedNodeIds.current = null;
    setActiveDrop(null);
  };

  const startDrag = (
    event: ReactDragEvent<HTMLButtonElement>,
    nodeId: string,
  ) => {
    const nodeIds = sameParentSelection(document, nodeId, selectedNodeIds);
    draggedNodeIds.current = nodeIds;
    setActiveDrop(null);
    setDragStatus(
      t(
        nodeIds.length === 1
          ? "sidebar.draggingLayer"
          : "sidebar.draggingLayers",
        { count: nodeIds.length },
      ),
    );
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-opendesign-layer-drag", "active");
  };

  const updateDrop = (
    event: ReactDragEvent<HTMLDivElement>,
    node: DesignNode,
    effectiveLocked: boolean,
  ) => {
    if (!draggedNodeIds.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const position = dropPosition(event, node, !effectiveLocked);
    setActiveDrop({ nodeId: node.id, position });
    setDragStatus(
      t(
        position === "before"
          ? "sidebar.dropBefore"
          : position === "inside"
            ? "sidebar.dropInside"
            : "sidebar.dropAfter",
        { name: node.name || t(nodeKindKeys[node.kind]) },
      ),
    );
  };

  const finishDrop = (
    event: ReactDragEvent<HTMLDivElement>,
    node: DesignNode,
    effectiveLocked: boolean,
  ) => {
    const nodeIds = draggedNodeIds.current;
    if (!nodeIds) return;
    event.preventDefault();
    const position = dropPosition(event, node, !effectiveLocked);
    const request = reparentRequest(
      document,
      activePageId,
      nodeIds,
      node,
      position,
    );
    clearDrag();
    if (!request) {
      setDragStatus(t("sidebar.dropUnavailable"));
      return;
    }
    const result = onReparent(request);
    setDragStatus(
      result.ok
        ? (result.warning ??
            t(
              request.nodeIds.length === 1
                ? "sidebar.movedLayer"
                : "sidebar.movedLayers",
              { count: request.nodeIds.length },
            ))
        : result.error,
    );
  };

  return (
    <aside
      aria-label={t("sidebar.navigation")}
      className={`${styles.root} ${className}`}
      data-library={tab === "styles" || tab === "variables" ? "true" : "false"}
      hidden={hidden}
    >
      <SidebarViewTabs onChange={onTabChange} value={tab} />
      {(tab === "layers" || tab === "assets") && (
        <div className={styles.search}>
          <Icon name="lucide:search" />
          <input
            aria-label={
              tab === "assets"
                ? t("sidebar.searchAssets")
                : t("sidebar.searchLayers")
            }
            onChange={(event) =>
              tab === "assets"
                ? setAssetQuery(event.target.value)
                : setLayerQuery(event.target.value)
            }
            placeholder={
              tab === "assets"
                ? t("sidebar.searchAssetsPlaceholder")
                : t("sidebar.searchLayersPlaceholder")
            }
            type="search"
            value={tab === "assets" ? assetQuery : layerQuery}
          />
          {(tab === "assets" ? assetQuery : layerQuery) && (
            <IconButton
              icon="lucide:x"
              label={t("sidebar.clearSearch")}
              onClick={() =>
                tab === "assets" ? setAssetQuery("") : setLayerQuery("")
              }
            />
          )}
        </div>
      )}
      {tab === "layers" ? (
        <div
          aria-labelledby="sidebar-layers-tab"
          className={styles.documentTree}
          id="sidebar-layers"
          role="tabpanel"
        >
          <nav
            aria-label={t("sidebar.documentPages")}
            className={styles.pageList}
          >
            <div className={styles.pageHeading}>
              <span>{t("sidebar.pages")}</span>
              <IconButton
                icon="lucide:plus"
                label={t("sidebar.createPage")}
                onClick={createPage}
              />
            </div>
            {document.pageOrder.map((pageId) => {
              const page = document.pagesById[pageId];
              if (!page) return null;
              return (
                <div
                  className={[
                    styles.pageRow,
                    activePageDrop?.pageId === pageId
                      ? activePageDrop.position === "before"
                        ? styles.pageRowDropBefore
                        : styles.pageRowDropAfter
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable={editingPageId !== pageId}
                  key={pageId}
                  onDragEnd={() => {
                    clearPageDrag();
                    setPageStatus("");
                  }}
                  onDragOver={(event) => {
                    if (
                      !draggedPageId.current ||
                      draggedPageId.current === pageId
                    )
                      return;
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const position =
                      event.clientY < bounds.top + bounds.height / 2
                        ? "before"
                        : "after";
                    setActivePageDrop({ pageId, position });
                    setPageStatus(
                      t(
                        position === "before"
                          ? "sidebar.pageDropBefore"
                          : "sidebar.pageDropAfter",
                        {
                          name: page.name,
                        },
                      ),
                    );
                  }}
                  onDragStart={(event) => {
                    draggedPageId.current = pageId;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(
                      "application/x-opendesign-page-drag",
                      "active",
                    );
                    setPageStatus(
                      t("sidebar.draggingPage", { name: page.name }),
                    );
                  }}
                  onDrop={(event) => {
                    if (!draggedPageId.current) return;
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    finishPageDrop(
                      pageId,
                      event.clientY < bounds.top + bounds.height / 2
                        ? "before"
                        : "after",
                    );
                  }}
                >
                  {editingPageId === pageId ? (
                    <div className={styles.pageEditor}>
                      <Icon name="lucide:frame" size={14} />
                      <input
                        aria-invalid={pageNameError ? "true" : undefined}
                        aria-label={t("sidebar.renamePage", {
                          name: page.name,
                        })}
                        maxLength={256}
                        onBlur={() => {
                          if (!composingPageName.current) commitPageRename();
                        }}
                        onChange={(event) => {
                          setPageNameDraft(event.target.value);
                          setPageNameError(null);
                        }}
                        onCompositionEnd={() => {
                          composingPageName.current = false;
                        }}
                        onCompositionStart={() => {
                          composingPageName.current = true;
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelPageRename();
                          } else if (
                            event.key === "Enter" &&
                            !composingPageName.current
                          ) {
                            event.preventDefault();
                            commitPageRename();
                          }
                        }}
                        ref={pageNameInput}
                        title={pageNameError ?? undefined}
                        value={pageNameDraft}
                      />
                    </div>
                  ) : (
                    <button
                      aria-current={
                        pageId === activePageId ? "page" : undefined
                      }
                      className={styles.pageItem}
                      onClick={() => onPageChange(pageId)}
                      onDoubleClick={() => beginPageRename(pageId, page.name)}
                      onKeyDown={(event) => {
                        if (event.key === "F2") {
                          event.preventDefault();
                          beginPageRename(pageId, page.name);
                        }
                      }}
                      type="button"
                    >
                      <Icon name="lucide:frame" size={14} />
                      <span>{page.name}</span>
                    </button>
                  )}
                  <DropdownMenu
                    contentProps={{
                      side: "right",
                      align: "start",
                      sideOffset: 4,
                    }}
                    icon={<Icon name="lucide:ellipsis" size={14} />}
                    label={t("sidebar.pageActions", { name: page.name })}
                  >
                    <DropdownMenuItem
                      onSelect={() => beginPageRename(pageId, page.name)}
                      shortcut="F2"
                    >
                      {t("sidebar.renamePageAction")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => duplicatePage(pageId)}>
                      {t("sidebar.duplicatePage")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className={styles.pageDelete}
                      disabled={document.pageOrder.length <= 1}
                      onSelect={() => deletePage(pageId)}
                    >
                      {t("sidebar.deletePage")}
                    </DropdownMenuItem>
                  </DropdownMenu>
                </div>
              );
            })}
            <span aria-live="polite" className={styles.pageStatus}>
              {pageNameError ?? pageStatus}
            </span>
          </nav>
          <div
            aria-label={t("sidebar.documentLayers")}
            className={styles.layerTree}
            role="tree"
          >
            <span className={styles.layerHeading}>{t("sidebar.layers")}</span>
            {normalizedLayerQuery && layers.length === 0 && (
              <span className={styles.noSearchResults}>
                {t("sidebar.noLayersFound")}
              </span>
            )}
            {layers.map((entry) => {
              const {
                componentTarget,
                node,
                depth,
                effectiveLocked,
                hasChildren,
                inheritedLocked,
                key,
                selectionNodeId,
                virtual,
              } = entry;
              const selected = componentTarget
                ? sameComponentTarget(componentTarget, selectionComponentTarget)
                : !selectionComponentTarget && selectedIds.has(selectionNodeId);
              const collapsed = collapsedNodeIds.has(key);
              return (
                <div
                  aria-expanded={hasChildren ? !collapsed : undefined}
                  aria-level={depth + 1}
                  aria-selected={selected}
                  className={[
                    styles.layerRow,
                    !node.visible ? styles.layerHidden : null,
                    booleanEditScope?.booleanId === node.id
                      ? styles.layerEditScopeParent
                      : node.parentId === booleanEditScope?.booleanId
                        ? styles.layerEditScopeOperand
                        : null,
                    !virtual && activeDrop?.nodeId === node.id
                      ? activeDrop.position === "before"
                        ? styles.layerDropBefore
                        : activeDrop.position === "inside"
                          ? styles.layerDropInside
                          : styles.layerDropAfter
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={key}
                  onPointerEnter={() =>
                    onLayerHoverChange?.({
                      nodeId: selectionNodeId,
                      ...(componentTarget ? { componentTarget } : {}),
                    })
                  }
                  onPointerLeave={() => onLayerHoverChange?.(null)}
                  onDragLeave={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (
                      activeDrop?.nodeId === node.id &&
                      !(
                        nextTarget instanceof Node &&
                        event.currentTarget.contains(nextTarget)
                      )
                    ) {
                      setActiveDrop(null);
                    }
                  }}
                  onDragOver={
                    virtual
                      ? undefined
                      : (event) => updateDrop(event, node, effectiveLocked)
                  }
                  onDrop={
                    virtual
                      ? undefined
                      : (event) => finishDrop(event, node, effectiveLocked)
                  }
                  role="treeitem"
                  style={{ "--layer-depth": depth } as CSSProperties}
                >
                  {hasChildren && (
                    <button
                      aria-label={t(
                        collapsed
                          ? "sidebar.expandNode"
                          : "sidebar.collapseNode",
                        { name: node.name || t(nodeKindKeys[node.kind]) },
                      )}
                      className={styles.layerDisclosure}
                      onClick={() => toggleNode(key)}
                      type="button"
                    >
                      <Icon
                        name={
                          collapsed
                            ? "lucide:chevron-right"
                            : "lucide:chevron-down"
                        }
                        size={13}
                      />
                    </button>
                  )}
                  {editingLayer?.key === key ? (
                    <div className={styles.layerEditor}>
                      <Icon
                        name={
                          node.maskMode !== undefined &&
                          node.maskMode !== "none"
                            ? "lucide:blend"
                            : componentIdentityNodeIds.has(node.id)
                              ? "lucide:component"
                              : nodeIcons[node.kind]
                        }
                        size={14}
                      />
                      <input
                        aria-invalid={layerNameError ? "true" : undefined}
                        aria-label={t("sidebar.renameLayer", {
                          name: node.name,
                        })}
                        maxLength={256}
                        onBlur={() => {
                          if (!composingLayerName.current) commitLayerRename();
                        }}
                        onChange={(event) => {
                          setLayerNameDraft(event.target.value);
                          setLayerNameError(null);
                        }}
                        onCompositionEnd={() => {
                          composingLayerName.current = false;
                        }}
                        onCompositionStart={() => {
                          composingLayerName.current = true;
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelLayerRename();
                          } else if (
                            event.key === "Enter" &&
                            !composingLayerName.current
                          ) {
                            event.preventDefault();
                            commitLayerRename();
                          }
                        }}
                        ref={layerNameInput}
                        title={layerNameError ?? undefined}
                        value={layerNameDraft}
                      />
                    </div>
                  ) : (
                    <button
                      className={styles.layerMain}
                      draggable={!virtual && !effectiveLocked}
                      onDragEnd={() => {
                        if (draggedNodeIds.current) {
                          clearDrag();
                          setDragStatus("");
                        }
                      }}
                      onDragStart={
                        virtual || effectiveLocked
                          ? undefined
                          : (event) => startDrag(event, node.id)
                      }
                      onClick={(event) => {
                        if (hasChildren) expandNode(key);
                        if (componentTarget) {
                          onSelect(
                            [selectionNodeId],
                            selectionNodeId,
                            componentTarget,
                          );
                          return;
                        }
                        const selection = layerPanelSelection(
                          layers
                            .filter((candidate) => !candidate.virtual)
                            .map((candidate) => candidate.selectionNodeId),
                          selectedNodeIds,
                          selectionAnchorNodeId,
                          selectionNodeId,
                          event,
                        );
                        onSelect(selection.nodeIds, selection.anchorNodeId);
                      }}
                      onDoubleClick={() => beginLayerRename(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "F2") {
                          event.preventDefault();
                          beginLayerRename(entry);
                        }
                      }}
                      tabIndex={key === firstFocusableId ? 0 : -1}
                      title={
                        node.maskMode !== undefined && node.maskMode !== "none"
                          ? t("sidebar.maskLayer", {
                              name: node.name || t(nodeKindKeys[node.kind]),
                            })
                          : node.name
                      }
                      type="button"
                    >
                      <Icon
                        name={
                          node.maskMode !== undefined &&
                          node.maskMode !== "none"
                            ? "lucide:blend"
                            : componentIdentityNodeIds.has(node.id)
                              ? "lucide:component"
                              : nodeIcons[node.kind]
                        }
                        size={14}
                      />
                      <span>
                        {node.name ||
                          t("sidebar.untitledNode", {
                            kind: t(nodeKindKeys[node.kind]),
                          })}
                      </span>
                    </button>
                  )}
                  {activeDrop?.nodeId === node.id && (
                    <span aria-hidden="true" className={styles.layerDropLabel}>
                      {t(
                        activeDrop.position === "before"
                          ? "sidebar.dropBeforeShort"
                          : activeDrop.position === "inside"
                            ? "sidebar.dropInsideShort"
                            : "sidebar.dropAfterShort",
                      )}
                    </span>
                  )}
                  <span className={styles.layerActions}>
                    <IconButton
                      className={effectiveLocked ? styles.layerLockActive : ""}
                      disabled={inheritedLocked && !node.locked}
                      icon={effectiveLocked ? "lucide:lock" : "lucide:unlock"}
                      label={t(
                        node.locked
                          ? "sidebar.unlockNode"
                          : inheritedLocked
                            ? "sidebar.lockedByParent"
                            : "sidebar.lockNode",
                        { name: node.name || t(nodeKindKeys[node.kind]) },
                      )}
                      onClick={() =>
                        componentTarget
                          ? onUpdateComponentLayer(componentTarget, {
                              locked: !node.locked,
                            })
                          : onToggleLock(node.id)
                      }
                      selected={effectiveLocked}
                    />
                    <IconButton
                      className={
                        node.visible ? "" : styles.layerVisibilityInactive
                      }
                      icon={node.visible ? "lucide:eye" : "lucide:eye-off"}
                      label={t(
                        node.visible ? "sidebar.hideNode" : "sidebar.showNode",
                        { name: node.name || t(nodeKindKeys[node.kind]) },
                      )}
                      onClick={() =>
                        componentTarget
                          ? onUpdateComponentLayer(componentTarget, {
                              visible: !node.visible,
                            })
                          : onToggleVisibility(node.id)
                      }
                    />
                  </span>
                </div>
              );
            })}
            <span className={styles.dragStatus} role="status">
              {dragStatus}
            </span>
          </div>
        </div>
      ) : tab === "assets" ? (
        <AssetsPanel
          document={document}
          onDelete={onDeleteAsset}
          onImport={onImportAsset}
          onLocate={onLocateAsset}
          onLocateComponent={onLocateComponent}
          onPlace={onPlaceAsset}
          onPlaceComponent={onPlaceComponent}
          onReplace={onReplaceAsset}
          projectLibraries={projectLibraries}
          query={assetQuery}
        />
      ) : (
        <div
          aria-labelledby="sidebar-library-tab"
          className={styles.libraryPanel}
          id="sidebar-library"
          role="tabpanel"
        >
          {tab === "variables" ? (
            <VariablesPanel
              actions={variableActions}
              activePageId={activePageId}
              document={document}
            />
          ) : styleActions ? (
            <LocalStylesPanel
              actions={styleActions}
              document={document}
              selectedNodeIds={selectedNodeIds}
            />
          ) : null}
        </div>
      )}
    </aside>
  );
}
