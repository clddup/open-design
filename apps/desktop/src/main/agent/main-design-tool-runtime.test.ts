import {
  isTrustedToolFailure,
  type ToolCallRequest,
  type TrustedToolContext,
} from "@opendesign/agent-contracts";
import type { ToolAuditEvent } from "@opendesign/tool-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DESIGN_INSPECT_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
} from "../../shared/design-agent-tools.js";
import {
  MainDesignToolRuntime,
  mainDesignToolAuditDiagnostic,
} from "./main-design-tool-runtime.js";

const context: TrustedToolContext = {
  runId: "run_1",
  sessionId: "conversation_1",
  documentId: "document_1",
  revision: 4,
  scope: {
    kind: "page",
    pageId: "page_1",
    selectedNodeIds: [],
  },
  mutationTarget: { kind: "page", pageId: "page_1" },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("MainDesignToolRuntime", () => {
  it("executes a registered tool through the delegated domain owner", async () => {
    const audit: ToolAuditEvent[] = [];
    const dispatch = vi.fn(
      (
        call: ToolCallRequest,
        receivedContext: TrustedToolContext,
        _signal: AbortSignal,
        reportProgress: (message: string, progress: number) => void,
      ) => {
        reportProgress("Inspecting", 0.5);
        return Promise.resolve({
          content: { ok: true, toolName: call.toolName },
          observedRevision: receivedContext.revision,
        });
      },
    );
    const progress = vi.fn();
    const runtime = new MainDesignToolRuntime({
      dispatch,
      isPreauthorized: () => true,
      recordAudit: (event) => {
        audit.push(event);
      },
    });

    await expect(
      runtime.execute(
        inspectCall(),
        context,
        new AbortController().signal,
        progress,
      ),
    ).resolves.toEqual({
      content: { ok: true, toolName: DESIGN_INSPECT_TOOL_NAME },
      observedRevision: 4,
    });
    expect(dispatch).toHaveBeenCalledWith(
      inspectCall(),
      context,
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(progress).toHaveBeenCalledWith("Inspecting", 0.5);
    expect(audit.map((event) => event.phase)).toEqual([
      "validated",
      "allowed",
      "started",
      "completed",
    ]);
  });

  it("rejects invalid semantic input before domain execution", async () => {
    const dispatch = vi.fn();
    const runtime = fixtureRuntime({ dispatch });

    await expect(
      runtime.execute(
        { ...inspectCall(), input: { forged: true } },
        context,
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toSatisfy(hasTrustedFailure("invalid_tool_input"));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("requires Main preauthorization for approval-gated tools", async () => {
    const dispatch = vi.fn(() => Promise.resolve({ content: { ok: true } }));
    const denied = fixtureRuntime({ dispatch, isPreauthorized: () => false });
    const call: ToolCallRequest = {
      toolCallId: "call_pages",
      toolName: PAGE_STRUCTURE_ACCESS_TOOL_NAME,
      input: {
        actions: ["create-page"],
        reason: "Create the requested Research page",
      },
    };

    await expect(
      denied.execute(
        call,
        context,
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toSatisfy(hasTrustedFailure("tool_policy_denied"));
    expect(dispatch).not.toHaveBeenCalled();

    const allowed = fixtureRuntime({
      dispatch,
      isPreauthorized: () => true,
    });
    await expect(
      allowed.execute(
        call,
        context,
        new AbortController().signal,
        () => undefined,
      ),
    ).resolves.toEqual({ content: { ok: true } });
  });

  it("propagates caller cancellation even when the domain tool ignores it", async () => {
    let started = false;
    const runtime = fixtureRuntime({
      dispatch: () => {
        started = true;
        return new Promise(() => undefined);
      },
    });
    const controller = new AbortController();
    const execution = runtime.execute(
      inspectCall(),
      context,
      controller.signal,
      () => undefined,
    );
    await vi.waitFor(() => expect(started).toBe(true));
    controller.abort();

    await expect(execution).rejects.toSatisfy(
      hasTrustedFailure("run_cancelled"),
    );
  });

  it("rejects invalid trusted output before it crosses the process bridge", async () => {
    const runtime = fixtureRuntime({
      dispatch: () =>
        Promise.resolve({
          content: { ok: true },
          observedRevision: 7,
          designRevision: {
            previousRevision: 4,
            revision: 5,
            transactionId: "transaction_1",
          },
        }),
    });

    await expect(
      runtime.execute(
        inspectCall(),
        context,
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toSatisfy(hasTrustedFailure("invalid_tool_output", true));
  });

  it("projects bounded silent runtime audit diagnostics", () => {
    expect(
      mainDesignToolAuditDiagnostic({
        at: "2026-08-23T00:00:00.000Z",
        runId: "run_1",
        toolCallId: "call_1",
        toolName: DESIGN_INSPECT_TOOL_NAME,
        phase: "failed",
      }),
    ).toEqual({
      level: "warning",
      source: "design-tool",
      presentation: "silent",
      code: "tool_runtime_failed",
      message: `${DESIGN_INSPECT_TOOL_NAME}: failed`,
      context: { runId: "run_1", toolCallId: "call_1" },
    });
  });
});

function inspectCall(): ToolCallRequest {
  return {
    toolCallId: "call_inspect",
    toolName: DESIGN_INSPECT_TOOL_NAME,
    input: {},
  };
}

function fixtureRuntime(options: {
  dispatch?: ConstructorParameters<typeof MainDesignToolRuntime>[0]["dispatch"];
  isPreauthorized?: ConstructorParameters<
    typeof MainDesignToolRuntime
  >[0]["isPreauthorized"];
}): MainDesignToolRuntime {
  return new MainDesignToolRuntime({
    dispatch:
      options.dispatch ?? (() => Promise.resolve({ content: { ok: true } })),
    isPreauthorized: options.isPreauthorized ?? (() => true),
    recordAudit: () => undefined,
  });
}

function hasTrustedFailure(code: string, terminal = false) {
  return (error: unknown): boolean => {
    if (!(error instanceof Error) || !("cause" in error)) return false;
    if (!isTrustedToolFailure(error.cause)) return false;
    return (
      error.cause.code === code &&
      (terminal ? error.cause.runTerminal === true : true)
    );
  };
}
