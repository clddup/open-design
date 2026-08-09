import { describe, expect, it, vi } from "vitest";
import { RendererDesignToolHost } from "./renderer-design-tool-host";

describe("RendererDesignToolHost", () => {
  it("correlates a Renderer transaction result with its Agent tool call", async () => {
    const send = vi.fn();
    const host = new RendererDesignToolHost(send);
    const result = host.execute(
      {
        toolCallId: "tool_call_1",
        toolName: "opendesign_inspect_document",
        input: {},
      },
      {
        runId: "run_1",
        sessionId: "conversation_1",
        documentId: "document_1",
        revision: 0,
        scope: { kind: "document", selectedNodeIds: [] },
      },
      new AbortController().signal,
    );
    const request = send.mock.calls[0]?.[0] as { requestId: string };

    expect(
      host.resolve({
        requestId: request.requestId,
        ok: true,
        result: { content: { documentId: "document_1", revision: 0 } },
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual({
      content: { documentId: "document_1", revision: 0 },
    });
  });
});
