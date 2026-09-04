import type { ToolCallRequest } from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  compileDesignFirstSliceToolInput,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  FirstSliceContract,
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
    let authorizedApply:
      ReturnType<typeof compileDesignFirstSliceToolInput>["apply"] | undefined;
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
      firstSliceTargetBinding: vi.fn(() => targetBinding(input)),
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
        input: allocationInput(),
      }),
      assertDesignPlanForAllocatedApply: vi.fn(
        (
          _context: unknown,
          apply: ReturnType<typeof compileDesignFirstSliceToolInput>["apply"],
        ) => {
          authorizedApply = apply;
          return { input: apply, plan: registeredPlan, targetIds: ["home"] };
        },
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
      input: canonicalFirstSlice(input),
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
    expect(registeredPlan?.targets[0]).toMatchObject({
      artboard: { frameId: "frame_home" },
      composition: {
        regions: [
          {
            nodeId: "odr_run_slice_4_home_home_hero",
          },
        ],
      },
    });
    expect(authorizedApply?.commands[0]).toMatchObject({
      node: {
        id: "odr_run_slice_4_home_hero_title",
        parentId: "odr_run_slice_4_home_home_hero",
      },
    });
    expect(coordinator.recordDesignApplyCompleted).toHaveBeenCalledWith(
      "run_slice",
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
      firstSliceTargetBinding: vi.fn(() => targetBinding(input)),
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
        input: allocationInput(),
      }),
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
          input: canonicalFirstSlice(input),
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
      firstSliceTargetBinding: vi.fn(() => targetBinding(input)),
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
        input: canonicalFirstSlice(input),
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
});

function canonicalFirstSlice(
  input: DesignFirstSliceToolInput,
): DesignFirstSliceToolInput {
  const parsed = FirstSliceContract.parse(firstSliceModelInput(input), {
    authoritativePrompt: "Create a focused home screen",
    newNodeIdPrefix: "odr_run_slice_",
    target: targetBinding(input),
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

function targetBinding(input: DesignFirstSliceToolInput) {
  const target = input.targets[0];
  return {
    targetId: target.targetId,
    label: target.label,
    objective: target.objective,
    pageId: target.pageId,
    frame: { ...target.frame },
  };
}

function allocationInput() {
  return {
    label: "Allocate Home artboard",
    summary: "Create the current target artboard",
    commands: [
      {
        commandId: "allocate_home",
        type: "insert_element" as const,
        pageId: "page_1",
        parentId: null,
        index: 0,
        node: {
          id: "frame_home",
          kind: "frame" as const,
          name: "Home",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 80, 40],
          size: { width: 390, height: 844 },
          exportSettings: [],
          opacity: 1,
          properties: {
            fills: [{ type: "solid" as const, color: "#ffffff", opacity: 1 }],
            strokes: [],
            strokeWidth: 0,
            cornerRadius: 0,
            clipsContent: true,
          },
          extensions: { agentTargetId: "home" },
        },
      },
    ],
  };
}
