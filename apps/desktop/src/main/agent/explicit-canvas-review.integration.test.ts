import { afterEach, expect, it, vi } from "vitest";
import { diagnoseDesignTargetLayout } from "@opendesign/editor-runtime";
import type { AgentImageAttachment } from "@opendesign/agent-contracts";
import type { CaptureCanvasInput } from "@/shared/design-capture-tool";
import type {
  DesignDeliveryScope,
  DesignReferenceStrategy,
} from "@/shared/design-agent-tools";
import type * as DesignVisualCriticModule from "./design-visual-critic";
import type { ModelProviderHost } from "../model/model-provider-host";
import {
  createDesignCaptureReviewSession,
  type DesignCaptureReviewExecute,
} from "./design-capture-review-tool-handler";
import {
  runIndependentDesignVisualCritic,
  type DesignVisualCriticContext,
  type DesignVisualCriticResult,
} from "./design-visual-critic";
import {
  editDesign,
  generateDesign,
  setupDesignEditing,
  type DesignEditingFixture,
} from "./design-plan-editing.integration.fixture";

vi.mock("./design-visual-critic", async (importOriginal) => ({
  ...(await importOriginal<typeof DesignVisualCriticModule>()),
  runIndependentDesignVisualCritic: vi.fn(),
}));

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.resetAllMocks();
  for (const dispose of cleanup.splice(0)) await dispose();
});

async function setup() {
  const fixture = await setupDesignEditing();
  cleanup.push(fixture.dispose);
  await generateDesign(fixture);
  const delivery = fixture.coordinator.getDeliveryLedger(
    fixture.context.runId,
  )!;
  const frameId = delivery.targets[0].rootNodeId;
  return { fixture, frameId };
}

function passedCritic(
  context: DesignVisualCriticContext,
): DesignVisualCriticResult {
  return {
    version: 1,
    observedRevision: context.observedRevision,
    passed: true,
    averageScore: 4,
    summary: "The captured design passes review",
    criteria: {},
    failedCriteria: [],
    refinements: [],
    review: null,
  };
}

function reviewSession(fixture: DesignEditingFixture) {
  const execute = vi.fn<DesignCaptureReviewExecute>(async (call, options) => {
    if (call.toolName !== "opendesign_capture_canvas")
      return fixture.execute(call);
    const target = options?.captureTarget;
    if (target?.kind !== "frame")
      throw new Error("Expected exact Frame capture");
    const document = fixture.runtime.getSnapshot().document;
    const layoutQuality = diagnoseDesignTargetLayout(
      document,
      target.pageId,
      target.nodeId,
      target.qualityProfile,
    );
    expect(layoutQuality.errorCount).toBe(0);
    return {
      observedRevision: document.revision,
      content: {
        attachment: {
          attachmentId: "capture",
          name: "capture.jpg",
          mimeType: "image/jpeg",
          byteSize: 100,
        },
        layoutQuality,
      },
    };
  });
  const modelHost = {
    resolveVisualCriticSelection: (
      selection: DesignVisualCriticContext["modelSelection"],
    ) => selection,
  } as ModelProviderHost;
  const session = createDesignCaptureReviewSession({
    context: fixture.context,
    coordinator: fixture.coordinator,
    execute,
    signal: new AbortController().signal,
    getModelProviderHost: () => modelHost,
  });
  return {
    execute,
    capture: (input: CaptureCanvasInput) =>
      session.capture({
        toolCallId: "review",
        toolName: "opendesign_capture_canvas",
        input,
      }),
  };
}

async function nextRun(
  fixture: DesignEditingFixture,
  attachments: AgentImageAttachment[] = [],
) {
  fixture.coordinator.handleAgentEvent({
    type: "run.completed",
    runId: fixture.context.runId,
    stopReason: "complete",
    finishedAt: "2026-09-09T00:00:01.000Z",
  });
  fixture.coordinator.disposeRun(fixture.context.runId);
  await fixture.host.saveDesignFile(
    "project",
    fixture.manifest.designFiles[0].designFileId,
    fixture.runtime.getSnapshot().document,
  );
  fixture.context.runId = "followup";
  await fixture.coordinator.registerRun({
    type: "run.start",
    ...fixture.context,
    prompt: "继续审核现有设计",
    modelSelection: { providerId: "mock", modelId: "mock" },
    attachments,
  });
  await fixture.inspect();
}

it("reviews an existing Frame on the next ordinary Run without generating a Plan or a revision", async () => {
  const { fixture, frameId } = await setup();
  await nextRun(fixture);
  const before = fixture.runtime.getSnapshot().document;
  expect(
    fixture.coordinator.getDeliveryLedger(fixture.context.runId),
  ).toBeUndefined();
  vi.mocked(runIndependentDesignVisualCritic).mockImplementation(
    (_host, context) => Promise.resolve(passedCritic(context)),
  );
  const { capture, execute } = reviewSession(fixture);
  const result = await capture({ target: { frameId, deliverable: "poster" } });
  expect(result.content).toMatchObject({
    reviewWorkflow: { verified: true, capturedRevision: before.revision },
  });
  expect(runIndependentDesignVisualCritic).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls.map(([call]) => call.toolName)).toEqual([
    "opendesign_capture_canvas",
    "opendesign_inspect_document",
    "opendesign_inspect_document",
  ]);
  expect(fixture.runtime.getSnapshot().document).toEqual(before);
  expect(
    fixture.coordinator.getDeliveryLedger(fixture.context.runId),
  ).toBeUndefined();
  expect(
    fixture.store
      .listGlobalTasks()
      .find((task) => task.runId === fixture.context.runId)?.delivery,
  ).toBeUndefined();
});

it("keeps an old passing critique as evidence without verifying a design edited during review", async () => {
  const { fixture, frameId } = await setup();
  const before = fixture.runtime.getSnapshot().document;
  const layerId = before.nodesById[frameId].childIds[0];
  vi.mocked(runIndependentDesignVisualCritic).mockImplementation(
    async (_host, context) => {
      await fixture.execute({
        toolCallId: "concurrent_edit",
        toolName: "opendesign_edit_design",
        input: {
          label: "Concurrent user edit",
          edits: [
            {
              kind: "node",
              input: {
                label: "Change opacity",
                commands: [
                  {
                    commandId: "opacity",
                    type: "update_properties",
                    nodeId: layerId,
                    opacity: 0.7,
                  },
                ],
              },
            },
          ],
        },
      });
      return passedCritic(context);
    },
  );
  const { capture } = reviewSession(fixture);
  const result = await capture({});
  expect(result.content).toMatchObject({
    reviewWorkflow: {
      code: "design_capture_revision_invalid",
      verified: false,
      capturedRevision: before.revision,
      currentRevision: before.revision + 1,
      critic: { observedRevision: before.revision, passed: true },
    },
  });
  expect(fixture.runtime.getSnapshot().document.revision).toBe(
    before.revision + 1,
  );
  const delivery = fixture.coordinator.getDeliveryLedger(
    fixture.context.runId,
  )!;
  expect(delivery.targets[0].status).toBe("drafted");
  expect(delivery.targets[0]).not.toHaveProperty("verifiedRevision");
  expect(
    delivery.planExecution?.targets[0].steps.some(
      (step) => step.status !== "completed",
    ),
  ).toBe(true);
});

it("passes explicitly authorized references and real quality coverage through capture to the critic", async () => {
  const { fixture, frameId } = await setup();
  const attachment: AgentImageAttachment = {
    attachmentId: `image_${"a".repeat(64)}`,
    name: "reference.png",
    mimeType: "image/png",
    byteSize: 100,
  };
  await nextRun(fixture, [attachment]);
  const layerId =
    fixture.runtime.getSnapshot().document.nodesById[frameId].childIds[0];
  const qualityProfile = {
    kind: "ui" as const,
    platform: "ios" as const,
    interactionMode: "touch" as const,
    safeAreaInsets: { top: 8, right: 8, bottom: 8, left: 8 },
    safeAreaNodeIds: [],
    interactiveNodeIds: [layerId],
  };
  vi.mocked(runIndependentDesignVisualCritic).mockImplementation(
    (_host, context) => {
      expect(context.referenceAttachments).toEqual([attachment]);
      expect(context.target.qualityProfile).toEqual(qualityProfile);
      expect(context.checkedQualityNodeCount).toBe(1);
      expect(context.userRequirements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: "继续审核现有设计" }),
        ]),
      );
      return Promise.resolve(passedCritic(context));
    },
  );
  const { capture, execute } = reviewSession(fixture);
  const result = await capture({
    target: {
      frameId,
      deliverable: "ui",
      qualityProfile,
      referenceAttachmentIds: [attachment.attachmentId],
    },
  });
  expect(result.content).toMatchObject({ reviewWorkflow: { verified: true } });
  expect(execute.mock.calls[0][1]?.captureTarget).toMatchObject({
    qualityProfile,
  });
  expect(runIndependentDesignVisualCritic).toHaveBeenCalledTimes(1);
  expect(
    fixture.coordinator.getDeliveryLedger(fixture.context.runId),
  ).toBeUndefined();
});

it("invalidates a previously verified Frame edited during recapture without inventing an Agent material write", async () => {
  const { fixture, frameId } = await setup();
  vi.mocked(runIndependentDesignVisualCritic).mockImplementation(
    (_host, context) => Promise.resolve(passedCritic(context)),
  );
  const { capture } = reviewSession(fixture);
  await capture({});
  const before = fixture.coordinator.getDeliveryLedger(fixture.context.runId)!;
  expect(before.targets[0].status).toBe("verified");
  const capturedRevision = fixture.runtime.getSnapshot().document.revision;
  const layerId =
    fixture.runtime.getSnapshot().document.nodesById[frameId].childIds[0];
  vi.mocked(runIndependentDesignVisualCritic).mockImplementation(
    async (_host, context) => {
      await fixture.execute({
        toolCallId: "user_edit_during_recapture",
        toolName: "opendesign_edit_design",
        input: {
          label: "Concurrent user edit",
          edits: [
            {
              kind: "node",
              input: {
                label: "Change opacity",
                commands: [
                  {
                    commandId: "opacity",
                    type: "update_properties",
                    nodeId: layerId,
                    opacity: 0.6,
                  },
                ],
              },
            },
          ],
        },
      });
      return passedCritic(context);
    },
  );
  const result = await capture({ target: { frameId, deliverable: "poster" } });
  expect(result.content).toMatchObject({
    reviewWorkflow: {
      verified: false,
      capturedRevision,
      currentRevision: capturedRevision + 1,
      critic: { observedRevision: capturedRevision, passed: true },
    },
  });
  const after = fixture.coordinator.getDeliveryLedger(fixture.context.runId)!;
  expect(after.targets[0]).toMatchObject({
    status: "drafted",
    draftRevision: before.targets[0].draftRevision,
  });
  expect(after.targets[0]).not.toHaveProperty("verifiedRevision");
  expect(after.planExecution!.planRevision).toBe(
    before.planExecution!.planRevision + 1,
  );
  expect(after.planExecution!.targets[0].steps).toMatchObject([
    { status: "completed" },
    { status: "in_progress", startedRevision: capturedRevision + 1 },
  ]);
  expect(fixture.runtime.getSnapshot().document.revision).toBe(
    capturedRevision + 1,
  );
  expect(runIndependentDesignVisualCritic).toHaveBeenCalledTimes(2);
});

it("drops previous reference strategy when explicit capture clears reference attachments", async () => {
  const { fixture, frameId } = await setup();
  const resolvePlanned = fixture.coordinator.resolveVisualCriticContext.bind(
    fixture.coordinator,
  );
  const plannedContext = vi
    .spyOn(fixture.coordinator, "resolveVisualCriticContext")
    .mockImplementation((...args) => {
      const context = resolvePlanned(...args);
      if (!context) throw new Error("Expected current planned target");
      return {
        ...context,
        plan: {
          ...context.plan,
          referenceStrategy: {
            synthesis: "Previously selected reference",
            references: [
              {
                attachmentId: `image_${"b".repeat(64)}`,
                decision: "style-reference",
                application: "Match the previous reference",
                preserve: [],
                avoid: [],
              },
            ],
          },
        },
      };
    });
  vi.mocked(runIndependentDesignVisualCritic).mockImplementation(
    (_host, context) => {
      expect(context.referenceAttachments).toEqual([]);
      expect(context.plan).not.toHaveProperty("referenceStrategy");
      return Promise.resolve(passedCritic(context));
    },
  );
  const { capture } = reviewSession(fixture);
  const result = await capture({
    target: { frameId, deliverable: "poster", referenceAttachmentIds: [] },
  });
  expect(result.content).toMatchObject({ reviewWorkflow: { verified: true } });
  expect(plannedContext).toHaveBeenCalledTimes(1);
  expect(runIndependentDesignVisualCritic).toHaveBeenCalledTimes(1);
});

it("retains an earlier target's review metadata and evidence after generating and editing other targets", async () => {
  const references: AgentImageAttachment[] = ["a", "b"].map((value) => ({
    attachmentId: `image_${value.repeat(64)}`,
    name: `${value}.png`,
    mimeType: "image/png",
    byteSize: 100,
  }));
  const fixture = await setupDesignEditing(references);
  cleanup.push(fixture.dispose);
  await fixture.inspect();
  const { coordinator, context } = fixture;
  const scope: DesignDeliveryScope = {
    version: 1,
    deliverable: "poster",
    objective: "Create two different posters",
    targets: ["first", "second"].map((targetId) => ({
      targetId,
      label: targetId,
      objective: `Create the ${targetId} poster`,
      artboard: { width: 800, height: 600 },
      requiredContent: [`${targetId} poster content`],
    })),
    exclusions: [],
    assumptions: [],
  };
  coordinator.recordDeliveryScopeCompleted(
    context,
    scope,
    coordinator.createDeliveryScopeReservation(context, scope),
  );
  const strategy = (
    attachment: AgentImageAttachment,
  ): DesignReferenceStrategy => ({
    synthesis: `Use ${attachment.name}`,
    references: [
      {
        attachmentId: attachment.attachmentId,
        decision: "style-reference",
        application: "Match the supplied palette",
        preserve: [],
        avoid: [],
      },
    ],
  });
  await generateDesign(fixture, { referenceStrategy: strategy(references[0]) });
  const first = coordinator.getDeliveryLedger(context.runId)!.targets[0];
  vi.mocked(runIndependentDesignVisualCritic).mockImplementation(
    (_host, reviewContext) => Promise.resolve(passedCritic(reviewContext)),
  );
  const session = reviewSession(fixture);
  const target = { frameId: first.rootNodeId, deliverable: "poster" as const };
  expect((await session.capture({ target })).content).toMatchObject({
    reviewWorkflow: { verified: true },
  });
  const completed = coordinator.getDeliveryLedger(context.runId)!.planExecution!
    .targets[0];
  await generateDesign(fixture, {
    referenceStrategy: strategy(references[1]),
    rasterAssetRoles: ["background"],
  });
  expect(
    coordinator.getDeliveryLedger(context.runId)!.planExecution!.targets[0],
  ).toEqual(completed);
  const frame =
    fixture.runtime.getSnapshot().document.nodesById[first.rootNodeId];
  await editDesign(fixture, [
    {
      commandId: "refine_first",
      type: "update_properties",
      nodeId: frame.childIds[0],
      opacity: 0.8,
    },
  ]);
  expect(
    coordinator.getDeliveryLedger(context.runId)!.targets[0],
  ).not.toHaveProperty("verifiedRevision");
  const result = await session.capture({ target });
  expect(result.content).toMatchObject({
    reviewWorkflow: { verified: true, capturedRevision: context.revision },
  });
  const reviewed = vi
    .mocked(runIndependentDesignVisualCritic)
    .mock.calls.at(-1)![1];
  expect(
    reviewed.referenceAttachments.map((attachment) => attachment.attachmentId),
  ).toEqual([references[0].attachmentId]);
  expect(reviewed.plan.briefFidelity?.requiredContent).toEqual([
    "first poster content",
  ]);
  expect(coordinator.getDeliveryLedger(context.runId)!.targets).toMatchObject([
    {
      targetId: "first",
      status: "verified",
      verifiedRevision: context.revision,
    },
    { targetId: "second", status: "drafted" },
  ]);
});
