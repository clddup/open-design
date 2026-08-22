import {
  AGENT_PROTOCOL_VERSION,
  isAgentEvent,
  type AgentRequest,
} from "@opendesign/agent-contracts";

export type AgentSupervisorFailure = {
  code:
    | "process_error"
    | "process_exited"
    | "protocol_mismatch"
    | "ready_timeout"
    | "startup_sequence_invalid"
    | "stop_timeout";
  message: string;
};

export type AgentSupervisorState =
  | { status: "stopped"; generation: number }
  | {
      status: "starting" | "handshaking" | "ready" | "stopping";
      generation: number;
    };

export interface AgentUtilityProcess {
  kill(): boolean;
  postMessage(message: unknown): void;
  readonly pid?: number;
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(
    event: "error",
    listener: (type: "FatalError", location: string, report: string) => void,
  ): this;
}

export interface AgentSupervisorOptions {
  clientVersion: string;
  fork(): AgentUtilityProcess;
  forceKill(pid: number): void;
  onFailure(failure: AgentSupervisorFailure): void;
  onMessage(message: unknown, generation: number): void;
  onProcessTerminated(generation: number): void;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
}

type ProcessLease = {
  child: AgentUtilityProcess;
  generation: number;
};

type Deferred = {
  promise: Promise<void>;
  reject(error: Error): void;
  resolve(): void;
};

const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_TIMEOUT_MS = 2_000;

/**
 * Owns exactly one Agent utility-process generation and its handshake.
 * Model/tool bridges and Run state remain outside this process lifecycle.
 */
export class AgentSupervisor {
  readonly #options: AgentSupervisorOptions;
  #lease: ProcessLease | null = null;
  #state: AgentSupervisorState = { status: "stopped", generation: 0 };
  #start: Deferred | null = null;
  #stop: Deferred | null = null;
  #readyTimer: ReturnType<typeof setTimeout> | null = null;
  #stopTimer: ReturnType<typeof setTimeout> | null = null;
  #failureReportedGeneration: number | null = null;

  constructor(options: AgentSupervisorOptions) {
    this.#options = options;
  }

  get state(): AgentSupervisorState {
    return { ...this.#state };
  }

  start(): Promise<void> {
    if (this.#state.status === "ready") return Promise.resolve();
    if (this.#start) return this.#start.promise;
    if (this.#stop) {
      return this.#stop.promise.then(() => this.start());
    }

    const generation = this.#state.generation + 1;
    const start = deferred();
    this.#start = start;
    this.#state = { status: "starting", generation };
    this.#failureReportedGeneration = null;
    let child: AgentUtilityProcess;
    try {
      child = this.#options.fork();
    } catch (error) {
      const failure = asError(error, "Agent process failed to start");
      this.#state = { status: "stopped", generation };
      this.#start = null;
      this.#failureReportedGeneration = generation;
      this.#options.onFailure({
        code: "process_error",
        message: failure.message,
      });
      start.reject(failure);
      return start.promise;
    }
    const lease = { child, generation };
    this.#lease = lease;
    child.on("message", (message) => this.#handleMessage(lease, message));
    child.on("exit", (code) => this.#handleExit(lease, code));
    child.on("error", (type, location) => {
      this.#fail(
        lease,
        "process_error",
        `Agent process failed: ${type} at ${location}`,
      );
    });
    this.#readyTimer = setTimeout(() => {
      this.#fail(
        lease,
        "ready_timeout",
        `Agent process did not become ready within ${this.#readyTimeoutMs}ms`,
      );
    }, this.#readyTimeoutMs);
    this.#readyTimer.unref?.();
    return start.promise;
  }

  send(request: AgentRequest): void {
    const lease = this.#lease;
    if (!lease) throw new Error("Agent process is not running");
    if (this.#state.status !== "ready") {
      throw new Error("Agent process is not ready");
    }
    lease.child.postMessage(request);
  }

  postMessageForGeneration(generation: number, message: unknown): boolean {
    const lease = this.#lease;
    if (!lease || lease.generation !== generation) return false;
    lease.child.postMessage(message);
    return true;
  }

  stop(): Promise<void> {
    const lease = this.#lease;
    if (!lease) return Promise.resolve();
    if (this.#stop) return this.#stop.promise;

    const stop = deferred();
    this.#stop = stop;
    this.#state = { status: "stopping", generation: lease.generation };
    this.#clearReadyTimer();
    this.#rejectStart(new Error("Agent process stopped before becoming ready"));
    lease.child.kill();
    this.#stopTimer = setTimeout(() => {
      if (!this.#isCurrent(lease)) return;
      const pid = lease.child.pid;
      if (pid !== undefined) {
        try {
          this.#options.forceKill(pid);
        } catch {
          // The process may have exited between the timeout and force kill.
        }
      }
      this.#reportFailure(lease, {
        code: "stop_timeout",
        message: `Agent process did not exit within ${this.#stopTimeoutMs}ms`,
      });
      this.#finalize(lease);
    }, this.#stopTimeoutMs);
    this.#stopTimer.unref?.();
    return stop.promise;
  }

  #handleMessage(lease: ProcessLease, message: unknown): void {
    if (!this.#isCurrent(lease)) return;
    if (isAgentEvent(message) && message.type === "agent.ready") {
      if (this.#state.status !== "starting") {
        this.#fail(
          lease,
          "startup_sequence_invalid",
          "Agent process repeated its ready event",
        );
        return;
      }
      if (message.protocolVersion !== AGENT_PROTOCOL_VERSION) {
        this.#fail(
          lease,
          "protocol_mismatch",
          `Agent protocol mismatch: ${message.protocolVersion} != ${AGENT_PROTOCOL_VERSION}`,
        );
        return;
      }
      this.#state = { status: "handshaking", generation: lease.generation };
      lease.child.postMessage({
        type: "handshake",
        protocolVersion: AGENT_PROTOCOL_VERSION,
        clientVersion: this.#options.clientVersion,
      } satisfies AgentRequest);
    } else if (isAgentEvent(message) && message.type === "agent.connected") {
      if (this.#state.status !== "handshaking") {
        this.#fail(
          lease,
          "startup_sequence_invalid",
          "Agent process connected before the host handshake",
        );
        return;
      }
      if (message.protocolVersion !== AGENT_PROTOCOL_VERSION) {
        this.#fail(
          lease,
          "protocol_mismatch",
          `Agent protocol mismatch: ${message.protocolVersion} != ${AGENT_PROTOCOL_VERSION}`,
        );
        return;
      }
      this.#clearReadyTimer();
      this.#state = { status: "ready", generation: lease.generation };
      this.#resolveStart();
    }
    this.#options.onMessage(message, lease.generation);
  }

  #handleExit(lease: ProcessLease, code: number): void {
    if (!this.#isCurrent(lease)) return;
    const expected = this.#state.status === "stopping";
    if (!expected) {
      this.#reportFailure(lease, {
        code: "process_exited",
        message: `Agent process exited with code ${code}`,
      });
      this.#rejectStart(new Error(`Agent process exited with code ${code}`));
    }
    this.#finalize(lease);
  }

  #fail(
    lease: ProcessLease,
    code: AgentSupervisorFailure["code"],
    message: string,
  ): void {
    if (!this.#isCurrent(lease)) return;
    this.#reportFailure(lease, { code, message });
    this.#rejectStart(new Error(message));
    this.#state = { status: "stopping", generation: lease.generation };
    this.#clearReadyTimer();
    lease.child.kill();
    if (!this.#stop) this.#stop = deferred();
    this.#stopTimer = setTimeout(() => {
      if (!this.#isCurrent(lease)) return;
      const pid = lease.child.pid;
      if (pid !== undefined) {
        try {
          this.#options.forceKill(pid);
        } catch {
          // The process may have exited between the timeout and force kill.
        }
      }
      this.#finalize(lease);
    }, this.#stopTimeoutMs);
    this.#stopTimer.unref?.();
  }

  #reportFailure(lease: ProcessLease, failure: AgentSupervisorFailure): void {
    if (this.#failureReportedGeneration === lease.generation) return;
    this.#failureReportedGeneration = lease.generation;
    this.#options.onFailure(failure);
  }

  #finalize(lease: ProcessLease): void {
    if (!this.#isCurrent(lease)) return;
    this.#clearReadyTimer();
    this.#clearStopTimer();
    this.#lease = null;
    this.#state = { status: "stopped", generation: lease.generation };
    this.#rejectStart(new Error("Agent process stopped before becoming ready"));
    this.#stop?.resolve();
    this.#stop = null;
    this.#options.onProcessTerminated(lease.generation);
  }

  #isCurrent(lease: ProcessLease): boolean {
    return this.#lease === lease;
  }

  #resolveStart(): void {
    this.#start?.resolve();
    this.#start = null;
  }

  #rejectStart(error: Error): void {
    this.#start?.reject(error);
    this.#start = null;
  }

  #clearReadyTimer(): void {
    if (this.#readyTimer) clearTimeout(this.#readyTimer);
    this.#readyTimer = null;
  }

  #clearStopTimer(): void {
    if (this.#stopTimer) clearTimeout(this.#stopTimer);
    this.#stopTimer = null;
  }

  get #readyTimeoutMs(): number {
    return this.#options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  }

  get #stopTimeoutMs(): number {
    return this.#options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  }
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}
