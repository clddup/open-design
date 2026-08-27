import type {
  DesignNode,
  GridAutoLayout,
  GridTrack as OpenDesignGridTrack,
  LayoutSizing,
  LinearAutoLayoutFlow,
} from "@opendesign/design-contracts";

export type FigmaGridAutoLayout = Pick<
  FrameNode,
  | "layoutMode"
  | "paddingTop"
  | "paddingRight"
  | "paddingBottom"
  | "paddingLeft"
  | "gridRowCount"
  | "gridColumnCount"
  | "gridRowGap"
  | "gridColumnGap"
  | "gridRowSizes"
  | "gridColumnSizes"
  | "gridItemsPositioning"
  | "gridAutoTracks"
  | "layoutSizingHorizontal"
  | "layoutSizingVertical"
>;

export type FigmaWrapAutoLayout = Pick<
  FrameNode,
  | "layoutMode"
  | "layoutWrap"
  | "paddingTop"
  | "paddingRight"
  | "paddingBottom"
  | "paddingLeft"
  | "itemSpacing"
  | "counterAxisSpacing"
  | "primaryAxisAlignItems"
  | "counterAxisAlignItems"
  | "counterAxisAlignContent"
  | "primaryAxisSizingMode"
  | "counterAxisSizingMode"
>;

export type OpenDesignWrapResult =
  | {
      ok: true;
      layout: Extract<LinearAutoLayoutFlow, { mode: "horizontal" }>;
    }
  | { ok: false; issues: readonly string[] };

export type FigmaWrapChildLayout = Pick<
  RectangleNode,
  "layoutGrow" | "layoutAlign"
>;

export type OpenDesignWrapChildResult =
  { ok: true; sizing: LayoutSizing } | { ok: false; issues: readonly string[] };

export type FigmaGridChild = Pick<
  RectangleNode,
  | "gridRowAnchorIndex"
  | "gridColumnAnchorIndex"
  | "gridRowSpan"
  | "gridColumnSpan"
  | "gridChildHorizontalAlign"
  | "gridChildVerticalAlign"
>;

export type FigmaGridTrackReorderEntry = GridTrackReorderEntry;

export type OpenDesignGridResult =
  { ok: true; grid: GridAutoLayout } | { ok: false; issues: readonly string[] };

export function toFigmaGridAutoLayout(
  grid: GridAutoLayout,
): FigmaGridAutoLayout {
  return {
    layoutMode: "GRID",
    paddingTop: grid.padding.top,
    paddingRight: grid.padding.right,
    paddingBottom: grid.padding.bottom,
    paddingLeft: grid.padding.left,
    gridRowCount: grid.rows.length,
    gridColumnCount: grid.columns.length,
    gridRowGap: grid.rowGap,
    gridColumnGap: grid.columnGap,
    gridRowSizes: grid.rows.map(toFigmaGridTrack),
    gridColumnSizes: grid.columns.map(toFigmaGridTrack),
    gridItemsPositioning:
      grid.itemsPositioning === "manual" ? "MANUAL" : "ROW_AUTO_FLOW",
    gridAutoTracks: grid.autoTracks === "rows" ? "ROWS" : "NONE",
    layoutSizingHorizontal: grid.sizing?.horizontal === "hug" ? "HUG" : "FIXED",
    layoutSizingVertical: grid.sizing?.vertical === "hug" ? "HUG" : "FIXED",
  };
}

export function toFigmaWrapAutoLayout(
  layout: Extract<LinearAutoLayoutFlow, { mode: "horizontal" }>,
): FigmaWrapAutoLayout | null {
  if (!layout.wrap) return null;
  return {
    layoutMode: "HORIZONTAL",
    layoutWrap: "WRAP",
    paddingTop: layout.padding.top,
    paddingRight: layout.padding.right,
    paddingBottom: layout.padding.bottom,
    paddingLeft: layout.padding.left,
    itemSpacing: layout.gap,
    counterAxisSpacing: layout.wrap.counterGap,
    primaryAxisAlignItems: toFigmaAxisAlignment(layout.primaryAlignment),
    counterAxisAlignItems: toFigmaCounterAlignment(layout.counterAlignment),
    counterAxisAlignContent:
      layout.wrap.counterAxisAlignContent === "space-between"
        ? "SPACE_BETWEEN"
        : "AUTO",
    primaryAxisSizingMode:
      layout.sizing?.horizontal === "hug" ? "AUTO" : "FIXED",
    counterAxisSizingMode: layout.sizing?.vertical === "hug" ? "AUTO" : "FIXED",
  };
}

export function fromFigmaWrapAutoLayout(
  value: FigmaWrapAutoLayout,
): OpenDesignWrapResult {
  const issues: string[] = [];
  if (value.layoutMode !== "HORIZONTAL")
    issues.push("Figma wrapped Auto Layout must be HORIZONTAL");
  if (value.layoutWrap !== "WRAP")
    issues.push("Figma wrapped Auto Layout must use WRAP");
  if (value.counterAxisSpacing === null || value.counterAxisSpacing < 0)
    issues.push("Figma counterAxisSpacing must be a non-negative number");
  if (value.itemSpacing < 0)
    issues.push("Figma itemSpacing must be non-negative");
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    layout: {
      mode: "horizontal",
      padding: {
        top: value.paddingTop,
        right: value.paddingRight,
        bottom: value.paddingBottom,
        left: value.paddingLeft,
      },
      gap: value.itemSpacing,
      primaryAlignment: fromFigmaAxisAlignment(value.primaryAxisAlignItems),
      counterAlignment: fromFigmaCounterAlignment(value.counterAxisAlignItems),
      sizing: {
        horizontal: value.primaryAxisSizingMode === "AUTO" ? "hug" : "fixed",
        vertical: value.counterAxisSizingMode === "AUTO" ? "hug" : "fixed",
      },
      wrap: {
        mode: "wrap",
        counterGap: value.counterAxisSpacing as number,
        counterAxisAlignContent:
          value.counterAxisAlignContent === "SPACE_BETWEEN"
            ? "space-between"
            : "auto",
      },
    },
  };
}

export function toFigmaWrapChildLayout(
  sizing: LayoutSizing,
): FigmaWrapChildLayout {
  return {
    layoutGrow: sizing.horizontal === "fill" ? 1 : 0,
    layoutAlign: sizing.vertical === "fill" ? "STRETCH" : "INHERIT",
  };
}

export function fromFigmaWrapChildLayout(
  value: FigmaWrapChildLayout,
): OpenDesignWrapChildResult {
  const issues: string[] = [];
  if (value.layoutGrow !== 0 && value.layoutGrow !== 1)
    issues.push("Figma layoutGrow must be 0 or 1");
  if (value.layoutAlign !== "INHERIT" && value.layoutAlign !== "STRETCH")
    issues.push(
      "Deprecated child-specific counter-axis alignment is not available in OpenDesign Wrap",
    );
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    sizing: {
      horizontal: value.layoutGrow === 1 ? "fill" : "fixed",
      vertical: value.layoutAlign === "STRETCH" ? "fill" : "fixed",
    },
  };
}

export function fromFigmaGridAutoLayout(
  value: FigmaGridAutoLayout,
): OpenDesignGridResult {
  const issues: string[] = [];
  if (value.layoutMode !== "GRID") issues.push("Figma layoutMode is not GRID");
  const rows = value.gridRowSizes.map((track, index) =>
    fromFigmaGridTrack(track, `row ${index}`, issues),
  );
  const columns = value.gridColumnSizes.map((track, index) =>
    fromFigmaGridTrack(track, `column ${index}`, issues),
  );
  if (rows.length < 1 || rows.length !== value.gridRowCount)
    issues.push("Figma Grid row count and track definitions do not match");
  if (columns.length < 1 || columns.length !== value.gridColumnCount)
    issues.push("Figma Grid column count and track definitions do not match");
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    grid: {
      mode: "grid",
      padding: {
        top: value.paddingTop,
        right: value.paddingRight,
        bottom: value.paddingBottom,
        left: value.paddingLeft,
      },
      rowGap: value.gridRowGap,
      columnGap: value.gridColumnGap,
      rows: rows as OpenDesignGridTrack[],
      columns: columns as OpenDesignGridTrack[],
      itemsPositioning:
        value.gridItemsPositioning === "MANUAL" ? "manual" : "row-auto-flow",
      ...(value.gridAutoTracks === "ROWS" ? { autoTracks: "rows" } : {}),
      sizing: {
        horizontal: value.layoutSizingHorizontal === "HUG" ? "hug" : "fixed",
        vertical: value.layoutSizingVertical === "HUG" ? "hug" : "fixed",
      },
    },
  };
}

export function toFigmaGridChild(node: DesignNode): FigmaGridChild | null {
  const placement = node.gridPlacement;
  if (!placement) return null;
  return {
    gridRowAnchorIndex: placement.row,
    gridColumnAnchorIndex: placement.column,
    gridRowSpan: placement.rowSpan,
    gridColumnSpan: placement.columnSpan,
    gridChildHorizontalAlign: figmaGridAlignment(placement.horizontalAlign),
    gridChildVerticalAlign: figmaGridAlignment(placement.verticalAlign),
  };
}

function toFigmaAxisAlignment(
  alignment: LinearAutoLayoutFlow["primaryAlignment"],
): FrameNode["primaryAxisAlignItems"] {
  if (alignment === "center") return "CENTER";
  if (alignment === "end") return "MAX";
  if (alignment === "space-between") return "SPACE_BETWEEN";
  return "MIN";
}

function fromFigmaAxisAlignment(
  alignment: FrameNode["primaryAxisAlignItems"],
): LinearAutoLayoutFlow["primaryAlignment"] {
  if (alignment === "CENTER") return "center";
  if (alignment === "MAX") return "end";
  if (alignment === "SPACE_BETWEEN") return "space-between";
  return "start";
}

function toFigmaCounterAlignment(
  alignment: LinearAutoLayoutFlow["counterAlignment"],
): FrameNode["counterAxisAlignItems"] {
  if (alignment === "baseline") return "BASELINE";
  if (alignment === "center") return "CENTER";
  if (alignment === "end") return "MAX";
  return "MIN";
}

function fromFigmaCounterAlignment(
  alignment: FrameNode["counterAxisAlignItems"],
): LinearAutoLayoutFlow["counterAlignment"] {
  if (alignment === "BASELINE") return "baseline";
  if (alignment === "CENTER") return "center";
  if (alignment === "MAX") return "end";
  return "start";
}

function toFigmaGridTrack(track: OpenDesignGridTrack): GridTrackSize {
  if (track.type === "hug") return { type: "HUG" };
  return {
    type: track.type === "fixed" ? "FIXED" : "FLEX",
    value: track.value,
  };
}

function fromFigmaGridTrack(
  track: GridTrackSize,
  label: string,
  issues: string[],
): OpenDesignGridTrack | null {
  if (track.type === "HUG") return { type: "hug" };
  if (track.type === "FLEX" && track.value === undefined)
    return { type: "fill", value: 1 };
  if (
    typeof track.value !== "number" ||
    !Number.isFinite(track.value) ||
    track.value < 0 ||
    (track.type === "FLEX" && track.value <= 0)
  ) {
    issues.push(`Figma Grid ${label} has an invalid track value`);
    return null;
  }
  return track.type === "FIXED"
    ? { type: "fixed", value: track.value }
    : { type: "fill", value: track.value };
}

function figmaGridAlignment(
  alignment: "start" | "center" | "end" | "auto",
): FigmaGridChild["gridChildHorizontalAlign"] {
  if (alignment === "start") return "MIN";
  if (alignment === "center") return "CENTER";
  if (alignment === "end") return "MAX";
  return "AUTO";
}
