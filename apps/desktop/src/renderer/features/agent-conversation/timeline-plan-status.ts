import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import type { DesignDeliveryLedger } from "@opendesign/workspace-contracts";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_CHECKPOINT_TOOL_NAME,
  DESIGN_EDIT_TOOL_NAME,
  DesignApplyContract,
  DesignCheckpointContract,
  EditDesignContract,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
} from "@/shared/design-agent-tools";
import { parseDesignStepProgressMessage } from "@/shared/design-step-progress";
import { committedStepsFromResult } from "./timeline-design-delivery";
import type { AgentTimelineItem } from "./timeline-types";

type Plan = NonNullable<AgentTimelineItem["plan"]>;
type PlanStepStatus =
  Plan["targets"][number]["implementationSteps"][number]["status"];

type StepActivity = {
  label: string;
  order: number;
  status: PlanStepStatus;
  toolCallId: string;
};

type ProjectPlanExecutionStateInput = {
  delivery?: DesignDeliveryLedger;
  plan: Plan;
  planOrder: number;
  planToolCallId?: string;
  runId: string;
};

export function createPlanExecutionStateProjector(source: {
  events: readonly AgentEvent[];
  timeline: readonly SessionTimelineItem[];
}): (input: ProjectPlanExecutionStateInput) => Plan {
  const activityByRunId = new Map<string, StepActivity[]>();
  return (input) => {
    let activities = activityByRunId.get(input.runId);
    if (!activities) {
      activities = collectStepActivities({ ...source, runId: input.runId });
      activityByRunId.set(input.runId, activities);
    }
    return projectPlanExecutionState(input, activities);
  };
}

function projectPlanExecutionState(
  input: ProjectPlanExecutionStateInput,
  sourceActivities: readonly StepActivity[],
): Plan {
  const activities = sourceActivities.filter(
    (activity) =>
      activity.order > input.planOrder ||
      activity.toolCallId === input.planToolCallId,
  );
  const latestByLabel = latestActivities(activities);
  const plannedLabels = new Set(
    input.plan.targets.flatMap((target) =>
      target.implementationSteps.map((step) => normalizedLabel(step.label)),
    ),
  );
  const statusByTargetId = new Map(
    input.delivery?.targets.map((target) => [target.targetId, target.status]) ??
      [],
  );
  const unmatched = [...latestByLabel.values()].filter(
    (activity) => !plannedLabels.has(normalizedLabel(activity.label)),
  );

  const targets = input.plan.targets.map((target, targetIndex) => {
    const status = statusByTargetId.get(target.targetId) ?? target.status;
    const ownsUnmatched =
      input.plan.targets.length === 1 ||
      input.delivery?.activeTargetId === target.targetId ||
      (input.delivery?.activeTargetId === null && targetIndex === 0);
    return {
      ...target,
      ...(status ? { status } : {}),
      implementationSteps: [
        ...target.implementationSteps.map((step) => ({
          ...step,
          status:
            latestByLabel.get(normalizedLabel(step.label))?.status ??
            step.status,
        })),
        ...(ownsUnmatched
          ? unmatched.map((activity) => ({
              label: activity.label,
              status: activity.status,
            }))
          : []),
      ],
    };
  });

  return {
    ...input.plan,
    status: targets.every((target) => target.status === "verified")
      ? "verified"
      : "active",
    targets,
  };
}

function collectStepActivities(input: {
  events: readonly AgentEvent[];
  runId: string;
  timeline: readonly SessionTimelineItem[];
}): StepActivity[] {
  const inputs = new Map<string, { input: unknown; toolName: string }>();
  const activities: StepActivity[] = [];
  for (const item of input.timeline) {
    if (item.type !== "tool" || item.runId !== input.runId) continue;
    inputs.set(item.toolCallId, { input: item.input, toolName: item.toolName });
    activities.push(...durableToolActivities(item));
  }
  const baseOrder = input.timeline.reduce(
    (maximum, item) => Math.max(maximum, item.sequence),
    0,
  );
  input.events.forEach((event, index) => {
    if (!("runId" in event) || event.runId !== input.runId) return;
    if (event.type === "tool.requested") {
      inputs.set(event.toolCallId, {
        input: event.input,
        toolName: event.toolName,
      });
    }
    activities.push(
      ...liveToolActivities(
        event,
        inputs,
        baseOrder + (index + 1) / (input.events.length + 1),
      ),
    );
  });
  return activities;
}

function durableToolActivities(
  item: Extract<SessionTimelineItem, { type: "tool" }>,
): StepActivity[] {
  if (item.status === "completed") {
    return settledActivities(
      item.toolCallId,
      item.toolName,
      item.input,
      item.sequence,
      item.result,
    );
  }
  const status =
    item.status === "failed"
      ? "failed"
      : item.status === "requested" || item.status === "running"
        ? "active"
        : undefined;
  return status
    ? inputActivities(
        item.toolCallId,
        item.toolName,
        item.input,
        item.sequence,
        status,
      )
    : [];
}

function liveToolActivities(
  event: AgentEvent,
  inputs: ReadonlyMap<string, { input: unknown; toolName: string }>,
  order: number,
): StepActivity[] {
  if (event.type === "tool.completed") {
    const source = inputs.get(event.toolCallId);
    return source
      ? settledActivities(
          event.toolCallId,
          source.toolName,
          source.input,
          order,
          event.result,
        )
      : completedActivities(event.toolCallId, order, event.result);
  }
  if (event.type === "tool.progress") {
    const step = parseDesignStepProgressMessage(event.message);
    return step
      ? [
          {
            label: step.label,
            order,
            status: "completed",
            toolCallId: event.toolCallId,
          },
        ]
      : [];
  }
  if (event.type !== "tool.requested" && event.type !== "tool.failed") {
    return [];
  }
  const source =
    event.type === "tool.requested"
      ? { input: event.input, toolName: event.toolName }
      : inputs.get(event.toolCallId);
  return source
    ? inputActivities(
        event.toolCallId,
        source.toolName,
        source.input,
        order,
        event.type === "tool.failed" ? "failed" : "active",
      )
    : [];
}

function completedActivities(
  toolCallId: string,
  order: number,
  result: unknown,
): StepActivity[] {
  return committedStepsFromResult(result).map((step) => ({
    label: step.label,
    order,
    status: "completed",
    toolCallId,
  }));
}

function settledActivities(
  toolCallId: string,
  toolName: string,
  input: unknown,
  order: number,
  result: unknown,
): StepActivity[] {
  const completed = completedActivities(toolCallId, order, result);
  const completedLabels = new Set(
    completed.map((activity) => normalizedLabel(activity.label)),
  );
  const uncommitted = semanticStepLabels(toolName, input)
    .filter((label) => !completedLabels.has(normalizedLabel(label)))
    .map((label) => ({
      label,
      order,
      status: "pending" as const,
      toolCallId,
    }));
  return [...completed, ...uncommitted];
}

function inputActivities(
  toolCallId: string,
  toolName: string,
  input: unknown,
  order: number,
  status: "active" | "failed",
): StepActivity[] {
  return semanticStepLabels(toolName, input).map((label) => ({
    label,
    order,
    status,
    toolCallId,
  }));
}

function semanticStepLabels(toolName: string, input: unknown): string[] {
  if (toolName === DESIGN_EDIT_TOOL_NAME) {
    const parsed = EditDesignContract.parse(input);
    return parsed.ok
      ? parsed.value.edits.flatMap((edit) =>
          edit.kind === "node"
            ? (edit.input.steps?.map((step) => step.label) ?? [])
            : [],
        )
      : [];
  }
  if (toolName === DESIGN_CHECKPOINT_TOOL_NAME) {
    const parsed = DesignCheckpointContract.parse(input);
    if (!parsed.ok) return [];
    const apply =
      parsed.value.action === "apply-and-capture"
        ? parsed.value.apply
        : parsed.value.refinement;
    return apply.steps?.map((step) => step.label) ?? [];
  }
  if (
    toolName === DESIGN_APPLY_TOOL_NAME ||
    toolName === INTERNAL_DESIGN_APPLY_TOOL_NAME
  ) {
    const parsed = DesignApplyContract.parse(input, {
      ...(toolName === INTERNAL_DESIGN_APPLY_TOOL_NAME
        ? { internal: true }
        : {}),
    });
    return parsed.ok
      ? (parsed.value.steps?.map((step) => step.label) ?? [])
      : [];
  }
  return [];
}

function latestActivities(
  activities: readonly StepActivity[],
): Map<string, StepActivity> {
  const latest = new Map<string, StepActivity>();
  for (const activity of activities) {
    const key = normalizedLabel(activity.label);
    const current = latest.get(key);
    if (!current || activity.order >= current.order) latest.set(key, activity);
  }
  return latest;
}

function normalizedLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}
