import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ModelApiFormat } from "./index.js";

export function exposesReasoningSummary(
  apiFormat: ModelApiFormat,
  event: AssistantMessageEvent,
): boolean {
  if (!event.type.startsWith("thinking_")) return true;
  return apiFormat !== "openai-chat-completions";
}
