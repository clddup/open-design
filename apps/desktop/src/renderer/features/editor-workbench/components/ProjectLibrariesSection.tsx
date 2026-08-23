import type {
  DesignDocument,
  LibraryReleaseSnapshot,
  SharedStyleType,
  VariableResolvedDataType,
} from "@opendesign/design-contracts";
import { Button, Icon, IconButton } from "@opendesign/ui";
import { useMemo, useState } from "react";
import { useI18n } from "../../../i18n";
import type { ProjectLibraryActions } from "../../../use-project-library-actions";
import styles from "./ProjectLibrariesSection.module.scss";

export function ProjectLibrariesSection({
  actions,
  document,
  query,
}: {
  actions: ProjectLibraryActions;
  document: DesignDocument;
  query: string;
}) {
  const { t } = useI18n();
  const [expandedLibraryIds, setExpandedLibraryIds] = useState<Set<string>>(
    new Set(),
  );
  const publishable =
    Object.keys(document.componentsById).length > 0 ||
    Object.values(document.stylesById).some(
      (style) => !style.hiddenFromPublishing,
    ) ||
    Object.values(document.variableCollectionsById).some(
      (collection) => !collection.hiddenFromPublishing,
    );
  if (!actions.available) return null;

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <span>{t("sidebar.projectLibraries")}</span>
        <IconButton
          disabled={actions.busyKey !== null || !publishable}
          icon={actions.published ? "lucide:refresh-cw" : "lucide:upload"}
          label={
            !publishable
              ? t("sidebar.publishRequiresComponent")
              : actions.published
                ? t("sidebar.republishCurrentFile")
                : t("sidebar.publishCurrentFile")
          }
          onClick={() => void actions.publish()}
        />
      </div>
      {actions.notice ? (
        <div className={styles.notice} role="status">
          <Icon name="lucide:check" size={13} />
          <span>{actions.notice}</span>
        </div>
      ) : null}
      {actions.error ? (
        <div className={styles.error} role="alert">
          <Icon name="lucide:circle-alert" size={14} />
          <span>{actions.error}</span>
          <IconButton
            icon="lucide:x"
            label={t("message.dismiss")}
            onClick={actions.clearError}
          />
        </div>
      ) : null}
      {actions.loading ? (
        <div className={styles.empty} role="status">
          <Icon name="lucide:loader-circle" size={15} />
          <span>{t("sidebar.loadingLibraries")}</span>
        </div>
      ) : actions.items.length === 0 ? (
        <div className={styles.empty}>
          <Icon name="lucide:library" size={16} />
          <span>{t("sidebar.noProjectLibraries")}</span>
        </div>
      ) : (
        <div className={styles.libraries}>
          {actions.items.map((item) => {
            const expanded = expandedLibraryIds.has(item.entry.libraryId);
            return (
              <div className={styles.library} key={item.entry.libraryId}>
                <div className={styles.libraryRow}>
                  <button
                    aria-expanded={item.enabled ? expanded : undefined}
                    className={styles.libraryName}
                    disabled={!item.enabled}
                    onClick={() => {
                      setExpandedLibraryIds((current) => {
                        const next = new Set(current);
                        if (next.has(item.entry.libraryId)) {
                          next.delete(item.entry.libraryId);
                        } else {
                          next.add(item.entry.libraryId);
                        }
                        return next;
                      });
                    }}
                    type="button"
                  >
                    <Icon
                      name={
                        item.enabled && expanded
                          ? "lucide:chevron-down"
                          : "lucide:chevron-right"
                      }
                      size={13}
                    />
                    <span>
                      <strong>{item.entry.name}</strong>
                      <small>
                        {item.enabled
                          ? t("sidebar.libraryEnabled")
                          : t("sidebar.libraryDisabled")}
                      </small>
                    </span>
                  </button>
                  <IconButton
                    disabled={actions.busyKey !== null}
                    icon={
                      item.enabled ? "lucide:circle-check" : "lucide:circle"
                    }
                    label={
                      item.enabled
                        ? t("sidebar.disableLibrary", {
                            name: item.entry.name,
                          })
                        : t("sidebar.enableLibrary", { name: item.entry.name })
                    }
                    onClick={() =>
                      void actions.setEnabled(
                        item.entry.libraryId,
                        !item.enabled,
                      )
                    }
                    selected={item.enabled}
                  />
                </div>
                {item.updateAvailable ? (
                  <div className={styles.update}>
                    <span>{t("sidebar.libraryUpdateAvailable")}</span>
                    <Button
                      disabled={actions.busyKey !== null}
                      onClick={() =>
                        void actions.acceptUpdate(item.entry.libraryId)
                      }
                      tone="primary"
                    >
                      {t("sidebar.acceptLibraryUpdate")}
                    </Button>
                    <Button
                      disabled={actions.busyKey !== null}
                      onClick={() =>
                        void actions.ignoreUpdate(item.entry.libraryId)
                      }
                      tone="quiet"
                    >
                      {t("sidebar.ignoreLibraryUpdate")}
                    </Button>
                  </div>
                ) : null}
                {item.enabled && expanded ? (
                  <div className={styles.resources}>
                    <div className={styles.resourceHeading}>
                      {t("sidebar.libraryComponents")}
                    </div>
                    <LibraryComponents
                      busy={actions.busyKey !== null}
                      document={document}
                      onPlace={(componentId) =>
                        actions.placeComponent(
                          item.entry.libraryId,
                          componentId,
                        )
                      }
                      query={query}
                      release={item.release}
                    />
                    <div className={styles.resourceHeading}>
                      {t("sidebar.libraryStyles")}
                    </div>
                    <LibraryStyles query={query} release={item.release} />
                    <div className={styles.resourceHeading}>
                      {t("sidebar.libraryVariables")}
                    </div>
                    <LibraryVariables query={query} release={item.release} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LibraryVariables({
  query,
  release,
}: {
  query: string;
  release: LibraryReleaseSnapshot | null;
}) {
  const { t } = useI18n();
  const collections = useMemo(
    () => (release ? releaseVariables(release, query) : []),
    [query, release],
  );
  if (!release) {
    return (
      <div className={styles.componentEmpty}>
        {t("sidebar.libraryUnavailable")}
      </div>
    );
  }
  if (collections.length === 0) {
    return (
      <div className={styles.componentEmpty}>
        {t("sidebar.libraryHasNoVariables")}
      </div>
    );
  }
  return (
    <div
      aria-label={t("sidebar.libraryVariables")}
      className={styles.variableCollections}
    >
      {collections.map((collection) => (
        <div className={styles.variableCollection} key={collection.id}>
          <div className={styles.variableCollectionName}>
            <Icon name="lucide:database" size={13} />
            <span>{collection.name}</span>
            <small>
              {t("variables.variableCount", {
                count: collection.variables.length,
              })}
            </small>
          </div>
          {collection.variables.map((variable) => (
            <div className={styles.variableItem} key={variable.id}>
              <Icon name="lucide:variable" size={12} />
              <span>{variable.name}</span>
              <small>{variableTypeLabel(variable.resolvedType, t)}</small>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function LibraryStyles({
  query,
  release,
}: {
  query: string;
  release: LibraryReleaseSnapshot | null;
}) {
  const { t } = useI18n();
  const entries = useMemo(
    () => (release ? releaseStyles(release, query) : []),
    [query, release],
  );
  if (!release) {
    return (
      <div className={styles.componentEmpty}>
        {t("sidebar.libraryUnavailable")}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className={styles.componentEmpty}>
        {t("sidebar.libraryHasNoStyles")}
      </div>
    );
  }
  return (
    <div aria-label={t("sidebar.libraryStyles")} className={styles.styleItems}>
      {entries.map((entry) => (
        <div key={entry.id}>
          <Icon name={styleIcon(entry.styleType)} size={14} />
          <span>
            <strong>{entry.name}</strong>
            <small>{t(styleTypeKey(entry.styleType))}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function LibraryComponents({
  busy,
  document,
  onPlace,
  query,
  release,
}: {
  busy: boolean;
  document: DesignDocument;
  onPlace: (componentId: string) => Promise<{
    ok: boolean;
    message?: string;
    error?: string;
  }>;
  query: string;
  release: LibraryReleaseSnapshot | null;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState("");
  const components = useMemo(
    () => (release ? releaseComponents(release, query) : []),
    [query, release],
  );
  if (!release) {
    return (
      <div className={styles.componentEmpty}>
        {t("sidebar.libraryUnavailable")}
      </div>
    );
  }
  if (components.length === 0) {
    return (
      <div className={styles.componentEmpty}>
        {query.trim()
          ? t("sidebar.noMatchingComponents")
          : t("sidebar.libraryHasNoComponents")}
      </div>
    );
  }
  return (
    <div className={styles.components}>
      {components.map((component) => {
        const componentIds = new Set(component.componentIds);
        const count = Object.values(document.nodesById).filter(
          (node) =>
            node.kind === "instance" &&
            componentIds.has(node.properties.componentId),
        ).length;
        return (
          <button
            aria-label={t("sidebar.placeComponent", { name: component.name })}
            disabled={busy}
            key={component.componentId}
            onClick={() => {
              void onPlace(component.componentId).then((result) =>
                setStatus(
                  result.ok ? (result.message ?? "") : (result.error ?? ""),
                ),
              );
            }}
            type="button"
          >
            <Icon name="lucide:component" size={15} />
            <span>
              <strong>{component.name}</strong>
              <small>
                {component.variantCount > 0
                  ? t("sidebar.componentSetSummary", {
                      count,
                      variants: component.variantCount,
                    })
                  : t("sidebar.componentInstances", { count })}
              </small>
            </span>
            <Icon name="lucide:plus" size={13} />
          </button>
        );
      })}
      <span className={styles.status} role="status">
        {status}
      </span>
    </div>
  );
}

function releaseComponents(release: LibraryReleaseSnapshot, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const variantsBySet = new Map<string, string[]>();
  const ordinary = Object.values(release.componentsById).flatMap((source) => {
    const component = source.component;
    if (!component.variantSetId) {
      return [
        {
          componentId: component.id,
          componentIds: [component.id],
          name: component.name,
          variantCount: 0,
        },
      ];
    }
    const members = variantsBySet.get(component.variantSetId) ?? [];
    members.push(component.id);
    variantsBySet.set(component.variantSetId, members);
    return [];
  });
  const sets = Object.values(release.variantSetsById).flatMap((source) => {
    const variantSet = source.variantSet;
    const componentIds = variantsBySet.get(variantSet.id) ?? [];
    return componentIds.includes(variantSet.defaultComponentId)
      ? [
          {
            componentId: variantSet.defaultComponentId,
            componentIds,
            name: variantSet.name,
            variantCount: componentIds.length,
          },
        ]
      : [];
  });
  return [...ordinary, ...sets]
    .filter(
      (component) =>
        !normalizedQuery ||
        component.name.toLocaleLowerCase().includes(normalizedQuery) ||
        component.componentIds.some((componentId) =>
          release.componentsById[componentId]?.component.name
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        ),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.componentId.localeCompare(right.componentId),
    );
}

function releaseStyles(release: LibraryReleaseSnapshot, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return Object.values(release.stylesById)
    .map((source) => source.style)
    .filter(
      (style) =>
        !style.hiddenFromPublishing &&
        (!normalizedQuery ||
          style.name.toLocaleLowerCase().includes(normalizedQuery)),
    )
    .sort(
      (left, right) =>
        left.styleType.localeCompare(right.styleType) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    );
}

function releaseVariables(release: LibraryReleaseSnapshot, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return Object.values(release.variableCollectionsById)
    .map((source) => {
      const collection = source.collection;
      const variables = collection.variableIds.flatMap((variableId) => {
        const variable = release.variablesById[variableId]?.variable;
        return variable && !variable.hiddenFromPublishing ? [variable] : [];
      });
      const collectionMatches = collection.name
        .toLocaleLowerCase()
        .includes(normalizedQuery);
      return {
        id: collection.id,
        name: collection.name,
        hidden: collection.hiddenFromPublishing,
        variables: collectionMatches
          ? variables
          : variables.filter((variable) =>
              variable.name.toLocaleLowerCase().includes(normalizedQuery),
            ),
      };
    })
    .filter(
      (collection) =>
        !collection.hidden &&
        collection.variables.length > 0 &&
        (!normalizedQuery ||
          collection.name.toLocaleLowerCase().includes(normalizedQuery) ||
          collection.variables.length > 0),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
}

function variableTypeLabel(
  type: VariableResolvedDataType,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (type === "BOOLEAN") return t("variables.typeBoolean");
  if (type === "COLOR") return t("variables.typeColor");
  if (type === "FLOAT") return t("variables.typeNumber");
  return t("variables.typeString");
}

function styleTypeKey(styleType: SharedStyleType) {
  return `styles.${styleType.toLowerCase()}` as
    "styles.paint" | "styles.text" | "styles.effect" | "styles.grid";
}

function styleIcon(styleType: SharedStyleType) {
  if (styleType === "TEXT") return "lucide:type";
  if (styleType === "EFFECT") return "lucide:sparkles";
  if (styleType === "GRID") return "lucide:grid-3x3";
  return "lucide:swatch-book";
}
