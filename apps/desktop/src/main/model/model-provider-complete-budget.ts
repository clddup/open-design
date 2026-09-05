import type { AgentModelContext } from "@opendesign/agent-contracts";
import type { ModelRequest } from "@opendesign/model-gateway";
import {
  contextBudgetExceededMessage,
  createContextBudget,
  modelContextFits,
} from "@opendesign/agent-runtime";

export function assertCompleteContextBudget(
  request: Omit<ModelRequest, "signal">,
  modelContext: AgentModelContext,
): void {
  const { system, tools } = request;
  const messages = request.messages.map((message) =>
    message.role === "user" && Array.isArray(message.content)
      ? {
          ...message,
          // Keep the existing fixed image cost, not base64 text tokens.
          content: message.content.map((block) =>
            block.type === "image" ? { ...block, data: "" } : block,
          ),
        }
      : message,
  );
  // A configured model always supplies the token budget; character fallback is unused.
  const budget = createContextBudget(modelContext, system, tools, 0);
  if (!modelContextFits(messages, system, tools, budget)) {
    throw new Error(
      contextBudgetExceededMessage(
        messages,
        budget,
        "after resolving completion attachments",
      ),
    );
  }
}
