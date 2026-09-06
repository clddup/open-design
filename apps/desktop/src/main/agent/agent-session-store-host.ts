import { awaitAbortable } from "../abortable-operation";
import type { SessionStore } from "@opendesign/session-store";
import type {
  SessionStoreBridgeRequest,
  SessionStoreBridgeResponse,
} from "@/shared/session-store-bridge.js";

type SuccessfulSessionStoreResponse = Extract<
  SessionStoreBridgeResponse,
  { ok: true }
>;

/** Main-owned persistence endpoint for the unprivileged Agent process. */
export class AgentSessionStoreHost {
  constructor(private readonly store: SessionStore) {}

  execute(
    request: SessionStoreBridgeRequest,
    signal: AbortSignal,
  ): Promise<SuccessfulSessionStoreResponse> {
    throwIfAborted(signal);
    const operation = this.executeOperation(request);
    return awaitAbortable(operation, signal);
  }

  private async executeOperation(
    request: SessionStoreBridgeRequest,
  ): Promise<SuccessfulSessionStoreResponse> {
    if (request.operation === "append") {
      await this.store.append(request.event);
      return {
        type: "session-store.response",
        requestId: request.requestId,
        operation: "append",
        ok: true,
        result: null,
      };
    }
    if (request.operation === "read") {
      return {
        type: "session-store.response",
        requestId: request.requestId,
        operation: "read",
        ok: true,
        result: await this.store.read(request.sessionId),
      };
    }
    if (request.operation === "readTimeline") {
      return {
        type: "session-store.response",
        requestId: request.requestId,
        operation: "readTimeline",
        ok: true,
        result: await this.store.readTimeline(request.sessionId),
      };
    }
    return {
      type: "session-store.response",
      requestId: request.requestId,
      operation: "project",
      ok: true,
      result: await this.store.project(request.sessionId),
    };
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new DOMException("Session request cancelled", "AbortError");
}
