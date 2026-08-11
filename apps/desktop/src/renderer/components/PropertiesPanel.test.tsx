import { TooltipProvider } from "@opendesign/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DesignNode } from "@opendesign/design-contracts";
import type {
  ArrangeOperation,
  ArrangementSelectionMetrics,
} from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  PropertiesPanel,
  type SvgInterchangeFeedback,
} from "./PropertiesPanel";

function renderPanel(
  options: {
    arrangement?: ArrangementSelectionMetrics | null;
    feedback?: SvgInterchangeFeedback | null;
    node?: DesignNode;
    onArrange?: (operation: ArrangeOperation) => void;
    operation?: { kind: "import" | "export"; name: string } | null;
    exportFormat?: "svg" | "png" | "jpeg" | "webp";
    selectionCount?: number;
  } = {},
) {
  const onCancelSvgOperation = vi.fn();
  const onDismissSvgFeedback = vi.fn();
  const onExportSvg = vi.fn();
  const onExportRaster = vi.fn();
  const onSvgExportSettingsChange = vi.fn();
  const onRasterExportSettingsChange = vi.fn();
  const onUpdate = vi.fn();
  const onArrange =
    options.onArrange ?? vi.fn<(operation: ArrangeOperation) => void>();
  render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <PropertiesPanel
          arrangement={options.arrangement ?? null}
          booleanOperationEditable={false}
          canDelete
          node={options.node}
          onArrange={onArrange}
          onBooleanOperationChange={vi.fn()}
          onCancelSvgOperation={onCancelSvgOperation}
          onDelete={vi.fn()}
          onDismissRasterFeedback={vi.fn()}
          onDismissSvgFeedback={onDismissSvgFeedback}
          onDuplicate={vi.fn()}
          onExportFormatChange={vi.fn()}
          onExportRaster={onExportRaster}
          onExportSvg={onExportSvg}
          onReplaceImage={vi.fn()}
          onSelectBooleanParent={vi.fn()}
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
