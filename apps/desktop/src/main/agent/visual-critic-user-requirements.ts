import type {
  AgentDocumentAttachment,
  AgentRequest,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";

export type VisualCriticUserRequirement = {
  messageId: string;
  content: string;
  documents: AgentDocumentAttachment[];
};

/** Raw user evidence only; no inference, author responses, or reconstructed summaries. */
export function visualCriticUserRequirements(
  request: Extract<AgentRequest, { type: "run.start" }>,
  timeline: readonly SessionTimelineItem[],
): VisualCriticUserRequirement[] {
  const automaticRuns = new Set(
    timeline.flatMap((item) =>
      item.sessionId === request.sessionId &&
      item.type === "run" &&
      item.continuation
        ? [item.runId]
        : [],
    ),
  );
  const requirements = timeline
    .filter((item) => item.sessionId === request.sessionId)
    .filter(
      (item): item is Extract<SessionTimelineItem, { type: "user.message" }> =>
        item.type === "user.message" &&
        item.documentId === request.documentId &&
        item.runId !== request.runId &&
        !automaticRuns.has(item.runId ?? ""),
    )
    .sort((left, right) => left.sequence - right.sequence)
    .map((item) => ({
      messageId: item.messageId,
      content: item.content,
      documents: documentAttachments(item.attachments),
    }));
  if (!request.continuation)
    requirements.push({
      messageId: `${request.runId}_user`,
      content: request.prompt,
      documents: documentAttachments(request.attachments),
    });
  return requirements;
}

function documentAttachments(
  attachments: Extract<AgentRequest, { type: "run.start" }>["attachments"],
): AgentDocumentAttachment[] {
  return (attachments ?? [])
    .filter(
      (attachment): attachment is AgentDocumentAttachment =>
        !attachment.mimeType.startsWith("image/"),
    )
    .map((attachment) => ({ ...attachment }));
}
