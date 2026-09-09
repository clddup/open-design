import type { DesktopApi } from "@/shared/desktop-api";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "../../state/workspace-runtime";
import {
  confirmStandaloneChanges,
  dirtyStandaloneFiles,
  saveStandaloneFile,
} from "./standalone-unsaved-changes";

function setup() {
  const workspace = new WorkspaceRuntime({
    projectId: "project_local",
    designFileId: "draft",
    name: "Draft.opendesign",
    document: createWelcomeDocument(),
  });
  const runtime = workspace.getActiveRuntime();
  const change = () => {
    const document = runtime.getSnapshot().document;
    const result = runtime.apply({
      transactionId: `change_${document.revision}`,
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: { type: "user", id: "local" },
      label: "Edit",
      commands: [
        {
          commandId: "rename",
          type: "update_properties",
          nodeId: "frame_welcome",
          name: `Edited ${document.revision}`,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
  };
  change();
  const desktop = {
    confirmUnsavedDesign: vi
      .fn<() => Promise<"save" | "discard" | "cancel">>()
      .mockResolvedValue("save"),
    saveDesignFile: vi
      .fn<DesktopApi["saveDesignFile"]>()
      .mockResolvedValue({ name: "Draft.opendesign" }),
  };
  return { workspace, runtime, change, desktop };
}

describe("standalone unsaved changes", () => {
  it("saves dirty standalone files before permitting close or replacement", async () => {
    const { workspace, runtime, desktop } = setup();
    expect(await confirmStandaloneChanges(workspace, desktop)).toBe(true);
    expect(desktop.saveDesignFile).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot().state.dirty).toBe(false);
  });

  it("cancel and save-dialog cancellation preserve the document", async () => {
    const { workspace, runtime, desktop } = setup();
    desktop.confirmUnsavedDesign.mockResolvedValueOnce("cancel");
    expect(await confirmStandaloneChanges(workspace, desktop)).toBe(false);
    expect(desktop.saveDesignFile).not.toHaveBeenCalled();
    desktop.saveDesignFile.mockResolvedValueOnce(null);
    expect(await confirmStandaloneChanges(workspace, desktop)).toBe(false);
    expect(runtime.getSnapshot().state.dirty).toBe(true);
  });

  it("failed saves keep dirty state and prevent the destructive action", async () => {
    const { workspace, runtime, desktop } = setup();
    desktop.saveDesignFile.mockRejectedValueOnce(new Error("disk full"));
    await expect(confirmStandaloneChanges(workspace, desktop)).rejects.toThrow(
      "disk full",
    );
    expect(runtime.getSnapshot().state.dirty).toBe(true);
  });

  it("discard does not forge a saved checkpoint and is revision scoped", async () => {
    const { workspace, runtime, desktop, change } = setup();
    desktop.confirmUnsavedDesign
      .mockImplementationOnce(() => {
        change();
        return Promise.resolve("discard");
      })
      .mockResolvedValueOnce("cancel");
    expect(await confirmStandaloneChanges(workspace, desktop)).toBe(false);
    expect(desktop.confirmUnsavedDesign).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot().state.dirty).toBe(true);
    expect(desktop.saveDesignFile).not.toHaveBeenCalled();
  });

  it("drains edits made during saving before allowing close", async () => {
    const { workspace, runtime, desktop, change } = setup();
    desktop.saveDesignFile.mockImplementationOnce(() => {
      change();
      return Promise.resolve({ name: "Draft.opendesign" });
    });
    expect(await confirmStandaloneChanges(workspace, desktop)).toBe(true);
    expect(desktop.saveDesignFile).toHaveBeenCalledTimes(2);
    expect(desktop.confirmUnsavedDesign).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot().state.dirty).toBe(false);
  });

  it("serializes a pending manual save with shutdown and snapshots inside the queue", async () => {
    const { workspace, runtime, desktop, change } = setup();
    let finishFirst!: (value: { name: string }) => void;
    desktop.saveDesignFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const manual = saveStandaloneFile(
      workspace,
      dirtyStandaloneFiles(workspace)[0],
      desktop.saveDesignFile,
    );
    await vi.waitFor(() =>
      expect(desktop.saveDesignFile).toHaveBeenCalledOnce(),
    );
    change();
    const closing = confirmStandaloneChanges(workspace, desktop);
    await vi.waitFor(() =>
      expect(desktop.confirmUnsavedDesign).toHaveBeenCalledOnce(),
    );
    expect(desktop.saveDesignFile).toHaveBeenCalledOnce();
    finishFirst({ name: "Draft.opendesign" });
    expect(await manual).toBe(true);
    expect(await closing).toBe(true);
    expect(
      desktop.saveDesignFile.mock.calls.map(([request]) => {
        const document: unknown = JSON.parse(request.contents);
        return document;
      }),
    ).toEqual([
      expect.objectContaining({ revision: 1 }),
      expect.objectContaining({ revision: 2 }),
    ]);
    expect(runtime.getSnapshot().state.dirty).toBe(false);
    expect(runtime.getSnapshot().state.checkpointRevision).toBe(2);
  });

  it("manual save never checkpoints edits created while disk work is pending", async () => {
    const { workspace, runtime, desktop, change } = setup();
    desktop.saveDesignFile.mockImplementationOnce(() => {
      change();
      return Promise.resolve({ name: "Draft.opendesign" });
    });
    expect(
      await saveStandaloneFile(
        workspace,
        dirtyStandaloneFiles(workspace)[0],
        desktop.saveDesignFile,
      ),
    ).toBe(true);
    expect(runtime.getSnapshot().state.dirty).toBe(true);
  });
});
