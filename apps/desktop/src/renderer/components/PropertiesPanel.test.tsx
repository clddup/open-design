import { TooltipProvider } from "@opendesign/ui";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  DesignNode,
  LayoutConstraints,
  LayoutGuide,
} from "@opendesign/design-contracts";
import type {
  ArrangeOperation,
  ArrangementSelectionMetrics,
} from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { PropertiesPanel } from "./PropertiesPanel";
import type { SvgInterchangeFeedback } from "../features/import-export/types";
import type { UpdatePropertiesPatch } from "../features/editor/types";

function renderPanel(
  options: {
    arrangement?: ArrangementSelectionMetrics | null;
    feedback?: SvgInterchangeFeedback | null;
    node?: DesignNode;
    onArrange?: (operation: ArrangeOperation) => void;
    operation?: { kind: "import" | "export"; name: string } | null;
    exportFormat?: "svg" | "png" | "jpeg" | "webp";
    selectionCount?: number;
    componentContext?: {
      availableComponents: readonly { id: string; name: string }[];
      componentName: string;
      isMain: boolean;
      overrideCount: number;
      sourceNodes: readonly [];
    };
    onRemoveComponent?: () => void;
    layoutMode?: "constraints" | "sizing" | "wrap-sizing" | "absolute" | null;
    onSetConstraints?: (nodeId: string, constraints: LayoutConstraints) => void;
    onSetLayoutPositioning?: (
      nodeId: string,
      positioning: "absolute" | null,
      constraints?: LayoutConstraints,
    ) => void;
    onSetFrameLayoutGuides?: (
      frameId: string,
      layoutGuides: readonly LayoutGuide[],
    ) => void;
    onUpdate?: (updates: UpdatePropertiesPatch) => void;
  } = {},
) {
  const onCancelSvgOperation = vi.fn();
  const onDismissSvgFeedback = vi.fn();
  const onExportSvg = vi.fn();
  const onExportRaster = vi.fn();
  const onSvgExportSettingsChange = vi.fn();
  const onRasterExportSettingsChange = vi.fn();
  const onUpdate = options.onUpdate ?? vi.fn();
  const onArrange =
    options.onArrange ?? vi.fn<(operation: ArrangeOperation) => void>();
  render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <PropertiesPanel
          arrangement={options.arrangement ?? null}
          booleanOperationEditable={false}
          canDelete
          layoutMode={options.layoutMode ?? null}
          componentContext={options.componentContext}
          node={options.node}
          onArrange={onArrange}
          onBooleanOperationChange={vi.fn()}
          onCancelSvgOperation={onCancelSvgOperation}
          onCreateComponent={vi.fn()}
          onCreateComponentInstance={vi.fn()}
          onDelete={vi.fn()}
          onDetachComponentInstance={vi.fn()}
          onDismissRasterFeedback={vi.fn()}
          onDismissSvgFeedback={onDismissSvgFeedback}
          onDuplicate={vi.fn()}
          onGoToComponentMain={vi.fn()}
          onExportFormatChange={vi.fn()}
          onExportRaster={onExportRaster}
          onExportSvg={onExportSvg}
          onReplaceImage={vi.fn()}
          onRemoveComponent={options.onRemoveComponent ?? vi.fn()}
          onResetComponentInstance={vi.fn()}
          onResetComponentSourceOverride={vi.fn()}
          onSelectBooleanParent={vi.fn()}
          onSetConstraints={options.onSetConstraints ?? vi.fn()}
          onSetLayoutPositioning={options.onSetLayoutPositioning ?? vi.fn()}
          onSetFrameLayoutGuides={options.onSetFrameLayoutGuides ?? vi.fn()}
          onSvgExportSettingsChange={onSvgExportSettingsChange}
          onRasterExportSettingsChange={onRasterExportSettingsChange}
          exportFormat={options.exportFormat ?? "svg"}
          rasterExportSettings={{
            format:
              options.exportFormat && options.exportFormat !== "svg"
                ? options.exportFormat
                : "png",
            size: { mode: "scale", value: 1 },
            background: { mode: "transparent" },
            quality: 0.9,
            resampling: "smooth",
          }}
          rasterFeedback={null}
          onUpdate={onUpdate}
          onUpdateComponentOverride={vi.fn()}
          selectionCount={options.selectionCount ?? 2}
          svgExportSettings={{ includeLayerIds: false, padding: 0 }}
          svgFeedback={options.feedback ?? null}
          svgOperation={options.operation ?? null}
        />
      </I18nProvider>
    </TooltipProvider>,
  );
  return {
    onCancelSvgOperation,
    onArrange,
    onDismissSvgFeedback,
    onExportSvg,
    onExportRaster,
    onRasterExportSettingsChange,
    onSvgExportSettingsChange,
    onUpdate,
  };
}

const lineNode: DesignNode = {
  id: "line_1",
  name: "Directed connector",
  parentId: null,
  childIds: [],
  visible: true,
  locked: false,
  transform: [1, 0, 0, 1, 120, 80],
  size: { width: 240, height: 120 },
  opacity: 1,
  extensions: {},
  kind: "line",
  properties: {
    fills: [],
    strokes: [{ type: "solid", color: "#151515", opacity: 1 }],
    strokeWidth: 3,
    strokeAlign: "center",
    strokeCap: "round",
    strokeJoin: "round",
    dashPattern: [8, 4],
    start: { x: 1, y: 0 },
    end: { x: 0, y: 1 },
    startEndpoint: "circle",
    endEndpoint: "line-arrow",
  },
};

const starNode: DesignNode = {
  id: "star_1",
  name: "Seven-point signal",
  parentId: null,
  childIds: [],
  visible: true,
  locked: false,
  transform: [1, 0, 0, 1, 120, 80],
  size: { width: 180, height: 180 },
  opacity: 1,
  extensions: {},
  kind: "star",
  properties: {
    fills: [{ type: "solid", color: "#f59e0b", opacity: 1 }],
    strokes: [],
    strokeWidth: 0,
    pointCount: 7,
    innerRadius: 0.42,
    cornerRadius: 6,
  },
};

const textNode: DesignNode = {
  id: "text_1",
  name: "Editorial summary",
  parentId: null,
  childIds: [],
  visible: true,
  locked: false,
  transform: [1, 0, 0, 1, 120, 80],
  size: { width: 320, height: 96 },
  opacity: 1,
  extensions: {},
  kind: "text",
  properties: {
    content: "A deliberately long summary for a constrained text box.",
    fontFamily: "Inter",
    fontSize: 18,
    fontWeight: 500,
    lineHeight: 26,
    letterSpacing: 0,
    textAlignHorizontal: "left",
    textAlignVertical: "top",
    textResize: "fixed",
    textWrap: "word",
    textOverflow: "clip",
    fills: [{ type: "solid", color: "#151515", opacity: 1 }],
    strokes: [],
    strokeWidth: 0,
  },
};

describe("PropertiesPanel SVG workflow", () => {
  it("runs the shared Tidy up planner from an enabled multi-selection control", async () => {
    const user = userEvent.setup();
    const { onArrange } = renderPanel({
      arrangement: {
        nodeIds: ["a", "b", "c", "d"],
        horizontalSpacing: null,
        verticalSpacing: null,
        canDistributeHorizontal: true,
        canDistributeVertical: true,
        canTidyUp: true,
        tidyUpDimension: "grid",
      },
      selectionCount: 4,
    });

    await user.click(
      screen.getByRole("button", { name: "Tidy up two-dimensional grid" }),
    );
    expect(onArrange).toHaveBeenCalledWith({ action: "tidy-up" });
  });

  it("edits only implemented SVG settings and exports the current selection", async () => {
    const user = userEvent.setup();
    const { onExportSvg, onSvgExportSettingsChange } = renderPanel();

    expect(screen.getByText("SVG")).toBeVisible();
    expect(screen.queryByText(/outline text/i)).toBeNull();
    expect(screen.queryByText(/simplify stroke/i)).toBeNull();

    await user.click(screen.getByLabelText("Include layer IDs"));
    expect(onSvgExportSettingsChange).toHaveBeenCalledWith({
      includeLayerIds: true,
      padding: 0,
    });

    const padding = screen.getByLabelText("Padding");
    await user.clear(padding);
    await user.type(padding, "24");
    await user.tab();
    expect(onSvgExportSettingsChange).toHaveBeenCalledWith({
      includeLayerIds: false,
      padding: 24,
    });

    await user.click(
      screen.getByRole("button", { name: "Export 2 selected as SVG…" }),
    );
    expect(onExportSvg).toHaveBeenCalledOnce();
  });

  it("shows Frame-child constraints and commits both axes explicitly", async () => {
    const user = userEvent.setup();
    const onSetConstraints = vi.fn();
    renderPanel({
      node: {
        ...textNode,
        parentId: "frame_1",
        constraints: { horizontal: "right", vertical: "bottom" },
      },
      selectionCount: 1,
      layoutMode: "constraints",
      onSetConstraints,
    });
    await user.selectOptions(
      screen.getByLabelText("Horizontal constraint"),
      "left-right",
    );
    expect(onSetConstraints).toHaveBeenCalledWith("text_1", {
      horizontal: "left-right",
      vertical: "bottom",
    });
    await user.selectOptions(
      screen.getByLabelText("Vertical constraint"),
      "center",
    );
    expect(onSetConstraints).toHaveBeenLastCalledWith("text_1", {
      horizontal: "right",
      vertical: "center",
    });
  });

  it("configures Frame Auto Layout direction, gap, padding, and alignment", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<(updates: UpdatePropertiesPatch) => void>();
    renderPanel({
      node: {
        id: "frame_auto",
        kind: "frame",
        name: "Navigation",
        parentId: null,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0],
        size: { width: 320, height: 80 },
        opacity: 1,
        properties: {
          fills: [],
          strokes: [],
          strokeWidth: 0,
          cornerRadius: 0,
          clipsContent: true,
        },
        extensions: {},
      },
      selectionCount: 1,
      onUpdate,
    });
    await user.selectOptions(screen.getByLabelText("Direction"), "horizontal");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: {
        autoLayout: {
          mode: "horizontal",
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          gap: 0,
          primaryAlignment: "start",
          counterAlignment: "start",
          sizing: { horizontal: "fixed", vertical: "fixed" },
        },
      },
    });
  });

  it("adds, edits, and removes a Frame uniform layout guide", async () => {
    const user = userEvent.setup();
    const onSetFrameLayoutGuides =
      vi.fn<(frameId: string, layoutGuides: readonly LayoutGuide[]) => void>();
    const frame: Extract<DesignNode, { kind: "frame" }> = {
      id: "frame_guides",
      kind: "frame",
      name: "Poster",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 180 },
      opacity: 1,
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
      },
      extensions: {},
    };
    renderPanel({
      node: frame,
      selectionCount: 1,
      onSetFrameLayoutGuides,
    });

    await user.click(screen.getByRole("button", { name: "Add layout guide" }));
    await user.click(screen.getByRole("menuitem", { name: "Uniform grid" }));
    expect(onSetFrameLayoutGuides).toHaveBeenLastCalledWith("frame_guides", [
      {
        id: "frame_guides_guide_1",
        type: "grid",
        size: 8,
        color: "#ff5a5f",
        opacity: 0.12,
      },
    ]);

    cleanup();
    const guide: LayoutGuide = {
      id: "grid_custom",
      type: "grid",
      size: 8,
      color: "#ff5a5f",
      opacity: 0.12,
    };
    renderPanel({
      node: {
        ...frame,
        properties: { ...frame.properties, layoutGuides: [guide] },
      },
      selectionCount: 1,
      onSetFrameLayoutGuides,
    });

    const size = screen.getByLabelText("Grid size grid_custom");
    await user.clear(size);
    await user.type(size, "16");
    await user.tab();
    expect(onSetFrameLayoutGuides).toHaveBeenLastCalledWith("frame_guides", [
      { ...guide, size: 16 },
    ]);

    const color = screen.getByLabelText("Guide color grid_custom");
    await user.clear(color);
    await user.type(color, "#3366ff");
    await user.tab();
    expect(onSetFrameLayoutGuides).toHaveBeenLastCalledWith("frame_guides", [
      { ...guide, color: "#3366ff" },
    ]);

    const opacity = screen.getByLabelText("Guide opacity grid_custom");
    await user.clear(opacity);
    await user.type(opacity, "0.25");
    await user.tab();
    expect(onSetFrameLayoutGuides).toHaveBeenLastCalledWith("frame_guides", [
      { ...guide, opacity: 0.25 },
    ]);

    await user.click(
      screen.getByRole("button", { name: "Remove layout guide grid_custom" }),
    );
    expect(onSetFrameLayoutGuides).toHaveBeenLastCalledWith("frame_guides", []);
  });

  it("adds and edits conditional Columns and Rows layout guide fields", async () => {
    const user = userEvent.setup();
    const onSetFrameLayoutGuides =
      vi.fn<(frameId: string, layoutGuides: readonly LayoutGuide[]) => void>();
    const frame: Extract<DesignNode, { kind: "frame" }> = {
      id: "frame_axis_guides",
      kind: "frame",
      name: "Responsive page",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 1440, height: 1024 },
      opacity: 1,
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
      },
      extensions: {},
    };
    renderPanel({ node: frame, selectionCount: 1, onSetFrameLayoutGuides });
    await user.click(screen.getByRole("button", { name: "Add layout guide" }));
    await user.click(screen.getByRole("menuitem", { name: "Columns" }));
    const columns: LayoutGuide = {
      id: "frame_axis_guides_guide_1",
      type: "columns",
      alignment: "stretch",
      count: 12,
      gutter: 24,
      margin: 64,
      color: "#ff5a5f",
      opacity: 0.12,
    };
    expect(onSetFrameLayoutGuides).toHaveBeenLastCalledWith(frame.id, [
      columns,
    ]);

    cleanup();
    renderPanel({
      node: {
        ...frame,
        properties: { ...frame.properties, layoutGuides: [columns] },
      },
      selectionCount: 1,
      onSetFrameLayoutGuides,
    });
    expect(screen.getByLabelText(`Margin ${columns.id}`)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(`Section size ${columns.id}`),
    ).not.toBeInTheDocument();
    const margin = screen.getByLabelText(`Margin ${columns.id}`);
    await user.clear(margin);
    await user.type(margin, "80");
    await user.tab();
    expect(onSetFrameLayoutGuides).toHaveBeenLastCalledWith(frame.id, [
      { ...columns, margin: 80 },
    ]);

    const rows: LayoutGuide = {
      id: "rows_bottom",
      type: "rows",
      alignment: "end",
      count: 4,
      gutter: 16,
      sectionSize: 40,
      offset: 24,
      color: "#3366ff",
      opacity: 0.1,
    };
    cleanup();
    renderPanel({
      node: {
        ...frame,
        properties: { ...frame.properties, layoutGuides: [rows] },
      },
      selectionCount: 1,
      onSetFrameLayoutGuides,
    });
    expect(screen.getByLabelText(`Section size ${rows.id}`)).toHaveValue(40);
    expect(screen.getByLabelText(`Offset ${rows.id}`)).toHaveValue(24);
    expect(
      screen.queryByLabelText(`Margin ${rows.id}`),
    ).not.toBeInTheDocument();
    const offset = screen.getByLabelText(`Offset ${rows.id}`);
    await user.clear(offset);
    await user.type(offset, "32");
    await user.tab();
    expect(onSetFrameLayoutGuides).toHaveBeenLastCalledWith(frame.id, [
      { ...rows, offset: 32 },
    ]);
  });

  it("uses a free stable guide ID and disables the ninth guide", async () => {
    const user = userEvent.setup();
    const onSetFrameLayoutGuides =
      vi.fn<(frameId: string, layoutGuides: readonly LayoutGuide[]) => void>();
    const guides = Array.from({ length: 7 }, (_, index): LayoutGuide => ({
      id: `frame_guides_grid_${index === 0 ? 1 : index + 2}`,
      type: "grid",
      size: 8 + index,
      color: "#ff5a5f",
      opacity: 0.12,
    }));
    const frame: Extract<DesignNode, { kind: "frame" }> = {
      id: "frame_guides",
      kind: "frame",
      name: "Poster",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 180 },
      opacity: 1,
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
        layoutGuides: guides,
      },
      extensions: {},
    };
    renderPanel({
      node: frame,
      selectionCount: 1,
      onSetFrameLayoutGuides,
    });
    await user.click(screen.getByRole("button", { name: "Add layout guide" }));
    await user.click(screen.getByRole("menuitem", { name: "Uniform grid" }));
    expect(onSetFrameLayoutGuides.mock.calls.at(-1)?.[1].at(-1)?.id).toBe(
      "frame_guides_guide_1",
    );

    cleanup();
    renderPanel({
      node: {
        ...frame,
        properties: {
          ...frame.properties,
          layoutGuides: [
            ...guides,
            {
              id: "frame_guides_guide_1",
              type: "grid",
              size: 24,
              color: "#3366ff",
              opacity: 0.2,
            },
          ],
        },
      },
      selectionCount: 1,
      onSetFrameLayoutGuides,
    });
    expect(
      screen.getByRole("button", { name: "Add layout guide" }),
    ).toBeDisabled();
  });

  it("toggles an Auto Layout child between flow and absolute positioning", async () => {
    const user = userEvent.setup();
    const onSetLayoutPositioning = vi.fn();
    renderPanel({
      node: { ...textNode, parentId: "frame_auto" },
      selectionCount: 1,
      layoutMode: "sizing",
      onSetLayoutPositioning,
    });
    await user.click(screen.getByLabelText("Ignore auto layout"));
    expect(onSetLayoutPositioning).toHaveBeenCalledWith("text_1", "absolute", {
      horizontal: "left",
      vertical: "top",
    });
    cleanup();
    renderPanel({
      node: {
        ...textNode,
        parentId: "frame_auto",
        layoutPositioning: "absolute",
        constraints: { horizontal: "right", vertical: "bottom" },
      },
      selectionCount: 1,
      layoutMode: "absolute",
      onSetLayoutPositioning,
    });
    expect(screen.getByLabelText("Ignore auto layout")).toBeChecked();
    expect(screen.getByLabelText("Horizontal constraint")).toHaveValue("right");
    await user.click(screen.getByLabelText("Ignore auto layout"));
    expect(onSetLayoutPositioning).toHaveBeenLastCalledWith(
      "text_1",
      null,
      undefined,
    );
  });

  it("configures Frame Hug axes and flow-child Fill axes explicitly", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<(updates: UpdatePropertiesPatch) => void>();
    const onSetLayoutSizing = vi.fn();
    const frame: DesignNode = {
      id: "frame_auto",
      kind: "frame" as const,
      name: "Flow",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 80 },
      opacity: 1,
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
        autoLayout: {
          mode: "horizontal" as const,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          gap: 0,
          primaryAlignment: "start" as const,
          counterAlignment: "start" as const,
        },
      },
      extensions: {},
    };
    renderPanel({ node: frame, selectionCount: 1, onUpdate });
    await user.selectOptions(screen.getByLabelText("Width sizing"), "hug");
    const update = onUpdate.mock.calls.at(-1)?.[0];
    expect(update?.properties?.autoLayout).toMatchObject({
      sizing: { horizontal: "hug", vertical: "fixed" },
    });
    cleanup();
    renderPanel({
      node: { ...textNode, parentId: "frame_auto" },
      selectionCount: 1,
      layoutMode: "sizing",
      onUpdate: (updates) => {
        if (updates.layoutSizing) onSetLayoutSizing(updates.layoutSizing);
      },
    });
    await user.selectOptions(screen.getByLabelText("Width sizing"), "fill");
    expect(onSetLayoutSizing).toHaveBeenCalledWith({
      horizontal: "fill",
      vertical: "fixed",
    });
  });

  it("switches Auto Layout between fixed and Auto gap without editing geometry directly", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<(updates: UpdatePropertiesPatch) => void>();
    const frame: DesignNode = {
      id: "frame_auto_gap",
      kind: "frame",
      name: "Responsive navigation",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 80 },
      opacity: 1,
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
        autoLayout: {
          mode: "horizontal",
          padding: { top: 12, right: 16, bottom: 12, left: 16 },
          gap: 8,
          primaryAlignment: "center",
          counterAlignment: "center",
        },
      },
      extensions: {},
    };
    renderPanel({ node: frame, selectionCount: 1, onUpdate });

    await user.selectOptions(screen.getByLabelText("Gap mode"), "auto");
    const automatic = onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout;
    expect(automatic).toEqual({
      mode: "horizontal",
      padding: { top: 12, right: 16, bottom: 12, left: 16 },
      gap: 8,
      primaryAlignment: "space-between",
      counterAlignment: "center",
    });
    cleanup();

    renderPanel({
      node: {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            mode: "horizontal",
            padding: { top: 12, right: 16, bottom: 12, left: 16 },
            gap: 8,
            primaryAlignment: "space-between",
            counterAlignment: "center",
          },
        },
      },
      selectionCount: 1,
      onUpdate,
    });
    expect(screen.getByLabelText("Gap")).toBeDisabled();
    expect(screen.queryByLabelText("Primary axis")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Gap mode"), "fixed");
    const fixed = onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout;
    expect(fixed).toEqual({
      mode: "horizontal",
      padding: { top: 12, right: 16, bottom: 12, left: 16 },
      gap: 8,
      primaryAlignment: "start",
      counterAlignment: "center",
    });
  });

  it("sets and clears Auto Layout min/max fields without generic property writes", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const frame: DesignNode = {
      id: "frame_limits",
      kind: "frame",
      name: "Responsive card",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 160 },
      opacity: 1,
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
        autoLayout: {
          mode: "vertical",
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
          gap: 12,
          primaryAlignment: "start",
          counterAlignment: "start",
        },
      },
      extensions: {},
    };
    renderPanel({ node: frame, selectionCount: 1, onUpdate });
    const minWidth = screen.getByLabelText("Min width");
    await user.type(minWidth, "240");
    await user.tab();
    expect(onUpdate).toHaveBeenLastCalledWith({
      layoutLimits: { minWidth: 240 },
    });
    cleanup();

    renderPanel({
      node: {
        ...textNode,
        parentId: "frame_limits",
        layoutLimits: { minWidth: 120 },
      },
      selectionCount: 1,
      layoutMode: "sizing",
      onUpdate,
    });
    const existingMinimum = screen.getByLabelText("Min width");
    expect(existingMinimum).toHaveValue(120);
    await user.clear(existingMinimum);
    await user.tab();
    expect(onUpdate).toHaveBeenLastCalledWith({ layoutLimits: null });
  });

  it("enables horizontal Wrap with fixed width and an independent default vertical gap", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<(updates: UpdatePropertiesPatch) => void>();
    renderPanel({
      node: {
        id: "frame_wrap",
        kind: "frame",
        name: "Tag collection",
        parentId: null,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0],
        size: { width: 320, height: 160 },
        opacity: 1,
        properties: {
          fills: [],
          strokes: [],
          strokeWidth: 0,
          cornerRadius: 0,
          clipsContent: true,
          autoLayout: {
            mode: "horizontal",
            padding: { top: 8, right: 12, bottom: 8, left: 12 },
            gap: 10,
            primaryAlignment: "start",
            counterAlignment: "center",
            sizing: { horizontal: "hug", vertical: "hug" },
          },
        },
        extensions: {},
      },
      selectionCount: 1,
      onUpdate,
    });

    await user.selectOptions(screen.getByLabelText("Flow"), "wrap");
    const enabled = onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout;
    expect(enabled).toMatchObject({
      mode: "horizontal",
      sizing: { horizontal: "fixed", vertical: "hug" },
      wrap: { mode: "wrap", counterGap: 10 },
    });
  });

  it("edits Wrap vertical gap, removes Wrap on vertical flow, and disables incompatible sizing", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<(updates: UpdatePropertiesPatch) => void>();
    const wrapFrame: DesignNode = {
      id: "frame_wrap",
      kind: "frame",
      name: "Tag collection",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 160 },
      opacity: 1,
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
        autoLayout: {
          mode: "horizontal",
          padding: { top: 8, right: 12, bottom: 8, left: 12 },
          gap: 10,
          primaryAlignment: "start",
          counterAlignment: "center",
          sizing: { horizontal: "fixed", vertical: "hug" },
          wrap: { mode: "wrap", counterGap: 16 },
        },
      },
      extensions: {},
    };
    renderPanel({ node: wrapFrame, selectionCount: 1, onUpdate });

    expect(
      screen.getAllByRole("option", { name: "Hug contents" })[0],
    ).toBeDisabled();
    const counterGap = screen.getByLabelText("Vertical gap");
    await user.clear(counterGap);
    await user.type(counterGap, "24");
    await user.tab();
    const updated = onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout;
    expect(updated).toMatchObject({
      wrap: { mode: "wrap", counterGap: 24 },
    });

    await user.selectOptions(screen.getByLabelText("Direction"), "vertical");
    const vertical = onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout;
    expect(vertical).toMatchObject({ mode: "vertical" });
    expect(vertical).not.toHaveProperty("wrap");
    cleanup();

    renderPanel({
      node: { ...textNode, parentId: "frame_wrap" },
      selectionCount: 1,
      layoutMode: "wrap-sizing",
      onUpdate,
    });
    expect(
      screen.getAllByRole("option", { name: "Fill container" }),
    ).toHaveLength(2);
    for (const option of screen.getAllByRole("option", {
      name: "Fill container",
    })) {
      expect(option).toBeDisabled();
    }
  });

  it("shows cancellable background progress and disables conflicting export controls", async () => {
    const user = userEvent.setup();
    const { onCancelSvgOperation } = renderPanel({
      operation: { kind: "import", name: "Brand system.svg" },
    });

    expect(screen.getByText("Importing Brand system.svg")).toBeVisible();
    expect(screen.getByLabelText("Include layer IDs")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Export 2 selected as SVG…" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelSvgOperation).toHaveBeenCalledOnce();
  });

  it("surfaces bounded fidelity notes with semantic warning text and dismissal", async () => {
    const user = userEvent.setup();
    const issues = [
      "unsupported-element",
      "effect-omitted",
      "mask-omitted",
      "multiple-paints-flattened",
    ].map((code, index) => ({
      code: code as
        | "unsupported-element"
        | "effect-omitted"
        | "mask-omitted"
        | "multiple-paints-flattened",
      message: `Fidelity detail ${index}`,
      severity: "warning" as const,
    }));
    const { onDismissSvgFeedback } = renderPanel({
      feedback: { kind: "export", name: "Brand.svg", issues },
    });

    expect(screen.getByText("Exported Brand.svg")).toBeVisible();
    expect(screen.getByText("4 fidelity note(s) reported.")).toBeVisible();
    expect(screen.getByText("unsupported-element")).toBeVisible();
    expect(screen.queryByText("multiple-paints-flattened")).toBeNull();
    expect(screen.getByText("1 more note(s)")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Dismiss SVG report" }),
    );
    expect(onDismissSvgFeedback).toHaveBeenCalledOnce();
  });
});

describe("PropertiesPanel line workflow", () => {
  it("removes component identity from the selected main through the component section", async () => {
    const user = userEvent.setup();
    const onRemoveComponent = vi.fn();
    renderPanel({
      componentContext: {
        availableComponents: [],
        componentName: "Directed connector",
        isMain: true,
        overrideCount: 0,
        sourceNodes: [],
      },
      node: lineNode,
      onRemoveComponent,
      selectionCount: 1,
    });

    await user.click(screen.getByRole("button", { name: "Remove component" }));
    expect(onRemoveComponent).toHaveBeenCalledOnce();
  });

  it("configures and starts a single-target professional raster export", async () => {
    const user = userEvent.setup();
    const { onExportRaster, onRasterExportSettingsChange } = renderPanel({
      node: lineNode,
      selectionCount: 1,
      exportFormat: "png",
    });

    expect(screen.getByText("240 × 120 px")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Size"), "scale:3");
    expect(onRasterExportSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ size: { mode: "scale", value: 3 } }),
    );
    await user.click(
      screen.getByRole("button", { name: "Export selection as PNG…" }),
    );
    expect(onExportRaster).toHaveBeenCalledOnce();
  });

  it("edits independent endpoints, direction, cap, join, and dash pattern", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderPanel({ node: lineNode });

    expect(screen.getByText("Directed connector")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Start"), "diamond");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { startEndpoint: "diamond" },
    });

    await user.selectOptions(screen.getByLabelText("End"), "triangle-arrow");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { endEndpoint: "triangle-arrow" },
    });

    await user.click(screen.getByRole("button", { name: "Reverse direction" }));
    expect(onUpdate).toHaveBeenCalledWith({
      properties: {
        start: { x: 0, y: 1 },
        end: { x: 1, y: 0 },
      },
    });

    await user.selectOptions(screen.getByLabelText("Cap"), "square");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { strokeCap: "square" },
    });

    await user.selectOptions(screen.getByLabelText("Join"), "bevel");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { strokeJoin: "bevel" },
    });

    const dashPattern = screen.getByLabelText("Dash pattern");
    await user.clear(dashPattern);
    await user.type(dashPattern, "12, 6, 2, 6");
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { dashPattern: [12, 6, 2, 6] },
    });
  });
});

describe("PropertiesPanel regular-shape workflow", () => {
  it("edits bounded Star point count, inner radius, and corner radius", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderPanel({ node: starNode });

    const pointCount = screen.getByLabelText("Point count");
    await user.clear(pointCount);
    await user.type(pointCount, "9");
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { pointCount: 9 },
    });

    const innerRadius = screen.getByLabelText("Inner radius");
    await user.clear(innerRadius);
    await user.type(innerRadius, "55");
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { innerRadius: 0.55 },
    });

    const cornerRadius = screen.getByLabelText("Corner radius");
    await user.clear(cornerRadius);
    await user.type(cornerRadius, "12");
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { cornerRadius: 12 },
    });
  });

  it("rejects fractional point counts and clamps values to the supported range", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderPanel({ node: starNode });
    const pointCount = screen.getByLabelText("Point count");

    await user.clear(pointCount);
    await user.type(pointCount, "4.5");
    await user.tab();
    expect(onUpdate).not.toHaveBeenCalled();

    await user.click(pointCount);
    await user.clear(pointCount);
    await user.type(pointCount, "61");
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { pointCount: 60 },
    });
  });
});

describe("PropertiesPanel text layout workflow", () => {
  it("edits resizing, wrapping, and overflow through one text section", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderPanel({ node: textNode, selectionCount: 1 });

    expect(screen.getByLabelText("Text resizing")).toHaveValue("fixed");
    expect(screen.getByLabelText("Wrapping")).toHaveValue("word");
    expect(screen.getByLabelText("Overflow")).toHaveValue("clip");
    expect(screen.getByLabelText("Vertical alignment")).toHaveValue("top");

    await user.selectOptions(
      screen.getByLabelText("Text resizing"),
      "auto-height",
    );
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { textResize: "auto-height" },
    });

    await user.selectOptions(
      screen.getByLabelText("Vertical alignment"),
      "center",
    );
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { textAlignVertical: "center" },
    });

    await user.selectOptions(screen.getByLabelText("Wrapping"), "character");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { textWrap: "character" },
    });

    await user.selectOptions(screen.getByLabelText("Overflow"), "ellipsis");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { textOverflow: "ellipsis" },
    });
    expect(textNode.size).toEqual({ width: 320, height: 96 });
  });

  it("disables incompatible wrapping and overflow choices in Auto Size modes", () => {
    const autoWidthText = {
      ...textNode,
      properties: {
        ...textNode.properties,
        textResize: "auto-width" as const,
        textWrap: "none" as const,
        textOverflow: "visible" as const,
      },
    };
    renderPanel({
      node: autoWidthText,
      selectionCount: 1,
    });
    expect(screen.getByLabelText("Wrapping")).toBeDisabled();
    expect(screen.getByLabelText("Overflow")).toBeDisabled();
    cleanup();

    const autoHeightText = {
      ...textNode,
      properties: {
        ...textNode.properties,
        textResize: "auto-height" as const,
        textWrap: "word" as const,
        textOverflow: "visible" as const,
      },
    };
    renderPanel({ node: autoHeightText, selectionCount: 1 });
    expect(screen.getByLabelText("Wrapping")).toBeEnabled();
    expect(screen.getByRole("option", { name: "No wrap" })).toBeDisabled();
    expect(screen.getByLabelText("Overflow")).toBeDisabled();
  });
});
