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
  evaluate(
    context: PolicyContext,
    signal: AbortSignal,
  ): Promise<PolicyDecision>;
}

export interface ApprovalHost {
  request(context: PolicyContext, signal: AbortSignal): Promise<boolean>;
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
      | "INVALID_REQUEST"
      | "INVALID_INPUT"
      | "INVALID_OUTPUT"
      | "POLICY_DENIED"
      | "APPROVAL_DENIED"
      | "OUTPUT_TOO_LARGE"
      | "TOOL_CANCELLED"
      | "TOOL_CONFLICT"
      | "TOOL_TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "ToolRuntimeError";
  }
}

export interface ToolExecutionOptions {
  signal?: AbortSignal;
  reportProgress?(message: string, progress: number): void;
}

export class ToolRuntime {
  readonly #tools = new Map<string, ToolDefinition<unknown, unknown>>();
  readonly #activeLeaseOwnerByKey = new Map<string, string>();

  constructor(
    private readonly policy: ToolPolicy,
    private readonly approvals: ApprovalHost,
    private readonly audit: AuditSink,
  ) {}

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    assertToolDefinition(tool);
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

  async execute(
    request: ToolExecutionRequest,
    options: ToolExecutionOptions = {},
  ): Promise<unknown> {
    assertExecutionRequest(request);
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
    throwIfCancelled(options.signal, tool.name);

    let decision: PolicyDecision;
    try {
      decision = await raceCancellation(
        this.policy.evaluate(
          policyContext,
          options.signal ?? neverAbortedSignal(),
        ),
        options.signal,
        tool.name,
      );
    } catch (error) {
      await this.record(request, "failed", {
        reason: error instanceof Error ? error.message : "policy failed",
        stage: "policy",
      });
      throw error;
    }
    if (decision === "deny") {
      await this.record(request, "denied", { reason: "policy" });
      throw new ToolRuntimeError("POLICY_DENIED", `Policy denied ${tool.name}`);
    }

    if (decision === "ask") {
      let approved: boolean;
      try {
        approved = await raceCancellation(
          this.approvals.request(
            policyContext,
            options.signal ?? neverAbortedSignal(),
          ),
          options.signal,
          tool.name,
        );
      } catch (error) {
        await this.record(request, "failed", {
          reason: error instanceof Error ? error.message : "approval failed",
          stage: "approval",
        });
        throw error;
      }
      if (!approved) {
        await this.record(request, "denied", { reason: "approval" });
        throw new ToolRuntimeError(
          "APPROVAL_DENIED",
          `Approval denied ${tool.name}`,
        );
      }
    }

    await this.record(request, "allowed");
    let releaseLease: () => void;
    try {
      releaseLease = this.acquireExecutionLease(request, tool.capability);
    } catch (error) {
      await this.record(request, "failed", {
        reason: error instanceof Error ? error.message : "execution conflict",
        stage: "lease",
      });
      throw error;
    }
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, tool.capability.timeoutMs);
    timeout.unref?.();

    try {
      await this.record(request, "started");
      if (controller.signal.aborted) {
        throw new ToolRuntimeError(
          timedOut ? "TOOL_TIMEOUT" : "TOOL_CANCELLED",
          timedOut ? `${tool.name} timed out` : `${tool.name} was cancelled`,
        );
      }
      const output = await raceAbort(
        tool.execute(request.input, {
          signal: controller.signal,
          reportProgress: (message, progress) => {
            assertProgress(message, progress);
            if (!controller.signal.aborted) {
              options.reportProgress?.(message, progress);
            }
          },
        }),
        controller.signal,
        () =>
          new ToolRuntimeError(
            timedOut ? "TOOL_TIMEOUT" : "TOOL_CANCELLED",
            timedOut ? `${tool.name} timed out` : `${tool.name} was cancelled`,
          ),
      );
      const serialized = serializeOutput(output, tool.name);
      const bytes = new TextEncoder().encode(serialized).byteLength;
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
        const reason = timedOut ? "timeout" : "cancelled";
        await this.record(request, "failed", { reason });
        if (error instanceof ToolRuntimeError) throw error;
        throw new ToolRuntimeError(
          timedOut ? "TOOL_TIMEOUT" : "TOOL_CANCELLED",
          timedOut ? `${tool.name} timed out` : `${tool.name} was cancelled`,
        );
      }
      await this.record(request, "failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      releaseLease();
    }
  }

  private acquireExecutionLease(
    request: ToolExecutionRequest,
    capability: ToolCapability,
  ): () => void {
    const owner = `${request.runId}:${request.toolCallId}`;
    const keys = [
      `call:${owner}`,
      ...(capability.concurrencyKey
        ? [`concurrency:${capability.concurrencyKey}`]
        : []),
    ];
    const conflict = keys.find((key) => this.#activeLeaseOwnerByKey.has(key));
    if (conflict) {
      throw new ToolRuntimeError(
        "TOOL_CONFLICT",
        `Tool execution conflicts with ${this.#activeLeaseOwnerByKey.get(conflict)}`,
      );
    }
    for (const key of keys) this.#activeLeaseOwnerByKey.set(key, owner);
    return () => {
      for (const key of keys) {
        if (this.#activeLeaseOwnerByKey.get(key) === owner) {
          this.#activeLeaseOwnerByKey.delete(key);
        }
      }
    };
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

let idleSignal: AbortSignal | undefined;

function neverAbortedSignal(): AbortSignal {
  idleSignal ??= new AbortController().signal;
  return idleSignal;
}

function assertExecutionRequest(request: ToolExecutionRequest): void {
  if (
    !safeIdentifier(request.runId) ||
    !safeIdentifier(request.toolCallId) ||
    !safeIdentifier(request.toolName)
  ) {
    throw new ToolRuntimeError(
      "INVALID_REQUEST",
      "Invalid tool execution identity",
    );
  }
}

function assertToolDefinition(tool: ToolDefinition<unknown, unknown>): void {
  if (!safeIdentifier(tool.name) || tool.description.trim().length === 0) {
    throw new TypeError("Tool definition identity is invalid");
  }
  const capability = tool.capability;
  if (
    !safeIdentifier(capability.capability) ||
    capability.resources.length === 0 ||
    capability.resources.some((resource) => !safeIdentifier(resource)) ||
    !Number.isSafeInteger(capability.timeoutMs) ||
    capability.timeoutMs <= 0 ||
    !Number.isSafeInteger(capability.outputLimitBytes) ||
    capability.outputLimitBytes <= 0 ||
    (capability.concurrencyKey !== undefined &&
      !safeIdentifier(capability.concurrencyKey))
  ) {
    throw new TypeError(`Tool capability is invalid: ${tool.name}`);
  }
}

function safeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  );
}

function assertProgress(message: string, progress: number): void {
  if (
    typeof message !== "string" ||
    message.length === 0 ||
    message.length > 2_000 ||
    !Number.isFinite(progress) ||
    progress < 0 ||
    progress > 1
  ) {
    throw new TypeError("Tool progress is invalid");
  }
}

function serializeOutput(output: unknown, toolName: string): string {
  try {
    const serialized = JSON.stringify(output);
    if (serialized === undefined) {
      throw new Error("output is not JSON serializable");
    }
    return serialized;
  } catch (error) {
    throw new ToolRuntimeError(
      "INVALID_OUTPUT",
      `${toolName} returned invalid output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function throwIfCancelled(
  signal: AbortSignal | undefined,
  toolName: string,
): void {
  if (signal?.aborted) {
    throw new ToolRuntimeError("TOOL_CANCELLED", `${toolName} was cancelled`);
  }
}

function raceCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  toolName: string,
): Promise<T> {
  if (!signal) return promise;
  return raceAbort(
    promise,
    signal,
    () => new ToolRuntimeError("TOOL_CANCELLED", `${toolName} was cancelled`),
  );
}

function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  error: () => Error,
): Promise<T> {
  if (signal.aborted) return Promise.reject(error());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(error());
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}
