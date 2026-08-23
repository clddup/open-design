import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { RenameLayersDialog } from "./RenameLayersDialog";

describe("RenameLayersDialog", () => {
  it("previews tokens and submits one rename request", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn(() => ({ ok: true }) as const);
    const onClose = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <RenameLayersDialog
          items={[
            { id: "a", name: "Card" },
            { id: "b", name: "Panel" },
          ]}
          onClose={onClose}
          onRename={onRename}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Rename 0" })).toBeDisabled();
    const renameTo = screen.getByRole("textbox", { name: "Rename to" });
    await user.clear(renameTo);
    await user.type(renameTo, "Layer ");
    await user.click(screen.getByRole("button", { name: "Number ↑" }));
    expect(screen.getByText("Layer 1")).toBeInTheDocument();
    expect(screen.getByText("Layer 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename 2" }));
    expect(onRename).toHaveBeenCalledWith({
      match: "",
      renameTo: "Layer {n}",
      useRegularExpression: false,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps invalid regular-expression requests unapplied", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn(() => ({ ok: true }) as const);
    render(
      <I18nProvider initialLocale="en">
        <RenameLayersDialog
          items={[{ id: "a", name: "Card" }]}
          onClose={vi.fn()}
          onRename={onRename}
        />
      </I18nProvider>,
    );

    await user.type(screen.getByRole("textbox", { name: "Match" }), "(");
    await user.click(
      screen.getByRole("checkbox", { name: "Use regular expression" }),
    );
    expect(
      screen.getByText("Enter a valid regular expression."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename 0" })).toBeDisabled();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("closes through Escape using the shared dialog primitive", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <RenameLayersDialog
          items={[{ id: "a", name: "Card" }]}
          onClose={onClose}
          onRename={() => ({ ok: true })}
        />
      </I18nProvider>,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
