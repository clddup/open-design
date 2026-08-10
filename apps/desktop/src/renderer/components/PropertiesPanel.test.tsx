import { TooltipProvider } from "@opendesign/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  PropertiesPanel,
  type SvgInterchangeFeedback,
} from "./PropertiesPanel";

function renderPanel(
  options: {
    feedback?: SvgInterchangeFeedback | null;
    operation?: { kind: "import" | "export"; name: string } | null;
  } = {},
) {
  const onCancelSvgOperation = vi.fn();
  const onDismissSvgFeedback = vi.fn();
  const onExportSvg = vi.fn();
  const onSvgExportSettingsChange = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <PropertiesPanel
          arrangement={null}
          booleanOperationEditable={false}
          canDelete
          node={undefined}
          onArrange={vi.fn()}
          onBooleanOperationChange={vi.fn()}
          onCancelSvgOperation={onCancelSvgOperation}
          onDelete={vi.fn()}
          onDismissSvgFeedback={onDismissSvgFeedback}
          onDuplicate={vi.fn()}
          onExportSvg={onExportSvg}
          onReplaceImage={vi.fn()}
          onSelectBooleanParent={vi.fn()}
          onSvgExportSettingsChange={onSvgExportSettingsChange}
          onUpdate={vi.fn()}
          selectionCount={2}
          svgExportSettings={{ includeLayerIds: false, padding: 0 }}
          svgFeedback={options.feedback ?? null}
          svgOperation={options.operation ?? null}
        />
      </I18nProvider>
    </TooltipProvider>,
  );
  return {
    onCancelSvgOperation,
    onDismissSvgFeedback,
    onExportSvg,
    onSvgExportSettingsChange,
  };
}

describe("PropertiesPanel SVG workflow", () => {
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
