import type { ToolCallRequest } from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  compileDesignFirstSliceToolInput,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  type DesignFirstSliceToolInput,
} from "@/shared/design-agent-tools.js";
import { handleDesignFirstSliceTool } from "./design-first-slice-tool-handler.js";
import {
  firstSliceInput,
  firstSliceModelInput,
} from "./design-first-slice-tool-handler.fixture.js";

const context = {
  runId: "run_slice",
  sessionId: "conversation_1",
  documentId: "document_1",
  revision: 3,
  scope: { kind: "page" as const, pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page" as const, pageId: "page_1" },
};

describe("handleDesignFirstSliceTool", () => {
  it("commits allocation and the first real slice through one semantic history group", async () => {
    const input = firstSliceInput();
    let boundInput: DesignFirstSliceToolInput | undefined;
    let registeredPlan:
      ReturnType<typeof compileDesignFirstSliceToolInput>["plan"] | undefined;
    const delivery = {
      version: 2 as const,
      targets: [
        {
          targetId: "home",
          label: "Home",
          pageId: "page_1",
          rootNodeId: "frame_home",
          status: "drafted" as const,
          allocatedRevision: 4,
          draftRevision: 5,
        },
      ],
      activeTargetId: "home",
    };
    const coordinator = {
      authoritativeDesignPrompt: vi
        .fn()
        .mockReturnValue("Create a focused home screen"),
      bindFirstSliceToDeliveryScope: vi.fn(
        (_context: unknown, value: DesignFirstSliceToolInput) => {
          boundInput = value;
          return value;
        },
      ),
      prepareDesignPlan: vi.fn(
        (
          _context: unknown,
          plan: ReturnType<typeof compileDesignFirstSliceToolInput>["plan"],
        ) => {
          registeredPlan = plan;
          return {
            status: "accepted",
            planRevision: 1,
            changedTargetIds: ["home"],
            plan,
            state: {},
          };
        },
      ),
      commitDesignPlan: vi.fn(
        (_context: unknown, preparation: Record<string, unknown>) =>
          preparation,
      ),
      createDesignPlanAllocation: vi.fn().mockReturnValue({
        targetIds: ["home"],
        input: {
          label: "Allocate Home artboard",
          commands: [
            {
              commandId: "allocate_home",
              type: "insert_element",
              pageId: "page_1",
              parentId: null,
              index: 0,
              node: { id: "frame_home", kind: "frame" },
            },
          ],
        },
      }),
      assertVisualReviewBeforeWrite: vi.fn(),
      assertDesignPlanForAllocatedApply: vi.fn(
        (
          _context: unknown,
          apply: ReturnType<typeof compileDesignFirstSliceToolInput>["apply"],
        ) => ({ input: apply, plan: registeredPlan, targetIds: ["home"] }),
      ),
      assertDesignApplyResult: vi.fn(),
      recordDesignPlanAllocated: vi.fn(),
      recordDesignApplyCompleted: vi.fn(),
      getDeliveryLedger: vi.fn().mockReturnValue(delivery),
      getDeliveryStageContext: vi.fn().mockReturnValue(undefined),
    };
    let rendererCall: ToolCallRequest | undefined;
    const rendererHost = {
      execute: vi.fn((call: ToolCallRequest) => {
        rendererCall = call;
        return Promise.resolve({
          content: {
            ok: true,
            committedSteps: [
              {
                stepIds: ["allocate_artboards"],
                label: "Create real artboard",
                revision: 4,
              },
              {
                stepIds: ["hero"],
                label: "Build hero",
                revision: 5,
              },
            ],
          },
          designRevision: {
            previousRevision: 3,
            revision: 5,
            transactionId: "transaction_slice",
          },
        });
      }),
    };
    const call = {
      toolCallId: "slice_1",
      toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
      input: firstSliceModelInput(input),
    };

    const result = await handleDesignFirstSliceTool(
      coordinator as never,
      rendererHost as never,
      call,
      context,
      context,
      new AbortController().signal,
    );

    expect(rendererCall).toMatchObject({
      toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
      input: {
        steps: [
          {
            stepId: "allocate_artboards",
            commandIds: ["allocate_home"],
          },
          { stepId: "hero" },
        ],
        commands: [
          { commandId: "allocate_home" },
          { commandId: "first_slice_1" },
        ],
      },
    });
    expect(coordinator.recordDesignPlanAllocated).toHaveBeenCalledWith(
      "run_slice",
      ["home"],
      4,
    );
    if (!boundInput) throw new Error("Expected host-bound First Slice input");
    const stableCompiled = compileDesignFirstSliceToolInput(boundInput);
    expect(boundInput.targets[0]).toMatchObject({
      frame: { frameId: "odr_run_slice_frame_home" },
      regions: [
        {
          nodeId: "odr_run_slice_home_hero",
          parentId: "odr_run_slice_frame_home",
        },
      ],
    });
    expect(boundInput.firstSlice.stages[0].elements[0]).toMatchObject({
      id: "odr_run_slice_hero_title",
      parentId: "odr_run_slice_home_hero",
    });
    expect(coordinator.recordDesignApplyCompleted).toHaveBeenCalledWith(
      "run_slice",
      stableCompiled.apply,
      expect.objectContaining({ targetIds: ["home"] }),
      5,
      {
        ok: true,
        committedSteps: [
          {
            stepIds: ["allocate_artboards"],
            label: "Create real artboard",
            revision: 4,
          },
          { stepIds: ["hero"], label: "Build hero", revision: 5 },
        ],
      },
    );
    expect(coordinator.prepareDesignPlan).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        briefFidelity: {
          requiredContent: ["Create a focused home screen"],
          preservedSemantics: [],
          prohibitedAdditions: [
            "Do not invent unrequested content, features, or delivery targets",
          ],
          assumptions: [],
        },
      }),
    );
    expect(result).toMatchObject({
      content: {
        allocation: { targetIds: ["home"], revision: 4 },
        firstSlice: { targetId: "home", revision: 5 },
        delivery,
      },
      designRevision: { previousRevision: 3, revision: 5 },
    });
  });

  it("does not advance allocation or delivery state when the combined renderer transaction fails", async () => {
    const input = firstSliceInput();
    const compiled = compileDesignFirstSliceToolInput(input);
    const coordinator = {
      authoritativeDesignPrompt: vi
        .fn()
        .mockReturnValue("Create a focused home screen"),
      bindFirstSliceToDeliveryScope: vi.fn(passthroughFirstSlice),
      prepareDesignPlan: vi.fn().mockReturnValue({
        status: "accepted",
        planRevision: 1,
        changedTargetIds: ["home"],
        plan: compiled.plan,
        state: {},
      }),
      commitDesignPlan: vi.fn(),
      createDesignPlanAllocation: vi.fn().mockReturnValue({
        targetIds: ["home"],
        input: {
          label: "Allocate Home artboard",
          commands: [{ commandId: "allocate_home" }],
        },
      }),
      assertVisualReviewBeforeWrite: vi.fn(),
      assertDesignPlanForAllocatedApply: vi.fn().mockReturnValue({
        input: compiled.apply,
        plan: compiled.plan,
        targetIds: ["home"],
      }),
      assertDesignApplyResult: vi.fn(),
      recordDesignPlanAllocated: vi.fn(),
      recordDesignApplyCompleted: vi.fn(),
    };
    const rendererHost = {
      execute: vi.fn().mockRejectedValue(new Error("stage rejected")),
    };

    await expect(
      handleDesignFirstSliceTool(
        coordinator as never,
        rendererHost as never,
        {
          toolCallId: "slice_failed",
          toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
          input: firstSliceModelInput(input),
        },
        context,
        context,
        new AbortController().signal,
      ),
    ).rejects.toThrow("stage rejected");
    expect(coordinator.recordDesignPlanAllocated).not.toHaveBeenCalled();
    expect(coordinator.recordDesignApplyCompleted).not.toHaveBeenCalled();
    expect(coordinator.commitDesignPlan).not.toHaveBeenCalled();
  });

  it("fills an allocated scope Frame without inserting the root again", async () => {
    const input = firstSliceInput();
    const compiled = compileDesignFirstSliceToolInput(input);
    const coordinator = {
      authoritativeDesignPrompt: vi.fn(() => "Create a focused home screen"),
      bindFirstSliceToDeliveryScope: vi.fn(passthroughFirstSlice),
      prepareDesignPlan: vi.fn(() => ({
        status: "accepted",
        planRevision: 1,
        changedTargetIds: ["home"],
        plan: compiled.plan,
        state: {},
      })),
      commitDesignPlan: vi.fn(
        (_context: unknown, preparation: Record<string, unknown>) =>
          preparation,
      ),
      createDesignPlanAllocation: vi.fn(() => undefined),
      assertVisualReviewBeforeWrite: vi.fn(),
      assertDesignPlanForApply: vi.fn(() => ({
        input: compiled.apply,
        plan: compiled.plan,
        targetIds: ["home"],
      })),
      assertDesignApplyResult: vi.fn(),
      recordDesignPlanAllocated: vi.fn(),
      recordDesignApplyCompleted: vi.fn(),
      getDeliveryLedger: vi.fn(() => ({
        targets: [
          { targetId: "previous", allocatedRevision: 2 },
          { targetId: "home", allocatedRevision: 4 },
        ],
      })),
      getDeliveryStageContext: vi.fn(() => undefined),
    };
    const rendererHost = {
      execute: vi.fn().mockResolvedValue({
        content: { ok: true },
        designRevision: {
          previousRevision: 4,
          revision: 5,
          transactionId: "transaction_scope_slice",
        },
      }),
    };

    const result = await handleDesignFirstSliceTool(
      coordinator as never,
      rendererHost as never,
      {
        toolCallId: "slice_scope",
        toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
        input: firstSliceModelInput(input),
      },
      context,
      context,
      new AbortController().signal,
    );

    expect(rendererHost.execute).toHaveBeenCalledWith(
      expect.objectContaining({ input: compiled.apply }),
      context,
      expect.any(AbortSignal),
      {},
    );
    expect(coordinator.recordDesignPlanAllocated).not.toHaveBeenCalled();
    expect(result.content).toMatchObject({
      allocation: { targetIds: ["home"], revision: 4 },
    });
  });

  it("rejects a one-direction compact Logo call when the authoritative brief requests three", async () => {
    const input = firstSliceInput();
    input.deliverable = "logo";
    input.designIntent.calibration.surfaceMode = "graphic";
    input.logoColorStrategy = {
      mode: "brand-color",
      rationale:
        "A vivid violet primary identifies the creative platform without relying on generic black geometry.",
      lightDarkAdaptation:
        "Use the primary violet on light surfaces and a brighter optical variant on dark surfaces.",
    };
    input.targets = input.targets.map((target) => ({
      ...target,
      qualityProfile: { kind: "graphic" },
    }));
    const coordinator = {
      authoritativeDesignPrompt: vi
        .fn()
        .mockReturnValue("Concept Exploration 提供 3 个真正不同的设计方向"),
      bindFirstSliceToDeliveryScope: vi.fn(passthroughFirstSlice),
      prepareDesignPlan: vi.fn(),
    };
    const rendererHost = { execute: vi.fn() };

    await expect(
      handleDesignFirstSliceTool(
        coordinator as never,
        rendererHost as never,
        {
          toolCallId: "slice_logo_incomplete",
          toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
          input: firstSliceModelInput(input),
        },
        context,
        context,
        new AbortController().signal,
      ),
    ).rejects.toThrow("design_workflow.logo_exploration_required");
    expect(coordinator.prepareDesignPlan).not.toHaveBeenCalled();
    expect(rendererHost.execute).not.toHaveBeenCalled();
  });

  it("returns a field-level domain failure before any zero-revision write", async () => {
    const input = firstSliceModelInput(firstSliceInput());
    const firstSlice = input.firstSlice as {
      stages: Array<{ elements: Array<Record<string, unknown>> }>;
    };
    firstSlice.stages[0].elements[0].parentId = "missing_region";
    const coordinator = {
      authoritativeDesignPrompt: vi
        .fn()
        .mockReturnValue("Create a focused home screen"),
      prepareDesignPlan: vi.fn(),
      createDesignPlanAllocation: vi.fn(),
    };
    const rendererHost = { execute: vi.fn() };

    await expect(
      handleDesignFirstSliceTool(
        coordinator as never,
        rendererHost as never,
        {
          toolCallId: "slice_invalid_parent",
          toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
          input,
        },
        { ...context, revision: 0 },
        { ...context, revision: 0 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(
      "first_slice.parent_not_available at /firstSlice/stages/0/elements/0/parentId",
    );
    expect(coordinator.prepareDesignPlan).not.toHaveBeenCalled();
    expect(coordinator.createDesignPlanAllocation).not.toHaveBeenCalled();
    expect(rendererHost.execute).not.toHaveBeenCalled();
  });
});

function passthroughFirstSlice(
  _context: unknown,
  value: DesignFirstSliceToolInput,
): DesignFirstSliceToolInput {
  return value;
}
