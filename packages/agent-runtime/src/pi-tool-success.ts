import type { TrustedToolResult } from "@opendesign/agent-contracts";
import type { AgentToolCallRecord } from "./completion-guard.js";
import type {
  ActiveToolCall,
  PiToolTerminalProjection,
} from "./pi-tool-call-tracker.js";
import {
  TOOL_RESULT_KIND,
  modelResultText,
  readSuccessDetails,
  type PiToolSuccessDetails,
} from "./pi-tool-protocol.js";
import type { AgentToolDefinition } from "./runtime-ports.js";
import {
  projectToolResultForModel,
  toolResultAttachments,
  validateDesignRevision,
  validateObservedRevision,
} from "./tool-execution-semantics.js";

export function projectPiToolTerminalSuccess(
  active: ActiveToolCall,
  toolCallId: string,
  result: unknown,
): Extract<PiToolTerminalProjection, { status: "completed" }> {
  const details = readSuccessDetails(result);
  const revision = validateDesignRevision(
    details.designRevision,
    active.revisionAtStart,
  );
  const observedRevision = validateObservedRevision(
    details.observedRevision,
    active.revisionAtStart,
  );
  if (
    revision &&
    observedRevision !== undefined &&
    observedRevision !== revision.revision
  ) {
    throw new Error("Pi tool result contains inconsistent revisions");
  }
  return {
    status: "completed",
    toolCallId,
    content: details.content,
    previousRevision: active.revisionAtStart,
    ...(observedRevision === undefined ? {} : { observedRevision }),
    ...(revision === undefined ? {} : { designRevision: revision }),
  };
}

export function projectPiToolSuccess(options: {
  currentRevision: number;
  definition: AgentToolDefinition;
  input: unknown;
  result: TrustedToolResult;
  toolCallId: string;
}): {
  modelResult: {
    content: [{ type: "text"; text: string }];
    details: PiToolSuccessDetails;
  };
  nextRevision?: number;
  record: AgentToolCallRecord;
  revisionAdvanced: boolean;
} {
  const revision = validateDesignRevision(
    options.result.designRevision,
    options.currentRevision,
  );
  const observedRevision = validateObservedRevision(
    options.result.observedRevision,
    options.currentRevision,
  );
  if (
    revision &&
    observedRevision !== undefined &&
    observedRevision !== revision.revision
  ) {
    throw new RangeError(
      "Tool returned inconsistent observed and design revisions",
    );
  }
  const nextRevision = revision?.revision ?? observedRevision;
  const record: AgentToolCallRecord = {
    toolCallId: options.toolCallId,
    toolName: options.definition.name,
    input: options.input,
    status: "completed",
    result: options.result.content,
    ...(nextRevision === undefined ? {} : { revision: nextRevision }),
  };
  const details = {
    kind: TOOL_RESULT_KIND,
    version: 1,
    content: options.result.content,
    attachments: toolResultAttachments(options.result.content),
    ...(observedRevision === undefined ? {} : { observedRevision }),
    ...(revision === undefined ? {} : { designRevision: revision }),
  } satisfies PiToolSuccessDetails;
  return {
    modelResult: {
      content: [
        {
          type: "text",
          text: modelResultText(
            projectToolResultForModel(options.result.content),
          ),
        },
      ],
      details,
    },
    ...(nextRevision === undefined ? {} : { nextRevision }),
    record,
    revisionAdvanced: revision !== undefined,
  };
}
