import type { TrustedToolFailure } from "@opendesign/agent-contracts";
import type { AgentUnresolvedDesignWriteFailure } from "./completion-guard.js";
import type { AgentToolDefinition } from "./runtime-ports.js";

export class PiDesignFailureRecovery {
  #inspectionRequiredFailure: TrustedToolFailure | undefined;
  #unresolvedFailure: AgentUnresolvedDesignWriteFailure | undefined;

  get inspectionRequiredFailure(): TrustedToolFailure | undefined {
    return this.#inspectionRequiredFailure;
  }

  get unresolvedFailure():
    Readonly<AgentUnresolvedDesignWriteFailure> | undefined {
    return this.#unresolvedFailure;
  }

  recordFailure(options: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    failure: TrustedToolFailure;
    designWrite: boolean;
    modelDisclosure: AgentToolDefinition["modelDisclosure"];
  }): TrustedToolFailure {
    if (options.modelDisclosure?.role === "delivery-scope") {
      return options.failure;
    }
    const details = options.failure.details;
    const fingerprint = details?.fingerprint;
    if (options.designWrite && options.failure.recoverable) {
      this.#unresolvedFailure = {
        toolCallId: options.toolCallId,
        toolName: options.toolName,
        code: options.failure.code,
        message: options.failure.message,
        inspectionCompleted: false,
        ...(details === undefined ? {} : { details }),
      };
    }
    if (!details || !fingerprint || !options.failure.recoverable) {
      return options.failure;
    }
    if (details.recovery.required) {
      this.#inspectionRequiredFailure = options.failure;
      if (options.designWrite) {
        this.#unresolvedFailure = {
          toolCallId: options.toolCallId,
          toolName: options.toolName,
          code: options.failure.code,
          message: options.failure.message,
          inspectionCompleted: false,
          details,
        };
      }
    }
    return options.failure;
  }

  recordInspection(): void {
    this.#inspectionRequiredFailure = undefined;
    if (this.#unresolvedFailure) {
      this.#unresolvedFailure = {
        ...this.#unresolvedFailure,
        inspectionCompleted: true,
      };
    }
  }

  recordPageClear(toolName: string, input: unknown, content: unknown): void {
    if (
      toolName !== "opendesign_manage_pages" ||
      typeof input !== "object" ||
      input === null ||
      !("action" in input) ||
      input.action !== "clear" ||
      typeof content !== "object" ||
      content === null ||
      !("deliveryDisposition" in content) ||
      content.deliveryDisposition !== "superseded"
    )
      return;
    this.#inspectionRequiredFailure = undefined;
    this.#unresolvedFailure = undefined;
  }

  recordRevisionWrite(): void {
    this.#unresolvedFailure = undefined;
  }
}
