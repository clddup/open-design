import type {
  DesignDocument,
  DesignNode,
  SharedStyleType,
  StyleReferenceTarget,
} from "@opendesign/design-contracts";
import { DesktopCombobox, Icon, IconButton } from "@opendesign/ui";
import { useI18n } from "../../../../i18n";
import type { ProjectLibraryActions } from "../../hooks/use-project-library-actions";
import type { StyleActions } from "../../hooks/use-style-actions";
import styles from "./StyleReferencesSection.module.scss";
import { Section } from "./controls";

export function StyleReferencesSection({
  actions,
  document,
  node,
  projectLibraries,
}: {
  actions: StyleActions;
  document: DesignDocument;
  node: DesignNode;
  projectLibraries?: ProjectLibraryActions;
}) {
  const { t } = useI18n();
  const fields = compatibleFields(node);
  if (fields.length === 0) return null;
  return (
    <Section defaultOpen={false} title={t("styles.title")}>
      <div className={styles.stack}>
        {fields.map((field) => (
          <StyleReferenceRow
            actions={actions}
            document={document}
            field={field}
            key={field}
            node={node}
            projectLibraries={projectLibraries}
          />
        ))}
      </div>
    </Section>
  );
}

function StyleReferenceRow({
  actions,
  document,
  field,
  node,
  projectLibraries,
}: {
  actions: StyleActions;
  document: DesignDocument;
  field: StyleReferenceTarget["field"];
  node: DesignNode;
  projectLibraries?: ProjectLibraryActions;
}) {
  const { t } = useI18n();
  const styleType = styleTypeForField(field);
  const localCandidates: StyleCandidate[] = document.styleOrderByType[
    styleType
  ].flatMap((styleId) => {
    const style = document.stylesById[styleId];
    return style
      ? [
          {
            id: style.id,
            name: style.name,
            optionValue: localOptionValue(style.id),
            source: t("styles.local"),
          },
        ]
      : [];
  });
  const libraryCandidates: StyleCandidate[] = (
    projectLibraries?.items ?? []
  ).flatMap((item) => {
    if (!item.enabled || !item.release) return [];
    return Object.values(item.release.stylesById).flatMap((source) =>
      source.style.styleType === styleType && !source.style.hiddenFromPublishing
        ? [
            {
              id: source.style.id,
              name: source.style.name,
              optionValue: libraryOptionValue(
                item.entry.libraryId,
                source.style.id,
              ),
              source: item.entry.name,
              libraryId: item.entry.libraryId,
            },
          ]
        : [],
    );
  });
  const currentStyleId = node[field];
  const currentImported =
    currentStyleId === undefined
      ? undefined
      : document.libraryStylesById[currentStyleId];
  const candidates: StyleCandidate[] = [
    ...localCandidates,
    ...libraryCandidates,
    ...(currentImported &&
    !libraryCandidates.some(
      (candidate) =>
        candidate.id === currentStyleId &&
        candidate.libraryId === currentImported.source.libraryId,
    )
      ? [
          {
            id: currentImported.style.id,
            name: currentImported.style.name,
            optionValue: libraryOptionValue(
              currentImported.source.libraryId,
              currentImported.style.id,
            ),
            source: t("styles.disabledLibrary"),
            libraryId: currentImported.source.libraryId,
            unavailable: true,
          },
        ]
      : []),
  ];
  const currentValue = currentImported
    ? libraryOptionValue(
        currentImported.source.libraryId,
        currentImported.style.id,
      )
    : currentStyleId
      ? localOptionValue(currentStyleId)
      : NO_STYLE;
  return (
    <div className={styles.row}>
      <label className={styles.field}>
        <span>{fieldLabel(field, t)}</span>
        <DesktopCombobox
          ariaLabel={t("styles.apply", { type: t(styleTypeKey(styleType)) })}
          emptyLabel={t("styles.noMatchingStyles")}
          onValueChange={(value) => {
            if (value === NO_STYLE) {
              actions.setReference({ nodeId: node.id, field }, null);
              return;
            }
            const candidate = candidates.find(
              (entry) => entry.optionValue === value,
            );
            if (!candidate) return;
            if (candidate?.libraryId && !candidate.unavailable) {
              void projectLibraries?.applyStyle(
                candidate.libraryId,
                candidate.id,
                { nodeId: node.id, field },
              );
              return;
            }
            actions.setReference({ nodeId: node.id, field }, candidate.id);
          }}
          options={[
            {
              value: NO_STYLE,
              label: t("styles.noStyle"),
              textValue: t("styles.noStyle"),
            },
            ...candidates.map((candidate) => ({
              value: candidate.optionValue,
              textValue: `${candidate.name} ${candidate.source}`,
              keywords: candidate.source,
              label: (
                <span className={styles.option}>
                  <Icon
                    name={
                      candidate.libraryId
                        ? "lucide:library"
                        : "lucide:swatch-book"
                    }
                    size={12}
                  />
                  <span>{candidate.name}</span>
                  <small>{candidate.source}</small>
                </span>
              ),
            })),
          ]}
          size="compact"
          searchAriaLabel={t("styles.search")}
          searchPlaceholder={t("styles.searchPlaceholder")}
          value={currentValue}
        />
      </label>
      <IconButton
        icon="lucide:plus"
        label={t("styles.createForProperty")}
        onClick={() =>
          actions.createFromNode(node.id, field, t("styles.untitled"))
        }
      />
      <IconButton
        disabled={currentStyleId === undefined || currentImported !== undefined}
        icon="lucide:refresh-cw"
        label={t("styles.updateFromSelection")}
        onClick={() =>
          currentStyleId !== undefined &&
          actions.updateFromNode(currentStyleId, node.id, field)
        }
      />
    </div>
  );
}

const NO_STYLE = "__opendesign_no_style__";

type StyleCandidate = {
  id: string;
  name: string;
  optionValue: string;
  source: string;
  libraryId?: string;
  unavailable?: boolean;
};

function localOptionValue(styleId: string) {
  return `local\u0000${styleId}`;
}

function libraryOptionValue(libraryId: string, styleId: string) {
  return `library\u0000${libraryId}\u0000${styleId}`;
}

function compatibleFields(node: DesignNode): StyleReferenceTarget["field"][] {
  const fields: StyleReferenceTarget["field"][] = [];
  if ("fills" in node.properties) fields.push("fillStyleId");
  if ("strokes" in node.properties) fields.push("strokeStyleId");
  if (node.kind === "text") fields.push("textStyleId");
  fields.push("effectStyleId");
  if (node.kind === "frame") fields.push("gridStyleId");
  return fields;
}

function styleTypeForField(
  field: StyleReferenceTarget["field"],
): SharedStyleType {
  if (field === "fillStyleId" || field === "strokeStyleId") return "PAINT";
  if (field === "textStyleId") return "TEXT";
  if (field === "effectStyleId") return "EFFECT";
  return "GRID";
}

function styleTypeKey(styleType: SharedStyleType) {
  return `styles.${styleType.toLowerCase()}` as
    "styles.paint" | "styles.text" | "styles.effect" | "styles.grid";
}

function fieldLabel(
  field: StyleReferenceTarget["field"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (field === "fillStyleId") return t("properties.fill");
  if (field === "strokeStyleId") return t("properties.stroke");
  if (field === "textStyleId") return t("styles.text");
  if (field === "effectStyleId") return t("properties.effects");
  return t("styles.grid");
}
