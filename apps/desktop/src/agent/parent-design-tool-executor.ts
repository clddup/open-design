import type {
  ToolCallRequest,
  ToolExecutionEvent,
  ToolExecutorPort,
  TrustedToolContext,
} from "@opendesign/agent-runtime";
import { capabilityManifestForAgent } from "@opendesign/design-capabilities";
import { DESIGN_CAPABILITIES_TOOL_NAME } from "../shared/design-agent-tools.js";
import {
  designToolBridgeResponseId,
  isDesignToolBridgeResponse,
  type DesignToolBridgeRequest,
  type DesignToolBridgeResponse,
} from "../shared/design-tool-bridge.js";

interface ParentPortLike {
  postMessage(message: unknown): void;
}

type PendingRequest = {
  resolve: (response: DesignToolBridgeResponse) => void;
};

export class ParentDesignToolExecutor implements ToolExecutorPort {
  readonly #pending = new Map<string, PendingRequest>();
  #sequence = 0;

  constructor(private readonly port: ParentPortLike) {}

  handleMessage(message: unknown): boolean {
    const requestId = designToolBridgeResponseId(message);
    if (!requestId) return false;
    const pending = this.#pending.get(requestId);
    if (!pending) return true;
    this.#pending.delete(requestId);
    if (!isDesignToolBridgeResponse(message)) {
      pending.resolve({
        type: "design-tool.response",
        requestId,
        ok: false,
        error: "Design tool host returned an invalid response",
      });
      return true;
    }
    pending.resolve(message);
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
    const response = new Promise<DesignToolBridgeResponse>((resolve) => {
      this.#pending.set(requestId, { resolve });
    });
    const abort = () => {
      this.port.postMessage({ type: "design-tool.cancel", requestId });
      const pending = this.#pending.get(requestId);
      if (!pending) return;
      this.#pending.delete(requestId);
      pending.resolve({
        type: "design-tool.response",
        requestId,
        ok: false,
        error: "Design tool request was cancelled",
      });
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
      const result = await response;
      if (!result.ok) throw new Error(result.error);
      yield { type: "completed", result: result.result };
    } finally {
      signal.removeEventListener("abort", abort);
      this.#pending.delete(requestId);
    }
  }
}
