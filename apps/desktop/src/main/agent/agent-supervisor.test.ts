import { AGENT_PROTOCOL_VERSION } from "@opendesign/agent-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSupervisor, type AgentUtilityProcess } from "./agent-supervisor";

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentSupervisor", () => {
  it("owns the ready handshake and publishes only a connected generation", async () => {
    const process = processFixture(101);
    const fixture = supervisorFixture([process.child]);

    const started = fixture.supervisor.start();
    expect(fixture.supervisor.state).toEqual({
      status: "starting",
      generation: 1,
    });

    process.emit("message", {
      type: "agent.ready",
      protocolVersion: AGENT_PROTOCOL_VERSION,
      runtimeVersion: "0.0.0",
    });
    expect(fixture.supervisor.state.status).toBe("handshaking");
    expect(process.postMessage).toHaveBeenCalledWith({
      type: "handshake",
      protocolVersion: AGENT_PROTOCOL_VERSION,
      clientVersion: "0.0.0",
    });

    process.emit("message", {
      type: "agent.connected",
      protocolVersion: AGENT_PROTOCOL_VERSION,
    });
    await started;
    expect(fixture.supervisor.state).toEqual({
      status: "ready",
      generation: 1,
    });
    expect(fixture.messages.map((entry) => entry.generation)).toEqual([1, 1]);

    fixture.supervisor.send({ type: "run.cancel", runId: "run_1" });
    expect(process.postMessage).toHaveBeenLastCalledWith({
      type: "run.cancel",
      runId: "run_1",
    });
  });

  it("shares one startup lease across concurrent callers", async () => {
    const process = processFixture(102);
    const fixture = supervisorFixture([process.child]);

    const first = fixture.supervisor.start();
    const second = fixture.supervisor.start();
    expect(first).toBe(second);
    expect(fixture.fork).toHaveBeenCalledOnce();

    connect(process);
    await Promise.all([first, second]);
  });

  it("reports a synchronous process spawn failure", async () => {
    const failures: Array<{ code: string; message: string }> = [];
    const supervisor = new AgentSupervisor({
      clientVersion: "0.0.0",
      fork: () => {
        throw new Error("fork unavailable");
      },
      forceKill: vi.fn(),
      onFailure: (failure) => failures.push(failure),
      onMessage: vi.fn(),
      onProcessTerminated: vi.fn(),
    });

    await expect(supervisor.start()).rejects.toThrow("fork unavailable");
    expect(failures).toEqual([
      { code: "process_error", message: "fork unavailable" },
    ]);
    expect(supervisor.state).toEqual({ status: "stopped", generation: 1 });
  });

  it("fails closed when the process never completes its handshake", async () => {
    vi.useFakeTimers();
    const process = processFixture(103);
    const fixture = supervisorFixture([process.child], {
      readyTimeoutMs: 100,
      stopTimeoutMs: 50,
    });

    const started = fixture.supervisor.start();
    const rejected = expect(started).rejects.toThrow(
      "Agent process did not become ready within 100ms",
    );
    await vi.advanceTimersByTimeAsync(100);

    await rejected;
    expect(process.kill).toHaveBeenCalledOnce();
    expect(fixture.failures).toEqual([
      expect.objectContaining({ code: "ready_timeout" }),
    ]);

    process.emit("exit", 0);
    expect(fixture.supervisor.state.status).toBe("stopped");
    expect(fixture.terminated).toEqual([1]);
  });

  it("rejects an incompatible process before Agent requests can be sent", async () => {
    const process = processFixture(104);
    const fixture = supervisorFixture([process.child]);
    const started = fixture.supervisor.start();
    const rejected = expect(started).rejects.toThrow("Agent protocol mismatch");

    process.emit("message", {
      type: "agent.ready",
      protocolVersion: "incompatible",
      runtimeVersion: "0.0.0",
    });

    await rejected;
    expect(process.kill).toHaveBeenCalledOnce();
    expect(fixture.failures).toEqual([
      expect.objectContaining({ code: "protocol_mismatch" }),
    ]);
    expect(() =>
      fixture.supervisor.send({ type: "run.cancel", runId: "run_1" }),
    ).toThrow("Agent process is not ready");
  });

  it("rejects a connected event that bypasses the host handshake", async () => {
    const process = processFixture(108);
    const fixture = supervisorFixture([process.child]);
    const started = fixture.supervisor.start();
    const rejected = expect(started).rejects.toThrow(
      "connected before the host handshake",
    );

    process.emit("message", {
      type: "agent.connected",
      protocolVersion: AGENT_PROTOCOL_VERSION,
    });

    await rejected;
    expect(process.kill).toHaveBeenCalledOnce();
    expect(fixture.failures).toEqual([
      expect.objectContaining({ code: "startup_sequence_invalid" }),
    ]);
  });

  it("reports an unexpected ready-process exit and releases its generation", async () => {
    const process = processFixture(105);
    const fixture = supervisorFixture([process.child]);
    const started = fixture.supervisor.start();
    connect(process);
    await started;

    process.emit("exit", 7);

    expect(fixture.failures).toEqual([
      {
        code: "process_exited",
        message: "Agent process exited with code 7",
      },
    ]);
    expect(fixture.supervisor.state).toEqual({
      status: "stopped",
      generation: 1,
    });
    expect(fixture.terminated).toEqual([1]);
  });

  it("force-kills a stuck stop without letting a stale exit clear the next generation", async () => {
    vi.useFakeTimers();
    const first = processFixture(106);
    const second = processFixture(107);
    const fixture = supervisorFixture([first.child, second.child], {
      stopTimeoutMs: 50,
    });
    const firstStart = fixture.supervisor.start();
    connect(first);
    await firstStart;

    const stopped = fixture.supervisor.stop();
    expect(first.kill).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(50);
    await stopped;
    expect(fixture.forceKill).toHaveBeenCalledWith(106);
    expect(fixture.failures).toEqual([
      expect.objectContaining({ code: "stop_timeout" }),
    ]);

    const secondStart = fixture.supervisor.start();
    expect(fixture.supervisor.state).toEqual({
      status: "starting",
      generation: 2,
    });
    first.emit("exit", 0);
    expect(fixture.supervisor.state.generation).toBe(2);
    connect(second);
    await secondStart;
    expect(fixture.supervisor.state).toEqual({
      status: "ready",
      generation: 2,
    });
    const callsBeforeStaleResponse = second.postMessage.mock.calls.length;
    expect(
      fixture.supervisor.postMessageForGeneration(1, {
        type: "model.response",
        requestId: "stale_request",
        ok: true,
      }),
    ).toBe(false);
    expect(second.postMessage).toHaveBeenCalledTimes(callsBeforeStaleResponse);
  });
});

type ProcessFixture = ReturnType<typeof processFixture>;

function connect(process: ProcessFixture): void {
  process.emit("message", {
    type: "agent.ready",
    protocolVersion: AGENT_PROTOCOL_VERSION,
    runtimeVersion: "0.0.0",
  });
  process.emit("message", {
    type: "agent.connected",
    protocolVersion: AGENT_PROTOCOL_VERSION,
  });
}

function processFixture(pid: number) {
  const listeners = new Map<string, (...args: never[]) => void>();
  const postMessage = vi.fn();
  const kill = vi.fn(() => true);
  const child = {
    kill,
    on: vi.fn((event: string, listener: (...args: never[]) => void) => {
      listeners.set(event, listener);
      return child;
    }),
    pid,
    postMessage,
  } as unknown as AgentUtilityProcess;
  return {
    child,
    emit(event: string, ...args: unknown[]) {
      listeners.get(event)?.(...(args as never[]));
    },
    kill,
    postMessage,
  };
}

function supervisorFixture(
  processes: AgentUtilityProcess[],
  timing: { readyTimeoutMs?: number; stopTimeoutMs?: number } = {},
) {
  const failures: Array<{ code: string; message: string }> = [];
  const messages: Array<{ generation: number; message: unknown }> = [];
  const terminated: number[] = [];
  const forceKill = vi.fn();
  const fork = vi.fn(() => {
    const process = processes.shift();
    if (!process) throw new Error("No process fixture is available");
    return process;
  });
  return {
    failures,
    forceKill,
    fork,
    messages,
    supervisor: new AgentSupervisor({
      clientVersion: "0.0.0",
      fork,
      forceKill,
      onFailure: (failure) => failures.push(failure),
      onMessage: (message, generation) =>
        messages.push({ generation, message }),
      onProcessTerminated: (generation) => terminated.push(generation),
      ...timing,
    }),
    terminated,
  };
}
