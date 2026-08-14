import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { TooltipProvider } from "@opendesign/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { I18nProvider } from "../i18n";
import type { StyleActions } from "../use-style-actions";
import { LocalStylesPanel } from "./LocalStylesPanel";
import { StyleReferencesSection } from "./properties/StyleReferencesSection";

describe("Local Styles workbench", () => {
  it("creates from the real selected property and manages ordered local styles", async () => {
    const user = userEvent.setup();
    const document = fixture();
    const actions = actionSpies();
    renderUi(
      <LocalStylesPanel
        actions={actions}
        document={document}
        selectedNodeIds={["title_welcome"]}
      />,
    );
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "id",
      "sidebar-styles",
    );
    expect(screen.getAllByText("Brand")).toHaveLength(2);
    await user.type(
      screen.getAllByLabelText("Style name").at(-1)!,
      "Brand/Accent{Enter}",
    );
    expect(actions.createFromNode).toHaveBeenCalledWith(
      "title_welcome",
      "fillStyleId",
      "Brand/Accent",
    );
    await user.click(
      screen.getByRole("button", { name: "Move Brand/Primary down" }),
    );
    expect(actions.moveStyle).toHaveBeenCalledWith("brand", 1);
  });

  it("applies, creates, updates and detaches typed Inspector references", async () => {
    const user = userEvent.setup();
    const document = fixture();
    const actions = actionSpies();
    const node = document.nodesById.title_welcome;
    renderUi(
      <StyleReferencesSection
        actions={actions}
        document={document}
        node={node}
      />,
    );
    await user.selectOptions(
      screen.getAllByLabelText("Apply Paint style")[0],
      "brand",
    );
    expect(actions.setReference).toHaveBeenCalledWith(
      { nodeId: "title_welcome", field: "fillStyleId" },
      "brand",
    );
    await user.click(
      screen.getAllByRole("button", {
        name: "Create style from this property",
      })[0],
    );
    expect(actions.createFromNode).toHaveBeenCalledWith(
      "title_welcome",
      "fillStyleId",
      "Untitled style",
    );
  });
});

function fixture() {
  const document = structuredClone(createWelcomeDocument());
  document.styleOrderByType.PAINT = ["brand", "accent"];
  document.stylesById.brand = paintStyle("brand", "Brand/Primary", "#2563eb");
  document.stylesById.accent = paintStyle("accent", "Brand/Accent", "#db2777");
  return document;
}

function paintStyle(id: string, name: string, color: string) {
  return {
    id,
    key: `${id}-key`,
    name,
    description: "",
    hiddenFromPublishing: false,
    styleType: "PAINT" as const,
    paints: [{ type: "solid" as const, color, opacity: 1 }],
    extensions: {},
  };
}

function actionSpies() {
  return {
    createFromNode: vi.fn(() => true),
    updateStyle: vi.fn(() => true),
    updateFromNode: vi.fn(() => true),
    moveStyle: vi.fn(() => true),
    deleteStyle: vi.fn(() => true),
    setReference: vi.fn(() => true),
  } satisfies StyleActions;
}

function renderUi(children: ReactNode) {
  return render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">{children}</I18nProvider>
    </TooltipProvider>,
  );
}
