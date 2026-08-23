import type {
  AutoLayout,
  GridAutoLayout,
  GridTrack,
  LinearAutoLayoutFlow,
} from "@opendesign/design-contracts";
import { IconButton } from "@opendesign/ui";
import { useI18n } from "../../../../i18n";
import styles from "../PropertiesPanel.module.scss";
import { Field, Section, commitNumber, formatNumber } from "./controls";

const defaultAutoLayout: LinearAutoLayoutFlow = {
  mode: "vertical",
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  gap: 0,
  primaryAlignment: "start",
  counterAlignment: "start",
  sizing: { horizontal: "fixed", vertical: "fixed" },
};
const defaultGridLayout: GridAutoLayout = {
  mode: "grid",
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  rowGap: 0,
  columnGap: 0,
  rows: [{ type: "hug" }],
  columns: [
    { type: "fill", value: 1 },
    { type: "fill", value: 1 },
  ],
  itemsPositioning: "row-auto-flow",
  sizing: { horizontal: "fixed", vertical: "fixed" },
};

export function AutoLayoutSection({
  autoLayout,
  onChange,
  onReorderGridTracks,
}: {
  autoLayout: AutoLayout;
  onChange: (autoLayout: AutoLayout) => void;
  onReorderGridTracks: (
    axis: "rows" | "columns",
    fromIndices: readonly number[],
    insertionIndex: number,
  ) => void;
}) {
  const { t } = useI18n();
  const linearFlow =
    autoLayout.mode === "horizontal" || autoLayout.mode === "vertical"
      ? autoLayout
      : null;
  const gridFlow = autoLayout.mode === "grid" ? autoLayout : null;
  const updateFlow = (patch: Partial<LinearAutoLayoutFlow>) => {
    onChange({ ...(linearFlow ?? defaultAutoLayout), ...patch });
  };
  const horizontalFlow = linearFlow?.mode === "horizontal" ? linearFlow : null;
  const wrapEnabled = horizontalFlow?.wrap?.mode === "wrap";
  const autoGap = linearFlow?.primaryAlignment === "space-between";
  return (
    <Section title={t("properties.autoLayout")}>
      <div className={styles.stack}>
        <label className={styles.select}>
          <span>{t("properties.autoLayoutDirection")}</span>
          <select
            aria-label={t("properties.autoLayoutDirection")}
            onChange={(event) => {
              const mode = event.target.value as AutoLayout["mode"];
              if (mode === "none") {
                onChange({ mode: "none" });
                return;
              }
              if (mode === "grid") {
                onChange({
                  ...defaultGridLayout,
                  padding:
                    autoLayout.mode === "none"
                      ? defaultGridLayout.padding
                      : autoLayout.padding,
                  sizing:
                    autoLayout.mode === "none"
                      ? defaultGridLayout.sizing
                      : autoLayout.sizing,
                });
                return;
              }
              const current = linearFlow ?? defaultAutoLayout;
              onChange({
                mode,
                padding: current.padding,
                gap: current.gap,
                primaryAlignment: current.primaryAlignment,
                counterAlignment: current.counterAlignment,
                ...(current.sizing ? { sizing: current.sizing } : {}),
              });
            }}
            value={autoLayout.mode}
          >
            <option value="none">{t("properties.autoLayoutNone")}</option>
            <option value="horizontal">
              {t("properties.autoLayoutHorizontal")}
            </option>
            <option value="vertical">
              {t("properties.autoLayoutVertical")}
            </option>
            <option value="grid">{t("properties.autoLayoutGrid")}</option>
          </select>
        </label>
        {linearFlow && (
          <>
            {horizontalFlow && (
              <label className={styles.select}>
                <span>{t("properties.autoLayoutFlow")}</span>
                <select
                  aria-label={t("properties.autoLayoutFlow")}
                  onChange={(event) => {
                    if (event.target.value === "wrap") {
                      onChange({
                        ...horizontalFlow,
                        sizing: {
                          horizontal: "fixed",
                          vertical: horizontalFlow.sizing?.vertical ?? "fixed",
                        },
                        wrap: {
                          mode: "wrap",
                          counterGap: horizontalFlow.gap,
                        },
                      });
                      return;
                    }
                    onChange({
                      mode: "horizontal",
                      padding: horizontalFlow.padding,
                      gap: horizontalFlow.gap,
                      primaryAlignment: horizontalFlow.primaryAlignment,
                      counterAlignment: horizontalFlow.counterAlignment,
                      ...(horizontalFlow.sizing
                        ? { sizing: horizontalFlow.sizing }
                        : {}),
                    });
                  }}
                  value={wrapEnabled ? "wrap" : "single-line"}
                >
                  <option value="single-line">
                    {t("properties.autoLayoutSingleLine")}
                  </option>
                  <option value="wrap">{t("properties.autoLayoutWrap")}</option>
                </select>
              </label>
            )}
            <div className={styles.grid}>
              {(["horizontal", "vertical"] as const).map((axis) => (
                <label className={styles.select} key={axis}>
                  <span>
                    {t(
                      axis === "horizontal"
                        ? "properties.autoLayoutWidthSizing"
                        : "properties.autoLayoutHeightSizing",
                    )}
                  </span>
                  <select
                    aria-label={t(
                      axis === "horizontal"
                        ? "properties.autoLayoutWidthSizing"
                        : "properties.autoLayoutHeightSizing",
                    )}
                    onChange={(event) =>
                      updateFlow({
                        sizing: {
                          horizontal: linearFlow.sizing?.horizontal ?? "fixed",
                          vertical: linearFlow.sizing?.vertical ?? "fixed",
                          [axis]: event.target.value as "fixed" | "hug",
                        },
                      })
                    }
                    value={linearFlow.sizing?.[axis] ?? "fixed"}
                  >
                    <option value="fixed">
                      {t("properties.autoLayoutFixed")}
                    </option>
                    <option
                      disabled={axis === "horizontal" && wrapEnabled}
                      value="hug"
                    >
                      {t("properties.autoLayoutHug")}
                    </option>
                  </select>
                </label>
              ))}
            </div>
            <div className={styles.grid}>
              <label className={styles.select}>
                <span>{t("properties.autoLayoutGapMode")}</span>
                <select
                  aria-label={t("properties.autoLayoutGapMode")}
                  onChange={(event) =>
                    updateFlow({
                      primaryAlignment:
                        event.target.value === "auto"
                          ? "space-between"
                          : "start",
                    })
                  }
                  value={autoGap ? "auto" : "fixed"}
                >
                  <option value="fixed">
                    {t("properties.autoLayoutGapFixed")}
                  </option>
                  <option value="auto">
                    {t("properties.autoLayoutGapAuto")}
                  </option>
                </select>
              </label>
              <Field
                accessibleLabel={t("properties.autoLayoutGap")}
                disabled={autoGap}
                label={t("properties.autoLayoutGap")}
                min={0}
                onCommit={(value) =>
                  commitNumber(
                    value,
                    linearFlow.gap,
                    (gap) => updateFlow({ gap }),
                    {
                      min: 0,
                    },
                  )
                }
                placeholder={
                  autoGap ? t("properties.autoLayoutGapAuto") : undefined
                }
                type="number"
                value={autoGap ? "" : formatNumber(linearFlow.gap)}
              />
              {horizontalFlow?.wrap && (
                <Field
                  accessibleLabel={t("properties.autoLayoutCounterGap")}
                  label={t("properties.autoLayoutCounterGap")}
                  min={0}
                  onCommit={(value) =>
                    commitNumber(
                      value,
                      horizontalFlow.wrap?.counterGap ?? horizontalFlow.gap,
                      (counterGap) =>
                        onChange({
                          ...horizontalFlow,
                          wrap: { mode: "wrap", counterGap },
                        }),
                      { min: 0 },
                    )
                  }
                  type="number"
                  value={formatNumber(horizontalFlow.wrap.counterGap)}
                />
              )}
              {!autoGap && (
                <AlignmentSelect
                  label={t("properties.autoLayoutPrimary")}
                  onChange={(primaryAlignment) =>
                    updateFlow({ primaryAlignment })
                  }
                  value={linearFlow.primaryAlignment as PackedAlignment}
                />
              )}
              <AlignmentSelect
                label={t("properties.autoLayoutCounter")}
                onChange={(counterAlignment) =>
                  updateFlow({ counterAlignment })
                }
                value={linearFlow.counterAlignment}
              />
            </div>
            <div className={styles.grid}>
              {(["top", "right", "bottom", "left"] as const).map((side) => (
                <Field
                  accessibleLabel={t(`properties.padding.${side}`)}
                  key={side}
                  label={t(`properties.padding.${side}`)}
                  min={0}
                  onCommit={(value) =>
                    commitNumber(
                      value,
                      linearFlow.padding[side],
                      (next) =>
                        updateFlow({
                          padding: { ...linearFlow.padding, [side]: next },
                        }),
                      { min: 0 },
                    )
                  }
                  type="number"
                  value={formatNumber(linearFlow.padding[side])}
                />
              ))}
            </div>
            <small className={styles.hint}>
              {t("properties.autoLayoutSizingHint")}
            </small>
          </>
        )}
        {gridFlow && (
          <GridControls
            grid={gridFlow}
            onChange={onChange}
            onReorderGridTracks={onReorderGridTracks}
          />
        )}
      </div>
    </Section>
  );
}

function AlignmentSelect({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: PackedAlignment) => void;
  value: PackedAlignment;
}) {
  const { t } = useI18n();
  return (
    <label className={styles.select}>
      <span>{label}</span>
      <select
        aria-label={label}
        onChange={(event) => onChange(event.target.value as PackedAlignment)}
        value={value}
      >
        <option value="start">{t("properties.autoLayoutStart")}</option>
        <option value="center">{t("properties.autoLayoutCenter")}</option>
        <option value="end">{t("properties.autoLayoutEnd")}</option>
      </select>
    </label>
  );
}

type PackedAlignment = Exclude<
  LinearAutoLayoutFlow["primaryAlignment"],
  "space-between"
>;

function GridControls({
  grid,
  onChange,
  onReorderGridTracks,
}: {
  grid: GridAutoLayout;
  onChange: (autoLayout: AutoLayout) => void;
  onReorderGridTracks: (
    axis: "rows" | "columns",
    fromIndices: readonly number[],
    insertionIndex: number,
  ) => void;
}) {
  const { t } = useI18n();
  const update = (patch: Partial<GridAutoLayout>) =>
    onChange({ ...grid, ...patch });
  return (
    <>
      <div className={styles.grid}>
        <label className={styles.select}>
          <span>{t("properties.autoLayoutGridPositioning")}</span>
          <select
            aria-label={t("properties.autoLayoutGridPositioning")}
            onChange={(event) => {
              const itemsPositioning = event.target.value as
                "manual" | "row-auto-flow";
              if (itemsPositioning === "manual") {
                onChange({ ...withoutAutomaticRows(grid), itemsPositioning });
                return;
              }
              update({ itemsPositioning });
            }}
            value={grid.itemsPositioning}
          >
            <option value="row-auto-flow">
              {t("properties.autoLayoutGridAutomatic")}
            </option>
            <option value="manual">
              {t("properties.autoLayoutGridManual")}
            </option>
          </select>
        </label>
        <label className={styles.select}>
          <span>{t("properties.autoLayoutGridRowMode")}</span>
          <select
            aria-label={t("properties.autoLayoutGridRowMode")}
            onChange={(event) => {
              if (event.target.value === "automatic") {
                update({
                  autoTracks: "rows",
                  itemsPositioning: "row-auto-flow",
                  sizing: {
                    horizontal: grid.sizing?.horizontal ?? "fixed",
                    vertical: "fixed",
                  },
                });
                return;
              }
              onChange(withoutAutomaticRows(grid));
            }}
            value={grid.autoTracks === "rows" ? "automatic" : "explicit"}
          >
            <option value="explicit">
              {t("properties.autoLayoutGridRowsExplicit")}
            </option>
            <option value="automatic">
              {t("properties.autoLayoutGridRowsAutomatic")}
            </option>
          </select>
        </label>
        <Field
          accessibleLabel={t("properties.autoLayoutColumnGap")}
          label={t("properties.autoLayoutColumnGap")}
          min={0}
          onCommit={(value) =>
            commitNumber(
              value,
              grid.columnGap,
              (columnGap) => update({ columnGap }),
              { min: 0 },
            )
          }
          type="number"
          value={formatNumber(grid.columnGap)}
        />
        <Field
          accessibleLabel={t("properties.autoLayoutRowGap")}
          label={t("properties.autoLayoutRowGap")}
          min={0}
          onCommit={(value) =>
            commitNumber(value, grid.rowGap, (rowGap) => update({ rowGap }), {
              min: 0,
            })
          }
          type="number"
          value={formatNumber(grid.rowGap)}
        />
      </div>
      <TrackList
        axis="columns"
        label={t("properties.autoLayoutColumns")}
        onChange={(columns) => update({ columns })}
        onReorder={onReorderGridTracks}
        tracks={grid.columns}
      />
      <TrackList
        axis="rows"
        fixedCount={grid.autoTracks === "rows"}
        label={t("properties.autoLayoutRows")}
        onChange={(rows) => update({ rows })}
        onReorder={onReorderGridTracks}
        tracks={grid.rows}
      />
      <div className={styles.grid}>
        {(["horizontal", "vertical"] as const).map((axis) => (
          <label className={styles.select} key={axis}>
            <span>
              {t(
                axis === "horizontal"
                  ? "properties.autoLayoutWidthSizing"
                  : "properties.autoLayoutHeightSizing",
              )}
            </span>
            <select
              aria-label={t(
                axis === "horizontal"
                  ? "properties.autoLayoutWidthSizing"
                  : "properties.autoLayoutHeightSizing",
              )}
              onChange={(event) =>
                update({
                  sizing: {
                    horizontal: grid.sizing?.horizontal ?? "fixed",
                    vertical: grid.sizing?.vertical ?? "fixed",
                    [axis]: event.target.value as "fixed" | "hug",
                  },
                })
              }
              value={grid.sizing?.[axis] ?? "fixed"}
            >
              <option value="fixed">{t("properties.autoLayoutFixed")}</option>
              <option
                disabled={axis === "vertical" && grid.autoTracks === "rows"}
                value="hug"
              >
                {t("properties.autoLayoutHug")}
              </option>
            </select>
          </label>
        ))}
      </div>
      <div className={styles.grid}>
        {(["top", "right", "bottom", "left"] as const).map((side) => (
          <Field
            accessibleLabel={t(`properties.padding.${side}`)}
            key={side}
            label={t(`properties.padding.${side}`)}
            min={0}
            onCommit={(value) =>
              commitNumber(
                value,
                grid.padding[side],
                (next) =>
                  update({ padding: { ...grid.padding, [side]: next } }),
                { min: 0 },
              )
            }
            type="number"
            value={formatNumber(grid.padding[side])}
          />
        ))}
      </div>
    </>
  );
}

function TrackList({
  axis,
  fixedCount = false,
  label,
  onChange,
  onReorder,
  tracks,
}: {
  axis: "rows" | "columns";
  fixedCount?: boolean;
  label: string;
  onChange: (tracks: GridTrack[]) => void;
  onReorder: (
    axis: "rows" | "columns",
    fromIndices: readonly number[],
    insertionIndex: number,
  ) => void;
  tracks: readonly GridTrack[];
}) {
  const { t } = useI18n();
  return (
    <div className={styles.stack}>
      <div className={styles.layoutGuideToolbar}>
        <span>{label}</span>
        <IconButton
          disabled={fixedCount}
          icon="lucide:plus"
          label={t("properties.autoLayoutTrackAdd", { label })}
          onClick={() => onChange([...tracks, { type: "fill", value: 1 }])}
        />
      </div>
      {tracks.map((track, index) => (
        <div className={styles.trackRow} key={index}>
          <label className={styles.select}>
            <span>{`${label} ${index + 1}`}</span>
            <select
              aria-label={`${label} ${index + 1}`}
              onChange={(event) => {
                const type = event.target.value as GridTrack["type"];
                const next = [...tracks];
                next[index] =
                  type === "hug"
                    ? { type }
                    : { type, value: type === "fill" ? 1 : 100 };
                onChange(next);
              }}
              value={track.type}
            >
              <option value="fixed">{t("properties.autoLayoutFixed")}</option>
              <option value="fill">{t("properties.autoLayoutFill")}</option>
              <option value="hug">{t("properties.autoLayoutHug")}</option>
            </select>
          </label>
          {track.type !== "hug" && (
            <Field
              accessibleLabel={`${label} ${index + 1} ${track.type === "fill" ? "fr" : "px"}`}
              label={track.type === "fill" ? "fr" : "px"}
              min={track.type === "fill" ? Number.EPSILON : 0}
              onCommit={(value) =>
                commitNumber(
                  value,
                  track.value,
                  (nextValue) => {
                    const next = [...tracks];
                    next[index] = { ...track, value: nextValue };
                    onChange(next);
                  },
                  { min: track.type === "fill" ? Number.EPSILON : 0 },
                )
              }
              type="number"
              value={formatNumber(track.value)}
            />
          )}
          {track.type === "hug" && <span aria-hidden="true" />}
          <IconButton
            className={styles.trackMoveUp}
            disabled={index === 0}
            icon="lucide:chevron-down"
            label={t("properties.autoLayoutTrackMoveUp", {
              label,
              index: index + 1,
            })}
            onClick={() => onReorder(axis, [index], index - 1)}
          />
          <IconButton
            disabled={index === tracks.length - 1}
            icon="lucide:chevron-down"
            label={t("properties.autoLayoutTrackMoveDown", {
              label,
              index: index + 1,
            })}
            onClick={() => onReorder(axis, [index], index + 2)}
          />
          <IconButton
            disabled={fixedCount || tracks.length <= 1}
            icon="lucide:trash-2"
            label={t("properties.autoLayoutTrackRemove", {
              label,
              index: index + 1,
            })}
            onClick={() =>
              onChange(tracks.filter((_, itemIndex) => itemIndex !== index))
            }
          />
        </div>
      ))}
    </div>
  );
}

function withoutAutomaticRows(grid: GridAutoLayout): GridAutoLayout {
  const explicitGrid = { ...grid };
  delete explicitGrid.autoTracks;
  return explicitGrid;
}
