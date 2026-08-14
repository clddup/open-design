import type { DesignError } from "@opendesign/design-contracts";

export class OperationError extends Error {
  readonly commandId: string;
  readonly code: DesignError["code"];
  readonly path: string | undefined;
  readonly details: DesignError["details"] | undefined;
  readonly retryable: boolean;

  constructor(
    commandId: string,
    message: string,
    code: DesignError["code"] = "invalid",
    options: {
      path?: string;
      details?: DesignError["details"];
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.commandId = commandId;
    this.code = code;
    this.path = options.path;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}
