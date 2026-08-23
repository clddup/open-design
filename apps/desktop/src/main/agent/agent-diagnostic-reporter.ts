import type { AgentEvent } from "@opendesign/agent-contracts";
import type {
  DiagnosticContext,
  DiagnosticInput,
} from "@/shared/diagnostics.js";

export function reportAgentDiagnostic(
  event: AgentEvent,
  publish: (input: DiagnosticInput) => void,
  contextFor: (event: AgentEvent) => DiagnosticContext | undefined,
): void {
  if (event.type === "agent.error") {
    const context = contextFor(event);
    publish({
      level: "error",
      source:
        event.failure?.provider === undefined ? "agent" : "model-provider",
      presentation: "toast",
      code: event.code,
      message: event.message,
      ...(event.failure === undefined ? {} : { failure: event.failure }),
      ...(context ? { context } : {}),
    });
  }
  if (event.type === "tool.failed") {
    if (event.code === "run_cancelled") return;
    publish({
      level: "warning",
      source: "design-tool",
      presentation: event.details ? "toast" : "silent",
      code: event.code,
      message: event.message,
      context: contextFor(event),
      ...(event.details ? { details: event.details } : {}),
    });
  }
}
