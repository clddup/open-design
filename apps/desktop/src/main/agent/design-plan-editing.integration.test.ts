import { afterEach, expect, it } from "vitest";
import { diagnoseDesignTargetLayout } from "@opendesign/editor-runtime";
import { agentDesignNodeIdPrefix } from "@/shared/design-id-allocation";
import type { DesignVisualCriticResult } from "./design-visual-critic";
import type { DesignDeliveryScope } from "@/shared/design-agent-tools";
import {
  setupDesignEditing,
  generateDesign,
  editDesign,
  type DesignEditingFixture,
} from "./design-plan-editing.integration.fixture";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

function passedCritic(revision: number): DesignVisualCriticResult {
  return {
    version: 1,
    observedRevision: revision,
    passed: true,
    averageScore: 4,
    summary: "The captured revision passes visual review",
    criteria: {},
    failedCriteria: [],
    refinements: [],
    review: null,
  };
}

function capture(fixture: DesignEditingFixture, unavailable = false) {
  const target = fixture.coordinator.resolveCanvasCaptureTarget(
    fixture.context,
  );
  if (target.kind !== "frame") throw new Error("Expected a delivery Frame");
  const document = fixture.runtime.getSnapshot().document;
  const quality = diagnoseDesignTargetLayout(
    document,
    target.pageId,
    target.nodeId,
    target.qualityProfile,
  );
  expect(quality.errorCount).toBe(0);
  return fixture.coordinator.recordCanvasCapture(
    fixture.context,
    document.revision,
    quality,
    unavailable ? undefined : passedCritic(document.revision),
    unavailable ? { message: "review disconnected" } : undefined,
    target.nodeId,
  );
}

it("keeps insert and subtree replacement editable after the first critic connection fails", async () => {
  const fixture = await setupDesignEditing();
  cleanup.push(fixture.dispose);
  await generateDesign(fixture);
  const before = fixture.runtime.getSnapshot().document;
  expect(() => capture(fixture, true)).toThrow(
    "design_workflow.visual_critic_unavailable",
  );
  const delivery = fixture.coordinator.getDeliveryLedger(
    fixture.context.runId,
  )!;
  expect(delivery.targets[0].status).toBe("captured");
  expect(
    delivery.planExecution?.targets[0].steps.map((step) => step.status),
  ).toEqual(["completed", "in_progress"]);
  const frame = before.nodesById[delivery.targets[0].rootNodeId];
  const original = before.nodesById[frame.childIds[0]];
  const added = {
    ...structuredClone(original),
    id: `${agentDesignNodeIdPrefix(fixture.context.runId)}added`,
    name: "Added shape",
    transform: [1, 0, 0, 1, 160, 24] as const,
  };
  await editDesign(fixture, [
    {
      commandId: "insert",
      type: "insert_element",
      pageId: fixture.context.scope.pageId,
      parentId: frame.id,
      index: frame.childIds.length,
      node: { ...added, transform: [...added.transform] },
    },
  ]);
  const insertedRevision = fixture.context.revision;
  await editDesign(fixture, [
    {
      commandId: "replace",
      type: "replace_subtree",
      rootNodeId: original.id,
      nodes: [{ ...structuredClone(original), opacity: 0.7 }],
    },
  ]);
  expect(fixture.context.revision).toBe(insertedRevision + 1);
  expect(
    fixture.runtime.getSnapshot().document.nodesById[added.id],
  ).toBeDefined();
  expect(
    fixture.runtime.getSnapshot().document.nodesById[original.id].opacity,
  ).toBe(0.7);
  expect(capture(fixture)).toMatchObject({ verified: true });
  expect(fixture.runtime.undo().ok).toBe(true);
  expect(
    fixture.runtime.getSnapshot().document.nodesById[original.id].opacity,
  ).toBe(original.opacity);
  expect(fixture.runtime.undo().ok).toBe(true);
  expect(fixture.runtime.getSnapshot().document.nodesById).toEqual(
    before.nodesById,
  );
});

it("reopens actual review evidence after editing a verified target and verifies the new revision", async () => {
  const fixture = await setupDesignEditing();
  cleanup.push(fixture.dispose);
  await generateDesign(fixture);
  expect(capture(fixture)).toMatchObject({ verified: true });
  const prior = fixture.coordinator.getDeliveryLedger(fixture.context.runId)!;
  const frame =
    fixture.runtime.getSnapshot().document.nodesById[
      prior.targets[0].rootNodeId
    ];
  await editDesign(fixture, [
    {
      commandId: "opacity",
      type: "update_properties",
      nodeId: frame.childIds[0],
      opacity: 0.8,
    },
  ]);
  const edited = fixture.coordinator.getDeliveryLedger(fixture.context.runId)!;
  expect(edited.targets[0]).toMatchObject({
    status: "drafted",
    draftRevision: fixture.context.revision,
  });
  expect(edited.targets[0]).not.toHaveProperty("verifiedRevision");
  expect(edited.planExecution?.planRevision).toBe(
    prior.planExecution!.planRevision + 1,
  );
  expect(edited.planExecution?.targets[0].steps).toMatchObject([
    {
      stepId: prior.planExecution!.targets[0].steps[0].stepId,
      status: "completed",
    },
    {
      stepId: prior.planExecution!.targets[0].steps[1].stepId,
      status: "in_progress",
      startedRevision: fixture.context.revision,
    },
  ]);
  expect(edited.planExecution?.targets[0].steps[1]).not.toHaveProperty(
    "completedRevision",
  );
  expect(capture(fixture)).toMatchObject({
    verified: true,
    capturedRevision: fixture.context.revision,
  });
  expect(
    fixture.coordinator.getDeliveryLedger(fixture.context.runId)?.targets[0],
  ).toMatchObject({
    status: "verified",
    verifiedRevision: fixture.context.revision,
  });
});

it("generates the next declared target while preserving an earlier target's unavailable review and editable content", async () => {
  const fixture = await setupDesignEditing();
  cleanup.push(fixture.dispose);
  await fixture.inspect();
  const scope: DesignDeliveryScope = {
    version: 1,
    deliverable: "poster",
    objective: "Create a two-poster set",
    targets: ["first", "second"].map((targetId) => ({
      targetId,
      label: targetId,
      objective: `Create the ${targetId} poster`,
      artboard: { width: 800, height: 600 },
      requiredContent: ["Editable shape"],
    })),
    exclusions: [],
    assumptions: [],
  };
  const reservation = fixture.coordinator.createDeliveryScopeReservation(
    fixture.context,
    scope,
  );
  fixture.coordinator.recordDeliveryScopeCompleted(
    fixture.context,
    scope,
    reservation,
  );
  await generateDesign(fixture);
  expect(() => capture(fixture, true)).toThrow(
    "design_workflow.visual_critic_unavailable",
  );
  const previous = fixture.coordinator.getDeliveryLedger(
    fixture.context.runId,
  )!;
  const firstRoot = previous.targets[0].rootNodeId;
  const firstNodes = fixture.runtime.getSnapshot().document.nodesById;
  expect(
    fixture.coordinator.getDeliveryStageContext(fixture.context.runId),
  ).toMatchObject({
    verifiedTargets: 0,
    nextTarget: { targetId: "second" },
  });
  await generateDesign(fixture);
  const current = fixture.coordinator.getDeliveryLedger(fixture.context.runId)!;
  expect(current.targets).toMatchObject([
    { targetId: "first", rootNodeId: firstRoot, status: "captured" },
    {
      targetId: "second",
      status: "drafted",
      draftRevision: fixture.context.revision,
    },
  ]);
  expect(current.targets[0]).not.toHaveProperty("verifiedRevision");
  expect(current.planExecution?.targets[0]).toEqual(
    previous.planExecution?.targets[0],
  );
  expect(current.planExecution?.targets[1]?.steps[0]?.status).toBe(
    "in_progress",
  );
  for (const [id, node] of Object.entries(firstNodes))
    expect(fixture.runtime.getSnapshot().document.nodesById[id]).toEqual(node);
  expect(fixture.runtime.undo().ok).toBe(true);
  expect(fixture.runtime.getSnapshot().document.nodesById).toEqual(firstNodes);
});
