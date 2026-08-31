import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  type DesignDeliveryScope,
} from "@/shared/design-agent-tools.js";
import { handleDeliveryScopeTool } from "./delivery-scope-tool-handler.js";

const context: TrustedToolContext = {
  runId: "run_scope",
  sessionId: "conversation_scope",
  documentId: "document_scope",
  revision: 0,
  scope: { kind: "page", pageId: "page_current", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_current" },
};

describe("handleDeliveryScopeTool", () => {
  it("allocates every confirmed target atomically before executable planning", async () => {
    const scope: DesignDeliveryScope = {
      version: 1,
      deliverable: "ui",
      objective: "Design the complete 24-screen product suite",
      targets: Array.from({ length: 24 }, (_, index) => ({
        targetId: `screen-${index + 1}`,
        label: `Screen ${index + 1}`,
        objective: `Design complete product screen ${index + 1}`,
        artboard: { width: 1440, height: 900 },
        requiredContent: [`Screen ${index + 1} content`],
      })),
      exclusions: [],
      assumptions: [],
    };
    const allocation = {
      artboards: scope.targets.map((target, index) => ({
        targetId: target.targetId,
        label: target.label,
        pageId: "page_current",
        frameId: `run_scope_scope_${index + 1}`,
        x: index * 1600,
        y: 0,
        width: target.artboard.width,
        height: target.artboard.height,
      })),
      input: {
        label: "Allocate 24 confirmed artboards",
        commands: scope.targets.map((_, index) => ({
          commandId: `allocate_scope_${index + 1}`,
        })),
      },
    };
    const coordinator = {
      createDeliveryScopeAllocation: vi.fn(() => allocation),
      recordDeliveryScopeCompleted: vi.fn(() => ({
        scope,
        artboards: allocation.artboards,
      })),
      getDeliveryLedger: vi.fn(() => ({
        targets: allocation.artboards,
      })),
      getDeliveryStageContext: vi.fn(() => ({
        totalTargets: 24,
        plannedTargets: 0,
        verifiedTargets: 0,
      })),
    };
    const rendererHost = {
      execute: vi
        .fn<
          (
            call: ToolCallRequest,
            context: TrustedToolContext,
            signal: AbortSignal,
            options: object,
          ) => Promise<TrustedToolResult>
        >()
        .mockResolvedValue({
          content: { ok: true },
          designRevision: {
            previousRevision: 0,
            revision: 1,
            transactionId: "transaction_scope",
          },
        }),
    };
    const call: ToolCallRequest = {
      toolCallId: "scope_call",
      toolName: DESIGN_DELIVERY_SCOPE_TOOL_NAME,
      input: scope,
    };

    await expect(
      handleDeliveryScopeTool(
        coordinator as never,
        rendererHost as never,
        call,
        context,
        context,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      content: {
        ok: true,
        status: "confirmed",
        nextAction: "define-executable-plan",
      },
    });
    expect(rendererHost.execute).toHaveBeenCalledOnce();
    const [rendererCall, rendererContext, rendererSignal, rendererOptions] =
      rendererHost.execute.mock.calls[0] ?? [];
    expect(rendererCall?.input).toMatchObject({ executionMode: "atomic" });
    expect(rendererContext).toBe(context);
    expect(rendererSignal).toBeInstanceOf(AbortSignal);
    expect(rendererOptions).toEqual({});
    expect(coordinator.recordDeliveryScopeCompleted).toHaveBeenCalledAfter(
      rendererHost.execute,
    );
  });
});
