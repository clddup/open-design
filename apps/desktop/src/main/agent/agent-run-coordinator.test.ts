import type {
  AgentEvent,
  AgentInitialDesignInspection,
  AgentRequest,
} from "@opendesign/agent-contracts";
import { createEmptyDesignDocument } from "@opendesign/editor-runtime";
import type { DesignDocument } from "@opendesign/design-contracts";
import { describe, expect, it, vi } from "vitest";
import type { AgentHost } from "./agent-host";
import {
  AgentRunCoordinator,
  type AgentRunCoordinatorServices,
} from "./agent-run-coordinator";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

const source: RunStartRequest = {
  type: "run.start",
  runId: "run_1",
  sessionId: "conversation_1",
  prompt: "Build a design",
  documentId: "document_1",
  revision: 4,
  scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_1" },
  modelSelection: { providerId: "provider_1", modelId: "model_1" },
};

const trustedSource: RunStartRequest = {
  ...source,
  deliveryScopeReview: "direct",
};

describe("AgentRunCoordinator", () => {
  it("owns registration, preflight, reference and conversation leases", async () => {
    const fixture = setup();
    const inspection = {
      version: 1 as const,
      observedRevision: source.revision,
      content: { inspection: { pageId: "page_1" } },
    };
    fixture.prepareInitialDesignInspection.mockResolvedValue(inspection);

    await fixture.coordinator.handleRequest(source);

    expect(fixture.globalTaskCoordinator.registerRun).toHaveBeenCalledWith(
      trustedSource,
    );
    expect(fixture.prepareInitialDesignInspection).toHaveBeenCalledWith(
      trustedSource,
      expect.any(AbortSignal),
    );
    expect(fixture.referenceHost.registerRun).toHaveBeenCalledWith(
      trustedSource,
      [],
    );
    expect(fixture.send).toHaveBeenCalledWith({
      ...trustedSource,
      initialDesignInspection: inspection,
      modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
    });
    expect(fixture.coordinator.conversationIdForRun(source.runId)).toBe(
      source.sessionId,
    );
    expect(fixture.coordinator.hasActiveConversationRun(source.sessionId)).toBe(
      true,
    );
  });

  it("releases the exact Run lease after its terminal event", async () => {
    const fixture = setup();
    await fixture.coordinator.handleRequest(source);
    const completed: AgentEvent = {
      type: "run.completed",
      runId: source.runId,
      finishedAt: "2026-08-23T01:00:00.000Z",
      stopReason: "complete",
    };

    fixture.coordinator.handleEvent(completed);

    expect(fixture.referenceHost.releaseRun).toHaveBeenCalledWith(source.runId);
    expect(fixture.forgetRun).toHaveBeenCalledWith(source.runId);
    expect(fixture.globalTaskCoordinator.handleAgentEvent).toHaveBeenCalledWith(
      completed,
    );
    expect(
      fixture.coordinator.conversationIdForRun(source.runId),
    ).toBeUndefined();
    expect(fixture.coordinator.hasActiveConversationRun(source.sessionId)).toBe(
      false,
    );
  });

  it("rejects a second explicit message instead of silently queueing it", async () => {
    const fixture = setup();
    await fixture.coordinator.handleRequest(source);
    const second = {
      ...source,
      runId: "run_queued_without_ui",
      prompt: "继续",
    };

    await expect(
      fixture.coordinator.handleRequest(second),
    ).rejects.toMatchObject({ code: "conversation_busy" });
    expect(fixture.globalTaskCoordinator.registerRun).toHaveBeenCalledTimes(1);
    expect(fixture.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ runId: second.runId }),
    );

    fixture.coordinator.handleEvent({
      type: "run.completed",
      runId: source.runId,
      finishedAt: "2026-08-23T01:00:00.000Z",
      stopReason: "complete",
    });
    await fixture.coordinator.handleRequest(second);
    expect(fixture.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "run.start", runId: second.runId }),
    );
  });

  it("accepts the next explicit message as soon as the current Run fails", async () => {
    const fixture = setup();
    await fixture.coordinator.handleRequest(source);
    fixture.coordinator.handleEvent({
      type: "agent.error",
      runId: source.runId,
      code: "provider_timeout",
      message: "Provider timed out",
      failure: {
        code: "provider_timeout",
        message: "Provider timed out",
        retryable: true,
      },
    });

    expect(fixture.coordinator.hasActiveConversationRun(source.sessionId)).toBe(
      false,
    );
    expect(fixture.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "run.continuation" }),
    );

    await fixture.coordinator.handleRequest({
      ...source,
      runId: "run_after_failure",
      prompt: "继续完成当前设计",
    });
    expect(fixture.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run.start",
        runId: "run_after_failure",
        sessionId: source.sessionId,
      }),
    );

    fixture.coordinator.handleEvent({
      type: "run.completed",
      runId: source.runId,
      finishedAt: "2026-08-23T01:00:00.000Z",
      stopReason: "error",
    });
    expect(fixture.coordinator.hasActiveConversationRun(source.sessionId)).toBe(
      true,
    );
  });

  it("releases every Run lease after a process-level Agent failure", async () => {
    const fixture = setup();
    const second = {
      ...source,
      runId: "run_2",
      sessionId: "conversation_2",
    };
    await fixture.coordinator.handleRequest(source);
    await fixture.coordinator.handleRequest(second);
    const failure: AgentEvent = {
      type: "agent.error",
      code: "process_exited",
      message: "Agent process exited",
    };

    fixture.coordinator.handleEvent(failure);

    expect(fixture.referenceHost.releaseRun.mock.calls).toEqual(
      expect.arrayContaining([[source.runId], [second.runId]]),
    );
    expect(fixture.forgetRun.mock.calls).toEqual(
      expect.arrayContaining([[source.runId], [second.runId]]),
    );
    expect(fixture.globalTaskCoordinator.handleAgentEvent).toHaveBeenCalledWith(
      failure,
    );
    expect(fixture.coordinator.hasActiveConversationRun(source.sessionId)).toBe(
      false,
    );
    expect(fixture.coordinator.hasActiveConversationRun(second.sessionId)).toBe(
      false,
    );
  });

  it("aborts an in-flight preflight and rejects new Runs while quiescing", async () => {
    const fixture = setup();
    let observedSignal: AbortSignal | undefined;
    fixture.prepareInitialDesignInspection.mockImplementation(
      (_request, signal) =>
        new Promise<undefined>((resolve) => {
          observedSignal = signal;
          signal.addEventListener("abort", () => resolve(undefined), {
            once: true,
          });
        }),
    );
    const starting = fixture.coordinator.handleRequest(source);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());

    fixture.coordinator.quiesceAndCancelAll();
    await starting;

    expect(observedSignal?.aborted).toBe(true);
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run.completed",
        runId: source.runId,
        stopReason: "cancelled",
      }),
    );
    await expect(
      fixture.coordinator.handleRequest({
        ...source,
        runId: "run_after_quiesce",
      }),
    ).rejects.toThrow("shutting down");
  });

  it("sends cancellation to every active utility-process Run before disposal", async () => {
    const fixture = setup();
    await fixture.coordinator.handleRequest(source);

    fixture.coordinator.quiesceAndCancelAll();
    expect(fixture.send).toHaveBeenLastCalledWith({
      type: "run.cancel",
      runId: source.runId,
    });

    fixture.coordinator.dispose();
    expect(fixture.referenceHost.releaseRun).toHaveBeenCalledWith(source.runId);
    expect(fixture.coordinator.hasActiveConversationRun(source.sessionId)).toBe(
      false,
    );
  });

  it("does not start a continuation whose document read outlives a process failure", async () => {
    const fixture = setup();
    let finishRead!: (value: {
      document: ReturnType<typeof createEmptyDesignDocument>;
    }) => void;
    fixture.projectHost.listOpenProjects.mockReturnValue([
      {
        projectId: "project_1",
        designFiles: [
          { designFileId: "file_1", documentId: source.documentId },
        ],
      },
    ]);
    fixture.projectHost.readDesignFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    await fixture.coordinator.handleRequest(source);
    fixture.coordinator.handleEvent({
      type: "tool.completed",
      runId: source.runId,
      toolCallId: "inspect_1",
      result: {
        unfinishedDelivery: {
          version: 3,
          activeTargetId: "target_1",
          targets: [
            {
              targetId: "target_1",
              label: "Home",
              pageId: "page_1",
              rootNodeId: "frame_1",
              reservedNodeIds: ["frame_1"],
              status: "drafted",
              allocatedRevision: 4,
              draftRevision: 5,
            },
          ],
        },
      },
    });
    fixture.coordinator.handleEvent({
      type: "run.completed",
      runId: source.runId,
      finishedAt: "2026-08-23T01:00:00.000Z",
      stopReason: "budget",
    });
    const scheduled = fixture.publish.mock.calls
      .map(([event]) => event)
      .find(
        (event) =>
          event.type === "run.continuation" && event.status === "scheduled",
      );
    if (!scheduled || scheduled.type !== "run.continuation") {
      throw new Error("Continuation was not scheduled");
    }

    fixture.coordinator.handleEvent({
      type: "agent.error",
      code: "process_exited",
      message: "Agent process exited",
    });
    finishRead({
      document: {
        ...createEmptyDesignDocument(source.documentId, "page_1"),
        revision: 5,
      },
    });

    await vi.waitFor(() =>
      expect(fixture.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "run.completed",
          runId: scheduled.nextRunId,
          stopReason: "cancelled",
        }),
      ),
    );
    expect(fixture.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run.start",
        runId: scheduled.nextRunId,
      }),
    );
  });
});

function setup() {
  const send = vi.fn();
  const globalTaskCoordinator = {
    handleAgentEvent: vi.fn(),
    registerRun: vi.fn(() => Promise.resolve({})),
    assertRunRevisionCurrent: vi.fn(() => Promise.resolve()),
    referenceAttachmentsForRun: vi.fn(() => []),
  };
  const modelProviderHost = {
    resolveModelContext: vi.fn(() => ({
      contextWindow: 200_000,
      maxOutputTokens: 16_384,
    })),
  };
  const projectHost = {
    listOpenProjects: vi.fn<
      () => Array<{
        projectId: string;
        designFiles: Array<{ designFileId: string; documentId: string }>;
      }>
    >(() => []),
    readDesignFile: vi.fn<
      (
        projectId: string,
        designFileId: string,
      ) => Promise<{ document: DesignDocument }>
    >(() =>
      Promise.resolve({
        document: createEmptyDesignDocument(source.documentId, "page_1"),
      }),
    ),
  };
  const referenceHost = {
    registerRun: vi.fn(),
    releaseRun: vi.fn(),
  };
  const services = {
    globalTaskCoordinator,
    modelProviderHost,
    projectHost,
    referenceHost,
  } as unknown as AgentRunCoordinatorServices;
  const prepareInitialDesignInspection = vi.fn<
    (
      request: RunStartRequest,
      signal: AbortSignal,
    ) => Promise<AgentInitialDesignInspection | undefined>
  >(() => Promise.resolve(undefined));
  const publish = vi.fn<(event: AgentEvent) => void>();
  const forgetRun = vi.fn();
  const coordinator = new AgentRunCoordinator({
    agentHost: { send } as unknown as AgentHost,
    forgetRun,
    getServices: () => services,
    prepareInitialDesignInspection,
    publish,
  });
  return {
    coordinator,
    forgetRun,
    globalTaskCoordinator,
    modelProviderHost,
    prepareInitialDesignInspection,
    projectHost,
    publish,
    referenceHost,
    send,
  };
}
