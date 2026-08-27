import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { designWorkflowFailureDomainIssues } from "./workflow-failure-contract.js";
import type { AgentRunFailure } from "./tool-failure.js";
import {
  DurableTimelineEventSchema,
  SessionTimelineItemSchema,
  type DurableTimelineEvent,
  type SessionTimelineItem,
} from "./agent-timeline-schema.js";
import { selectionScopeDomainIssues } from "./wire-foundations.js";

export const DurableTimelineEventContract =
  defineContract<DurableTimelineEvent>({
    schema: DurableTimelineEventSchema,
    code: "durable_timeline_event.schema_invalid",
    subject: "Durable timeline event",
    recovery: "Correct the reported durable timeline event field.",
    refine: durableTimelineEventDomainIssues,
    clone: false,
  });

export const SessionTimelineItemContract = defineContract<SessionTimelineItem>({
  schema: SessionTimelineItemSchema,
  code: "session_timeline_item.schema_invalid",
  subject: "Session timeline item",
  recovery: "Correct the reported session timeline item field.",
  refine: sessionTimelineItemDomainIssues,
  clone: false,
});

export function isDurableTimelineEvent(
  value: unknown,
): value is DurableTimelineEvent {
  return DurableTimelineEventContract.parse(value).ok;
}

export function isSessionTimelineItem(
  value: unknown,
): value is SessionTimelineItem {
  return SessionTimelineItemContract.parse(value).ok;
}

function runFailureStateDomainIssues(
  value: {
    status: string;
    stopReason?: string;
    failure?: AgentRunFailure;
  },
  path: string,
  code: string,
  recovery: string,
): ValidationIssue[] {
  if (
    value.failure === undefined ||
    (value.status === "error" && value.stopReason === "error")
  ) {
    return [];
  }
  return [
    {
      code,
      path: `${path}/failure`,
      message: "Run failure details require error status and error stop reason",
      expected: { status: "error", stopReason: "error" },
      actual: { status: value.status, stopReason: value.stopReason ?? null },
      recovery,
    },
  ];
}

function durableTimelineEventDomainIssues(
  value: DurableTimelineEvent,
): ValidationIssue[] {
  if (value.type === "message.user") {
    return selectionScopeDomainIssues(
      value.payload.scope,
      "/payload/scope",
      "durable_timeline_event.primary_selection_invalid",
      "Persist a primary node that belongs to the selected node snapshot.",
    );
  }
  if (value.type === "run.state") {
    return runFailureStateDomainIssues(
      value.payload,
      "/payload",
      "durable_timeline_event.failure_state_invalid",
      "Persist failure details only with error status and error stop reason.",
    );
  }
  if (
    value.type === "context.compacted" &&
    value.payload.toSequence < value.payload.fromSequence
  ) {
    return [
      {
        code: "durable_timeline_event.compacted_range_invalid",
        path: "/payload/toSequence",
        message: "toSequence must be greater than or equal to fromSequence",
        expected: { minimum: value.payload.fromSequence },
        actual: value.payload.toSequence,
        recovery: "Persist a non-descending compacted sequence range.",
      },
    ];
  }
  return [];
}

export function sessionTimelineItemDomainIssues(
  value: SessionTimelineItem,
  path = "",
  codes = {
    primarySelection: "session_timeline_item.primary_selection_invalid",
    failureState: "session_timeline_item.failure_state_invalid",
  },
  recovery = "Correct the reported session timeline item field.",
): ValidationIssue[] {
  if (value.type === "user.message") {
    return selectionScopeDomainIssues(
      value.scope,
      `${path}/scope`,
      codes.primarySelection,
      recovery,
    );
  }
  if (value.type === "run") {
    return runFailureStateDomainIssues(
      value,
      path,
      codes.failureState,
      recovery,
    );
  }
  if (value.type === "tool" && value.error !== undefined) {
    return designWorkflowFailureDomainIssues(value.error, `${path}/error`);
  }
  return [];
}
