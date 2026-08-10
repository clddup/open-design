import type {
  DesignDocument,
  DesignNode,
  NodeKind,
} from "@opendesign/design-contracts";
import { Glyph, IconButton, type GlyphName } from "@opendesign/ui";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
} from "react";
import type { MessageKey } from "../../shared/i18n/messages";
import { useI18n } from "../i18n";
import type { SidebarTab } from "../state/editor";

const nodeIcons: Record<NodeKind, GlyphName> = {
  frame: "frame",
  group: "layers",
  boolean: "boolean",
  rectangle: "rectangle",
  ellipse: "ellipse",
  text: "text",
  image: "assets",
  vector: "pen",
  path: "pen",
  instance: "assets",
};

const assets = [
  {
    name: "sidebar.assetNavigation",
    detail: "sidebar.componentPlaceholder",
  },
  {
    name: "sidebar.assetPrimaryButton",
    detail: "sidebar.componentPlaceholder",
  },
  {
    name: "sidebar.assetInsightCard",
    detail: "sidebar.componentPlaceholder",
  },
  { name: "sidebar.assetSignalOrb", detail: "sidebar.vectorPlaceholder" },
] satisfies ReadonlyArray<{ name: MessageKey; detail: MessageKey }>;

const nodeKindKeys: Record<NodeKind, MessageKey> = {
  frame: "node.frame",
  group: "node.group",
  boolean: "node.boolean",
  rectangle: "node.rectangle",
  ellipse: "node.ellipse",
  text: "node.text",
  image: "node.image",
  vector: "node.vector",
  path: "node.path",
  instance: "node.instance",
};

type TreeEntry = {
  node: DesignNode;
  depth: number;
  effectiveLocked: boolean;
  inheritedLocked: boolean;
};

export type LayerDropPosition = "before" | "inside" | "after";

export type LayerReparentRequest = {
  nodeIds: readonly string[];
  parentId: string | null;
  index: number;
  position: LayerDropPosition;
  targetNodeId: string;
};

export type LayerReparentResult =
  { ok: true; warning?: string } | { ok: false; error: string };

type ActiveLayerDrop = {
  nodeId: string;
  position: LayerDropPosition;
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
  if (canDropInside && (node.kind === "frame" || node.kind === "group")) {
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
    entries.push({ node, depth, effectiveLocked, inheritedLocked });
    if (collapsedNodeIds.has(nodeId)) return;
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

export function LeftSidebar({
  document,
  activePageId,
  selectedNodeIds,
  tab,
  onTabChange,
  onPageChange,
  onDelete,
  onSelect,
  onReparent,
  onToggleLock,
  onToggleVisibility,
}: {
  document: DesignDocument;
  activePageId: string;
  selectedNodeIds: readonly string[];
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onPageChange: (pageId: string) => void;
  onDelete: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  onReparent: (request: LayerReparentRequest) => LayerReparentResult;
  onToggleLock: (nodeId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
}) {
  const { t } = useI18n();
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [activeDrop, setActiveDrop] = useState<ActiveLayerDrop | null>(null);
  const [dragStatus, setDragStatus] = useState("");
  const draggedNodeIds = useRef<readonly string[] | null>(null);
  const revealedSelectionKey = useRef<string | null>(null);
  const layers = flattenPageTree(document, activePageId, collapsedNodeIds);
  const selectedIds = new Set(selectedNodeIds);
  const firstFocusableId =
    layers.find(({ node }) => selectedIds.has(node.id))?.node.id ??
    layers[0]?.node.id;

  useEffect(() => {
    const selectionKey = `${document.documentId}:${activePageId}:${selectedNodeIds.join("\u0000")}`;
    if (revealedSelectionKey.current === selectionKey) return;
    revealedSelectionKey.current = selectionKey;
    const ancestors = collectAncestorIds(document, selectedNodeIds);
    if (ancestors.size === 0) return;
    setCollapsedNodeIds((current) => {
      if (![...ancestors].some((nodeId) => current.has(nodeId))) return current;
      const next = new Set(current);
      ancestors.forEach((nodeId) => next.delete(nodeId));
      return next;
    });
  }, [activePageId, document, selectedNodeIds]);

  useEffect(() => {
    setCollapsedNodeIds(new Set());
    revealedSelectionKey.current = null;
    draggedNodeIds.current = null;
    setActiveDrop(null);
    setDragStatus("");
  }, [activePageId, document.documentId]);

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
    <aside aria-label={t("sidebar.navigation")} className="left-sidebar">
      <div
        className="panel-tabs"
        role="tablist"
        aria-label={t("sidebar.views")}
      >
        <button
          aria-controls="sidebar-layers"
          aria-selected={tab === "layers"}
          id="sidebar-layers-tab"
          onClick={() => onTabChange("layers")}
          role="tab"
          type="button"
        >
          <Glyph name="layers" />
          {t("sidebar.layers")}
        </button>
        <button
          aria-controls="sidebar-assets"
          aria-selected={tab === "assets"}
          id="sidebar-assets-tab"
          onClick={() => onTabChange("assets")}
          role="tab"
          type="button"
        >
          <Glyph name="assets" />
          {t("sidebar.assets")}
        </button>
      </div>
      <div className="sidebar-search">
        <Glyph name="search" />
        <input
          aria-label={t("sidebar.searchUnavailable", {
            view: t(tab === "layers" ? "sidebar.layers" : "sidebar.assets"),
          })}
          disabled
          placeholder={t("sidebar.searchUnavailablePlaceholder")}
          type="search"
        />
      </div>
      {tab === "layers" ? (
        <div
          aria-labelledby="sidebar-layers-tab"
          className="document-tree"
          id="sidebar-layers"
          role="tabpanel"
        >
          <nav aria-label={t("sidebar.documentPages")} className="page-list">
            <span>{t("sidebar.pages")}</span>
            {document.pageOrder.map((pageId) => {
              const page = document.pagesById[pageId];
              if (!page) return null;
              return (
                <button
                  aria-current={pageId === activePageId ? "page" : undefined}
                  className="page-list__item"
                  key={pageId}
                  onClick={() => onPageChange(pageId)}
                  type="button"
                >
                  <Glyph name="frame" size={14} />
                  <span>{page.name}</span>
                </button>
              );
            })}
          </nav>
          <div
            aria-label={t("sidebar.documentLayers")}
            className="layer-tree"
            role="tree"
          >
            <span className="layer-tree__heading">{t("sidebar.layers")}</span>
            {layers.map(({ node, depth, effectiveLocked, inheritedLocked }) => {
              const selected = selectedIds.has(node.id);
              const hasChildren = node.childIds.length > 0;
              const collapsed = collapsedNodeIds.has(node.id);
              return (
                <div
                  aria-expanded={hasChildren ? !collapsed : undefined}
                  aria-level={depth + 1}
                  aria-selected={selected}
                  className={`layer-row${
                    activeDrop?.nodeId === node.id
                      ? ` layer-row--drop-${activeDrop.position}`
                      : ""
                  }`}
                  key={node.id}
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
                  onDragOver={(event) =>
                    updateDrop(event, node, effectiveLocked)
                  }
                  onDrop={(event) => finishDrop(event, node, effectiveLocked)}
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
                      className="layer-row__disclosure"
                      onClick={() => toggleNode(node.id)}
                      type="button"
                    >
                      <Glyph
                        name={collapsed ? "chevron-right" : "chevron-down"}
                        size={13}
                      />
                    </button>
                  )}
                  <button
                    className="layer-row__main"
                    draggable={!effectiveLocked}
                    onDragEnd={() => {
                      if (draggedNodeIds.current) {
                        clearDrag();
                        setDragStatus("");
                      }
                    }}
                    onDragStart={
                      effectiveLocked
                        ? undefined
                        : (event) => startDrag(event, node.id)
                    }
                    onClick={() => {
                      if (hasChildren) expandNode(node.id);
                      onSelect(node.id);
                    }}
                    tabIndex={node.id === firstFocusableId ? 0 : -1}
                    type="button"
                  >
                    <Glyph name={nodeIcons[node.kind]} size={14} />
                    <span>
                      {node.name ||
                        t("sidebar.untitledNode", {
                          kind: t(nodeKindKeys[node.kind]),
                        })}
                    </span>
                  </button>
                  {activeDrop?.nodeId === node.id && (
                    <span aria-hidden="true" className="layer-row__drop-label">
                      {t(
                        activeDrop.position === "before"
                          ? "sidebar.dropBeforeShort"
                          : activeDrop.position === "inside"
                            ? "sidebar.dropInsideShort"
                            : "sidebar.dropAfterShort",
                      )}
                    </span>
                  )}
                  <span className="layer-row__actions">
                    <IconButton
                      className={
                        effectiveLocked ? "layer-row__lock--active" : ""
                      }
                      disabled={inheritedLocked && !node.locked}
                      icon={effectiveLocked ? "lock" : "unlock"}
                      label={t(
                        node.locked
                          ? "sidebar.unlockNode"
                          : inheritedLocked
                            ? "sidebar.lockedByParent"
                            : "sidebar.lockNode",
                        { name: node.name || t(nodeKindKeys[node.kind]) },
                      )}
                      onClick={() => onToggleLock(node.id)}
                      selected={effectiveLocked}
                    />
                    <IconButton
                      icon={node.visible ? "eye" : "eye-off"}
                      label={t(
                        node.visible ? "sidebar.hideNode" : "sidebar.showNode",
                        { name: node.name || t(nodeKindKeys[node.kind]) },
                      )}
                      onClick={() => onToggleVisibility(node.id)}
                    />
                    <IconButton
                      icon="trash"
                      label={t("sidebar.deleteNode", {
                        name: node.name || t(nodeKindKeys[node.kind]),
                      })}
                      onClick={() => onDelete(node.id)}
                    />
                  </span>
                </div>
              );
            })}
            <span className="layer-tree__drag-status" role="status">
              {dragStatus}
            </span>
          </div>
        </div>
      ) : (
        <div
          aria-labelledby="sidebar-assets-tab"
          className="asset-list"
          id="sidebar-assets"
          role="tabpanel"
        >
          <div className="asset-list__heading">
            <span>{t("sidebar.staticPlaceholders")}</span>
            <IconButton
              disabled
              icon="plus"
              label={t("sidebar.createComponentUnavailable")}
            />
          </div>
          {assets.map((asset, index) => (
            <button
              className="asset-card"
              disabled
              key={asset.name}
              type="button"
            >
              <span
                className={`asset-card__preview asset-card__preview--${index + 1}`}
              >
                <Glyph name={index === 3 ? "ellipse" : "rectangle"} />
              </span>
              <span>
                <strong>{t(asset.name)}</strong>
                <small>{t(asset.detail)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
