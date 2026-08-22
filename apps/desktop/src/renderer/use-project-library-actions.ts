import { planLibraryReleaseUpdate } from "@opendesign/library-service";
import type {
  DesignDocument,
  DesignOperation,
  LibraryReleaseSnapshot,
  StyleReferenceTarget,
  VariableBindingTarget,
} from "@opendesign/design-contracts";
import {
  planApplyLibraryStyle,
  planApplyLibraryVariable,
  planCreateLibraryInstance,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import type {
  ProjectLibraryCatalog,
  ProjectLibraryCatalogEntry,
} from "../shared/desktop-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessageKey, MessageParameters } from "../shared/i18n/messages";
import type { AssetActionResult } from "./design-assets";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export interface ProjectLibraryItem {
  currentReleaseId: string | null;
  enabled: boolean;
  entry: ProjectLibraryCatalogEntry;
  ignored: boolean;
  release: LibraryReleaseSnapshot | null;
  updateAvailable: boolean;
}

export interface ProjectLibraryActions {
  available: boolean;
  busyKey: string | null;
  error: string | null;
  items: readonly ProjectLibraryItem[];
  loading: boolean;
  notice: string | null;
  published: boolean;
  publish: () => Promise<void>;
  setEnabled: (libraryId: string, enabled: boolean) => Promise<void>;
  placeComponent: (
    libraryId: string,
    componentId: string,
  ) => Promise<AssetActionResult>;
  applyStyle: (
    libraryId: string,
    styleId: string,
    target: StyleReferenceTarget,
  ) => Promise<AssetActionResult>;
  applyVariable: (
    libraryId: string,
    variableId: string,
    target: VariableBindingTarget,
  ) => Promise<AssetActionResult>;
  acceptUpdate: (libraryId: string) => Promise<void>;
  ignoreUpdate: (libraryId: string) => Promise<void>;
  clearError: () => void;
}

export function useProjectLibraryActions({
  activeDesignFileId,
  activePageId,
  activeProjectId,
  applyCommands,
  document,
  projectBacked,
  runtime,
  t,
  transactionCounter,
}: {
  activeDesignFileId: string;
  activePageId: string;
  activeProjectId: string;
  applyCommands: (label: string, commands: DesignOperation[]) => boolean;
  document: DesignDocument;
  projectBacked: boolean;
  runtime: EditorRuntime;
  t: Translate;
  transactionCounter: { current: number };
}): ProjectLibraryActions {
  const [catalog, setCatalog] = useState<ProjectLibraryCatalog | null>(null);
  const [releases, setReleases] = useState<
    Record<string, LibraryReleaseSnapshot>
  >({});
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadEpoch = useRef(0);
  const importedReleasesRef = useRef(collectImportedReleaseIds(document));
  const importedSourceKey = importedLibrarySourceKey(document);
  importedReleasesRef.current = collectImportedReleaseIds(document);

  const load = useCallback(async () => {
    const api = window.desktop;
    const epoch = ++loadEpoch.current;
    if (!projectBacked || !api) {
      setCatalog(null);
      setReleases({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextCatalog = await api.listProjectLibraries({
        projectId: activeProjectId,
      });
      const enabled = new Set(
        nextCatalog.enabledLibraryIdsByDesignFileId[activeDesignFileId] ?? [],
      );
      const nextReleases = Object.fromEntries(
        await Promise.all(
          nextCatalog.libraries
            .filter(
              (entry) =>
                enabled.has(entry.libraryId) &&
                entry.sourceDesignFileId !== activeDesignFileId,
            )
            .map(async (entry) => {
              const selectedReleaseId =
                nextCatalog.acceptedReleaseIdsByDesignFileId[
                  activeDesignFileId
                ]?.[entry.libraryId] ??
                newestImportedReleaseId(
                  importedReleasesRef.current[entry.libraryId],
                  entry,
                );
              return [
                entry.libraryId,
                await api.readProjectLibraryRelease({
                  projectId: activeProjectId,
                  libraryId: entry.libraryId,
                  ...(selectedReleaseId
                    ? { releaseId: selectedReleaseId }
                    : {}),
                }),
              ] as const;
            }),
        ),
      );
      if (epoch !== loadEpoch.current) return;
      setCatalog(nextCatalog);
      setReleases(nextReleases);
    } catch (reason) {
      if (epoch === loadEpoch.current) setError(errorMessage(reason));
    } finally {
      if (epoch === loadEpoch.current) setLoading(false);
    }
  }, [activeDesignFileId, activeProjectId, importedSourceKey, projectBacked]);

  useEffect(() => {
    void load();
    return () => {
      loadEpoch.current += 1;
    };
  }, [load]);

  const run = useCallback(
    async (key: string, action: () => Promise<void>) => {
      if (busyKey) return;
      setBusyKey(key);
      setError(null);
      setNotice(null);
      try {
        await action();
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey],
  );

  const publish = useCallback(
    () =>
      run("publish", async () => {
        const api = requireDesktopApi();
        const current = runtime.getSnapshot().document;
        await api.saveProjectDesignFile({
          projectId: activeProjectId,
          designFileId: activeDesignFileId,
          document: current,
        });
        const result = await api.publishProjectLibrary({
          projectId: activeProjectId,
          designFileId: activeDesignFileId,
        });
        setCatalog(result.catalog);
        setNotice(t("sidebar.libraryPublished"));
      }),
    [activeDesignFileId, activeProjectId, run, runtime, t],
  );

  const setEnabled = useCallback(
    (libraryId: string, enabled: boolean) =>
      run(`enabled:${libraryId}`, async () => {
        const api = requireDesktopApi();
        const nextCatalog = await api.setProjectLibraryEnabled({
          projectId: activeProjectId,
          designFileId: activeDesignFileId,
          libraryId,
          enabled,
        });
        setCatalog(nextCatalog);
        if (enabled) {
          const release = await api.readProjectLibraryRelease({
            projectId: activeProjectId,
            libraryId,
          });
          setReleases((current) => ({ ...current, [libraryId]: release }));
          setNotice(t("sidebar.libraryEnabledNotice"));
        } else {
          setReleases((current) => {
            const next = { ...current };
            delete next[libraryId];
            return next;
          });
          setNotice(t("sidebar.libraryDisabledNotice"));
        }
      }),
    [activeDesignFileId, activeProjectId, run, t],
  );

  const placeComponent = useCallback(
    async (
      libraryId: string,
      componentId: string,
    ): Promise<AssetActionResult> => {
      if (busyKey) {
        return { ok: false, error: t("sidebar.libraryBusy") };
      }
      setBusyKey(`place:${libraryId}:${componentId}`);
      setError(null);
      try {
        const api = requireDesktopApi();
        const release =
          releases[libraryId] ??
          (await api.readProjectLibraryRelease({
            projectId: activeProjectId,
            libraryId,
          }));
        const current = runtime.getSnapshot();
        const page = current.document.pagesById[activePageId];
        const component = release.componentsById[componentId]?.component;
        if (!page || !component) {
          return { ok: false, error: t("sidebar.libraryComponentUnavailable") };
        }
        const operationId = `library_instance_${Date.now()}_${++transactionCounter.current}`;
        const plan = planCreateLibraryInstance(current.document, release, {
          componentId,
          instanceId: operationId,
          pageId: activePageId,
          parentId: null,
          index: page.rootNodeIds.length,
          transform: [1, 0, 0, 1, 64, 64],
          commandPrefix: operationId,
        });
        if (!plan.ok) return { ok: false, error: plan.message };
        if (!applyCommands(t("history.createLibraryInstance"), plan.commands)) {
          return { ok: false, error: t("sidebar.libraryComponentUnavailable") };
        }
        runtime.setSelection(plan.selectionNodeIds, plan.instanceId);
        setReleases((currentReleases) => ({
          ...currentReleases,
          [libraryId]: release,
        }));
        return {
          ok: true,
          message: t("sidebar.libraryComponentPlaced", {
            name: component.name,
          }),
        };
      } catch (reason) {
        const message = errorMessage(reason);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusyKey(null);
      }
    },
    [
      activePageId,
      activeProjectId,
      applyCommands,
      busyKey,
      releases,
      runtime,
      t,
      transactionCounter,
    ],
  );

  const applyStyle = useCallback(
    async (
      libraryId: string,
      styleId: string,
      target: StyleReferenceTarget,
    ): Promise<AssetActionResult> => {
      if (busyKey) {
        return { ok: false, error: t("sidebar.libraryBusy") };
      }
      setBusyKey(`style:${libraryId}:${styleId}`);
      setError(null);
      try {
        const api = requireDesktopApi();
        const release =
          releases[libraryId] ??
          (await api.readProjectLibraryRelease({
            projectId: activeProjectId,
            libraryId,
          }));
        const source = release.stylesById[styleId];
        if (!source || source.style.hiddenFromPublishing) {
          return { ok: false, error: t("sidebar.libraryStyleUnavailable") };
        }
        const operationId = `library_style_${Date.now()}_${++transactionCounter.current}`;
        const plan = planApplyLibraryStyle(
          runtime.getSnapshot().document,
          release,
          {
            styleId,
            target,
            commandPrefix: operationId,
          },
        );
        if (!plan.ok) return { ok: false, error: plan.message };
        if (!applyCommands(t("history.applyLibraryStyle"), plan.commands)) {
          return { ok: false, error: t("sidebar.libraryStyleUnavailable") };
        }
        setReleases((currentReleases) => ({
          ...currentReleases,
          [libraryId]: release,
        }));
        return {
          ok: true,
          message: t("sidebar.libraryStyleApplied", {
            name: source.style.name,
          }),
        };
      } catch (reason) {
        const message = errorMessage(reason);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusyKey(null);
      }
    },
    [
      activeProjectId,
      applyCommands,
      busyKey,
      releases,
      runtime,
      t,
      transactionCounter,
    ],
  );

  const applyVariable = useCallback(
    async (
      libraryId: string,
      variableId: string,
      target: VariableBindingTarget,
    ): Promise<AssetActionResult> => {
      if (busyKey) {
        return { ok: false, error: t("sidebar.libraryBusy") };
      }
      setBusyKey(`variable:${libraryId}:${variableId}`);
      setError(null);
      try {
        const api = requireDesktopApi();
        const release =
          releases[libraryId] ??
          (await api.readProjectLibraryRelease({
            projectId: activeProjectId,
            libraryId,
          }));
        const source = release.variablesById[variableId];
        const collection = source
          ? release.variableCollectionsById[
              source.variable.variableCollectionId
            ]
          : undefined;
        if (
          !source ||
          !collection ||
          source.variable.hiddenFromPublishing ||
          collection.collection.hiddenFromPublishing
        ) {
          return {
            ok: false,
            error: t("sidebar.libraryVariableUnavailable"),
          };
        }
        const operationId = `library_variable_${Date.now()}_${++transactionCounter.current}`;
        const plan = planApplyLibraryVariable(
          runtime.getSnapshot().document,
          release,
          { variableId, target, commandPrefix: operationId },
        );
        if (!plan.ok) return { ok: false, error: plan.message };
        if (!applyCommands(t("history.applyLibraryVariable"), plan.commands)) {
          return {
            ok: false,
            error: t("sidebar.libraryVariableUnavailable"),
          };
        }
        setReleases((currentReleases) => ({
          ...currentReleases,
          [libraryId]: release,
        }));
        return {
          ok: true,
          message: t("sidebar.libraryVariableApplied", {
            name: source.variable.name,
          }),
        };
      } catch (reason) {
        const message = errorMessage(reason);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusyKey(null);
      }
    },
    [
      activeProjectId,
      applyCommands,
      busyKey,
      releases,
      runtime,
      t,
      transactionCounter,
    ],
  );

  const acceptUpdate = useCallback(
    (libraryId: string) =>
      run(`accept:${libraryId}`, async () => {
        const api = requireDesktopApi();
        const release = await api.readProjectLibraryRelease({
          projectId: activeProjectId,
          libraryId,
        });
        const current = runtime.getSnapshot().document;
        const operationId = `library_update_${Date.now()}_${++transactionCounter.current}`;
        const plan = planLibraryReleaseUpdate(current, release, operationId);
        if (
          plan.commands.length > 0 &&
          !applyCommands(t("history.updateLibrary"), plan.commands)
        ) {
          throw new Error(t("sidebar.libraryUpdateFailed"));
        }
        await api.saveProjectDesignFile({
          projectId: activeProjectId,
          designFileId: activeDesignFileId,
          document: runtime.getSnapshot().document,
        });
        const nextCatalog = await api.setProjectLibraryUpdateAccepted({
          projectId: activeProjectId,
          designFileId: activeDesignFileId,
          libraryId,
          releaseId: release.releaseId,
        });
        setCatalog(nextCatalog);
        setReleases((currentReleases) => ({
          ...currentReleases,
          [libraryId]: release,
        }));
        setNotice(t("sidebar.libraryUpdated"));
      }),
    [
      activeDesignFileId,
      activeProjectId,
      applyCommands,
      run,
      runtime,
      t,
      transactionCounter,
    ],
  );

  const ignoreUpdate = useCallback(
    (libraryId: string) =>
      run(`ignore:${libraryId}`, async () => {
        const api = requireDesktopApi();
        const entry = catalog?.libraries.find(
          (candidate) => candidate.libraryId === libraryId,
        );
        if (!entry) throw new Error(t("sidebar.libraryUnavailable"));
        setCatalog(
          await api.setProjectLibraryUpdateIgnored({
            projectId: activeProjectId,
            designFileId: activeDesignFileId,
            libraryId,
            releaseId: entry.latestReleaseId,
          }),
        );
        setNotice(t("sidebar.libraryUpdateIgnored"));
      }),
    [activeDesignFileId, activeProjectId, catalog, run, t],
  );

  const items = useMemo(() => {
    if (!catalog) return [];
    const enabled = new Set(
      catalog.enabledLibraryIdsByDesignFileId[activeDesignFileId] ?? [],
    );
    const ignored =
      catalog.ignoredReleaseIdsByDesignFileId[activeDesignFileId] ?? {};
    const accepted =
      catalog.acceptedReleaseIdsByDesignFileId[activeDesignFileId] ?? {};
    return catalog.libraries
      .filter((entry) => entry.sourceDesignFileId !== activeDesignFileId)
      .map((entry): ProjectLibraryItem => {
        const currentReleaseId =
          accepted[entry.libraryId] ?? importedReleaseId(document, entry);
        return {
          currentReleaseId,
          enabled: enabled.has(entry.libraryId),
          entry,
          ignored: ignored[entry.libraryId] === entry.latestReleaseId,
          release: releases[entry.libraryId] ?? null,
          updateAvailable:
            enabled.has(entry.libraryId) &&
            currentReleaseId !== null &&
            currentReleaseId !== entry.latestReleaseId &&
            accepted[entry.libraryId] !== entry.latestReleaseId &&
            ignored[entry.libraryId] !== entry.latestReleaseId,
        };
      })
      .sort((left, right) => left.entry.name.localeCompare(right.entry.name));
  }, [activeDesignFileId, catalog, document, releases]);

  return {
    available: projectBacked,
    busyKey,
    error,
    items,
    loading,
    notice,
    published: Boolean(
      catalog?.libraries.some(
        (entry) => entry.sourceDesignFileId === activeDesignFileId,
      ),
    ),
    publish,
    setEnabled,
    placeComponent,
    applyStyle,
    applyVariable,
    acceptUpdate,
    ignoreUpdate,
    clearError: () => setError(null),
  };
}

function importedReleaseId(
  document: DesignDocument,
  entry: ProjectLibraryCatalogEntry,
): string | null {
  return newestImportedReleaseId(
    collectImportedReleaseIds(document)[entry.libraryId],
    entry,
  );
}

function collectImportedReleaseIds(document: DesignDocument) {
  const releaseIdsByLibraryId: Record<string, Set<string>> = {};
  for (const source of Object.values(document.libraryComponentsById)) {
    const releaseIds =
      releaseIdsByLibraryId[source.source.libraryId] ?? new Set<string>();
    releaseIds.add(source.source.releaseId);
    releaseIdsByLibraryId[source.source.libraryId] = releaseIds;
  }
  for (const source of Object.values(document.libraryStylesById)) {
    const releaseIds =
      releaseIdsByLibraryId[source.source.libraryId] ?? new Set<string>();
    releaseIds.add(source.source.releaseId);
    releaseIdsByLibraryId[source.source.libraryId] = releaseIds;
  }
  for (const source of Object.values(document.libraryVariableCollectionsById)) {
    const releaseIds =
      releaseIdsByLibraryId[source.source.libraryId] ?? new Set<string>();
    releaseIds.add(source.source.releaseId);
    releaseIdsByLibraryId[source.source.libraryId] = releaseIds;
  }
  for (const source of Object.values(document.libraryVariablesById)) {
    const releaseIds =
      releaseIdsByLibraryId[source.source.libraryId] ?? new Set<string>();
    releaseIds.add(source.source.releaseId);
    releaseIdsByLibraryId[source.source.libraryId] = releaseIds;
  }
  return releaseIdsByLibraryId;
}

function newestImportedReleaseId(
  importedReleaseIds: ReadonlySet<string> | undefined,
  entry: ProjectLibraryCatalogEntry,
): string | null {
  if (!importedReleaseIds?.size) return null;
  for (let index = entry.releases.length - 1; index >= 0; index -= 1) {
    const releaseId = entry.releases[index]?.releaseId;
    if (releaseId && importedReleaseIds.has(releaseId)) return releaseId;
  }
  return null;
}

function importedLibrarySourceKey(document: DesignDocument) {
  return [
    ...Object.values(document.libraryComponentsById).map(
      (source) =>
        `${source.source.libraryId}\u0000${source.source.releaseId}\u0000${source.component.id}`,
    ),
    ...Object.values(document.libraryStylesById).map(
      (source) =>
        `${source.source.libraryId}\u0000${source.source.releaseId}\u0000${source.style.id}`,
    ),
    ...Object.values(document.libraryVariableCollectionsById).map(
      (source) =>
        `${source.source.libraryId}\u0000${source.source.releaseId}\u0000${source.collection.id}`,
    ),
    ...Object.values(document.libraryVariablesById).map(
      (source) =>
        `${source.source.libraryId}\u0000${source.source.releaseId}\u0000${source.variable.id}`,
    ),
  ]
    .sort()
    .join("\u0001");
}

function requireDesktopApi() {
  if (!window.desktop) throw new Error("Desktop Library API is unavailable");
  return window.desktop;
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
