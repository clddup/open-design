import type { CanonicalMessage } from "@opendesign/model-gateway";

const executionProjections = new WeakSet<object>();

/** Run-local provenance; never inferred from user text or sent over the wire. */
export function executionContextMessage<T extends CanonicalMessage>(
  message: T,
): T {
  executionProjections.add(message);
  return message;
}

export function isExecutionContextMessage(message: CanonicalMessage): boolean {
  return executionProjections.has(message);
}
