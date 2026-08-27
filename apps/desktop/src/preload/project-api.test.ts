import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { PROJECT_MANIFEST_VERSION } from "@opendesign/workspace-contracts";
import { describe, expect, it, vi } from "vitest";
import { channels } from "@/shared/desktop-api";
import { createProjectApi } from "./project-api";

const now = "2026-08-27T06:00:00.000Z";

function descriptor() {
  return {
    designFileId: "design_brand",
    documentId: "document_welcome",
    name: "Brand System",
    relativePath: "designs/brand-system.opendesign",
    createdAt: now,
    updatedAt: now,
    lifecycle: "active" as const,
  };
}

function manifest(projectId = "project_acme") {
  return {
    manifestVersion: PROJECT_MANIFEST_VERSION,
    projectId,
    name: "Acme Design",
    createdAt: now,
    updatedAt: now,
    lifecycle: "active" as const,
    designFiles: [descriptor()],
  };
}

describe("Project Preload API", () => {
  it("validates a Project request before invoking Main", async () => {
    const invoke = vi.fn().mockResolvedValue(manifest());
    const api = createProjectApi(invoke);

    await expect(
      api.openRecentProject({ projectId: "project_acme" }),
    ).resolves.toEqual(manifest());
    expect(invoke).toHaveBeenCalledWith(channels.openRecentProject, {
      projectId: "project_acme",
    });

    await expect(
      api.openRecentProject({
        projectId: "project_acme",
        rootPath: "/tmp/acme",
      } as never),
    ).rejects.toThrow("/rootPath");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects a recent Project response for another request", async () => {
    const api = createProjectApi(
      vi.fn().mockResolvedValue(manifest("project_other")),
    );

    await expect(
      api.openRecentProject({ projectId: "project_acme" }),
    ).rejects.toThrow("/projectId");
  });

  it("correlates Design File create and save responses", async () => {
    const document = createWelcomeDocument();
    const file = { descriptor: descriptor(), document };
    const invoke = vi.fn().mockResolvedValue(file);
    const api = createProjectApi(invoke);

    await expect(
      api.createProjectDesignFile({
        projectId: "project_acme",
        descriptor: descriptor(),
        document,
      }),
    ).resolves.toEqual(file);

    invoke.mockResolvedValueOnce({
      ...file,
      document: { ...document, revision: document.revision + 1 },
    });
    await expect(
      api.saveProjectDesignFile({
        projectId: "project_acme",
        designFileId: descriptor().designFileId,
        document,
      }),
    ).rejects.toThrow("/document/revision");
  });

  it("rejects duplicate Project list responses", async () => {
    const api = createProjectApi(
      vi.fn().mockResolvedValue([manifest(), manifest()]),
    );
    await expect(api.listOpenProjects()).rejects.toThrow("/1/projectId");
  });
});
