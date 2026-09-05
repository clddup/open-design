import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type {
  ToolExecutionEvent,
  TrustedToolFailure,
} from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import { OpenDesignPiToolAdapter } from "./pi-tool-adapter.js";
import type { AgentToolDefinition } from "./runtime-ports.js";
import { request, tool } from "./pi-runtime-test-support.js";

const material: AgentToolDefinition = {
  ...tool,
  name: "opendesign_material_probe",
  risk: "design_write",
};
const pages: AgentToolDefinition = {
  ...tool,
  name: "opendesign_manage_pages",
  risk: "design_write",
};
const capture: AgentToolDefinition = {
  ...tool,
  name: "opendesign_capture_canvas",
};
const superseded = { deliveryDisposition: "superseded" };

function writeFailure(id: string): TrustedToolFailure {
  return {
    code: "design.invalid",
    message: `Invalid material ${id}`,
    retryable: false,
    recoverable: true,
    details: {
      kind: "design-transaction",
      fingerprint: id,
      issues: [{ path: `/nodesById/${id}`, message: "Invalid node" }],
      recovery: {
        action: "inspect-and-revise",
        toolName: "opendesign_inspect_document",
        required: true,
      },
    },
  };
}

function createAdapter(content: unknown = superseded) {
  return new OpenDesignPiToolAdapter({
    request,
    definitions: [material, pages, capture],
    maxToolCalls: 16,
    lifecycle: {
      approvalRequested: () => Promise.resolve(),
      approvalResolved: () => Promise.resolve(),
    },
    toolExecutor: {
      async *execute(call): AsyncIterable<ToolExecutionEvent> {
        await Promise.resolve();
        if (
          call.toolName === material.name ||
          call.toolCallId === "failed_clear"
        ) {
          yield { type: "failed", error: writeFailure(call.toolCallId) };
        } else {
          yield { type: "completed", result: { content } };
        }
      },
    },
  });
}

function execute(
  adapter: OpenDesignPiToolAdapter,
  name: string,
  id: string,
  input = {},
) {
  const executable = adapter.tools.find((candidate) => candidate.name === name);
  if (!executable) throw new Error(`Missing test tool ${name}`);
  return executable.execute(id, input, new AbortController().signal);
}

async function beforeWrite(adapter: OpenDesignPiToolAdapter, id: string) {
  const toolCall = fauxToolCall(material.name, {}, { id });
  adapter.beginToolCall({ toolCallId: id, toolName: material.name, args: {} });
  return adapter.beforeToolCall({
    toolCall,
    args: {},
    assistantMessage: fauxAssistantMessage(toolCall),
    context: { systemPrompt: "Test", messages: [], tools: adapter.tools },
  });
}

describe("trusted Page clear recovery boundary", () => {
  it("ends old unresolved and inspection recovery after a successful superseding no-op clear, but retains new failures", async () => {
    const adapter = createAdapter();
    await expect(execute(adapter, material.name, "old_write")).rejects.toThrow(
      "design.invalid",
    );
    expect(adapter.unresolvedDesignWriteFailure).toMatchObject({
      toolCallId: "old_write",
      inspectionCompleted: false,
    });
    await execute(adapter, pages.name, "clear_success", { action: "clear" });
    expect(adapter.currentRevision).toBe(request.revision);
    expect(adapter.unresolvedDesignWriteFailure).toBeUndefined();
    expect(await beforeWrite(adapter, "new_write")).toBeUndefined();
    await expect(execute(adapter, material.name, "new_write")).rejects.toThrow(
      "design.invalid",
    );
    expect(adapter.unresolvedDesignWriteFailure).toMatchObject({
      toolCallId: "new_write",
      inspectionCompleted: false,
    });
    expect(
      await beforeWrite(adapter, "blocked_after_new_failure"),
    ).toMatchObject({ block: true });
    expect(adapter.toolCallRecords).toEqual([
      expect.objectContaining({
        toolCallId: "clear_success",
        result: superseded,
      }),
    ]);
    expect(adapter.toolCallRecords[0]).not.toHaveProperty("revisionAdvanced");
  });

  it.each([
    { name: pages.name, input: { action: "clear" }, content: {} },
    {
      name: pages.name,
      input: { action: "clear", deliveryDisposition: "superseded" },
      content: {},
    },
    {
      name: pages.name,
      input: { action: "clear" },
      content: { deliveryDisposition: "active" },
    },
    { name: pages.name, input: { action: "rename" }, content: superseded },
    { name: capture.name, input: { action: "clear" }, content: superseded },
  ])(
    "does not treat other no-ops, actions or model-provided dispositions as superseding: %j",
    async ({ name, input, content }) => {
      const adapter = createAdapter(content);
      await expect(
        execute(adapter, material.name, "old_write"),
      ).rejects.toThrow();
      const unresolved = adapter.unresolvedDesignWriteFailure;
      await execute(adapter, name, "ordinary_success", input);
      expect(adapter.unresolvedDesignWriteFailure).toBe(unresolved);
      expect(
        await beforeWrite(adapter, "still_requires_inspection"),
      ).toMatchObject({ block: true });
    },
  );

  it("does not reset the error circuit when a no-op clear supersedes the prior design", async () => {
    const adapter = createAdapter();
    await expect(execute(adapter, material.name, "same_write")).rejects.toThrow(
      "design.invalid",
    );
    await execute(adapter, pages.name, "clear_success", { action: "clear" });
    await expect(execute(adapter, material.name, "same_write")).rejects.toThrow(
      "design_recovery_no_progress",
    );
    expect(adapter.forcedStopReason).toBe("error");
    expect(adapter.unresolvedDesignWriteFailure).toMatchObject({
      toolCallId: "same_write",
    });
  });

  it("does not clear recovery when the clear call fails", async () => {
    const adapter = createAdapter();
    await expect(
      execute(adapter, material.name, "old_write"),
    ).rejects.toThrow();
    await expect(
      execute(adapter, pages.name, "failed_clear", { action: "clear" }),
    ).rejects.toThrow();
    expect(adapter.unresolvedDesignWriteFailure).toMatchObject({
      toolCallId: "failed_clear",
    });
    expect(
      await beforeWrite(adapter, "still_requires_inspection"),
    ).toMatchObject({ block: true });
    expect(adapter.toolCallRecords).toEqual([]);
  });
});
