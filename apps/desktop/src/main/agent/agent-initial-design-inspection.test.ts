import type {
  AgentRequest,
  TrustedToolContext,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import { DESIGN_INSPECT_TOOL_NAME } from "@/shared/design-agent-tools.js";
import {
  INITIAL_DESIGN_INSPECTION_TIMEOUTS,
  prepareInitialDesignInspection,
} from "./agent-initial-design-inspection.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

const request: RunStartRequest = {
  type: "run.start",
  runId: "run_initial_inspection",
  sessionId: "conversation_initial_inspection",
  prompt: "Create a dashboard",
  documentId: "document_1",
  revision: 7,
  scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_1" },
  modelSelection: { providerId: "provider", modelId: "design" },
};

describe("initial design inspection", () => {
  it("registers the exact Renderer snapshot and returns only its bounded model projection", async () => {
    const assertDesignToolContext = vi.fn();
    const recordDocumentInspection = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      content: {
        pageId: "page_1",
        revision: 7,
        text: "x".repeat(20_000),
      },
      observedRevision: 7,
    });
    const result = await prepareInitialDesignInspection(
      request,
      {
        coordinator: {
          assertDesignToolContext,
          resolveExecutionContext: (context) => ({
            ...context,
            scope: { kind: "document", selectedNodeIds: [], pageId: "page_1" },
            mutationTarget: { kind: "document" },
          }),
          recordDocumentInspection,
          getRecoverableDelivery: () => ({
            version: 4,
            activeTargetId: "target_home",
            targets: [
              {
                targetId: "target_home",
                label: "Home",
                pageId: "page_1",
                rootNodeId: "frame_home",
                reservedNodeIds: ["frame_home"],
                status: "pending",
              },
            ],
          }),
          getDeliveryStageContext: () => ({
            totalTargets: 2,
            plannedTargets: 1,
            verifiedTargets: 0,
            currentPlan: {
              stage: 1,
              status: "active",
              targets: [
                {
                  targetId: "target_home",
                  label: "Home",
                  objective: "Design Home",
                  requiredContent: ["Home content"],
                },
              ],
            },
          }),
        },
        renderer: { execute },
      },
      new AbortController().signal,
    );

    expect(assertDesignToolContext).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: request.runId,
        revision: request.revision,
        mutationTarget: request.mutationTarget,
      }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: DESIGN_INSPECT_TOOL_NAME,
        input: {},
      }),
      expect.objectContaining({ mutationTarget: { kind: "document" } }),
      expect.any(AbortSignal),
      { timeouts: INITIAL_DESIGN_INSPECTION_TIMEOUTS },
    );
    expect(recordDocumentInspection).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      version: 1,
      observedRevision: request.revision,
    });
    expect(result.content).toMatchObject({
      inspection: { pageId: "page_1" },
      unfinishedDelivery: { activeTargetId: "target_home" },
      deliveryStage: { totalTargets: 2, plannedTargets: 1 },
    });
    expect(JSON.stringify(result.content)).not.toContain("x".repeat(20_000));
  });

  it("rejects a concurrent revision instead of injecting a stale snapshot", async () => {
    const recordDocumentInspection = vi.fn();
    await expect(
      prepareInitialDesignInspection(
        request,
        {
          coordinator: {
            assertDesignToolContext: vi.fn(),
            resolveExecutionContext: (context) => context,
            recordDocumentInspection,
            getRecoverableDelivery: () => undefined,
            getDeliveryStageContext: () => undefined,
          },
          renderer: {
            execute: vi.fn().mockResolvedValue({
              content: { pageId: "page_1", revision: 8 },
              observedRevision: 8,
            }),
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("initial_inspection_stale");
    expect(recordDocumentInspection).not.toHaveBeenCalled();
  });

  it("rejects a non-object projection and reports document revision drift", async () => {
    const execute = vi.fn();
    const dependencies = {
      coordinator: {
        assertDesignToolContext: vi.fn(),
        resolveExecutionContext: (context: TrustedToolContext) => context,
        recordDocumentInspection: vi.fn(),
        getRecoverableDelivery: () => undefined,
        getDeliveryStageContext: () => undefined,
      },
      renderer: { execute },
    };
    execute.mockResolvedValueOnce({
      content: "not structured",
      observedRevision: 7,
    });
    await expect(
      prepareInitialDesignInspection(
        request,
        dependencies,
        new AbortController().signal,
      ),
    ).rejects.toThrow("/content/inspection");

    execute.mockResolvedValueOnce({
      content: {
        document: {
          documentId: "document_1",
          revision: 8,
          pagesById: {},
          nodesById: {},
        },
      },
      observedRevision: 7,
    });
    await expect(
      prepareInitialDesignInspection(
        request,
        dependencies,
        new AbortController().signal,
      ),
    ).rejects.toThrow("/content/inspection/document/revision");
  });
});
