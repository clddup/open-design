import {
  isTrustedToolFailure,
  type ToolCallRequest,
  type TrustedToolContext,
} from "@opendesign/agent-contracts";
import type { ToolAuditEvent } from "@opendesign/tool-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_INSPECT_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
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
      parseInput: parseTestInput,
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

  it("dispatches the canonical input returned by the single Main parser", async () => {
    const source = { actions: ["create-page"], reason: "Create a Page" };
    const canonical = {
      actions: ["create-page"],
      reason: "Create the approved Page",
    };
    const parseInput = vi.fn(() => ({ ok: true as const, value: canonical }));
    const dispatch = vi.fn(() => Promise.resolve({ content: { ok: true } }));
    const isPreauthorized = vi.fn(() => true);
    const runtime = new MainDesignToolRuntime({
      dispatch,
      parseInput,
      isPreauthorized,
      recordAudit: () => undefined,
    });
    const call = {
      toolCallId: "call_page_access",
      toolName: PAGE_STRUCTURE_ACCESS_TOOL_NAME,
      input: source,
    };

    await runtime.execute(
      call,
      context,
      new AbortController().signal,
      () => undefined,
    );

    expect(parseInput).toHaveBeenCalledOnce();
    expect(parseInput).toHaveBeenCalledWith(call, context);
    expect(isPreauthorized).toHaveBeenCalledWith(
      expect.objectContaining({ input: canonical }),
      context,
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ input: canonical }),
      context,
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it("rejects invalid semantic input before domain execution", async () => {
    const dispatch = vi.fn();
    const runtime = fixtureRuntime({ dispatch });

    const execution = runtime.execute(
      { ...inspectCall(), input: { forged: true } },
      context,
      new AbortController().signal,
      () => undefined,
    );
    await expect(execution).rejects.toSatisfy(
      hasTrustedFailure("invalid_tool_input"),
    );
    await expect(execution).rejects.toMatchObject({
      cause: {
        details: {
          kind: "tool-validation",
          fingerprint: expect.stringContaining(
            `${DESIGN_INSPECT_TOOL_NAME}:design_tool.empty_input_invalid:/forged`,
          ) as unknown as string,
          issues: [
            expect.objectContaining({
              code: "design_tool.empty_input_invalid",
              path: "/forged",
            }),
          ],
        },
      },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("preserves expected and actual values in structured validation failures", async () => {
    const runtime = new MainDesignToolRuntime({
      dispatch: vi.fn(),
      parseInput: () => ({
        ok: false,
        issues: [
          {
            code: "design_edit.width_invalid",
            path: "/edits/0/input/width",
            message: "Width must be positive",
            expected: "> 0",
            actual: 0,
          },
        ],
      }),
      isPreauthorized: () => true,
      recordAudit: () => undefined,
    });

    await expect(
      runtime.execute(
        inspectCall(),
        context,
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({
      cause: {
        details: {
          issues: [
            expect.objectContaining({
              expected: "> 0",
              actual: 0,
            }),
          ],
        },
      },
    });
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
    parseInput: parseTestInput,
    isPreauthorized: options.isPreauthorized ?? (() => true),
    recordAudit: () => undefined,
  });
}

function parseTestInput(call: ToolCallRequest) {
  const spec = DESIGN_AGENT_TOOL_SPECS.find(
    (candidate) => candidate.name === call.toolName,
  );
  const issues = spec?.validateInputIssues(call.input) ?? [
    {
      code: "design_tool.unknown",
      path: "/",
      message: "Unknown design tool",
    },
  ];
  return issues.length === 0
    ? { ok: true as const, value: structuredClone(call.input) }
    : {
        ok: false as const,
        issues: issues.map((issue) => ({
          ...issue,
          code: issue.code ?? "design_tool.input_invalid",
        })),
      };
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
