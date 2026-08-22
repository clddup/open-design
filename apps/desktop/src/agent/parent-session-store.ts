import type {
  JournalEvent,
  SessionProjection,
  SessionStore,
  SessionTimelineItem,
} from "@opendesign/session-store";
import {
  isSessionStoreBridgeResponse,
  sessionStoreBridgeResponseId,
  type SessionStoreBridgeRequest,
  type SessionStoreBridgeResponse,
  type SessionStoreOperation,
} from "../shared/session-store-bridge.js";

interface ParentPortLike {
  postMessage(message: unknown): void;
}

type PendingRequest = {
  operation: SessionStoreOperation;
  reject: (error: Error) => void;
  resolve: (response: SessionStoreBridgeResponse) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const SESSION_REQUEST_TIMEOUT_MS = 30_000;

/** Agent-side SessionStore proxy. All persistence and paths remain in Main. */
export class ParentSessionStore implements SessionStore {
  readonly #pending = new Map<string, PendingRequest>();
  #sequence = 0;

  constructor(private readonly port: ParentPortLike) {}

  append<T>(event: JournalEvent<T>): Promise<void> {
    return this.request({
      type: "session-store.request",
      requestId: this.nextRequestId(),
      operation: "append",
      event,
    }).then(() => undefined);
  }

  read(sessionId: string): Promise<JournalEvent[]> {
    return this.request({
      type: "session-store.request",
      requestId: this.nextRequestId(),
      operation: "read",
      sessionId,
    }).then((response) => {
      if (!response.ok || response.operation !== "read") {
        throw new TypeError("Session Store returned the wrong read response");
      }
      return response.result;
    });
  }

  readTimeline(sessionId: string): Promise<SessionTimelineItem[]> {
    return this.request({
      type: "session-store.request",
      requestId: this.nextRequestId(),
      operation: "readTimeline",
      sessionId,
    }).then((response) => {
      if (!response.ok || response.operation !== "readTimeline") {
        throw new TypeError(
          "Session Store returned the wrong timeline response",
        );
      }
      return response.result;
    });
  }

  project(sessionId: string): Promise<SessionProjection> {
    return this.request({
      type: "session-store.request",
      requestId: this.nextRequestId(),
      operation: "project",
      sessionId,
    }).then((response) => {
      if (!response.ok || response.operation !== "project") {
        throw new TypeError(
          "Session Store returned the wrong projection response",
        );
      }
      return response.result;
    });
  }

  handleMessage(message: unknown): boolean {
    const requestId = sessionStoreBridgeResponseId(message);
    if (!requestId) return false;
    const pending = this.#pending.get(requestId);
    if (!pending) return true;
    this.#pending.delete(requestId);
    clearTimeout(pending.timeout);
    if (
      !isSessionStoreBridgeResponse(message) ||
      message.operation !== pending.operation
    ) {
      pending.reject(
        new TypeError("Main returned an invalid Session Store response"),
      );
      return true;
    }
    if (!message.ok) {
      pending.reject(new Error(message.error));
      return true;
    }
    pending.resolve(message);
    return true;
  }

  private request(
    request: SessionStoreBridgeRequest,
  ): Promise<SessionStoreBridgeResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.delete(request.requestId)) return;
        reject(new Error(`Session Store ${request.operation} timed out`));
      }, SESSION_REQUEST_TIMEOUT_MS);
      timeout.unref?.();
      this.#pending.set(request.requestId, {
        operation: request.operation,
        reject,
        resolve,
        timeout,
      });
      this.port.postMessage(request);
    });
  }

  private nextRequestId(): string {
    return `session_${process.pid}_${Date.now()}_${++this.#sequence}`;
  }
}
