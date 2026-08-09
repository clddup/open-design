import type { DesignDocument } from "@opendesign/design-contracts";
import { createEmptyDesignDocument } from "@opendesign/editor-runtime";
import type { DesignFileDescriptor } from "@opendesign/workspace-contracts";

export interface StarterProjectFile {
  descriptor: DesignFileDescriptor;
  document: DesignDocument;
}

export function createStarterProjectFiles(
  projectId: string,
  now = new Date().toISOString(),
): StarterProjectFile[] {
  return [
    createStarterFile({
      designFileId: `design_${projectId}_untitled`,
      documentId: `document_${projectId}_untitled`,
      name: "Untitled",
      relativePath: "designs/untitled.opendesign",
      now,
      page: { id: `page_${projectId}_1`, name: "Page 1" },
    }),
  ];
}

function createStarterFile({
  designFileId,
  documentId,
  name,
  relativePath,
  now,
  page,
}: {
  designFileId: string;
  documentId: string;
  name: string;
  relativePath: string;
  now: string;
  page: { id: string; name: string };
}): StarterProjectFile {
  const document = structuredClone(
    createEmptyDesignDocument(documentId, page.id),
  );
  document.pagesById[page.id] = {
    ...document.pagesById[page.id],
    name: page.name,
  };
  return {
    descriptor: {
      designFileId,
      documentId,
      name,
      relativePath,
      createdAt: now,
      updatedAt: now,
      lifecycle: "active",
    },
    document,
  };
}
