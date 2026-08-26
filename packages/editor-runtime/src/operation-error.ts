import type { DesignError, DesignIssue } from "@opendesign/design-contracts";

export class OperationError extends Error {
  readonly commandId: string;
  readonly code: DesignError["code"];
  readonly path: string | undefined;
  readonly context: DesignError["context"] | undefined;
  readonly issues: readonly DesignIssue[] | undefined;
  readonly retryable: boolean;

  constructor(
    commandId: string,
    message: string,
    code: DesignError["code"] = "invalid",
    options: {
      path?: string;
      context?: DesignError["context"];
      issues?: readonly DesignIssue[];
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.commandId = commandId;
    this.code = code;
    this.path = options.path;
    this.context = options.context;
    this.issues = options.issues;
    this.retryable = options.retryable ?? false;
  }
}
