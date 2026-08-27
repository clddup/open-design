import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { PROJECT_MANIFEST_VERSION } from "@opendesign/workspace-contracts";
import { describe, expect, it } from "vitest";
import {
  CreateProjectDesignFileRequestContract,
  ProjectDesignFileContract,
  ProjectIdentityRequestContract,
  ProjectManifestListContract,
  ProjectManifestResponseContract,
  RecentProjectListContract,
  RenameProjectDesignFileRequestContract,
  RenameProjectDesignFileResultContract,
  SaveProjectDesignFileRequestContract,
} from "./project-file-contract";

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

describe("Project and Design File IPC contracts", () => {
  it("uses one exact Project identity request for create, open, remove, and reveal", () => {
    expect(
      ProjectIdentityRequestContract.parse({ projectId: "project_acme" }).ok,
    ).toBe(true);
    expect(
      ProjectIdentityRequestContract.issues({
        projectId: "project_acme",
        rootPath: "/tmp/acme",
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "project.identity_request_invalid",
        path: "/rootPath",
      }),
    );
  });

  it("composes canonical descriptor and document contracts for create", () => {
    const document = createWelcomeDocument();
    const request = {
      projectId: "project_acme",
      descriptor: descriptor(),
      document,
    };
    expect(CreateProjectDesignFileRequestContract.parse(request).ok).toBe(true);
    expect(
      CreateProjectDesignFileRequestContract.issues({
        ...request,
        descriptor: { ...request.descriptor, documentId: "document_other" },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "project.design_file_document_mismatch",
        path: "/document/documentId",
        expected: "document_other",
        actual: document.documentId,
      }),
    );
  });

  it("binds create and save responses to their exact requests", () => {
    const document = createWelcomeDocument();
    const createRequest = {
      projectId: "project_acme",
      descriptor: descriptor(),
      document,
    };
    const file = { descriptor: descriptor(), document };
    expect(
      ProjectDesignFileContract.parse(file, {
        kind: "create",
        request: createRequest,
      }).ok,
    ).toBe(true);
    expect(
      ProjectDesignFileContract.issues(
        {
          ...file,
          descriptor: { ...file.descriptor, designFileId: "design_other" },
        },
        { kind: "create", request: createRequest },
      ),
    ).toContainEqual(
      expect.objectContaining({
        code: "project.response_mismatch",
        path: "/descriptor/designFileId",
      }),
    );

    const saveRequest = {
      projectId: "project_acme",
      designFileId: file.descriptor.designFileId,
      document,
    };
    expect(SaveProjectDesignFileRequestContract.parse(saveRequest).ok).toBe(
      true,
    );
    expect(
      ProjectDesignFileContract.issues(
        { ...file, document: { ...document, revision: document.revision + 1 } },
        { kind: "save", request: saveRequest },
      ),
    ).toContainEqual(
      expect.objectContaining({
        code: "project.response_mismatch",
        path: "/document/revision",
        expected: document.revision,
        actual: document.revision + 1,
      }),
    );
  });

  it("validates trimmed rename requests and correlates rename responses", () => {
    const request = {
      projectId: "project_acme",
      designFileId: "design_brand",
      name: "Brand Platform",
    };
    expect(RenameProjectDesignFileRequestContract.parse(request).ok).toBe(true);
    expect(
      RenameProjectDesignFileRequestContract.issues({
        ...request,
        name: " Brand Platform ",
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "project.design_file_name_not_trimmed",
        path: "/name",
      }),
    );
    expect(
      RenameProjectDesignFileResultContract.issues(
        { ...descriptor(), name: "Wrong name" },
        { kind: "rename", request },
      ),
    ).toContainEqual(
      expect.objectContaining({
        code: "project.response_mismatch",
        path: "/name",
        expected: request.name,
        actual: "Wrong name",
      }),
    );
  });

  it("correlates recent Project responses and rejects duplicate lists", () => {
    expect(
      ProjectManifestResponseContract.issues(manifest("project_other"), {
        kind: "project",
        projectId: "project_acme",
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "project.response_mismatch",
        path: "/projectId",
      }),
    );
    expect(
      ProjectManifestListContract.issues([manifest(), manifest()]),
    ).toContainEqual(
      expect.objectContaining({
        code: "project.list_id_duplicate",
        path: "/1/projectId",
      }),
    );
    expect(
      RecentProjectListContract.issues([
        { projectId: "project_acme", name: "Acme", lastOpenedAt: now },
        { projectId: "project_acme", name: "Acme", lastOpenedAt: now },
      ]),
    ).toContainEqual(
      expect.objectContaining({
        code: "project.list_id_duplicate",
        path: "/1/projectId",
      }),
    );
  });

  it("rejects control characters in all Workspace names", () => {
    expect(
      RecentProjectListContract.issues([
        {
          projectId: "project_acme",
          name: "Acme\nDesign",
          lastOpenedAt: now,
        },
      ]),
    ).toContainEqual(
      expect.objectContaining({
        code: "project.recent_list_invalid",
        path: "/0/name",
      }),
    );
  });
});
