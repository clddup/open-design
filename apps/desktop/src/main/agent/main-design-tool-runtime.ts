import {
  isTrustedToolResult,
  type ToolCallRequest,
  type TrustedToolContext,
  type TrustedToolFailure,
  type TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  ToolRuntime,
  ToolRuntimeError,
  type ToolAuditEvent,
  type ToolCapability,
  type ToolExecutionContext,
} from "@opendesign/tool-runtime";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  READ_IMAGE_TOOL_NAME,
} from "@/shared/design-agent-tools.js";

export interface MainDesignToolDispatcher {
  (
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
    reportProgress: (message: string, progress: number) => void,
  ): Promise<TrustedToolResult>;
}

export interface MainDesignToolRuntimeOptions {
  dispatch: MainDesignToolDispatcher;
  isPreauthorized(call: ToolCallRequest, context: TrustedToolContext): boolean;
  recordAudit(event: ToolAuditEvent): void | Promise<void>;
}

type Invocation = {
  call: ToolCallRequest;
  context: TrustedToolContext;
};

const TOOL_TIMEOUT_MS = 15 * 60_000;
const TOOL_OUTPUT_LIMIT_BYTES = 4_000_000;

/**
 * Main-owned policy/runtime boundary for every Agent-facing design tool.
 *
 * Design workflow state remains in GlobalTaskCoordinator and the delegated
 * dispatcher. This class owns only generic validation, policy, preauthorization,
 * cancellation, timeout, call leases, output bounds, and audit dispatch.
 */
export class MainDesignToolRuntime {
  readonly #invocations = new Map<string, Invocation>();
  readonly #runtime: ToolRuntime;

  constructor(private readonly options: MainDesignToolRuntimeOptions) {
    this.#runtime = new ToolRuntime(
      {
        evaluate: (policyContext) => {
          const invocation = this.requireInvocation(
            policyContext.runId,
            policyContext.toolCallId,
          );
          const spec = requireToolSpec(policyContext.toolName);
          const decision =
            spec.approval === "required" &&
            !this.options.isPreauthorized(invocation.call, invocation.context)
              ? "deny"
              : "allow";
          return Promise.resolve(decision);
        },
      },
      {
        request: () => Promise.resolve(false),
      },
      {
        record: (event) => Promise.resolve(this.options.recordAudit(event)),
      },
    );

    for (const spec of DESIGN_AGENT_TOOL_SPECS) {
      const capability = declaredCapability(spec);
      this.#runtime.register({
        name: spec.name,
        description: spec.description,
        validateInput: (input) => spec.validateInputIssues(input).length === 0,
        validateOutput: isTrustedToolResult,
        capability,
        resolveCapability: (_input, request) => ({
          ...capability,
          resources: [
            `design-file:${this.requireInvocation(request.runId, request.toolCallId).context.documentId}`,
          ],
        }),
        execute: (input, execution) =>
          this.executeRegisteredTool(spec.name, input, execution),
      });
    }
  }

  async execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
    reportProgress: (message: string, progress: number) => void,
  ): Promise<TrustedToolResult> {
    const key = invocationKey(context.runId, call.toolCallId);
    const invocation = { call, context };
    if (this.#invocations.has(key)) {
      throw runtimeFailure(
        new ToolRuntimeError(
          "TOOL_CONFLICT",
          `Tool call ${call.toolCallId} is already active for Run ${context.runId}`,
        ),
      );
    }
    this.#invocations.set(key, invocation);
    try {
      return (await this.#runtime.execute(
        {
          runId: context.runId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        },
        { signal, reportProgress },
      )) as TrustedToolResult;
    } catch (error) {
      if (error instanceof ToolRuntimeError) throw runtimeFailure(error);
      throw error;
    } finally {
      if (this.#invocations.get(key) === invocation) {
        this.#invocations.delete(key);
      }
    }
  }

  private executeRegisteredTool(
    toolName: string,
    input: unknown,
    execution: ToolExecutionContext,
  ): Promise<TrustedToolResult> {
    const invocation = this.requireInvocation(
      execution.runId,
      execution.toolCallId,
    );
    if (
      invocation.call.toolName !== toolName ||
      execution.toolName !== toolName ||
      invocation.call.input !== input
    ) {
      throw new ToolRuntimeError(
        "INVALID_REQUEST",
        "Tool execution identity changed after validation",
      );
    }
    return this.options.dispatch(
      invocation.call,
      invocation.context,
      execution.signal,
      (message, progress) => execution.reportProgress(message, progress),
    );
  }

  private requireInvocation(runId: string, toolCallId: string): Invocation {
    const invocation = this.#invocations.get(invocationKey(runId, toolCallId));
    if (!invocation) {
      throw new ToolRuntimeError(
        "INVALID_REQUEST",
        "Tool execution has no trusted Main invocation context",
      );
    }
    return invocation;
  }
}

function declaredCapability(
  spec: (typeof DESIGN_AGENT_TOOL_SPECS)[number],
): ToolCapability {
  const sideEffect =
    spec.risk !== "read" ||
    spec.name === DESIGN_CAPTURE_TOOL_NAME ||
    spec.name === DESIGN_REVIEW_TOOL_NAME ||
    spec.name === READ_IMAGE_TOOL_NAME;
  return {
    capability:
      spec.risk === "read"
        ? "design.read"
        : spec.risk === "external"
          ? "design.external"
          : "design.write",
    resources: ["design-file:*"],
    risk: spec.risk,
    sideEffect,
    idempotent: !sideEffect,
    timeoutMs: TOOL_TIMEOUT_MS,
    outputLimitBytes: TOOL_OUTPUT_LIMIT_BYTES,
    ...(spec.risk === "external" ? { requiresSecret: true } : {}),
  };
}

function requireToolSpec(toolName: string) {
  const spec = DESIGN_AGENT_TOOL_SPECS.find(
    (candidate) => candidate.name === toolName,
  );
  if (!spec) {
    throw new ToolRuntimeError("TOOL_NOT_FOUND", `Unknown tool: ${toolName}`);
  }
  return spec;
}

function invocationKey(runId: string, toolCallId: string): string {
  return `${runId}:${toolCallId}`;
}

function runtimeFailure(error: ToolRuntimeError): Error {
  const terminal = [
    "TOOL_NOT_FOUND",
    "INVALID_REQUEST",
    "INVALID_OUTPUT",
    "OUTPUT_TOO_LARGE",
  ].includes(error.code);
  const failure: TrustedToolFailure = {
    code: runtimeFailureCode(error.code),
    message: error.message,
    retryable: error.code === "TOOL_CONFLICT",
    recoverable:
      error.code === "INVALID_INPUT" ||
      error.code === "TOOL_CONFLICT" ||
      error.code === "TOOL_TIMEOUT",
    ...(terminal ? { runTerminal: true } : {}),
  };
  return new Error(error.message, { cause: failure });
}

function runtimeFailureCode(code: ToolRuntimeError["code"]): string {
  switch (code) {
    case "INVALID_INPUT":
      return "invalid_tool_input";
    case "TOOL_CANCELLED":
      return "run_cancelled";
    case "TOOL_CONFLICT":
      return "tool_execution_conflict";
    case "TOOL_TIMEOUT":
      return "tool_execution_timeout";
    case "POLICY_DENIED":
    case "APPROVAL_DENIED":
      return "tool_policy_denied";
    case "TOOL_NOT_FOUND":
    case "INVALID_REQUEST":
      return "invalid_tool_request";
    case "INVALID_OUTPUT":
    case "OUTPUT_TOO_LARGE":
      return "invalid_tool_output";
  }
}

export function mainDesignToolAuditDiagnostic(event: ToolAuditEvent): {
  level: "info" | "warning";
  source: "design-tool";
  presentation: "silent";
  code: string;
  message: string;
  context: { runId: string; toolCallId: string };
} {
  return {
    level:
      event.phase === "failed" || event.phase === "denied" ? "warning" : "info",
    source: "design-tool",
    presentation: "silent",
    code: `tool_runtime_${event.phase}`,
    message: `${event.toolName}: ${event.phase}`,
    context: { runId: event.runId, toolCallId: event.toolCallId },
  };
}
