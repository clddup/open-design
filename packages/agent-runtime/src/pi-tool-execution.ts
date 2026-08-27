import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  TrustedToolExecutionError,
  type AgentToolDefinition,
  type ToolExecutorPort,
} from "./runtime-ports.js";
import {
  TOOL_PROGRESS_KIND,
  type PiToolProgressDetails,
} from "./pi-tool-protocol.js";

export function createPiAgentTool(
  modelDefinition: AgentToolDefinition,
  execute: AgentTool["execute"],
): AgentTool {
  return {
    name: modelDefinition.name,
    label: modelDefinition.name,
    description: modelDefinition.description,
    parameters: modelDefinition.inputSchema,
    executionMode: "sequential",
    execute,
  };
}

export async function executeTrustedPiTool(options: {
  context: TrustedToolContext;
  definition: AgentToolDefinition;
  onUpdate: Parameters<AgentTool["execute"]>[3];
  parameters: unknown;
  signal: AbortSignal;
  toolCallId: string;
  toolExecutor?: ToolExecutorPort;
}): Promise<TrustedToolResult> {
  if (!options.toolExecutor) {
    throw new Error("Tool executor became unavailable");
  }
  let completed: TrustedToolResult | undefined;
  for await (const event of options.toolExecutor.execute(
    {
      toolCallId: options.toolCallId,
      toolName: options.definition.name,
      input: options.parameters,
    },
    options.context,
    options.signal,
  )) {
    if (options.signal.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException("Tool execution cancelled", "AbortError");
    }
    if (event.type === "progress") {
      const progress = Math.min(1, Math.max(0, event.progress));
      options.onUpdate?.({
        content: [{ type: "text", text: event.message }],
        details: {
          kind: TOOL_PROGRESS_KIND,
          version: 1,
          message: event.message,
          progress,
        } satisfies PiToolProgressDetails,
      });
      continue;
    }
    if (event.type === "failed") {
      throw new TrustedToolExecutionError(event.error);
    }
    if (completed) {
      throw new Error("Tool executor completed more than once");
    }
    completed = event.result;
  }
  if (!completed) {
    throw new Error("Tool executor did not return a completed result");
  }
  return completed;
}
