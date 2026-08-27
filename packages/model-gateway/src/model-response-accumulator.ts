import type { ResolvedModelIdentity } from "./provider-config.js";
import type {
  CanonicalContentBlock,
  CanonicalStreamEvent,
  ModelError,
  ModelStopReason,
  ModelUsage,
} from "./canonical-wire.js";

export interface CompletedModelResponse {
  attemptId: string;
  model?: string;
  identity?: ResolvedModelIdentity;
  providerRequestId?: string;
  blocks: CanonicalContentBlock[];
  stopReason: ModelStopReason;
  providerStopReason?: string;
  usage: ModelUsage;
}

export class ModelResponseAccumulator {
  readonly #blocks = new Map<string, CanonicalContentBlock>();
  #model?: string;
  #identity?: ResolvedModelIdentity;
  #providerRequestId?: string;
  #completion?: Extract<CanonicalStreamEvent, { type: "attempt.completed" }>;
  #failure?: ModelError;

  constructor(readonly attemptId: string) {}

  add(event: CanonicalStreamEvent): void {
    if (event.attemptId !== this.attemptId) {
      throw new Error(
        `Attempt mismatch: ${event.attemptId} != ${this.attemptId}`,
      );
    }
    if (event.type === "attempt.started") {
      this.#model = event.model;
      this.#identity = event.identity;
      if (event.providerRequestId !== undefined) {
        this.#providerRequestId = event.providerRequestId;
      }
    }
    if (event.type === "block.completed") {
      this.#blocks.set(event.block.id, event.block);
    }
    if (event.type === "attempt.completed") {
      this.#completion = event;
      if (event.providerRequestId !== undefined) {
        this.#providerRequestId = event.providerRequestId;
      }
    }
    if (event.type === "attempt.failed") this.#failure = event.error;
  }

  completedBlocks(): CanonicalContentBlock[] {
    return [...this.#blocks.values()];
  }

  result(): CompletedModelResponse {
    if (this.#failure) {
      const error = new Error(this.#failure.message);
      error.name = this.#failure.code;
      throw error;
    }
    if (!this.#completion) {
      throw new Error(`Model attempt did not complete: ${this.attemptId}`);
    }
    return {
      attemptId: this.attemptId,
      ...(this.#model === undefined ? {} : { model: this.#model }),
      ...(this.#identity === undefined
        ? {}
        : {
            identity: {
              ...this.#identity,
              ...(this.#providerRequestId === undefined
                ? {}
                : { responseId: this.#providerRequestId }),
            },
          }),
      ...(this.#providerRequestId === undefined
        ? {}
        : { providerRequestId: this.#providerRequestId }),
      blocks: this.completedBlocks(),
      stopReason: this.#completion.stopReason,
      ...(this.#completion.providerStopReason === undefined
        ? {}
        : { providerStopReason: this.#completion.providerStopReason }),
      usage: this.#completion.usage,
    };
  }
}
