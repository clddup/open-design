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
  modelDisclosure: { bootstrap: "available", role: "material-write" },
};
const scope: AgentToolDefinition = {
  ...tool,
  name: "opendesign_scope_probe",
  risk: "design_write",
  modelDisclosure: { bootstrap: "available", role: "delivery-scope" },
  validateInputIssues: (input) =>
    input === null
      ? [
          {
            path: "/",
            code: "scope_input_invalid",
            message: "Expected an object",
          },
        ]
      : [],
};
const materialFailure: TrustedToolFailure = {
  code: "design.invalid",
  message: "The material write violates an invariant",
  retryable: false,
  recoverable: true,
  details: {
    kind: "design-transaction",
    fingerprint: "material_invalid",
    issues: [{ path: "/nodesById/title", message: "Invalid material node" }],
    recovery: {
      action: "inspect-and-revise",
      toolName: "opendesign_inspect_document",
      required: true,
    },
  },
};
const scopeFailure: TrustedToolFailure = {
  code: "delivery_scope_already_registered",
  message: "Delivery scope has already been registered",
  retryable: false,
  recoverable: true,
};
type FailureEntry = "execution" | "validation" | "terminal";

function createAdapter(materialFails = false) {
  return new OpenDesignPiToolAdapter({
    request,
    definitions: [material, scope],
    maxToolCalls: 16,
    lifecycle: {
      approvalRequested: () => Promise.resolve(),
      approvalResolved: () => Promise.resolve(),
    },
    toolExecutor: {
      async *execute(call, context): AsyncIterable<ToolExecutionEvent> {
        await Promise.resolve();
        if (call.toolName === material.name && materialFails) {
          yield { type: "failed", error: materialFailure };
        } else if (
          call.toolName === scope.name &&
          call.toolCallId !== "scope_success"
        ) {
          yield { type: "failed", error: scopeFailure };
        } else {
          yield {
            type: "completed",
            result: {
              content: { ok: true },
              ...(call.toolName === material.name
                ? {
                    designRevision: {
                      previousRevision: context.revision,
                      revision: context.revision + 1,
                      transactionId: "transaction_material",
                    },
                  }
                : {}),
            },
          };
        }
      },
    },
  });
}

function execute(adapter: OpenDesignPiToolAdapter, name: string, id: string) {
  const executable = adapter.tools.find((candidate) => candidate.name === name);
  if (!executable) throw new Error(`Missing test tool ${name}`);
  return executable.execute(id, {}, new AbortController().signal);
}

async function failScope(
  adapter: OpenDesignPiToolAdapter,
  entry: FailureEntry,
  id: string,
) {
  const args = entry === "execution" ? {} : null;
  const started = adapter.beginToolCall({
    toolCallId: id,
    toolName: scope.name,
    args,
  });
  expect(started).toMatchObject({ risk: "design_write" });
  if (entry === "execution") {
    await expect(execute(adapter, scope.name, id)).rejects.toThrow();
  } else if (entry === "validation") {
    const toolCall = fauxToolCall(scope.name, {}, { id });
    expect(
      await adapter.beforeToolCall({
        toolCall,
        args,
        assistantMessage: fauxAssistantMessage(toolCall),
        context: { systemPrompt: "Test", messages: [], tools: adapter.tools },
      }),
    ).toMatchObject({ block: true });
  }
  const failure = adapter.endToolCall({
    toolCallId: id,
    toolName: scope.name,
    result: {},
    isError: true,
  });
  adapter.acknowledgeToolCall(id);
  expect(failure).toMatchObject({ status: "failed", toolCallId: id });
  return failure;
}

describe("delivery-scope failures do not create canvas recovery obligations", () => {
  it.each(["execution", "validation", "terminal"] as const)(
    "preserves the committed revision, errors and repeat circuit after late scope failure via %s",
    async (entry) => {
      const adapter = createAdapter();
      await execute(adapter, material.name, "material_success");
      const failure = await failScope(adapter, entry, "scope_failed");
      expect(failure).toMatchObject({
        code: entry === "execution" ? scopeFailure.code : "invalid_tool_input",
        recoverable: true,
      });
      expect(adapter.unresolvedDesignWriteFailure).toBeUndefined();
      expect(adapter.currentRevision).toBe(request.revision + 1);
      const repeated = await failScope(adapter, entry, "scope_repeated");
      expect(repeated).toMatchObject({
        code:
          entry === "execution"
            ? "design_recovery_no_progress"
            : "tool_protocol_no_progress",
        runTerminal: true,
      });
      expect(adapter.unresolvedDesignWriteFailure).toBeUndefined();
      expect(adapter.currentRevision).toBe(request.revision + 1);
      expect(
        adapter.toolCallRecords.map((record) => record.toolCallId),
      ).toEqual(["material_success"]);
    },
  );

  it.each(["execution", "validation", "terminal"] as const)(
    "neither overwrites nor clears a real unresolved write after scope failure or success via %s",
    async (entry) => {
      const adapter = createAdapter(true);
      await expect(
        execute(adapter, material.name, "material_failed"),
      ).rejects.toThrow(materialFailure.code);
      const unresolved = adapter.unresolvedDesignWriteFailure;
      expect(unresolved).toMatchObject({
        toolCallId: "material_failed",
        code: materialFailure.code,
      });
      await failScope(adapter, entry, "scope_failed");
      expect(adapter.unresolvedDesignWriteFailure).toBe(unresolved);
      await execute(adapter, scope.name, "scope_success");
      expect(adapter.unresolvedDesignWriteFailure).toBe(unresolved);
      expect(adapter.currentRevision).toBe(request.revision);
      expect(
        adapter.toolCallRecords.map((record) => record.toolCallId),
      ).toEqual(["scope_success"]);
    },
  );
});
