import type {
  CanonicalStreamEvent,
  ModelGateway,
  ModelRequest,
} from "@opendesign/model-gateway";
import {
  isModelBridgeResponse,
  modelBridgeResponseId,
  modelBridgeResponseValidationError,
  type ModelBridgeRequest,
} from "../shared/model-bridge.js";

interface ParentPortLike {
  postMessage(message: unknown): void;
}

type PendingRequest = {
  attemptId: string;
  done: boolean;
  events: CanonicalStreamEvent[];
  waiting?: (result: IteratorResult<CanonicalStreamEvent>) => void;
};

export class ParentModelGateway implements ModelGateway {
  readonly #pending = new Map<string, PendingRequest>();
  #sequence = 0;

  constructor(private readonly port: ParentPortLike) {}

  handleMessage(message: unknown): boolean {
    const requestId = modelBridgeResponseId(message);
    if (!requestId) return false;
    const pending = this.#pending.get(requestId);
    if (!pending) return true;
    if (!isModelBridgeResponse(message)) {
      enqueue(pending, {
        type: "attempt.failed",
        attemptId: pending.attemptId,
        error: {
          code: "model_bridge_invalid_response",
          message: `Model host returned an invalid response: ${modelBridgeResponseValidationError(message)}`,
          retryable: true,
        },
      });
      complete(pending);
      return true;
    }
    if (message.type === "model.event") {
      enqueue(pending, message.event);
      return true;
    }
    if (!message.ok) {
      enqueue(pending, {
        type: "attempt.failed",
        attemptId: pending.attemptId,
        error: {
          code: "model_bridge_failed",
          message: message.error,
          retryable: true,
        },
      });
    }
    complete(pending);
    return true;
  }

  async *stream(request: ModelRequest): AsyncIterable<CanonicalStreamEvent> {
    const requestId = `model_${process.pid}_${Date.now()}_${++this.#sequence}`;
    const pending: PendingRequest = {
      attemptId: request.attemptId,
      done: false,
      events: [],
    };
    this.#pending.set(requestId, pending);
    const abort = () => {
      this.port.postMessage({ type: "model.cancel", requestId });
      const pending = this.#pending.get(requestId);
      if (pending) {
        enqueue(pending, {
          type: "attempt.failed",
          attemptId: request.attemptId,
          error: {
            code: "cancelled",
            message: "Model request was cancelled",
            retryable: false,
          },
        });
        complete(pending);
      }
    };
    request.signal.addEventListener("abort", abort, { once: true });
    const serializableRequest: Omit<ModelRequest, "signal"> = {
      attemptId: request.attemptId,
      ...(request.sessionId === undefined
        ? {}
        : { sessionId: request.sessionId }),
      modelSelection: { ...request.modelSelection },
      system: request.system,
      messages: request.messages,
      tools: request.tools,
    };
    this.port.postMessage({
      type: "model.request",
      requestId,
      request: serializableRequest,
    } satisfies ModelBridgeRequest);

    try {
      while (true) {
        const result = await nextEvent(pending);
        if (result.done) break;
        yield result.value;
      }
    } finally {
      request.signal.removeEventListener("abort", abort);
      this.#pending.delete(requestId);
    }
  }
}

function enqueue(pending: PendingRequest, event: CanonicalStreamEvent): void {
  const waiting = pending.waiting;
  if (waiting) {
    pending.waiting = undefined;
    waiting({ done: false, value: event });
  } else {
    pending.events.push(event);
  }
}

function complete(pending: PendingRequest): void {
  pending.done = true;
  if (pending.events.length === 0 && pending.waiting) {
    const waiting = pending.waiting;
    pending.waiting = undefined;
    waiting({ done: true, value: undefined });
  }
}

function nextEvent(
  pending: PendingRequest,
): Promise<IteratorResult<CanonicalStreamEvent>> {
  const event = pending.events.shift();
  if (event) return Promise.resolve({ done: false, value: event });
  if (pending.done) return Promise.resolve({ done: true, value: undefined });
  return new Promise((resolve) => {
    pending.waiting = resolve;
  });
}
