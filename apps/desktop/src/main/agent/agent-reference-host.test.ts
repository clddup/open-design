import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentAttachmentHost } from "./agent-attachment-host";
import { AgentReferenceHost } from "./agent-reference-host";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const context = {
  runId: "run_reference",
  sessionId: "session_reference",
  documentId: "document_reference",
  revision: 0,
  scope: { kind: "document" as const, selectedNodeIds: [] },
};

function request(prompt: string) {
  return {
    type: "run.start" as const,
    runId: context.runId,
    sessionId: context.sessionId,
    prompt,
    documentId: context.documentId,
    revision: 0,
    scope: context.scope,
    modelSelection: { providerId: "test", modelId: "vision" },
  };
}

describe("AgentReferenceHost", () => {
  it("reads only an exact local image path declared by the user", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-reference-"));
    const source = join(root, "reference.png");
    await writeFile(source, png);
    const host = new AgentReferenceHost(
      new AgentAttachmentHost(join(root, "attachments")),
    );
    host.registerRun(request(`Please inspect ${source}`));

    const result = await host.readImage(
      { source },
      context,
      new AbortController().signal,
    );

    expect(result.content).toMatchObject({
      ok: true,
      sourceKind: "local-path",
      attachment: { mimeType: "image/png", byteSize: png.byteLength },
      attachments: [{ mimeType: "image/png" }],
    });
    await expect(
      host.readImage(
        { source: join(root, "other.png") },
        context,
        new AbortController().signal,
      ),
    ).rejects.toThrow("not explicitly referenced");
  });

  it("fetches an explicit image URL without credentials and content-addresses it", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-reference-"));
    const fetch = vi.fn().mockResolvedValue(
      new Response(png, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    const host = new AgentReferenceHost(
      new AgentAttachmentHost(join(root, "attachments")),
      fetch,
    );
    const source = "https://design.example/reference.png";
    host.registerRun(request(`Use ${source} as the visual reference`));

    const result = await host.readImage(
      { source },
      context,
      new AbortController().signal,
    );

    expect(fetch).toHaveBeenCalledWith(
      new URL(source),
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(result.content).toMatchObject({
      sourceKind: "url",
      attachment: { mimeType: "image/png" },
    });
  });
});
