import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";

export type ToolRisk = "read" | "design_write" | "external" | "destructive";
export type PolicyDecision = "allow" | "ask" | "deny";

export interface ToolCapability {
  capability: string;
  resources: string[];
  risk: ToolRisk;
  sideEffect: boolean;
  idempotent: boolean;
  timeoutMs: number;
  outputLimitBytes: number;
  concurrencyKey?: string;
  requiresSecret?: boolean;
}

export interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: TSchema;
  capability: ToolCapability;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

export interface ToolExecutionRequest {
  runId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolExecutionContext {
  signal: AbortSignal;
  reportProgress(message: string, progress: number): void;
}

export interface PolicyContext {
  runId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  capability: ToolCapability;
}

export interface ToolPolicy {
  evaluate(context: PolicyContext): Promise<PolicyDecision>;
}

export interface ApprovalHost {
  request(context: PolicyContext): Promise<boolean>;
}

export interface AuditSink {
  record(event: ToolAuditEvent): Promise<void>;
}

export interface ToolAuditEvent {
  at: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  phase:
    "validated" | "allowed" | "denied" | "started" | "completed" | "failed";
  detail?: unknown;
}

export class ToolRuntimeError extends Error {
  constructor(
    readonly code:
      | "TOOL_NOT_FOUND"
      | "INVALID_INPUT"
      | "POLICY_DENIED"
      | "APPROVAL_DENIED"
      | "OUTPUT_TOO_LARGE"
      | "TOOL_TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "ToolRuntimeError";
  }
}

export class ToolRuntime {
  readonly #tools = new Map<string, ToolDefinition<unknown, unknown>>();

  constructor(
    private readonly policy: ToolPolicy,
    private readonly approvals: ApprovalHost,
    private readonly audit: AuditSink,
  ) {}

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.#tools.set(tool.name, tool);
  }

  list(): ReadonlyArray<
    Pick<
      ToolDefinition<unknown, unknown>,
      "name" | "description" | "capability"
    >
  > {
    return [...this.#tools.values()].map(
      ({ name, description, capability }) => ({
        name,
        description,
        capability,
      }),
    );
  }

  async execute(request: ToolExecutionRequest): Promise<unknown> {
    const tool = this.#tools.get(request.toolName);
    if (!tool) {
      throw new ToolRuntimeError(
        "TOOL_NOT_FOUND",
        `Unknown tool: ${request.toolName}`,
      );
    }

    if (!Value.Check(tool.inputSchema, request.input)) {
      throw new ToolRuntimeError(
        "INVALID_INPUT",
        `Invalid input for ${tool.name}`,
      );
    }

    const policyContext: PolicyContext = {
      ...request,
      capability: tool.capability,
    };
    await this.record(request, "validated");

    const decision = await this.policy.evaluate(policyContext);
    if (decision === "deny") {
      await this.record(request, "denied", { reason: "policy" });
      throw new ToolRuntimeError("POLICY_DENIED", `Policy denied ${tool.name}`);
    }

    if (decision === "ask" && !(await this.approvals.request(policyContext))) {
      await this.record(request, "denied", { reason: "approval" });
      throw new ToolRuntimeError(
        "APPROVAL_DENIED",
        `Approval denied ${tool.name}`,
      );
    }

    await this.record(request, "allowed");
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      tool.capability.timeoutMs,
    );

    try {
      await this.record(request, "started");
      const output = await tool.execute(request.input, {
        signal: controller.signal,
        reportProgress: () => {},
      });
      const bytes = new TextEncoder().encode(JSON.stringify(output)).byteLength;
      if (bytes > tool.capability.outputLimitBytes) {
        throw new ToolRuntimeError(
          "OUTPUT_TOO_LARGE",
          `${tool.name} output exceeds ${tool.capability.outputLimitBytes} bytes`,
        );
      }
      await this.record(request, "completed");
      return output;
    } catch (error) {
      if (controller.signal.aborted) {
        await this.record(request, "failed", { reason: "timeout" });
        throw new ToolRuntimeError("TOOL_TIMEOUT", `${tool.name} timed out`);
      }
      await this.record(request, "failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private record(
    request: ToolExecutionRequest,
    phase: ToolAuditEvent["phase"],
    detail?: unknown,
  ): Promise<void> {
    return this.audit.record({
      at: new Date().toISOString(),
      runId: request.runId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      phase,
      detail,
    });
  }
}
