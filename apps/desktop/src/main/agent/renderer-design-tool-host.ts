import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import type {
  RendererDesignCaptureTarget,
  RendererDesignToolCancel,
  RendererDesignToolRequest,
  RendererDesignToolResponse,
} from "../../shared/design-tool-bridge";

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (result: TrustedToolResult) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class RendererDesignToolHost {
  readonly #pending = new Map<string, PendingRequest>();
  #sequence = 0;

  constructor(
    private readonly send: (request: RendererDesignToolRequest) => void,
    private readonly sendCancel: (
      request: RendererDesignToolCancel,
    ) => void = () => undefined,
  ) {}

  execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
    options: { captureTarget?: RendererDesignCaptureTarget } = {},
  ): Promise<TrustedToolResult> {
    const requestId = `renderer_tool_${Date.now()}_${++this.#sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        this.sendCancel({ requestId });
        reject(new Error("Renderer design tool timed out"));
      }, 30_000);
      const abort = () => {
        const pending = this.#pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.#pending.delete(requestId);
        this.sendCancel({ requestId });
        reject(new Error("Renderer design tool was cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.#pending.set(requestId, {
        resolve: (result) => {
          signal.removeEventListener("abort", abort);
          resolve(result);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
        timeout,
      });
      try {
        this.send({ requestId, call, context, ...options });
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(requestId);
        signal.removeEventListener("abort", abort);
        reject(
          error instanceof Error
            ? error
            : new Error("Renderer design tool dispatch failed"),
        );
      }
    });
  }

  resolve(response: RendererDesignToolResponse): boolean {
    const pending = this.#pending.get(response.requestId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.#pending.delete(response.requestId);
    if (response.ok) pending.resolve(response.result);
    else
      pending.reject(
        new Error(response.error.message, { cause: response.error }),
      );
    return true;
  }

  rejectAll(message: string): void {
    for (const [requestId, pending] of this.#pending) {
      clearTimeout(pending.timeout);
      this.sendCancel({ requestId });
      pending.reject(new Error(message));
    }
    this.#pending.clear();
  }
}
