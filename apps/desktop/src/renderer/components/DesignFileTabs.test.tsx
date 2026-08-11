import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { workspaceFileKey, type WorkspaceSnapshot } from "../workspace-runtime";
import { DesignFileTabs } from "./DesignFileTabs";

const files = [
  { projectId: "project_a", designFileId: "design_mobile", name: "Mobile UI" },
  { projectId: "project_b", designFileId: "design_web", name: "Website" },
  { projectId: "project_a", designFileId: "design_brand", name: "Brand" },
] as const;

function Tabs({
  onActivate,
  onRename = () => Promise.resolve(true),
  canRename = () => true,
}: {
  onActivate: (projectId: string, designFileId: string) => void;
  onRename?: (
    projectId: string,
    designFileId: string,
    name: string,
  ) => Promise<boolean>;
  canRename?: (projectId: string, designFileId: string) => boolean;
}) {
  const [activeFileKey, setActiveFileKey] = useState(
    workspaceFileKey(files[0].projectId, files[0].designFileId),
  );
  const [names, setNames] = useState(files.map(({ name }) => name as string));
  const openFileKeys = files.map((file) =>
    workspaceFileKey(file.projectId, file.designFileId),
  );
  const records = Object.fromEntries(
    files.map((file, index) => {
      const key = openFileKeys[index];
      if (!key) throw new Error("Design file key is missing");
      return [
        key,
        {
          ...file,
          name: names[index] ?? file.name,
          key,
          documentId: `document_${index}`,
          activePageId: `page_${index}`,
          retainedByRunIds: [],
        },
      ];
    }),
  );
  const active = records[activeFileKey];
  if (!active) throw new Error("Active design file is missing");
  const snapshot: WorkspaceSnapshot = {
    version: 1,
    activeFileKey,
    activeProjectId: active.projectId,
    activeDesignFileId: active.designFileId,
    openFileKeys,
    files: records,
  };

  return (
    <DesignFileTabs
      canRename={canRename}
      onActivate={(projectId, designFileId) => {
        onActivate(projectId, designFileId);
        setActiveFileKey(workspaceFileKey(projectId, designFileId));
      }}
      onRename={async (projectId, designFileId, name) => {
        const renamed = await onRename(projectId, designFileId, name);
        if (renamed) {
          const index = files.findIndex(
            (file) =>
              file.projectId === projectId &&
              file.designFileId === designFileId,
          );
          if (index >= 0) {
            setNames((current) =>
              current.map((currentName, currentIndex) =>
                currentIndex === index ? name : currentName,
              ),
            );
          }
        }
        return renamed;
      }}
      snapshot={snapshot}
    />
  );
}

describe("DesignFileTabs", () => {
  it("moves focus and activates composite file identities with arrow keys", () => {
    const onActivate = vi.fn();
    render(<Tabs onActivate={onActivate} />);
    const tabs = screen.getAllByRole("tab");
    const first = tabs[0];
    const second = tabs[1];
    const last = tabs[2];
    if (!first || !second || !last) throw new Error("Design tabs are missing");

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onActivate).toHaveBeenLastCalledWith("project_b", "design_web");
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(second, { key: "End" });
    expect(onActivate).toHaveBeenLastCalledWith("project_a", "design_brand");
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: "Home" });
    expect(onActivate).toHaveBeenLastCalledWith("project_a", "design_mobile");
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(onActivate).toHaveBeenLastCalledWith("project_a", "design_brand");
    expect(last).toHaveFocus();
  });

  it("renames by stable composite identity and restores tab focus on Enter", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(true);
    render(<Tabs onActivate={vi.fn()} onRename={onRename} />);

    await user.dblClick(screen.getByRole("tab", { name: "Mobile UI" }));
    const input = screen.getByRole("textbox", { name: "Rename Mobile UI" });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "Launch poster{Enter}");

    expect(onRename).toHaveBeenCalledWith(
      "project_a",
      "design_mobile",
      "Launch poster",
    );
    expect(
      await screen.findByRole("tab", { name: "Launch poster" }),
    ).toHaveFocus();
  });

  it("commits a trimmed name on blur without stealing the next tab focus", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(true);
    render(<Tabs onActivate={vi.fn()} onRename={onRename} />);

    await user.dblClick(screen.getByRole("tab", { name: "Mobile UI" }));
    const input = screen.getByRole("textbox", { name: "Rename Mobile UI" });
    await user.clear(input);
    await user.type(input, "  Product UI  ");
    await user.click(screen.getByRole("tab", { name: "Website" }));

    expect(onRename).toHaveBeenCalledWith(
      "project_a",
      "design_mobile",
      "Product UI",
    );
    expect(
      await screen.findByRole("tab", { name: "Product UI" }),
    ).toBeVisible();
    expect(screen.getByRole("tab", { name: "Website" })).toHaveFocus();
  });

  it("cancels with Escape and rejects an empty name without leaving edit mode", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(true);
    render(<Tabs onActivate={vi.fn()} onRename={onRename} />);

    const mobile = screen.getByRole("tab", { name: "Mobile UI" });
    mobile.focus();
    await user.keyboard("{F2}");
    let input = screen.getByRole("textbox", { name: "Rename Mobile UI" });
    await user.clear(input);
    await user.keyboard("{Enter}");
    input = screen.getByRole("textbox", { name: "Rename Mobile UI" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a file name using 1 to 256 characters.",
    );
    expect(onRename).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("tab", { name: "Mobile UI" })).toHaveFocus();
  });

  it("keeps the editor open for retry when persistence fails", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(false);
    render(<Tabs onActivate={vi.fn()} onRename={onRename} />);

    await user.dblClick(screen.getByRole("tab", { name: "Mobile UI" }));
    const input = screen.getByRole("textbox", { name: "Rename Mobile UI" });
    await user.clear(input);
    await user.type(input, "Retry name{Enter}");

    expect(onRename).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("textbox", { name: "Rename Mobile UI" }),
    ).toHaveFocus();
  });

  it("exposes a non-interactive pending state until persistence completes", async () => {
    const user = userEvent.setup();
    let resolveRename: ((renamed: boolean) => void) | undefined;
    const onRename = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRename = resolve;
        }),
    );
    render(<Tabs onActivate={vi.fn()} onRename={onRename} />);

    await user.dblClick(screen.getByRole("tab", { name: "Mobile UI" }));
    const input = screen.getByRole("textbox", { name: "Rename Mobile UI" });
    await user.clear(input);
    await user.type(input, "Saved design{Enter}");

    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("aria-busy", "true");
    expect(resolveRename).toBeTypeOf("function");

    act(() => resolveRename?.(true));
    expect(
      await screen.findByRole("tab", { name: "Saved design" }),
    ).toHaveFocus();
  });

  it("does not offer persistent rename for non-Project files", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(true);
    render(
      <Tabs canRename={() => false} onActivate={vi.fn()} onRename={onRename} />,
    );

    const mobile = screen.getByRole("tab", { name: "Mobile UI" });
    await user.dblClick(mobile);
    mobile.focus();
    await user.keyboard("{F2}");

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });
});
