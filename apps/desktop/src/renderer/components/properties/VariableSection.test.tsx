import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { VariableSection } from "./VariableSection";

describe("Variable Inspector section", () => {
  it("sorts compatible picker candidates, exposes mode override, and emits stable targets", async () => {
    const user = userEvent.setup();
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
      variableIds: ["copy", "opacity"],
      defaultModeId: "light",
      extensions: {},
    };
    document.variablesById.copy = {
      id: "copy",
      key: "copy-key",
      name: "Content/Title",
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "theme",
      resolvedType: "STRING",
      valuesByMode: { light: "Light title", dark: "Dark title" },
      scopes: ["TEXT_CONTENT"],
      codeSyntax: {},
      extensions: {},
    };
    document.variablesById.opacity = {
      id: "opacity",
      key: "opacity-key",
      name: "Opacity/Muted",
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "theme",
      resolvedType: "FLOAT",
      valuesByMode: { light: 0.8, dark: 0.6 },
      scopes: ["OPACITY"],
      codeSyntax: {},
      extensions: {},
    };
    const node = document.nodesById.title_welcome;
    if (!node) throw new Error("Welcome title is missing");
    const onSetBinding = vi.fn();
    const onSetExplicitMode = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <VariableSection
          activePageId="page_welcome"
          document={document}
          node={node}
          onSetBinding={onSetBinding}
          onSetExplicitMode={onSetExplicitMode}
        />
      </I18nProvider>,
    );

    await user.selectOptions(screen.getByLabelText("Theme Mode"), "dark");
    expect(onSetExplicitMode).toHaveBeenCalledWith("theme", "dark");
    await user.selectOptions(
      screen.getByLabelText("Text content variable"),
      "copy",
    );
    expect(onSetBinding).toHaveBeenCalledWith(
      { kind: "node", nodeId: "title_welcome", field: "characters" },
      "copy",
    );
    expect(
      screen
        .getByLabelText("Opacity variable")
        .querySelector('option[value="copy"]'),
    ).toBeNull();
  });
});
