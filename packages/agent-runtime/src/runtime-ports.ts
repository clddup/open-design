import type {
  AgentToolFailureIssue,
  ApprovalDecision,
  ToolCallRequest,
  ToolExecutionEvent,
  ToolRisk,
  TrustedToolContext,
  TrustedToolFailure,
} from "@opendesign/agent-contracts";
import type {
  CanonicalTool,
  ModelGateway,
  ModelSelection,
} from "@opendesign/model-gateway";
import type { SessionStore } from "@opendesign/session-store";
import type { CompletionGuardPort } from "./completion-guard.js";
import type { AgentRunRequest, ModelToolSurface } from "./run-request.js";

export interface AgentToolDefinition extends CanonicalTool {
  risk: ToolRisk;
  approval: "never" | "required";
  /**
   * Optional model-facing progressive disclosure metadata.
   *
   * This changes only which validated host tools and schemas are sent to the
   * Provider. It never grants execution authority or creates another tool
   * implementation: every disclosed view still executes the original trusted
   * definition and validateInput boundary.
   */
  modelDisclosure?: {
    bootstrap: "available" | "deferred";
    beforePlan?: "available" | "deferred";
    afterInspection?: "available";
    role?: "inspection" | "plan" | "material-write";
    /**
     * Provider surfaces that may see this definition before the first
     * material revision. Omitted definitions belong to the general surface.
     * Execution registration and host authority are unaffected.
     */
    surfaces?: readonly ModelToolSurface[];
    bootstrapDescription?: string;
    bootstrapInputSchema?: Record<string, unknown>;
    whenDeliveryScopeReview?: "required";
  };
  approvalScope?: "call" | "run";
  approvalDenial?: "continue" | "cancel-run";
  approvalPrompt?:
    | {
        title: string;
        summary: string;
      }
    | ((
        input: unknown,
        request: Readonly<AgentRunRequest>,
      ) => { title: string; summary: string });
  validateInputIssues(input: unknown): readonly AgentToolFailureIssue[];
}

export interface ToolCatalogPort {
  listTools():
    readonly AgentToolDefinition[] | Promise<readonly AgentToolDefinition[]>;
}

export class TrustedToolExecutionError extends Error {
  constructor(readonly failure: TrustedToolFailure) {
    super(failure.message);
    this.name = "TrustedToolExecutionError";
  }
}

export interface ToolExecutorPort {
  execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): AsyncIterable<ToolExecutionEvent>;
}

export interface ApprovalRequest {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  title: string;
  summary: string;
  risk: ToolRisk;
}

export interface ApprovalPort {
  requestApproval(
    request: ApprovalRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<ApprovalDecision>;
}

export interface AgentRuntimeLimits {
  maxTurns: number;
  maxToolCalls: number;
  maxGeneratedTokens: number;
  maxCompletionGuardRejections: number;
  maxContextCharacters: number;
}

export interface AgentRuntimeOptions {
  modelGateway: ModelGateway;
  sessionStore: SessionStore;
  toolCatalog?: ToolCatalogPort;
  toolExecutor?: ToolExecutorPort;
  approvalPort?: ApprovalPort;
  completionGuard?: CompletionGuardPort;
  limits?: Partial<AgentRuntimeLimits>;
  systemPrompt?: string;
  systemPromptForRequest?: (request: AgentRunRequest) => string;
  newDesignSystemPrompt?: string;
  newDesignSystemPromptForRequest?: (request: AgentRunRequest) => string;
  thinkingLevelForRequest?: (
    request: AgentRunRequest,
    surface: ModelToolSurface,
  ) => NonNullable<ModelSelection["reasoningEffort"]>;
  now?: () => Date;
}

export function toCanonicalTool(tool: AgentToolDefinition): CanonicalTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}
