import { TooltipProvider } from "@opendesign/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ComponentOverridePatch,
  DesignNode,
  ImageFilters,
  ImagePaint,
  ImagePlacement,
  InstanceSwapPreferredValue,
  LayoutConstraints,
  LayoutGuide,
  SlotSettings,
  TextNode,
} from "@opendesign/design-contracts";
import type {
  ArrangeOperation,
  ArrangementSelectionMetrics,
} from "@opendesign/editor-runtime";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { PropertiesPanel } from "./PropertiesPanel";
import type { ComponentInspectorContext } from "@/renderer/features/editor";
import type { SvgInterchangeFeedback } from "../../import-export/types";
import type { UpdatePropertiesPatch } from "@/renderer/features/editor";
import type { FontInspectorContext } from "./properties/TypographySection";

function renderPanel(
  options: {
    arrangement?: ArrangementSelectionMetrics | null;
    feedback?: SvgInterchangeFeedback | null;
    node?: DesignNode;
    onArrange?: (operation: ArrangeOperation) => void;
    operation?: { kind: "import" | "export"; name: string } | null;
    exportFormat?: "svg" | "png" | "jpeg" | "webp";
    selectionCount?: number;
    componentContext?: ComponentInspectorContext;
    canCombineVariants?: boolean;
    canAddToVariantSet?: boolean;
    onCombineVariants?: () => void;
    onAddToVariantSet?: () => void;
    onDissolveVariantSet?: () => void;
    onDuplicateVariant?: () => void;
    onRemoveVariant?: () => void;
    onAddComponentProperty?: (input: {
      name: string;
      sourceNodeId: string;
      type: "BOOLEAN" | "TEXT" | "INSTANCE_SWAP" | "SLOT";
    }) => void;
    onAddVariantProperty?: (name: string) => void;
    onRemoveVariantProperty?: (propertyName: string) => void;
    onRenameVariantProperty?: (propertyName: string, name: string) => void;
    onRenameVariantValue?: (
      propertyName: string,
      value: string,
      name: string,
    ) => void;
    onReorderVariantProperties?: (propertyOrder: readonly string[]) => void;
    onReorderComponentProperties?: (
      componentPropertyOrder: readonly string[],
    ) => void;
    onReorderVariantValues?: (
      propertyName: string,
      values: readonly string[],
    ) => void;
    onSetVariantProperties?: (
      componentId: string,
      properties: Readonly<Record<string, string>>,
    ) => void;
    onResetComponentProperty?: (propertyName: string) => void;
    onSetComponentProperty?: (
      propertyName: string,
      value: string | boolean,
    ) => void;
    onClearComponentSlot?: (propertyName: string) => void;
    onCreateComponentSlotOverride?: (propertyName: string) => void;
    onResetComponentSlot?: (propertyName: string) => void;
    onSetComponentSlotSettings?: (
      propertyName: string,
      input: {
        description?: string;
        preferredValues: readonly InstanceSwapPreferredValue[];
        settings: SlotSettings;
      },
    ) => void;
    onRemoveComponent?: () => void;
    layoutMode?: "constraints" | "sizing" | "absolute" | null;
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
    onReorderGridTracks?: (
      frameId: string,
      axis: "rows" | "columns",
      fromIndices: readonly number[],
      insertionIndex: number,
    ) => void;
    onUpdate?: (updates: UpdatePropertiesPatch) => void;
    onUpdateImageFilters?: (filters: ImageFilters) => void;
    onUpdateImagePaintFilters?: (
      nodeId: string,
      paintField: "fills" | "strokes",
      paintIndex: number,
      expectedPaint: ImagePaint,
      filters: ImageFilters,
    ) => void;
    onUpdateImagePlacement?: (placement: ImagePlacement) => void;
    onUpdateComponentOverride?: (
      sourcePath: readonly string[],
      patch: ComponentOverridePatch,
    ) => void;
    fontContext?: FontInspectorContext;
  } = {},
) {
  const onCancelSvgOperation = vi.fn();
  const onDismissSvgFeedback = vi.fn();
  const onExportSvg = vi.fn();
  const onExportRaster = vi.fn();
  const onSvgExportSettingsChange = vi.fn();
  const onRasterExportSettingsChange = vi.fn();
  const onUpdate = options.onUpdate ?? vi.fn();
  const onUpdateImageFilters = options.onUpdateImageFilters ?? vi.fn();
  const onUpdateImagePaintFilters =
    options.onUpdateImagePaintFilters ?? vi.fn();
  const onUpdateImagePlacement = options.onUpdateImagePlacement ?? vi.fn();
  const onArrange =
    options.onArrange ?? vi.fn<(operation: ArrangeOperation) => void>();
  render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <PropertiesPanel
          activePageId="page_welcome"
          arrangement={options.arrangement ?? null}
          booleanOperationEditable={false}
          canAddToVariantSet={options.canAddToVariantSet ?? false}
          canCombineVariants={options.canCombineVariants ?? false}
          canDelete
          layoutMode={options.layoutMode ?? null}
          componentContext={options.componentContext}
          document={createWelcomeDocument()}
          fontContext={options.fontContext}
          node={options.node}
          onArrange={onArrange}
          onAddToVariantSet={options.onAddToVariantSet ?? vi.fn()}
          onAddComponentProperty={options.onAddComponentProperty ?? vi.fn()}
          onAddVariantProperty={options.onAddVariantProperty ?? vi.fn()}
          onBooleanOperationChange={vi.fn()}
          onCancelSvgOperation={onCancelSvgOperation}
          onCreateComponent={vi.fn()}
          onCreateComponentInstance={vi.fn()}
          onCombineVariants={options.onCombineVariants ?? vi.fn()}
          onDelete={vi.fn()}
          onDetachComponentInstance={vi.fn()}
          onDissolveVariantSet={options.onDissolveVariantSet ?? vi.fn()}
          onDismissSvgFeedback={onDismissSvgFeedback}
          onDuplicate={vi.fn()}
          onDuplicateVariant={options.onDuplicateVariant ?? vi.fn()}
          onGoToComponentMain={vi.fn()}
          onExportFormatChange={vi.fn()}
          onExportRaster={onExportRaster}
          onExportStoredSetting={vi.fn()}
          onExportSvg={onExportSvg}
          onCropImage={vi.fn(() => true)}
          onSelectImageArea={vi.fn(() => true)}
          onExpandImage={vi.fn(() => true)}
          onUpscaleImage={vi.fn()}
          onReplaceImage={vi.fn()}
          imageEditStatus={null}
          imageEditAction={null}
          onRemoveImageBackground={vi.fn()}
          onReplaceImageBackground={vi.fn()}
          onRelightImage={vi.fn()}
          onEditImageWithPrompt={vi.fn()}
          onSelectImageEditReference={vi.fn().mockResolvedValue(null)}
          onCancelImageEdit={vi.fn()}
          onSwitchImageSource={vi.fn()}
          onUpdateImageFilters={onUpdateImageFilters}
          onUpdateImagePaintFilters={onUpdateImagePaintFilters}
          onUpdateImagePlacement={onUpdateImagePlacement}
          onRemoveComponent={options.onRemoveComponent ?? vi.fn()}
          onRemoveVariant={options.onRemoveVariant ?? vi.fn()}
          onRemoveComponentProperty={vi.fn()}
          onRemoveVariantProperty={options.onRemoveVariantProperty ?? vi.fn()}
          onRenameComponentProperty={vi.fn()}
          onReorderComponentProperties={
            options.onReorderComponentProperties ?? vi.fn()
          }
          onRenameVariantProperty={options.onRenameVariantProperty ?? vi.fn()}
          onRenameVariantValue={options.onRenameVariantValue ?? vi.fn()}
          onReorderVariantProperties={
            options.onReorderVariantProperties ?? vi.fn()
          }
          onReorderVariantValues={options.onReorderVariantValues ?? vi.fn()}
          onResetComponentInstance={vi.fn()}
          onResetComponentSourceOverride={vi.fn()}
          onResetComponentProperty={options.onResetComponentProperty ?? vi.fn()}
          onSelectBooleanParent={vi.fn()}
          onSetConstraints={options.onSetConstraints ?? vi.fn()}
          onSetLayoutPositioning={options.onSetLayoutPositioning ?? vi.fn()}
          onSetFrameLayoutGuides={options.onSetFrameLayoutGuides ?? vi.fn()}
          onReorderGridTracks={options.onReorderGridTracks ?? vi.fn()}
          onSvgExportSettingsChange={onSvgExportSettingsChange}
          onSetComponentProperty={options.onSetComponentProperty ?? vi.fn()}
          onClearComponentSlot={options.onClearComponentSlot ?? vi.fn()}
          onCreateComponentSlotOverride={
            options.onCreateComponentSlotOverride ?? vi.fn()
          }
          onResetComponentSlot={options.onResetComponentSlot ?? vi.fn()}
          onSetComponentSlotSettings={
            options.onSetComponentSlotSettings ?? vi.fn()
          }
          onSetVariantProperties={options.onSetVariantProperties ?? vi.fn()}
          onSetVariableBinding={vi.fn()}
          onSetVariableMode={vi.fn()}
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
          onUpdate={onUpdate}
          onUpdateComponentOverride={
            options.onUpdateComponentOverride ?? vi.fn()
          }
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
    onUpdateImageFilters,
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
  exportSettings: [],
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

const imageNode: Extract<DesignNode, { kind: "image" }> = {
  id: "image_1",
  name: "Campaign hero",
  kind: "image",
  parentId: null,
  childIds: [],
  visible: true,
  locked: false,
  transform: [1, 0, 0, 1, 0, 0],
  size: { width: 640, height: 420 },
  exportSettings: [],
  opacity: 1,
  properties: {
    assetId: "asset_hero",
    placement: { mode: "fit" },
    filters: { contrast: -0.1 },
    altText: "Campaign hero",
    cornerRadius: 0,
  },
  extensions: {},
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
  exportSettings: [],
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

const textNode: TextNode = {
  id: "text_1",
  name: "Editorial summary",
  parentId: null,
  childIds: [],
  visible: true,
  locked: false,
  transform: [1, 0, 0, 1, 120, 80],
  size: { width: 320, height: 96 },
  exportSettings: [],
  opacity: 1,
  extensions: {},
  kind: "text",
  properties: {
    content: "A deliberately long summary for a constrained text box.",
    fontFamily: "Inter",
    fontStyleName: null,
    fontSize: 18,
    fontWeight: 500,
    fontSlant: "normal",
    lineHeight: 26,
    letterSpacing: 0,
    paragraphIndent: 0,
    paragraphSpacing: 0,
    listSpacing: 0,
    hangingList: false,
    textCase: "original",
    textDecoration: "none",
    textAlignHorizontal: "left",
    textAlignVertical: "top",
    textResize: "fixed",
    textWrap: "word",
    textOverflow: "clip",
    textTruncation: "disabled",
    maxLines: null,
    fills: [{ type: "solid", color: "#151515", opacity: 1 }],
    strokes: [],
    strokeWidth: 0,
  },
};

const componentInstanceNode: Extract<DesignNode, { kind: "instance" }> = {
  id: "button_instance",
  name: "Button instance",
  parentId: null,
  childIds: [],
  visible: true,
  locked: false,
  transform: [1, 0, 0, 1, 120, 80],
  size: { width: 240, height: 48 },
  exportSettings: [],
  opacity: 1,
  extensions: {},
  kind: "instance",
  properties: {
    componentId: "button_component",
    componentProperties: {},
    overrides: [],
  },
};

describe("PropertiesPanel information architecture", () => {
  it("prioritizes real design controls and progressively discloses advanced sections", async () => {
    const user = userEvent.setup();
    renderPanel({ node: lineNode, selectionCount: 1 });

    expect(
      screen.queryByRole("tab", { name: "Prototype properties unavailable" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Layer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Layout" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Effects" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    const exportSection = screen.getByRole("button", { name: "Export" });
    expect(exportSection).toHaveAttribute("aria-expanded", "false");
    await user.click(exportSection);
    expect(exportSection).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps component identity visible but folds component creation for ordinary frames", () => {
    const frame = createWelcomeDocument().nodesById.frame_welcome;
    expect(frame?.kind).toBe("frame");
    renderPanel({ node: frame, selectionCount: 1 });

    expect(screen.getByRole("button", { name: "Component" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows only the active derived component override after canvas drill-in", async () => {
    const user = userEvent.setup();
    const onUpdateComponentOverride = vi.fn();
    renderPanel({
      componentContext: {
        activeSourcePath: [textNode.id],
        availableComponents: [],
        availableSlotPreferredValues: [],
        componentName: "Primary button",
        componentProperties: [],
        componentPropertyDefinitions: [],
        isMain: false,
        overrideCount: 0,
        sourceNodes: [
          {
            node: textNode,
            overridden: false,
            sourcePath: [textNode.id],
          },
        ],
      },
      node: componentInstanceNode,
      onUpdateComponentOverride,
      selectionCount: 1,
    });

    expect(screen.getAllByText(textNode.name)).toHaveLength(2);
    expect(screen.getAllByText("Layer overrides").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Source layer")).toHaveValue(textNode.id);
    expect(
      screen.queryByRole("button", { name: "Duplicate layer" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete layer" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Visible" }));
    expect(onUpdateComponentOverride).toHaveBeenCalledWith([textNode.id], {
      visible: false,
    });
  });
});

describe("PropertiesPanel image adjustments", () => {
  it("commits one standard filter update after slider interaction and can reset", () => {
    const onUpdateImageFilters = vi.fn();
    renderPanel({ node: imageNode, onUpdateImageFilters });

    const exposure = screen.getByRole("slider", { name: "Exposure" });
    fireEvent.change(exposure, { target: { value: "25" } });
    expect(onUpdateImageFilters).not.toHaveBeenCalled();
    fireEvent.pointerUp(exposure, { target: { value: "25" } });
    expect(onUpdateImageFilters).toHaveBeenCalledWith({
      contrast: -0.1,
      exposure: 0.25,
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset adjustments" }));
    expect(onUpdateImageFilters).toHaveBeenLastCalledWith({});
  });

  it("commits adjustments inside the exact image Fill row", () => {
    const onUpdateImagePaintFilters = vi.fn();
    const paintNode: DesignNode = {
      ...starNode,
      id: "image_paint_shape",
      properties: {
        ...starNode.properties,
        fills: [
          {
            type: "image",
            assetId: "asset_photo",
            fit: "cover",
            opacity: 1,
            filters: { contrast: -0.1 },
          },
        ],
      },
    };
    renderPanel({ node: paintNode, onUpdateImagePaintFilters });

    const exposure = screen.getByRole("slider", { name: "Exposure" });
    fireEvent.change(exposure, { target: { value: "30" } });
    expect(onUpdateImagePaintFilters).not.toHaveBeenCalled();
    fireEvent.pointerUp(exposure, { target: { value: "30" } });
    expect(onUpdateImagePaintFilters).toHaveBeenLastCalledWith(
      "image_paint_shape",
      "fills",
      0,
      {
        type: "image",
        assetId: "asset_photo",
        fit: "cover",
        opacity: 1,
        filters: { contrast: -0.1 },
      },
      { contrast: -0.1, exposure: 0.3 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset adjustments" }));
    expect(onUpdateImagePaintFilters).toHaveBeenLastCalledWith(
      "image_paint_shape",
      "fills",
      0,
      {
        type: "image",
        assetId: "asset_photo",
        fit: "cover",
        opacity: 1,
        filters: { contrast: -0.1 },
      },
      {},
    );
  });
});

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
        exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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
        exportSettings: [],
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
      exportSettings: [],
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

    await user.selectOptions(
      screen.getByLabelText("Vertical gap mode"),
      "auto",
    );
    const automatic = onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout;
    expect(automatic).toMatchObject({
      wrap: {
        mode: "wrap",
        counterGap: 16,
        counterAxisAlignContent: "space-between",
      },
    });
    cleanup();
    const automaticWrapFrame = structuredClone(wrapFrame);
    if (
      automaticWrapFrame.kind !== "frame" ||
      automaticWrapFrame.properties.autoLayout?.mode !== "horizontal" ||
      !automaticWrapFrame.properties.autoLayout.wrap
    ) {
      throw new Error("missing wrapped Frame");
    }
    automaticWrapFrame.properties.autoLayout.wrap.counterAxisAlignContent =
      "space-between";
    renderPanel({
      node: automaticWrapFrame,
      selectionCount: 1,
      onUpdate,
    });
    expect(screen.getByLabelText("Vertical gap")).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Direction"), "vertical");
    const vertical = onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout;
    expect(vertical).toMatchObject({ mode: "vertical" });
    expect(vertical).not.toHaveProperty("wrap");
    cleanup();

    renderPanel({
      node: { ...textNode, parentId: "frame_wrap" },
      selectionCount: 1,
      layoutMode: "sizing",
      onUpdate,
    });
    expect(
      screen.getAllByRole("option", { name: "Fill container" }),
    ).toHaveLength(2);
    for (const option of screen.getAllByRole("option", {
      name: "Fill container",
    })) {
      expect(option).toBeEnabled();
    }
  });

  it("switches to Grid and edits real tracks and independent gaps", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<(updates: UpdatePropertiesPatch) => void>();
    const frame: DesignNode = {
      id: "frame_grid",
      kind: "frame",
      name: "Product grid",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 600, height: 400 },
      exportSettings: [],
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
    await user.selectOptions(screen.getByLabelText("Direction"), "grid");
    expect(
      onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout,
    ).toMatchObject({
      mode: "grid",
      itemsPositioning: "row-auto-flow",
      rows: [{ type: "hug" }],
      columns: [
        { type: "fill", value: 1 },
        { type: "fill", value: 1 },
      ],
    });
    cleanup();
    const onReorderGridTracks = vi.fn();
    renderPanel({
      node: {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            mode: "grid",
            padding: { top: 16, right: 16, bottom: 16, left: 16 },
            rowGap: 12,
            columnGap: 16,
            rows: [{ type: "hug" }],
            columns: [
              { type: "fixed", value: 180 },
              { type: "fill", value: 1 },
            ],
            itemsPositioning: "row-auto-flow",
          },
        },
      },
      selectionCount: 1,
      onUpdate,
      onReorderGridTracks,
    });
    await user.click(
      screen.getByRole("button", { name: "Move Columns track 1 down" }),
    );
    expect(onReorderGridTracks).toHaveBeenCalledWith(
      "frame_grid",
      "columns",
      [0],
      2,
    );
    await user.selectOptions(screen.getByLabelText("Rows"), "automatic");
    expect(
      onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout,
    ).toMatchObject({
      itemsPositioning: "row-auto-flow",
      autoTracks: "rows",
      sizing: { vertical: "fixed" },
    });
    await user.click(screen.getByRole("button", { name: "Add Columns track" }));
    expect(
      onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout,
    ).toMatchObject({
      columns: [
        { type: "fixed", value: 180 },
        { type: "fill", value: 1 },
        { type: "fill", value: 1 },
      ],
    });
    const columnGap = screen.getByLabelText("Column gap");
    await user.clear(columnGap);
    await user.type(columnGap, "24");
    await user.tab();
    expect(
      onUpdate.mock.calls.at(-1)?.[0].properties?.autoLayout,
    ).toMatchObject({
      columnGap: 24,
    });
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
  it("authors a typed component property from an explicit Main sublayer", async () => {
    const user = userEvent.setup();
    const onAddComponentProperty = vi.fn();
    renderPanel({
      componentContext: {
        availableComponents: [],
        availableSlotPreferredValues: [],
        componentName: "Primary button",
        componentProperties: [],
        componentPropertyDefinitions: [],
        isMain: true,
        overrideCount: 0,
        sourceNodes: [
          {
            node: textNode,
            overridden: false,
            sourcePath: [textNode.id],
          },
        ],
      },
      node: lineNode,
      onAddComponentProperty,
      selectionCount: 1,
    });

    await user.selectOptions(screen.getByLabelText("Property type"), "TEXT");
    const name = screen.getByLabelText("Property name");
    await user.clear(name);
    await user.type(name, "CTA label");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Add property" }));

    expect(onAddComponentProperty).toHaveBeenCalledWith({
      name: "CTA label",
      sourceNodeId: textNode.id,
      type: "TEXT",
    });
  });

  it("reorders ordinary Component properties with accessible controls", async () => {
    const user = userEvent.setup();
    const onReorderComponentProperties = vi.fn();
    renderPanel({
      componentContext: {
        availableComponents: [],
        availableSlotPreferredValues: [],
        componentName: "Primary button",
        componentProperties: [],
        componentPropertyDefinitions: [
          {
            definition: { type: "TEXT", defaultValue: "Continue" },
            propertyName: "Label#button:text",
            sourceNodeIds: [textNode.id],
          },
          {
            definition: { type: "BOOLEAN", defaultValue: true },
            propertyName: "Visible#button:visible",
            sourceNodeIds: [textNode.id],
          },
        ],
        isMain: true,
        overrideCount: 0,
        sourceNodes: [],
      },
      node: lineNode,
      onReorderComponentProperties,
      selectionCount: 1,
    });

    await user.click(screen.getByRole("button", { name: "Move Label down" }));

    expect(onReorderComponentProperties).toHaveBeenCalledWith([
      "Visible#button:visible",
      "Label#button:text",
    ]);
  });

  it("authors a Slot only from an eligible Frame sublayer", async () => {
    const user = userEvent.setup();
    const onAddComponentProperty = vi.fn();
    const contentFrame: Extract<DesignNode, { kind: "frame" }> = {
      id: "card_content",
      name: "Content",
      parentId: "card_main",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 16, 16],
      size: { width: 240, height: 120 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "frame",
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: false,
      },
    };
    renderPanel({
      componentContext: {
        availableComponents: [],
        availableSlotPreferredValues: [],
        componentName: "Card",
        componentProperties: [],
        componentPropertyDefinitions: [],
        isMain: true,
        overrideCount: 0,
        sourceNodes: [
          {
            node: contentFrame,
            overridden: false,
            sourcePath: [contentFrame.id],
          },
        ],
      },
      node: lineNode,
      onAddComponentProperty,
      selectionCount: 1,
    });

    await user.selectOptions(screen.getByLabelText("Property type"), "SLOT");
    await user.click(screen.getByRole("button", { name: "Add property" }));

    expect(onAddComponentProperty).toHaveBeenCalledWith({
      name: "Content",
      sourceNodeId: contentFrame.id,
      type: "SLOT",
    });
  });

  it("configures Component and Component Set preferred values for a Slot", async () => {
    const user = userEvent.setup();
    const onSetComponentSlotSettings = vi.fn();
    const propertyName = "Content#card:content";
    renderPanel({
      componentContext: {
        availableComponents: [],
        availableSlotPreferredValues: [
          { key: "row_component", name: "Row", type: "COMPONENT" },
          { key: "row_set", name: "Row states", type: "COMPONENT_SET" },
        ],
        componentName: "Card",
        componentProperties: [],
        componentPropertyDefinitions: [
          {
            definition: {
              type: "SLOT",
              defaultValue: "card_content",
              slotSettings: { displayEmptyByDefault: true },
            },
            propertyName,
            sourceNodeIds: ["card_content"],
          },
        ],
        isMain: true,
        overrideCount: 0,
        sourceNodes: [],
      },
      node: lineNode,
      onSetComponentSlotSettings,
      selectionCount: 1,
    });

    await user.click(screen.getByText("Slot settings"));
    const preferred = screen.getByLabelText<HTMLSelectElement>(
      "Preferred instances",
    );
    for (const option of preferred.options) option.selected = true;
    fireEvent.change(preferred);

    expect(onSetComponentSlotSettings).toHaveBeenCalledWith(propertyName, {
      description: undefined,
      preferredValues: [
        { key: "row_component", type: "COMPONENT" },
        { key: "row_set", type: "COMPONENT_SET" },
      ],
      settings: { displayEmptyByDefault: true },
    });
  });

  it("edits and resets a consolidated instance property before advanced overrides", async () => {
    const user = userEvent.setup();
    const onResetComponentProperty = vi.fn();
    const onSetComponentProperty = vi.fn();
    renderPanel({
      componentContext: {
        availableComponents: [],
        availableSlotPreferredValues: [],
        componentName: "Primary button",
        componentProperties: [
          {
            assigned: true,
            definition: { type: "BOOLEAN", defaultValue: true },
            propertyName: "Show label#button:visible",
            value: false,
          },
        ],
        componentPropertyDefinitions: [],
        isMain: false,
        overrideCount: 0,
        sourceNodes: [],
      },
      node: lineNode,
      onResetComponentProperty,
      onSetComponentProperty,
      selectionCount: 1,
    });

    const property = screen
      .getByText("Show label")
      .closest("div")?.parentElement;
    if (!property) throw new Error("Missing component property row");
    await user.click(within(property).getByRole("checkbox"));
    await user.click(within(property).getByRole("button", { name: "Reset" }));

    expect(onSetComponentProperty).toHaveBeenCalledWith(
      "Show label#button:visible",
      true,
    );
    expect(onResetComponentProperty).toHaveBeenCalledWith(
      "Show label#button:visible",
    );
  });

  it("shows real Slot state and routes edit, clear, and reset actions", async () => {
    const user = userEvent.setup();
    const onClearComponentSlot = vi.fn();
    const onCreateComponentSlotOverride = vi.fn();
    const onResetComponentSlot = vi.fn();
    const propertyName = "Content#card:content";
    renderPanel({
      componentContext: {
        availableComponents: [],
        availableSlotPreferredValues: [],
        componentName: "Card",
        componentProperties: [
          {
            assigned: true,
            definition: {
              type: "SLOT",
              defaultValue: "card_content",
              slotSettings: { minChildren: 2 },
            },
            propertyName,
            value: "card_content",
            slot: {
              childCount: 1,
              displayNodeId: "card_content_override",
              limitViolations: ["BELOW_MIN"],
              overridden: true,
              propertyName,
              settings: { minChildren: 2 },
              sourceSlotNodeId: "card_content",
            },
          },
        ],
        componentPropertyDefinitions: [],
        isMain: false,
        overrideCount: 0,
        sourceNodes: [],
      },
      node: lineNode,
      onClearComponentSlot,
      onCreateComponentSlotOverride,
      onResetComponentSlot,
      selectionCount: 1,
    });

    expect(screen.getByText("Custom contents · 1 layers")).toBeVisible();
    expect(
      screen.getByText("1 slot guidance limits need attention"),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit contents" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(onClearComponentSlot).toHaveBeenCalledWith(propertyName);
    expect(onResetComponentSlot).toHaveBeenCalledWith(propertyName);
    expect(onCreateComponentSlotOverride).not.toHaveBeenCalled();
  });

  it("switches and resets a VARIANT property from the Instance inspector", async () => {
    const user = userEvent.setup();
    const onResetComponentProperty = vi.fn();
    const onSetComponentProperty = vi.fn();
    renderPanel({
      componentContext: {
        availableComponents: [],
        availableSlotPreferredValues: [],
        componentName: "Button",
        componentProperties: [
          {
            assigned: true,
            definition: {
              type: "VARIANT",
              defaultValue: "Default",
              variantOptions: ["Default", "Hover"],
            },
            propertyName: "State",
            value: "Hover",
          },
        ],
        componentPropertyDefinitions: [],
        isMain: false,
        overrideCount: 0,
        sourceNodes: [],
        variantSet: {
          id: "button_set",
          isDefault: false,
          isRoot: false,
          name: "Button",
          properties: { State: "Hover" },
          variantCount: 2,
          propertyOrder: ["State"],
          propertyDefinitions: {
            State: {
              defaultValue: "Default",
              variantOptions: ["Default", "Hover"],
            },
          },
          members: [],
        },
      },
      node: lineNode,
      onResetComponentProperty,
      onSetComponentProperty,
      selectionCount: 1,
    });

    await user.selectOptions(screen.getByLabelText("State"), "Default");
    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(onSetComponentProperty).toHaveBeenCalledWith("State", "Default");
    expect(onResetComponentProperty).toHaveBeenCalledWith("State");
  });

  it("removes component identity from the selected main through the component section", async () => {
    const user = userEvent.setup();
    const onRemoveComponent = vi.fn();
    renderPanel({
      componentContext: {
        availableComponents: [],
        availableSlotPreferredValues: [],
        componentName: "Directed connector",
        componentProperties: [],
        componentPropertyDefinitions: [],
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

  it("offers one explicit combine action only for eligible multi-Component selection", async () => {
    const user = userEvent.setup();
    const onCombineVariants = vi.fn();
    renderPanel({
      canCombineVariants: true,
      onCombineVariants,
      selectionCount: 2,
    });

    await user.click(
      screen.getByRole("button", { name: "Combine as variants" }),
    );
    expect(onCombineVariants).toHaveBeenCalledOnce();
  });

  it("offers Set membership lifecycle actions from the real Set root", async () => {
    const user = userEvent.setup();
    const onDuplicateVariant = vi.fn();
    const onDissolveVariantSet = vi.fn();
    const onAddVariantProperty = vi.fn();
    const onRenameVariantProperty = vi.fn();
    const onReorderVariantValues = vi.fn();
    const onSetVariantProperties = vi.fn();
    renderPanel({
      componentContext: {
        availableComponents: [],
        availableSlotPreferredValues: [],
        componentName: "Button",
        componentProperties: [],
        componentPropertyDefinitions: [],
        isMain: false,
        overrideCount: 0,
        sourceNodes: [],
        variantSet: {
          id: "button_set",
          isDefault: false,
          isRoot: true,
          name: "Button",
          properties: {},
          variantCount: 2,
          propertyOrder: ["State"],
          propertyDefinitions: {
            State: {
              defaultValue: "Default",
              variantOptions: ["Default", "Hover"],
            },
          },
          members: [
            {
              componentId: "button_default",
              name: "Button / Default",
              rootNodeId: "button_default_root",
              properties: { State: "Default" },
            },
            {
              componentId: "button_hover",
              name: "Button / Hover",
              rootNodeId: "button_hover_root",
              properties: { State: "Hover" },
            },
          ],
        },
      },
      node: lineNode,
      onDuplicateVariant,
      onDissolveVariantSet,
      onAddVariantProperty,
      onRenameVariantProperty,
      onReorderVariantValues,
      onSetVariantProperties,
      selectionCount: 1,
    });

    await user.click(screen.getByRole("button", { name: "Add variant" }));
    await user.click(screen.getByRole("button", { name: "Dissolve set" }));
    expect(onDuplicateVariant).toHaveBeenCalledOnce();
    expect(onDissolveVariantSet).toHaveBeenCalledOnce();

    const property = screen.getByLabelText("Property State");
    await user.clear(property);
    await user.type(property, "Mode{Enter}");
    expect(onRenameVariantProperty).toHaveBeenCalledWith("State", "Mode");

    await user.click(screen.getByRole("button", { name: "Move Hover up" }));
    expect(onReorderVariantValues).toHaveBeenCalledWith("State", [
      "Hover",
      "Default",
    ]);

    const memberValue = screen.getByLabelText("Button / Hover · State");
    await user.clear(memberValue);
    await user.type(memberValue, "Pressed{Enter}");
    expect(onSetVariantProperties).toHaveBeenCalledWith("button_hover", {
      State: "Pressed",
    });

    await user.type(screen.getByLabelText("New property"), "Size{Enter}");
    await user.click(screen.getByRole("button", { name: "Add property" }));
    expect(onAddVariantProperty).toHaveBeenCalledWith("Size");
  });

  it("adds one ordinary Component to one selected Set", async () => {
    const user = userEvent.setup();
    const onAddToVariantSet = vi.fn();
    renderPanel({
      canAddToVariantSet: true,
      onAddToVariantSet,
      selectionCount: 2,
    });
    await user.click(
      screen.getByRole("button", { name: "Add to component set" }),
    );
    expect(onAddToVariantSet).toHaveBeenCalledOnce();
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
  it("distinguishes available and unknown fonts and disables meaningless reflow", () => {
    const context = {
      importState: { status: "idle" } as const,
      matchingNodeCount: 1,
      reflowableNodeCount: 0,
      onImport: vi.fn().mockResolvedValue(undefined),
      onReflow: vi.fn(),
      onReplace: vi.fn(),
    };
    renderPanel({
      node: textNode,
      selectionCount: 1,
      fontContext: {
        ...context,
        availability: {
          status: "available",
          provider: "test-font-provider",
          providerVersion: "3",
          message: "Inter is loaded",
        },
      },
    });

    expect(screen.getByText("Font available")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reflow" })).toBeDisabled();
    expect(
      screen.queryByLabelText("Replacement font family"),
    ).not.toBeInTheDocument();

    cleanup();
    renderPanel({
      node: textNode,
      selectionCount: 1,
      fontContext: {
        ...context,
        availability: {
          status: "unknown",
          provider: "test-font-provider",
          providerVersion: "3",
          message: "System font enumeration is unavailable",
        },
      },
    });
    expect(screen.getByText("Font availability unknown")).toBeVisible();
    expect(screen.getByRole("button", { name: "Import font…" })).toBeVisible();
    expect(screen.getByLabelText("Replacement font family")).toBeVisible();
  });

  it("reports font import progress, success, and recovery errors", () => {
    const baseContext = {
      availability: {
        status: "missing" as const,
        provider: "test-font-provider",
        providerVersion: "3",
        message: "Inter is not loaded",
      },
      matchingNodeCount: 1,
      onImport: vi.fn().mockResolvedValue(undefined),
      onReflow: vi.fn(),
      onReplace: vi.fn(),
      reflowableNodeCount: 1,
    };
    renderPanel({
      node: textNode,
      selectionCount: 1,
      fontContext: {
        ...baseContext,
        importState: { status: "importing" },
      },
    });
    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();

    cleanup();
    renderPanel({
      node: textNode,
      selectionCount: 1,
      fontContext: {
        ...baseContext,
        importState: { count: 2, status: "success" },
      },
    });
    expect(screen.getByText("Imported 2 font face(s)")).toBeVisible();

    cleanup();
    renderPanel({
      node: textNode,
      selectionCount: 1,
      fontContext: {
        ...baseContext,
        importState: { message: "Malformed SFNT", status: "error" },
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Font import failed: Malformed SFNT",
    );
  });

  it("shows trusted missing-font state and submits explicit reflow or file-wide replacement", async () => {
    const user = userEvent.setup();
    const onReflow = vi.fn();
    const onReplace = vi.fn();
    const onImport = vi.fn().mockResolvedValue(undefined);
    renderPanel({
      node: textNode,
      selectionCount: 1,
      fontContext: {
        availability: {
          status: "missing",
          provider: "test-font-provider",
          providerVersion: "3",
          message: "Inter is not loaded",
        },
        matchingNodeCount: 3,
        reflowableNodeCount: 2,
        importState: { status: "idle" },
        onImport,
        onReflow,
        onReplace,
      },
    });

    expect(screen.getByText("Font missing — fallback rendered")).toBeVisible();
    expect(
      screen.getByText("3 matching text layers in this file"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Import font…" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onReflow).not.toHaveBeenCalled();

    const replacement = screen.getByLabelText("Replacement font family");
    await user.type(replacement, "IBM Plex Sans");
    await user.tab();
    await user.type(
      screen.getByLabelText("Replacement face style"),
      "Medium Italic",
    );
    await user.tab();
    await user.selectOptions(
      screen.getByLabelText("Replacement font slant"),
      "italic",
    );
    await user.click(
      screen.getByRole("button", { name: "Replace 3 matching layers" }),
    );
    expect(onReplace).toHaveBeenCalledWith({
      fontFamily: "IBM Plex Sans",
      fontStyleName: "Medium Italic",
      fontWeight: 500,
      fontSlant: "italic",
    });
  });

  it("edits Typography Core fields through one text section", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderPanel({ node: textNode, selectionCount: 1 });

    expect(screen.getByLabelText("Text resizing")).toHaveValue("fixed");
    expect(screen.getByLabelText("Wrapping")).toHaveValue("word");
    expect(screen.getByLabelText("Overflow")).toHaveValue("clip");
    expect(screen.getByLabelText("Vertical alignment")).toHaveValue("top");
    expect(screen.getByLabelText("Truncation")).toHaveValue("disabled");
    expect(screen.getByLabelText("Maximum lines")).toBeDisabled();

    const fontStyleName = screen.getByLabelText("Font face style");
    await user.type(fontStyleName, "Medium Italic");
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { fontStyleName: "Medium Italic" },
    });

    await user.selectOptions(screen.getByLabelText("Font slant"), "italic");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { fontSlant: "italic" },
    });

    const paragraphIndent = screen.getByLabelText("Paragraph indent");
    await user.clear(paragraphIndent);
    await user.type(paragraphIndent, "12");
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { paragraphIndent: 12 },
    });

    await user.selectOptions(screen.getByLabelText("Letter case"), "uppercase");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { textCase: "uppercase" },
    });

    await user.selectOptions(screen.getByLabelText("Decoration"), "underline");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { textDecoration: "underline" },
    });

    await user.selectOptions(
      screen.getByLabelText("Text resizing"),
      "auto-height",
    );
    expect(onUpdate).toHaveBeenCalledWith({
      properties: {
        textOverflow: "visible",
        textResize: "auto-height",
        textWrap: "word",
      },
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

    await user.selectOptions(screen.getByLabelText("Truncation"), "ending");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: {
        maxLines: null,
        textOverflow: "clip",
        textTruncation: "ending",
      },
    });
    expect(textNode.size).toEqual({ width: 320, height: 96 });
  });

  it("enforces Auto Size wrapping, overflow, and ending-truncation defaults", async () => {
    const user = userEvent.setup();
    const autoWidthText = {
      ...textNode,
      properties: {
        ...textNode.properties,
        textResize: "auto-width" as const,
        textWrap: "none" as const,
        textOverflow: "visible" as const,
        textTruncation: "disabled" as const,
        maxLines: null,
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
        textTruncation: "disabled" as const,
        maxLines: null,
      },
    };
    const { onUpdate } = renderPanel({
      node: autoHeightText,
      selectionCount: 1,
    });
    expect(screen.getByLabelText("Wrapping")).toBeEnabled();
    expect(screen.getByRole("option", { name: "No wrap" })).toBeDisabled();
    expect(screen.getByLabelText("Overflow")).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Truncation"), "ending");
    expect(onUpdate).toHaveBeenCalledWith({
      properties: {
        maxLines: 3,
        textOverflow: "visible",
        textTruncation: "ending",
      },
    });
  });

  it("allows fixed ending truncation to use a positive line cap or box height", async () => {
    const user = userEvent.setup();
    const endingText: TextNode = {
      ...textNode,
      properties: {
        ...textNode.properties,
        textResize: "fixed",
        maxLines: null,
        textOverflow: "clip",
        textTruncation: "ending",
      },
    };
    const { onUpdate } = renderPanel({ node: endingText, selectionCount: 1 });
    const maxLines = screen.getByLabelText("Maximum lines");
    expect(maxLines).toBeEnabled();
    expect(maxLines).toHaveValue(null);
    await user.type(maxLines, "4");
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith({ properties: { maxLines: 4 } });
  });

  it("routes typography edits to the exact live text range", async () => {
    const user = userEvent.setup();
    const onRangeUpdate = vi.fn();
    const onParagraphUpdate = vi.fn();
    const { onUpdate } = renderPanel({
      node: textNode,
      selectionCount: 1,
      fontContext: {
        availability: {
          status: "available",
          provider: "test-font-provider",
          providerVersion: "3",
          message: "Inter is loaded",
        },
        importState: { status: "idle" },
        matchingNodeCount: 1,
        reflowableNodeCount: 0,
        onImport: vi.fn().mockResolvedValue(undefined),
        onReflow: vi.fn(),
        onReplace: vi.fn(),
        paragraph: {
          start: 0,
          end: 4,
          style: {
            listOptions: { type: "none" },
            indentation: 0,
            listSpacing: 0,
            paragraphIndent: 0,
            paragraphSpacing: 0,
          },
          mixedFields: [],
          onUpdate: onParagraphUpdate,
        },
        range: {
          collapsed: false,
          start: 0,
          end: 4,
          text: "Open",
          style: {
            fontFamily: textNode.properties.fontFamily,
            fontStyleName: textNode.properties.fontStyleName,
            fontSize: textNode.properties.fontSize,
            fontWeight: textNode.properties.fontWeight,
            fontSlant: textNode.properties.fontSlant,
            lineHeight: textNode.properties.lineHeight,
            letterSpacing: textNode.properties.letterSpacing,
            paragraphIndent: textNode.properties.paragraphIndent,
            paragraphSpacing: textNode.properties.paragraphSpacing,
            listOptions: { type: "none" },
            indentation: 0,
            listSpacing: 0,
            textCase: textNode.properties.textCase,
            textDecoration: textNode.properties.textDecoration,
            fills: textNode.properties.fills,
          },
          mixedFields: [],
          onUpdate: onRangeUpdate,
        },
      },
    });
    expect(screen.getByText("Selected text 0–4")).toBeVisible();
    const size = screen.getByLabelText("Font size");
    await user.clear(size);
    await user.type(size, "28");
    await user.tab();
    expect(onRangeUpdate).toHaveBeenCalledWith({ fontSize: 28 });
    const paragraphSpacing = screen.getByLabelText("Paragraph spacing");
    await user.clear(paragraphSpacing);
    await user.type(paragraphSpacing, "16");
    await user.tab();
    expect(onRangeUpdate).toHaveBeenCalledWith({ paragraphSpacing: 16 });
    await user.selectOptions(screen.getByLabelText("List style"), "ordered");
    expect(onParagraphUpdate).toHaveBeenCalledWith({
      listOptions: { type: "ordered" },
    });
    const listLevel = screen.getByLabelText("List indentation level");
    await user.clear(listLevel);
    await user.type(listLevel, "2");
    await user.tab();
    expect(onParagraphUpdate).toHaveBeenCalledWith({ indentation: 2 });
    const listSpacing = screen.getByLabelText("List spacing");
    await user.clear(listSpacing);
    await user.type(listSpacing, "12");
    await user.tab();
    expect(onParagraphUpdate).toHaveBeenCalledWith({ listSpacing: 12 });
    await user.click(screen.getByLabelText("Hanging list markers"));
    expect(onUpdate).toHaveBeenCalledWith({
      properties: { hangingList: true },
    });
    expect(onUpdate).not.toHaveBeenCalledWith({ properties: { fontSize: 28 } });
    expect(onUpdate).not.toHaveBeenCalledWith({
      properties: { paragraphSpacing: 16 },
    });
  });

  it("shows and edits a session-only typing style at a collapsed caret", async () => {
    const user = userEvent.setup();
    const onRangeUpdate = vi.fn();
    renderPanel({
      node: textNode,
      selectionCount: 1,
      fontContext: {
        availability: {
          status: "available",
          provider: "test-font-provider",
          providerVersion: "3",
          message: "Inter is loaded",
        },
        importState: { status: "idle" },
        matchingNodeCount: 1,
        reflowableNodeCount: 0,
        onImport: vi.fn().mockResolvedValue(undefined),
        onReflow: vi.fn(),
        onReplace: vi.fn(),
        paragraph: {
          start: 2,
          end: 2,
          style: {
            listOptions: { type: "none" },
            indentation: 0,
            listSpacing: 0,
            paragraphIndent: 0,
            paragraphSpacing: 0,
          },
          mixedFields: [],
          onUpdate: vi.fn(),
        },
        range: {
          collapsed: true,
          start: 2,
          end: 2,
          text: "",
          style: {
            fontFamily: textNode.properties.fontFamily,
            fontStyleName: textNode.properties.fontStyleName,
            fontSize: 24,
            fontWeight: 700,
            fontSlant: textNode.properties.fontSlant,
            lineHeight: textNode.properties.lineHeight,
            letterSpacing: textNode.properties.letterSpacing,
            paragraphIndent: textNode.properties.paragraphIndent,
            paragraphSpacing: textNode.properties.paragraphSpacing,
            listOptions: { type: "none" },
            indentation: 0,
            listSpacing: 0,
            textCase: textNode.properties.textCase,
            textDecoration: textNode.properties.textDecoration,
            fills: textNode.properties.fills,
          },
          mixedFields: [],
          onUpdate: onRangeUpdate,
        },
      },
    });

    expect(screen.getByText("Typing at 2")).toBeVisible();
    expect(
      screen.getByText(
        "Typography changes apply to text typed from this caret.",
      ),
    ).toBeVisible();
    const size = screen.getByLabelText("Font size");
    expect(size).toHaveValue(24);
    await user.clear(size);
    await user.type(size, "30");
    await user.tab();
    expect(onRangeUpdate).toHaveBeenCalledWith({ fontSize: 30 });
  });
});
