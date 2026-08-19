import type {
  AgentUnresolvedDesignWriteFailure,
  TrustedToolFailure,
} from "./index.js";

export class PiDesignFailureRecovery {
  readonly #attempts = new Map<string, number>();
  readonly #blockedInputs = new Map<string, TrustedToolFailure>();
  #inspectionRequiredFailure: TrustedToolFailure | undefined;
  #unresolvedFailure: AgentUnresolvedDesignWriteFailure | undefined;

  get inspectionRequiredFailure(): TrustedToolFailure | undefined {
    return this.#inspectionRequiredFailure;
  }

  get unresolvedFailure():
    Readonly<AgentUnresolvedDesignWriteFailure> | undefined {
    return this.#unresolvedFailure;
  }

  blockedFailure(
    toolName: string,
    input: unknown,
  ): TrustedToolFailure | undefined {
    return this.#blockedInputs.get(toolInputFingerprint(toolName, input));
  }

  recordFailure(options: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    failure: TrustedToolFailure;
    designWrite: boolean;
  }): TrustedToolFailure {
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
    const attempt = (this.#attempts.get(fingerprint) ?? 0) + 1;
    this.#attempts.set(fingerprint, attempt);
    const maxAttempts = 2;
    const enriched: TrustedToolFailure = {
      ...options.failure,
      details: {
        ...details,
        attempt,
        maxAttempts,
        ...(attempt >= maxAttempts ? { retrySuppressed: true } : {}),
      },
    };
    if (attempt >= maxAttempts) {
      this.#blockedInputs.set(
        toolInputFingerprint(options.toolName, options.input),
        enriched,
      );
    }
    if (details.recovery.required) {
      this.#inspectionRequiredFailure = enriched;
      if (options.designWrite) {
        this.#unresolvedFailure = {
          toolCallId: options.toolCallId,
          toolName: options.toolName,
          code: enriched.code,
          message: enriched.message,
          inspectionCompleted: false,
          ...(enriched.details === undefined
            ? {}
            : { details: enriched.details }),
        };
      }
    }
    return enriched;
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

  recordRevisionWrite(): void {
    this.#unresolvedFailure = undefined;
  }
}

function toolInputFingerprint(toolName: string, input: unknown): string {
  return `${toolName}:${hashText(stableJson(input))}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
