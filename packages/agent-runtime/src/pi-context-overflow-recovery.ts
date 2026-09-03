import type {
  CanonicalStreamEvent,
  ModelGateway,
  ModelRequest,
} from "@opendesign/model-gateway";
import type { PiModelContextProjectionPort } from "./pi-model-gateway-ports.js";

export async function* streamWithContextOverflowRecovery(
  gateway: ModelGateway,
  initialRequest: ModelRequest,
  projection: PiModelContextProjectionPort | undefined,
  nextAttemptId: () => string,
): AsyncIterable<CanonicalStreamEvent> {
  const logicalAttemptId = initialRequest.attemptId;
  let request = initialRequest;
  let retried = false;

  while (true) {
    const buffered: CanonicalStreamEvent[] = [];
    let semanticContentStarted = false;
    let restart = false;

    for await (const physicalEvent of gateway.stream(request)) {
      const event = withAttemptId(physicalEvent, logicalAttemptId);
      if (!semanticContentStarted && isSemanticContent(event)) {
        semanticContentStarted = true;
        yield* buffered;
        buffered.length = 0;
      }
      if (
        !semanticContentStarted &&
        !retried &&
        event.type === "attempt.failed" &&
        event.error.code === "context_too_large"
      ) {
        const recovered = projection?.recoverProviderContextOverflow?.(
          request,
          event.error,
        );
        if (recovered !== undefined) {
          request = { ...recovered, attemptId: nextAttemptId() };
          retried = true;
          restart = true;
          break;
        }
      }
      if (semanticContentStarted || isTerminal(event)) {
        if (!semanticContentStarted) yield* buffered;
        yield event;
      } else {
        buffered.push(event);
      }
      if (isTerminal(event)) return;
    }

    if (restart) continue;
    yield* buffered;
    return;
  }
}

function withAttemptId(
  event: CanonicalStreamEvent,
  attemptId: string,
): CanonicalStreamEvent {
  return event.attemptId === attemptId ? event : { ...event, attemptId };
}

function isSemanticContent(event: CanonicalStreamEvent): boolean {
  return (
    event.type === "block.completed" ||
    (event.type === "block.delta" && event.delta.length > 0)
  );
}

function isTerminal(event: CanonicalStreamEvent): boolean {
  return event.type === "attempt.completed" || event.type === "attempt.failed";
}
