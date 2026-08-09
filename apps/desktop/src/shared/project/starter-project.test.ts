import { isDesignDocument } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { isCreateProjectDesignFileRequest } from "../desktop-api";
import { createStarterProjectFiles } from "./starter-project";

const now = "2026-08-07T12:00:00.000Z";

describe("createStarterProjectFiles", () => {
  it("creates stable, schema-valid design files with unique identities", () => {
    const files = createStarterProjectFiles("project_acme", now);

    expect(files.map(({ descriptor }) => descriptor.name)).toEqual([
      "Untitled",
    ]);
    expect(
      new Set(files.map(({ descriptor }) => descriptor.designFileId)).size,
    ).toBe(files.length);
    expect(
      new Set(files.map(({ descriptor }) => descriptor.documentId)).size,
    ).toBe(files.length);
    expect(
      new Set(files.map(({ descriptor }) => descriptor.relativePath)).size,
    ).toBe(files.length);
    expect(createStarterProjectFiles("project_acme", now)).toEqual(files);

    for (const file of files) {
      expect(file.document.documentId).toBe(file.descriptor.documentId);
      expect(isDesignDocument(file.document)).toBe(true);
      expect(
        isCreateProjectDesignFileRequest({
          projectId: "project_acme",
          descriptor: file.descriptor,
          document: file.document,
        }),
      ).toBe(true);
    }
  });

  it("starts with one neutral empty page and no product-type assumptions", () => {
    const files = createStarterProjectFiles("project_acme", now);

    for (const { document } of files) {
      expect(document.pageOrder).toHaveLength(1);
      const pages = document.pageOrder.map((pageId) =>
        expectPage(document.pagesById[pageId]),
      );
      expect(pages[0]).toMatchObject({ name: "Page 1", rootNodeIds: [] });
      expect(document.nodesById).toEqual({});
      expect(
        [files[0]?.descriptor.name, ...pages.map(({ name }) => name)].join(" "),
      ).not.toMatch(/website|mobile|desktop|auth|component/i);
    }
  });
});

function expectPage<T>(page: T | undefined): T {
  expect(page).toBeDefined();
  if (!page) throw new Error("Starter page is missing");
  return page;
}
