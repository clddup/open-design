import type { DesignDocument } from "@opendesign/design-contracts";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Glyph,
  IconButton,
} from "@opendesign/ui";
import { useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  DESIGN_ASSET_DRAG_MIME,
  filterDesignImageAssets,
  indexDesignImageAssets,
  type AssetActionResult,
  type DesignAssetIndexEntry,
  type DesignAssetReference,
} from "../design-assets";
import styles from "./AssetsPanel.module.scss";

export function AssetsPanel({
  document,
  query,
  onLocateComponent,
  onPlaceComponent,
  onDelete,
  onImport,
  onLocate,
  onPlace,
  onReplace,
}: {
  document: DesignDocument;
  query: string;
  onLocateComponent: (componentId: string) => void;
  onPlaceComponent: (componentId: string) => AssetActionResult;
  onDelete: (assetId: string) => AssetActionResult;
  onImport: () => Promise<AssetActionResult>;
  onLocate: (reference: DesignAssetReference) => void;
  onPlace: (assetId: string) => AssetActionResult;
  onReplace: (assetId: string) => Promise<AssetActionResult>;
}) {
  const { t } = useI18n();
  const entries = useMemo(() => indexDesignImageAssets(document), [document]);
  const filtered = useMemo(
    () => filterDesignImageAssets(entries, query),
    [entries, query],
  );
  const components = useMemo(
    () =>
      Object.values(document.componentsById)
        .filter((component) =>
          component.name
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        ),
    [document, query],
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const nextReferenceByAsset = useRef(new Map<string, number>());

  const report = (result: AssetActionResult) => {
    setStatus(result.ok ? (result.message ?? "") : result.error);
  };
  const runAsync = async (
    key: string,
    action: () => Promise<AssetActionResult>,
  ) => {
    if (busyKey) return;
    setBusyKey(key);
    setStatus("");
    try {
      report(await action());
    } finally {
      setBusyKey(null);
    }
  };
  const locate = (entry: DesignAssetIndexEntry) => {
    const locatable = entry.references.filter(
      (reference) => reference.pageId !== null,
    );
    if (locatable.length === 0) {
      if (entry.status === "ready") {
        report(onPlace(entry.assetId));
      } else {
        void runAsync(`replace:${entry.assetId}`, () =>
          onReplace(entry.assetId),
        );
      }
      return;
    }
    const next = nextReferenceByAsset.current.get(entry.assetId) ?? 0;
    const reference = locatable[next % locatable.length];
    if (!reference) return;
    nextReferenceByAsset.current.set(entry.assetId, next + 1);
    onLocate(reference);
    setStatus(
      t("sidebar.assetLocated", {
        current: (next % locatable.length) + 1,
        count: locatable.length,
      }),
    );
  };

  return (
    <div
      aria-labelledby="sidebar-assets-tab"
      className={styles.panel}
      id="sidebar-assets"
      role="tabpanel"
    >
      <div className={styles.heading}>
        <span>{t("sidebar.fileComponents")}</span>
      </div>
      {Object.keys(document.componentsById).length === 0 ? (
        <div className={styles.compactEmpty}>
          <Glyph name="component" size={17} />
          <span>{t("sidebar.noComponentsHint")}</span>
        </div>
      ) : components.length === 0 ? (
        <div className={styles.compactEmpty}>
          <Glyph name="search" size={15} />
          <span>{t("sidebar.noMatchingComponents")}</span>
        </div>
      ) : (
        <div
          aria-label={t("sidebar.components")}
          className={styles.componentItems}
        >
          {components.map((component) => {
            const count = Object.values(document.nodesById).filter(
              (node) =>
                node.kind === "instance" &&
                node.properties.componentId === component.id,
            ).length;
            return (
              <div className={styles.componentItem} key={component.id}>
                <button
                  aria-label={t("sidebar.placeComponent", {
                    name: component.name,
                  })}
                  onClick={() => report(onPlaceComponent(component.id))}
                  type="button"
                >
                  <Glyph name="component" size={16} />
                  <span>
                    <strong title={component.name}>{component.name}</strong>
                    <small>{t("sidebar.componentInstances", { count })}</small>
                  </span>
                </button>
                <IconButton
                  icon="select"
                  label={t("sidebar.locateComponentMain", {
                    name: component.name,
                  })}
                  onClick={() => onLocateComponent(component.id)}
                />
              </div>
            );
          })}
        </div>
      )}
      <div className={styles.heading}>
        <span>{t("sidebar.fileImages")}</span>
        <IconButton
          disabled={busyKey !== null}
          icon="plus"
          label={t("sidebar.importImageAsset")}
          onClick={() => void runAsync("import", onImport)}
        />
      </div>
      {entries.length === 0 ? (
        <div className={styles.empty}>
          <Glyph name="image" size={20} />
          <strong>{t("sidebar.noImageAssets")}</strong>
          <span>{t("sidebar.noImageAssetsHint")}</span>
          <button
            disabled={busyKey !== null}
            onClick={() => void runAsync("import", onImport)}
            type="button"
          >
            {t("sidebar.importImage")}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className={`${styles.empty} ${styles.searchEmpty}`}>
          <Glyph name="search" size={18} />
          <strong>{t("sidebar.noMatchingAssets")}</strong>
          <span>{t("sidebar.noMatchingAssetsHint", { query })}</span>
        </div>
      ) : (
        <div aria-label={t("sidebar.imageAssets")} className={styles.items}>
          {filtered.map((entry) => {
            const ready = entry.status === "ready";
            const busy = busyKey?.endsWith(`:${entry.assetId}`) ?? false;
            const dimensions = entry.asset?.size
              ? `${Math.round(entry.asset.size.width)} × ${Math.round(entry.asset.size.height)}`
              : null;
            return (
              <div
                className={`${styles.item} ${
                  entry.status === "missing"
                    ? styles.missing
                    : entry.status === "unavailable"
                      ? styles.unavailable
                      : styles.ready
                }`}
                key={entry.assetId}
              >
                <button
                  aria-label={
                    entry.referenceCount > 0
                      ? t("sidebar.locateAsset", { name: entry.name })
                      : entry.status === "ready"
                        ? t("sidebar.placeAsset", { name: entry.name })
                        : t("sidebar.relinkNamedAsset", { name: entry.name })
                  }
                  className={styles.main}
                  draggable={ready}
                  onClick={() => locate(entry)}
                  onDragStart={(event) => {
                    if (!ready) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                      DESIGN_ASSET_DRAG_MIME,
                      entry.assetId,
                    );
                    setStatus(t("sidebar.draggingAsset", { name: entry.name }));
                  }}
                  type="button"
                >
                  <span className={styles.preview}>
                    {entry.previewDataUrl ? (
                      <img
                        alt=""
                        draggable={false}
                        src={entry.previewDataUrl}
                      />
                    ) : (
                      <Glyph name="image" size={18} />
                    )}
                    {entry.status !== "ready" && <i aria-hidden="true">!</i>}
                  </span>
                  <span className={styles.copy}>
                    <strong title={entry.name}>{entry.name}</strong>
                    <small>
                      {entry.status === "missing"
                        ? t("sidebar.assetMissing")
                        : entry.status === "unavailable"
                          ? t("sidebar.assetUnavailable")
                          : entry.referenceCount === 0
                            ? t("sidebar.assetUnused")
                            : t("sidebar.assetUsageCount", {
                                count: entry.referenceCount,
                              })}
                      {dimensions ? ` · ${dimensions}` : ""}
                    </small>
                  </span>
                </button>
                <DropdownMenu
                  contentProps={{
                    side: "right",
                    align: "start",
                    sideOffset: 4,
                  }}
                  icon={<Glyph name="more" size={14} />}
                  label={t("sidebar.assetActions", { name: entry.name })}
                >
                  <DropdownMenuItem
                    disabled={!ready}
                    onSelect={() => report(onPlace(entry.assetId))}
                  >
                    {t("sidebar.placeOnCanvas")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={entry.referenceCount === 0}
                    onSelect={() => locate(entry)}
                  >
                    {t("sidebar.locateNextInstance")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busyKey !== null}
                    onSelect={() =>
                      void runAsync(`replace:${entry.assetId}`, () =>
                        onReplace(entry.assetId),
                      )
                    }
                  >
                    {entry.status === "ready"
                      ? t("sidebar.replaceAsset")
                      : t("sidebar.relinkAsset")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className={styles.delete}
                    disabled={
                      busy || entry.asset === null || entry.referenceCount > 0
                    }
                    onSelect={() => report(onDelete(entry.assetId))}
                  >
                    {entry.referenceCount > 0
                      ? t("sidebar.assetInUse")
                      : t("sidebar.deleteAsset")}
                  </DropdownMenuItem>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}
      <span aria-live="polite" className={styles.status} role="status">
        {status}
      </span>
    </div>
  );
}
