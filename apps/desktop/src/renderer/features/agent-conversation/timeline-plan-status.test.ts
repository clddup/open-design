import { expect, it } from "vitest";
import { createPlanExecutionStateProjector } from "./timeline-plan-status";

it("reopens the same stable review step when newer evidence invalidates a completed Plan", () => {
  const project = createPlanExecutionStateProjector({
    events: [],
    timeline: [],
  });
  const result = project({
    runId: "run",
    planOrder: 1,
    plan: {
      planRevision: 1,
      stage: 1,
      status: "verified",
      targets: [
        {
          targetId: "target",
          label: "Design",
          objective: "Design",
          status: "verified",
          implementationSteps: [
            { stepId: "build", label: "Build", status: "completed" },
            { stepId: "review", label: "Review", status: "completed" },
          ],
        },
      ],
    },
    delivery: {
      version: 4,
      activeTargetId: "target",
      targets: [
        {
          targetId: "target",
          label: "Design",
          pageId: "page",
          rootNodeId: "frame",
          reservedNodeIds: ["frame"],
          status: "drafted",
          draftRevision: 2,
        },
      ],
      planExecution: {
        planRevision: 2,
        targets: [
          {
            targetId: "target",
            steps: [
              {
                stepId: "build",
                label: "Build",
                kind: "implementation",
                status: "completed",
                startedRevision: 1,
                completedRevision: 1,
              },
              {
                stepId: "review",
                label: "Review",
                kind: "review-refine",
                status: "in_progress",
                startedRevision: 2,
              },
            ],
          },
        ],
      },
    },
  });
  expect(result.status).toBe("active");
  expect(result.targets[0].status).toBe("drafted");
  expect(result.targets[0].implementationSteps).toMatchObject([
    { stepId: "build", status: "completed" },
    { stepId: "review", status: "active" },
  ]);
});
