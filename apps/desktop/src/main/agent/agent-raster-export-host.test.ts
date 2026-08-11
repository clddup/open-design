import type { TrustedToolContext } from "@opendesign/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import { EXPORT_RASTER_TOOL_NAME } from "../../shared/design-agent-tools.js";
import { AgentRasterExportHost } from "./agent-raster-export-host.js";

const input = {
  pageId: "page_1",
  rootNodeId: "frame_1",
  suggestedName: "Poster",
  format: "png",
  size: { mode: "scale", value: 2 },
  background: { mode: "transparent" },
  resampling: "smooth",
} as const;
const call = { toolCallId: "call_1", toolName: EXPORT_RASTER_TOOL_NAME, input };
const context = {
  runId: "run_1",
  sessionId: "session_1",
  documentId: "document_1",
  revision: 7,
  scope: { kind: "page", pageId: "page_1" },
  mutationTarget: { kind: "page", pageId: "page_1" },
} as TrustedToolContext;
const prepared = {
  kind: "raster-export-preparation",
  version: 1,
  suggestedName: "Poster",
  format: "png",
  mimeType: "image/png",
  bytes: new Uint8Array([1, 2, 3]),
  width: 1600,
  height: 1200,
  revision: 7,
  rootNodeId: "frame_1",
} as const;

describe("AgentRasterExportHost", () => {
  it("validates Renderer output, saves in Main, and returns no bytes or path", async () => {
    const renderer = {
      execute: vi
        .fn()
        .mockResolvedValue({ observedRevision: 7, content: prepared }),
    };
    const files = {
      saveRasterFile: vi
        .fn()
        .mockResolvedValue({ name: "Poster.png", byteSize: 3 }),
    };
    const result = await new AgentRasterExportHost(renderer, files).execute(
      call,
      context,
      new AbortController().signal,
    );

    expect(files.saveRasterFile).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: "Poster",
        format: "png",
        bytes: prepared.bytes,
      }),
      expect.any(AbortSignal),
    );
    expect(result.content).toEqual({
      ok: true,
      format: "png",
      saved: true,
      name: "Poster.png",
      width: 1600,
      height: 1200,
      byteSize: 3,
      revision: 7,
      rootNodeId: "frame_1",
    });
    expect(result.content).not.toHaveProperty("bytes");
    expect(result.content).not.toHaveProperty("path");
  });

  it("treats native cancellation as a successful unsaved delivery result", async () => {
    const host = new AgentRasterExportHost(
      {
        execute: vi
          .fn()
          .mockResolvedValue({ observedRevision: 7, content: prepared }),
      },
      { saveRasterFile: vi.fn().mockResolvedValue(null) },
    );
    await expect(
      host.execute(call, context, new AbortController().signal),
    ).resolves.toMatchObject({ content: { ok: true, saved: false } });
  });

  it("rejects stale or forged Renderer output before saving", async () => {
    const saveRasterFile = vi.fn();
    const stale = new AgentRasterExportHost(
      {
        execute: vi.fn().mockResolvedValue({
          observedRevision: 8,
          content: { ...prepared, revision: 8 },
        }),
      },
      { saveRasterFile },
    );
    await expect(
      stale.execute(call, context, new AbortController().signal),
    ).rejects.toThrow("revision conflict");

    const forged = new AgentRasterExportHost(
      {
        execute: vi.fn().mockResolvedValue({
          observedRevision: 7,
          content: { ...prepared, rootNodeId: "other" },
        }),
      },
      { saveRasterFile },
    );
    await expect(
      forged.execute(call, context, new AbortController().signal),
    ).rejects.toThrow("mismatched raster export metadata");
    expect(saveRasterFile).not.toHaveBeenCalled();
  });
});
