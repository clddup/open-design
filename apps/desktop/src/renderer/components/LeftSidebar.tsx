import type {
  DesignDocument,
  DesignNode,
  NodeKind,
} from "@opendesign/design-contracts";
import {
  canDeleteNodes,
  resolveBooleanEditScope,
} from "@opendesign/editor-runtime";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Glyph,
  IconButton,
  type GlyphName,
} from "@opendesign/ui";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
} from "react";
import type { MessageKey } from "../../shared/i18n/messages";
import type { AssetActionResult, DesignAssetReference } from "../design-assets";
import { useI18n } from "../i18n";
import type { SidebarTab } from "../state/editor";
import { AssetsPanel } from "./AssetsPanel";
import styles from "./LeftSidebar.module.scss";

const nodeIcons: Record<NodeKind, GlyphName> = {
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

const nodeKindKeys: Record<NodeKind, MessageKey> = {
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

type PageDropPosition = "before" | "after";

type ActivePageDrop = {
  pageId: string;
  position: PageDropPosition;
};

export type PageActionResult =
  { ok: true; pageId: string; name?: string } | { ok: false; error: string };

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
  const [activePageDrop, setActivePageDrop] = useState<ActivePageDrop | null>(
    null,
  );
  const [dragStatus, setDragStatus] = useState("");
  const [pageStatus, setPageStatus] = useState("");
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pageNameDraft, setPageNameDraft] = useState("");
  const [pageNameError, setPageNameError] = useState<string | null>(null);
  const [assetQuery, setAssetQuery] = useState("");
  const draggedNodeIds = useRef<readonly string[] | null>(null);
  const draggedPageId = useRef<string | null>(null);
  const pageNameInput = useRef<HTMLInputElement | null>(null);
  const composingPageName = useRef(false);
  const revealedSelectionKey = useRef<string | null>(null);
  const layers = flattenPageTree(document, activePageId, collapsedNodeIds);
  const selectedIds = new Set(selectedNodeIds);
  const componentMainNodeIds = new Set(
    Object.values(document.componentsById).map(
      (component) => component.rootNodeId,
    ),
  );
  const booleanEditScope = resolveBooleanEditScope(
    document,
    activePageId,
    selectedNodeIds,
  );
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

  useEffect(() => {
    setAssetQuery("");
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

  const beginPageRename = (pageId: string, name: string) => {
    setEditingPageId(pageId);
    setPageNameDraft(name);
    setPageNameError(null);
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
    setPageStatus(
      t("sidebar.renamedPage", { name: result.name ?? pageNameDraft.trim() }),
    );
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
    setPageStatus(t("sidebar.createdPage"));
  };

  const duplicatePage = (pageId: string) => {
    const result = onDuplicatePage(pageId);
    if (!result.ok) {
      setPageStatus(result.error);
      return;
    }
    onPageChange(result.pageId);
    setPageStatus(t("sidebar.duplicatedPage"));
  };

  const deletePage = (pageId: string) => {
    const result = onDeletePage(pageId);
    setPageStatus(result.ok ? t("sidebar.deletedPage") : result.error);
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
    setPageStatus(result.ok ? t("sidebar.reorderedPage") : result.error);
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
    <aside aria-label={t("sidebar.navigation")} className={styles.root}>
      <div
        className={styles.tabs}
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
      <div className={styles.search}>
        <Glyph name="search" />
        <input
          aria-label={
            tab === "assets"
              ? t("sidebar.searchAssets")
              : t("sidebar.searchUnavailable", {
                  view: t("sidebar.layers"),
                })
          }
          disabled={tab !== "assets"}
          onChange={(event) => setAssetQuery(event.target.value)}
          placeholder={
            tab === "assets"
              ? t("sidebar.searchAssetsPlaceholder")
              : t("sidebar.searchUnavailablePlaceholder")
          }
          type="search"
          value={tab === "assets" ? assetQuery : ""}
        />
      </div>
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
                icon="plus"
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
                      <Glyph name="frame" size={14} />
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
                      <Glyph name="frame" size={14} />
                      <span>{page.name}</span>
                    </button>
                  )}
                  <DropdownMenu
                    contentProps={{
                      side: "right",
                      align: "start",
                      sideOffset: 4,
                    }}
                    icon={<Glyph name="more" size={14} />}
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
            {layers.map(({ node, depth, effectiveLocked, inheritedLocked }) => {
              const selected = selectedIds.has(node.id);
              const hasChildren = node.childIds.length > 0;
              const collapsed = collapsedNodeIds.has(node.id);
              return (
                <div
                  aria-expanded={hasChildren ? !collapsed : undefined}
                  aria-level={depth + 1}
                  aria-selected={selected}
                  className={[
                    styles.layerRow,
                    booleanEditScope?.booleanId === node.id
                      ? styles.layerEditScopeParent
                      : node.parentId === booleanEditScope?.booleanId
                        ? styles.layerEditScopeOperand
                        : null,
                    activeDrop?.nodeId === node.id
                      ? activeDrop.position === "before"
                        ? styles.layerDropBefore
                        : activeDrop.position === "inside"
                          ? styles.layerDropInside
                          : styles.layerDropAfter
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
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
                      className={styles.layerDisclosure}
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
                    className={styles.layerMain}
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
                    <Glyph
                      name={
                        componentMainNodeIds.has(node.id)
                          ? "component"
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
                      disabled={!canDeleteNodes(document, [node.id])}
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
            <span className={styles.dragStatus} role="status">
              {dragStatus}
            </span>
          </div>
        </div>
      ) : (
        <AssetsPanel
          document={document}
          onDelete={onDeleteAsset}
          onImport={onImportAsset}
          onLocate={onLocateAsset}
          onLocateComponent={onLocateComponent}
          onPlace={onPlaceAsset}
          onPlaceComponent={onPlaceComponent}
          onReplace={onReplaceAsset}
          query={assetQuery}
        />
      )}
    </aside>
  );
}
