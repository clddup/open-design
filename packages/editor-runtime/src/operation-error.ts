import type { DesignError, DesignIssue } from "@opendesign/design-contracts";

type OperationIssueCode = `design.${string}`;

export class OperationError extends Error {
  readonly commandId: string;
  readonly code: DesignError["code"];
  readonly context: DesignError["context"] | undefined;
  readonly issues: readonly DesignIssue[];
  readonly retryable: boolean;

  constructor(
    commandId: string,
    issueCode: OperationIssueCode,
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
    this.context = options.context;
    this.issues = options.issues ?? [
      {
        code: issueCode,
        commandId,
        path: options.path ?? "",
        message,
        ...(options.context === undefined ? {} : { details: options.context }),
      },
    ];
    this.retryable = options.retryable ?? false;
  }
}
