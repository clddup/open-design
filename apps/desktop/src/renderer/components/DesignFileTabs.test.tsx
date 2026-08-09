import { fireEvent, render, screen } from "@testing-library/react";
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
}: {
  onActivate: (projectId: string, designFileId: string) => void;
}) {
  const [activeFileKey, setActiveFileKey] = useState(
    workspaceFileKey(files[0].projectId, files[0].designFileId),
  );
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
      onActivate={(projectId, designFileId) => {
        onActivate(projectId, designFileId);
        setActiveFileKey(workspaceFileKey(projectId, designFileId));
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
});
