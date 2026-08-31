export {
  DESIGN_WORKFLOW_FAILURE_CODES,
  DESIGN_WORKFLOW_FAILURE_DEFINITIONS,
  DesignWorkflowFailureCodeSchema,
  designWorkflowFailureDefinition,
  type DesignWorkflowFailureCode,
  type DesignWorkflowFailurePhase,
} from "./workflow-failure-contract.js";
export type { AgentRunContinuation } from "./continuation.js";
export { AgentRunContinuationContract } from "./continuation.js";
export * from "./agent-event.js";
export * from "./agent-timeline-schema.js";
export * from "./agent-timeline.js";
export * from "./agent-request.js";
export * from "./design-delivery-stage.js";
export * from "./initial-design-inspection.js";
export * from "./tool-bridge.js";
export * from "./tool-failure.js";
export * from "./trusted-tool-result.js";
export * from "./wire-foundations.js";
export { formatContractFailure as formatRuntimeContractFailure } from "@opendesign/contract-runtime";
export type {
  Contract as RuntimeContract,
  ValidationIssue as RuntimeContractIssue,
  ValidationResult as RuntimeContractResult,
} from "@opendesign/contract-runtime";

export const AGENT_PROTOCOL_VERSION = "3.13.0" as const;

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: T;
}

export interface JsonRpcSuccess<T = unknown> {
  jsonrpc: "2.0";
  id: string;
  result: T;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: "2.0";
  method: string;
  params: T;
}
