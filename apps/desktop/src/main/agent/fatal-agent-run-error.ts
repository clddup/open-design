export class FatalAgentRunError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FatalAgentRunError";
  }
}
