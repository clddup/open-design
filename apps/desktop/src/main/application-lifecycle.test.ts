import { describe, expect, it, vi } from "vitest";
import {
  ApplicationLifecycle,
  type ApplicationLifecycleOptions,
  type ApplicationShutdownResources,
} from "./application-lifecycle.js";

describe("ApplicationLifecycle", () => {
  it("keeps macOS alive after an ordinary last-window close", () => {
    const fixture = setup("darwin");

    fixture.lifecycle.handleWindowAllClosed();

    expect(fixture.quit).not.toHaveBeenCalled();
  });

  it("quits after the last window closes on Windows", () => {
    const fixture = setup("win32");

    fixture.lifecycle.handleWindowAllClosed();

    expect(fixture.quit).toHaveBeenCalledOnce();
  });

  it("resumes a requested macOS application quit after Renderer autosave", () => {
    const fixture = setup("darwin");
    fixture.lifecycle.handleBeforeQuit();

    fixture.lifecycle.handleWindowAllClosed();

    expect(fixture.quit).toHaveBeenCalledOnce();
  });

  it("holds will-quit until ordered teardown and diagnostic flush complete", async () => {
    const order: string[] = [];
    let finishFlush!: () => void;
    const flush = new Promise<void>((resolve) => {
      finishFlush = resolve;
    });
    const fixture = setup("win32", {
      abortActiveWork: () => {
        order.push("abort");
      },
      stopAgent: () => {
        order.push("stop-agent");
      },
      detachAgentHandlers: () => {
        order.push("detach-agent");
      },
      rejectRendererTools: () => {
        order.push("reject-tools");
      },
      closeWorkspace: () => {
        order.push("close-workspace");
      },
      clearCorrelations: () => {
        order.push("clear-correlations");
      },
      flushDiagnostics: async () => {
        order.push("flush-start");
        await flush;
        order.push("flush-end");
      },
      clearServices: () => {
        order.push("clear-services");
      },
    });
    const event = { preventDefault: vi.fn() };

    const shuttingDown = fixture.lifecycle.handleWillQuit(event);
    await vi.waitFor(() => expect(order).toContain("flush-start"));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.exit).not.toHaveBeenCalled();
    expect(order).toEqual([
      "abort",
      "stop-agent",
      "detach-agent",
      "reject-tools",
      "close-workspace",
      "clear-correlations",
      "flush-start",
    ]);

    finishFlush();
    await shuttingDown;
    expect(order).toEqual([
      "abort",
      "stop-agent",
      "detach-agent",
      "reject-tools",
      "close-workspace",
      "clear-correlations",
      "flush-start",
      "flush-end",
      "clear-services",
    ]);
    expect(fixture.exit).toHaveBeenCalledWith(0);
  });

  it("runs teardown and exits exactly once across repeated will-quit events", async () => {
    const fixture = setup("darwin");
    const first = { preventDefault: vi.fn() };
    const second = { preventDefault: vi.fn() };

    await Promise.all([
      fixture.lifecycle.handleWillQuit(first),
      fixture.lifecycle.handleWillQuit(second),
    ]);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).toHaveBeenCalledOnce();
    for (const step of Object.values(fixture.resources)) {
      expect(step).toHaveBeenCalledOnce();
    }
    expect(fixture.exit).toHaveBeenCalledOnce();
  });

  it("waits for the Agent supervisor before detaching Agent handlers", async () => {
    const order: string[] = [];
    let finishAgentStop!: () => void;
    const agentStopped = new Promise<void>((resolve) => {
      finishAgentStop = resolve;
    });
    const fixture = setup("win32", {
      abortActiveWork: () => {
        order.push("abort");
      },
      stopAgent: async () => {
        order.push("stop-agent-start");
        await agentStopped;
        order.push("stop-agent-end");
      },
      detachAgentHandlers: () => {
        order.push("detach-agent");
      },
    });

    const shuttingDown = fixture.lifecycle.handleWillQuit({
      preventDefault: vi.fn(),
    });
    await vi.waitFor(() => expect(order).toContain("stop-agent-start"));
    expect(order).toEqual(["abort", "stop-agent-start"]);

    finishAgentStop();
    await shuttingDown;
    expect(order).toEqual([
      "abort",
      "stop-agent-start",
      "stop-agent-end",
      "detach-agent",
    ]);
  });

  it("continues remaining teardown steps when one resource fails", async () => {
    const fixture = setup("win32", {
      stopAgent: () => {
        throw new Error("Agent stop failed");
      },
      flushDiagnostics: () => {
        throw new Error("Diagnostic flush failed");
      },
    });

    await fixture.lifecycle.handleWillQuit({ preventDefault: vi.fn() });

    expect(fixture.resources.clearServices).toHaveBeenCalledOnce();
    expect(fixture.reportShutdownError).toHaveBeenCalledOnce();
    const error = fixture.reportShutdownError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect(fixture.exit).toHaveBeenCalledWith(0);
  });
});

function setup(
  platform: NodeJS.Platform,
  overrides: Partial<ApplicationShutdownResources> = {},
) {
  const resources = {
    abortActiveWork: vi.fn(overrides.abortActiveWork ?? (() => undefined)),
    clearCorrelations: vi.fn(overrides.clearCorrelations ?? (() => undefined)),
    clearServices: vi.fn(overrides.clearServices ?? (() => undefined)),
    closeWorkspace: vi.fn(overrides.closeWorkspace ?? (() => undefined)),
    detachAgentHandlers: vi.fn(
      overrides.detachAgentHandlers ?? (() => undefined),
    ),
    flushDiagnostics: vi.fn(
      overrides.flushDiagnostics ?? (() => Promise.resolve()),
    ),
    rejectRendererTools: vi.fn(
      overrides.rejectRendererTools ?? (() => undefined),
    ),
    stopAgent: vi.fn(overrides.stopAgent ?? (() => undefined)),
  } satisfies ApplicationShutdownResources;
  const exit = vi.fn();
  const quit = vi.fn();
  const reportShutdownError = vi.fn<(error: unknown) => void>();
  const options: ApplicationLifecycleOptions = {
    exit,
    platform,
    quit,
    reportShutdownError,
    resources,
  };
  return {
    exit,
    lifecycle: new ApplicationLifecycle(options),
    quit,
    reportShutdownError,
    resources,
  };
}
