import {
  createWelcomeDocument,
  EditorRuntime,
  planCreateComponent,
} from "@opendesign/editor-runtime";
import type { DesignDocument } from "@opendesign/design-contracts";
import type { ProjectDesignFile } from "@/shared/desktop-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectAutosaveCoordinator } from "./project-autosave";

describe("ProjectAutosaveCoordinator", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces Project document changes and checkpoints the saved revision", async () => {
    vi.useFakeTimers();
    const runtime = new EditorRuntime(createWelcomeDocument());
    const save: AutosaveFunction = vi.fn(
      (
        _projectId: string,
        _designFileId: string,
        document: DesignDocument,
      ): Promise<ProjectDesignFile> =>
        Promise.resolve({
          descriptor: descriptor(document.revision),
          document,
        }),
    );
    const coordinator = new ProjectAutosaveCoordinator({ delayMs: 500, save });
    coordinator.track(target(runtime));

    renameFrame(runtime, "Autosaved frame");
    expect(runtime.getSnapshot().state.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledWith(
      "project_acme",
      "design_mobile",
      expect.objectContaining({ revision: 1 }),
    );
    expect(runtime.getSnapshot().state.dirty).toBe(false);
    expect(runtime.getSnapshot().state.checkpointRevision).toBe(1);
    coordinator.dispose();
  });

  it("autosaves component definitions through the same document checkpoint", async () => {
    vi.useFakeTimers();
    const runtime = new EditorRuntime(createWelcomeDocument());
    const save: AutosaveFunction = vi.fn(
      (_projectId: string, _designFileId: string, document: DesignDocument) =>
        Promise.resolve(savedFile(document)),
    );
    const coordinator = new ProjectAutosaveCoordinator({ delayMs: 50, save });
    coordinator.track(target(runtime));
    const plan = planCreateComponent(runtime.getSnapshot().document, {
      componentId: "component_features",
      nodeId: "feature_group",
      name: "Features",
      commandPrefix: "component-features",
    });
    if (!plan.ok) throw new Error(plan.message);
    const current = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "component-features",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "tester" },
        label: "Create component",
        commands: plan.commands,
      }).ok,
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(1);
    const savedDocument = vi.mocked(save).mock.calls[0]?.[2];
    expect(savedDocument?.componentsById.component_features).toMatchObject({
      rootNodeId: "feature_group",
    });
    coordinator.dispose();
  });

  it("serializes a newer revision produced while a save is in flight", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const first = deferred<ProjectDesignFile>();
    const save = vi
      .fn<AutosaveFunction>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation((_projectId, _designFileId, document) =>
        Promise.resolve(savedFile(document)),
      );
    const coordinator = new ProjectAutosaveCoordinator({ save });
    coordinator.track(target(runtime));

    renameFrame(runtime, "First revision");
    const flushing = coordinator.flushDocument("document_welcome");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    renameFrame(runtime, "Second revision");
    first.resolve(savedFile(save.mock.calls[0]?.[2]));
    await flushing;

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[2]?.revision).toBe(2);
    expect(runtime.getSnapshot().state.dirty).toBe(false);
    expect(runtime.getSnapshot().state.checkpointRevision).toBe(2);
    coordinator.dispose();
  });

  it("keeps the document dirty and reports a persistence failure", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const onError = vi.fn();
    const coordinator = new ProjectAutosaveCoordinator({
      onError,
      save: () => Promise.reject(new Error("Disk is read-only")),
    });
    coordinator.track(target(runtime));
    renameFrame(runtime, "Unsaved frame");

    await expect(coordinator.flushDocument("document_welcome")).rejects.toThrow(
      "Disk is read-only",
    );
    expect(runtime.getSnapshot().state.dirty).toBe(true);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "document_welcome" }),
      expect.any(Error),
    );
    coordinator.dispose();
  });

  it("rejects a mismatched persistence response without checkpointing", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const onError = vi.fn();
    const coordinator = new ProjectAutosaveCoordinator({
      onError,
      save: (_projectId, _designFileId, document) =>
        Promise.resolve({
          descriptor: {
            ...descriptor(document.revision),
            documentId: "document_other",
          },
          document,
        }),
    });
    coordinator.track(target(runtime));
    renameFrame(runtime, "Untrusted save response");

    await expect(coordinator.flushDocument("document_welcome")).rejects.toThrow(
      "Autosave response does not match design_mobile revision 1",
    );
    expect(runtime.getSnapshot().state.dirty).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it("rejects a runtime bound to a different document identity", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const coordinator = new ProjectAutosaveCoordinator({
      save: (_projectId, _designFileId, document) =>
        Promise.resolve(savedFile(document)),
    });

    expect(() =>
      coordinator.track({
        ...target(runtime),
        documentId: "document_other",
      }),
    ).toThrow(
      "Autosave runtime document does not match target: document_other",
    );
    coordinator.dispose();
  });
});

function target(runtime: EditorRuntime) {
  return {
    projectId: "project_acme",
    designFileId: "design_mobile",
    documentId: "document_welcome",
    runtime,
  };
}

function descriptor(revision: number) {
  return {
    designFileId: "design_mobile",
    documentId: "document_welcome",
    name: "Mobile UI",
    relativePath: "designs/mobile.opendesign",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: `2026-08-11T00:00:0${revision}.000Z`,
    lifecycle: "active" as const,
  };
}

function savedFile(document = createWelcomeDocument()) {
  return { descriptor: descriptor(document.revision), document };
}

function renameFrame(runtime: EditorRuntime, name: string): void {
  const current = runtime.getSnapshot().document;
  const result = runtime.apply({
    transactionId: `rename_${current.revision + 1}`,
    documentId: current.documentId,
    baseRevision: current.revision,
    actor: { type: "user", id: "tester" },
    label: "Rename frame",
    commands: [
      {
        commandId: `rename_frame_${current.revision + 1}`,
        type: "update_properties",
        nodeId: "frame_welcome",
        name,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

type AutosaveFunction = (
  projectId: string,
  designFileId: string,
  document: DesignDocument,
) => Promise<ProjectDesignFile>;
