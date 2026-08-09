import type {
  DesignDocument,
  DesignNode,
  NodeKind,
} from "@opendesign/design-contracts";
import { Glyph, IconButton, type GlyphName } from "@opendesign/ui";
import type { CSSProperties } from "react";
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
};

function flattenPageTree(
  document: DesignDocument,
  pageId: string | undefined,
): TreeEntry[] {
  if (!pageId) return [];
  const page = document.pagesById[pageId];
  if (!page) return [];

  const entries: TreeEntry[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string, depth: number) => {
    if (visited.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;

    visited.add(nodeId);
    entries.push({ node, depth });
    for (const childId of node.childIds) visit(childId, depth + 1);
  };

  for (const rootNodeId of page.rootNodeIds) visit(rootNodeId, 0);
  return entries;
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
  const layers = flattenPageTree(document, activePageId);
  const selectedIds = new Set(selectedNodeIds);
  const firstFocusableId =
    layers.find(({ node }) => selectedIds.has(node.id))?.node.id ??
    layers[0]?.node.id;

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
            {layers.map(({ node, depth }) => {
              const selected = selectedIds.has(node.id);
              const hasChildren = node.childIds.length > 0;
              return (
                <div
                  aria-expanded={hasChildren ? true : undefined}
                  aria-level={depth + 1}
                  aria-selected={selected}
                  className="layer-row"
                  key={node.id}
                  role="treeitem"
                  style={{ "--layer-depth": depth } as CSSProperties}
                >
                  <button
                    className="layer-row__main"
                    onClick={() => onSelect(node.id)}
                    tabIndex={node.id === firstFocusableId ? 0 : -1}
                    type="button"
                  >
                    {hasChildren ? (
                      <Glyph name="chevron-down" size={13} />
                    ) : (
                      <span className="layer-row__indent" />
                    )}
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
                      icon="lock"
                      label={t(
                        node.locked ? "sidebar.unlockNode" : "sidebar.lockNode",
                        { name: node.name || t(nodeKindKeys[node.kind]) },
                      )}
                      onClick={() => onToggleLock(node.id)}
                      selected={node.locked}
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
