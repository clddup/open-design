import type {
  ToolCallRequest,
  ToolExecutionEvent,
  TrustedToolContext,
  DesignToolBridgeRequest,
  DesignToolBridgeResponse,
} from "@opendesign/agent-contracts";
import {
  designToolBridgeResponseId,
  isDesignToolBridgeProgress,
  isDesignToolBridgeResponse,
} from "@opendesign/agent-contracts";
import type { ToolExecutorPort } from "@opendesign/agent-runtime";
import { capabilityManifestForAgent } from "@opendesign/design-capabilities";
import { DESIGN_CAPABILITIES_TOOL_NAME } from "@/shared/design-agent-tools.js";

interface ParentPortLike {
  postMessage(message: unknown): void;
}

type PendingRequest = {
  events: AsyncEventQueue<
    | { kind: "progress"; message: string; progress: number }
    | { kind: "response"; response: DesignToolBridgeResponse }
  >;
};

export class ParentDesignToolExecutor implements ToolExecutorPort {
  readonly #pending = new Map<string, PendingRequest>();
  #sequence = 0;

  constructor(private readonly port: ParentPortLike) {}

  handleMessage(message: unknown): boolean {
    if (isDesignToolBridgeProgress(message)) {
      const pending = this.#pending.get(message.requestId);
      pending?.events.push({
        kind: "progress",
        message: message.message,
        progress: message.progress,
      });
      return true;
    }
    const requestId = designToolBridgeResponseId(message);
    if (!requestId) return false;
    const pending = this.#pending.get(requestId);
    if (!pending) return true;
    this.#pending.delete(requestId);
    if (!isDesignToolBridgeResponse(message)) {
      pending.events.push({
        kind: "response",
        response: {
          type: "design-tool.response",
          requestId,
          ok: false,
          error: {
            code: "invalid_tool_response",
            message: "Design tool host returned an invalid response",
            retryable: false,
            recoverable: false,
          },
        },
      });
      pending.events.close();
      return true;
    }
    pending.events.push({ kind: "response", response: message });
    pending.events.close();
    return true;
  }

  async *execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): AsyncIterable<ToolExecutionEvent> {
    if (call.toolName === DESIGN_CAPABILITIES_TOOL_NAME) {
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Capability query cancelled", "AbortError");
      }
      yield {
        type: "completed",
        result: { content: capabilityManifestForAgent() },
      };
      return;
    }
    const requestId = `tool_${process.pid}_${Date.now()}_${++this.#sequence}`;
    const events = new AsyncEventQueue<
      | { kind: "progress"; message: string; progress: number }
      | { kind: "response"; response: DesignToolBridgeResponse }
    >();
    this.#pending.set(requestId, { events });
    const abort = () => {
      this.port.postMessage({ type: "design-tool.cancel", requestId });
      const pending = this.#pending.get(requestId);
      if (!pending) return;
      this.#pending.delete(requestId);
      pending.events.push({
        kind: "response",
        response: {
          type: "design-tool.response",
          requestId,
          ok: false,
          error: {
            code: "run_cancelled",
            message: "Design tool request was cancelled",
            retryable: false,
            recoverable: false,
          },
        },
      });
      pending.events.close();
    };
    signal.addEventListener("abort", abort, { once: true });
    this.port.postMessage({
      type: "design-tool.request",
      requestId,
      call,
      context,
    } satisfies DesignToolBridgeRequest);

    try {
      yield {
        type: "progress",
        message: "正在验证设计工具参数与当前 revision",
        progress: 0.15,
      };
      for await (const event of events) {
        if (event.kind === "progress") {
          yield {
            type: "progress",
            message: event.message,
            progress: event.progress,
          };
          continue;
        }
        if (!event.response.ok) {
          yield { type: "failed", error: event.response.error };
          return;
        }
        yield { type: "completed", result: event.response.result };
        return;
      }
    } finally {
      signal.removeEventListener("abort", abort);
      this.#pending.delete(requestId);
    }
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  readonly #buffer: T[] = [];
  #closed = false;
  #resolve: ((result: IteratorResult<T>) => void) | null = null;

  push(value: T): void {
    if (this.#closed) return;
    const resolve = this.#resolve;
    if (resolve) {
      this.#resolve = null;
      resolve({ done: false, value });
      return;
    }
    this.#buffer.push(value);
  }

  close(): void {
    this.#closed = true;
    const resolve = this.#resolve;
    if (resolve) {
      this.#resolve = null;
      resolve({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.#buffer.shift();
        if (value !== undefined) {
          return Promise.resolve({ done: false, value });
        }
        if (this.#closed) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.#resolve = resolve;
        });
      },
    };
  }
}
