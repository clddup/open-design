import type {
  DesignDocument,
  DesignNode,
  NodeKind,
} from "@opendesign/design-contracts";
import { Glyph, IconButton, type GlyphName } from "@opendesign/ui";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { MessageKey } from "../../shared/i18n/messages";
import { useI18n } from "../i18n";
import type { SidebarTab } from "../state/editor";

const nodeIcons: Record<NodeKind, GlyphName> = {
  frame: "frame",
  group: "layers",
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
  onToggleLock: (nodeId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
}) {
  const { t } = useI18n();
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
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
                  className="layer-row"
                  key={node.id}
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
