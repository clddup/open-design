import type { AgentRunRequest, ModelToolSurface } from "./run-request.js";
import type {
  AgentToolDefinition,
  ApprovalPort,
  ToolExecutorPort,
} from "./runtime-ports.js";
import type { PiToolLifecyclePort } from "./pi-tool-approval.js";

export interface OpenDesignPiToolAdapterOptions {
  request: AgentRunRequest;
  definitions: readonly AgentToolDefinition[];
  toolExecutor?: ToolExecutorPort;
  approvalPort?: ApprovalPort;
  lifecycle: PiToolLifecyclePort;
  maxToolCalls: number;
  initialInspection?: boolean;
  initialModelToolSurface?: ModelToolSurface;
  now?: () => Date;
}
