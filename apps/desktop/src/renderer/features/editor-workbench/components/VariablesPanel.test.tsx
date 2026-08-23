import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { VariablesPanel, type VariablesPanelActions } from "./VariablesPanel";

describe("Variables workbench", () => {
  it("manages collection selection, Page modes, values, metadata, and creation by keyboard", async () => {
    const user = userEvent.setup();
    const document = fixture();
    const actions = actionSpies();
    render(
      <I18nProvider initialLocale="en">
        <VariablesPanel
          actions={actions}
          activePageId="page_welcome"
          document={document}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "id",
      "sidebar-variables",
    );
    expect(screen.getByRole("option", { name: /Theme/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.selectOptions(screen.getByLabelText("Page mode"), "dark");
    expect(actions.setExplicitMode).toHaveBeenCalledWith(
      { kind: "page", id: "page_welcome" },
      "theme",
      "dark",
    );

    const variableName = screen.getByRole("textbox", { name: "Variable name" });
    await user.clear(variableName);
    await user.type(variableName, "Color/Foreground");
    fireEvent.blur(variableName);
    expect(actions.updateVariable).toHaveBeenCalledWith(
      expect.objectContaining({ id: "foreground", name: "Color/Foreground" }),
    );

    const newName = screen.getByRole("textbox", {
      name: "New collection or variable name",
    });
    await user.type(newName, "Content/Body{Enter}");
    expect(actions.createVariable).toHaveBeenCalledWith(
      "theme",
      "Content/Body",
      "COLOR",
    );
  });
});

function fixture() {
  const document = structuredClone(createWelcomeDocument());
  document.variableCollectionOrder = ["theme"];
  document.variableCollectionsById.theme = {
    id: "theme",
    key: "theme-key",
    name: "Theme",
    hiddenFromPublishing: false,
    modes: [
      { modeId: "light", name: "Light" },
      { modeId: "dark", name: "Dark" },
    ],
    variableIds: ["foreground"],
    defaultModeId: "light",
    extensions: {},
  };
  document.variablesById.foreground = {
    id: "foreground",
    key: "foreground-key",
    name: "Foreground",
    description: "Primary text",
    hiddenFromPublishing: false,
    variableCollectionId: "theme",
    resolvedType: "COLOR",
    valuesByMode: {
      light: { r: 0.1, g: 0.1, b: 0.1 },
      dark: { r: 1, g: 1, b: 1 },
    },
    scopes: ["TEXT_FILL"],
    codeSyntax: { WEB: "--foreground" },
    extensions: {},
  };
  return document;
}

function actionSpies(): VariablesPanelActions {
  return {
    createCollection: vi.fn(() => true),
    updateCollection: vi.fn(() => true),
    moveCollection: vi.fn(() => true),
    deleteCollection: vi.fn(() => true),
    addMode: vi.fn(() => true),
    removeMode: vi.fn(() => true),
    createVariable: vi.fn(() => true),
    updateVariable: vi.fn(() => true),
    deleteVariable: vi.fn(() => true),
    setBinding: vi.fn(() => true),
    setExplicitMode: vi.fn(() => true),
  };
}
