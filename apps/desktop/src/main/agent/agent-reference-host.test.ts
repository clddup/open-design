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
  mutationTarget: { kind: "document" as const },
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
    mutationTarget: context.mutationTarget,
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

  it("keeps the timeout active while the remote response body is streaming", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-reference-"));
    const cancel = vi.fn();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(png);
          },
          cancel,
        }),
        { status: 200, headers: { "content-type": "image/png" } },
      ),
    );
    const host = new AgentReferenceHost(
      new AgentAttachmentHost(join(root, "attachments")),
      fetch,
      10,
    );
    const source = "https://design.example/slow.png";
    host.registerRun(request(`Inspect ${source}`));
    vi.useFakeTimers();
    try {
      const pending = host.readImage(
        { source },
        context,
        new AbortController().signal,
      );
      const rejected = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
      });

      await vi.advanceTimersByTimeAsync(11);

      await rejected;
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a remote body that streams beyond the 16 MB limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-reference-"));
    const cancel = vi.fn();
    const chunk = new Uint8Array(8 * 1024 * 1024);
    chunk.set(png);
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(chunk);
            controller.enqueue(chunk);
            controller.enqueue(new Uint8Array([0]));
          },
          cancel,
        }),
        { status: 200, headers: { "content-type": "image/png" } },
      ),
    );
    const host = new AgentReferenceHost(
      new AgentAttachmentHost(join(root, "attachments")),
      fetch,
    );
    const source = "https://design.example/oversized.png";
    host.registerRun(request(`Inspect ${source}`));

    await expect(
      host.readImage({ source }, context, new AbortController().signal),
    ).rejects.toThrow("Remote image exceeds the 16 MB limit");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels the remote body when the user stops the run", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-reference-"));
    const cancel = vi.fn();
    let markBodyReadStarted: (() => void) | undefined;
    const bodyReadStarted = new Promise<void>((resolve) => {
      markBodyReadStarted = resolve;
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(png);
          },
          pull() {
            markBodyReadStarted?.();
          },
          cancel,
        }),
        { status: 200, headers: { "content-type": "image/png" } },
      ),
    );
    const host = new AgentReferenceHost(
      new AgentAttachmentHost(join(root, "attachments")),
      fetch,
    );
    const source = "https://design.example/cancelled.png";
    const controller = new AbortController();
    host.registerRun(request(`Inspect ${source}`));

    const pending = host.readImage({ source }, context, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await bodyReadStarted;
    controller.abort();

    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });
});
