import {
  AgentRunFailureSchema,
  AgentToolFailureDetailsSchema,
  type AgentRunFailure,
  type AgentToolFailureDetails,
} from "@opendesign/agent-contracts";
import { TimestampSchema } from "@opendesign/workspace-contracts";
import { Type } from "@sinclair/typebox";
import { defineContract } from "./contract-validation";

export const DIAGNOSTIC_EVENT_VERSION = 3 as const;

const DiagnosticIdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const DiagnosticLevelSchema = Type.Union([
  Type.Literal("info"),
  Type.Literal("warning"),
  Type.Literal("error"),
]);
const DiagnosticSourceSchema = Type.Union([
  Type.Literal("agent"),
  Type.Literal("design-tool"),
  Type.Literal("main"),
  Type.Literal("model-provider"),
  Type.Literal("renderer"),
  Type.Literal("storage"),
]);
const DiagnosticPresentationSchema = Type.Union([
  Type.Literal("silent"),
  Type.Literal("toast"),
]);

export const DiagnosticContextSchema = Type.Object(
  {
    conversationId: Type.Optional(DiagnosticIdentifierSchema),
    runId: Type.Optional(DiagnosticIdentifierSchema),
    requestId: Type.Optional(DiagnosticIdentifierSchema),
    toolCallId: Type.Optional(DiagnosticIdentifierSchema),
    projectId: Type.Optional(DiagnosticIdentifierSchema),
    designFileId: Type.Optional(DiagnosticIdentifierSchema),
  },
  { additionalProperties: false },
);

const DiagnosticPayloadProperties = {
  level: DiagnosticLevelSchema,
  presentation: DiagnosticPresentationSchema,
  code: DiagnosticIdentifierSchema,
  message: Type.String({ minLength: 1, maxLength: 20_000 }),
  context: Type.Optional(DiagnosticContextSchema),
  details: Type.Optional(AgentToolFailureDetailsSchema),
  failure: Type.Optional(AgentRunFailureSchema),
};

export const RendererDiagnosticReportSchema = Type.Object(
  DiagnosticPayloadProperties,
  { additionalProperties: false },
);

export const DiagnosticInputSchema = Type.Object(
  {
    ...DiagnosticPayloadProperties,
    source: DiagnosticSourceSchema,
  },
  { additionalProperties: false },
);

export const DiagnosticEventSchema = Type.Object(
  {
    ...DiagnosticPayloadProperties,
    source: DiagnosticSourceSchema,
    version: Type.Literal(DIAGNOSTIC_EVENT_VERSION),
    eventId: DiagnosticIdentifierSchema,
    occurredAt: TimestampSchema,
    appVersion: DiagnosticIdentifierSchema,
    platform: DiagnosticIdentifierSchema,
  },
  { additionalProperties: false },
);

export type DiagnosticLevel = "info" | "warning" | "error";

export type DiagnosticSource =
  "agent" | "design-tool" | "main" | "model-provider" | "renderer" | "storage";

export type DiagnosticPresentation = "silent" | "toast";

export type DiagnosticContext = {
  conversationId?: string;
  runId?: string;
  requestId?: string;
  toolCallId?: string;
  projectId?: string;
  designFileId?: string;
};

export type DiagnosticInput = {
  level: DiagnosticLevel;
  source: DiagnosticSource;
  presentation: DiagnosticPresentation;
  code: string;
  message: string;
  context?: DiagnosticContext;
  details?: AgentToolFailureDetails;
  failure?: AgentRunFailure;
};

export type RendererDiagnosticReport = Omit<DiagnosticInput, "source">;

export type DiagnosticEvent = DiagnosticInput & {
  version: typeof DIAGNOSTIC_EVENT_VERSION;
  eventId: string;
  occurredAt: string;
  appVersion: string;
  platform: NodeJS.Platform;
};

export const DiagnosticContextContract = defineContract<DiagnosticContext>({
  schema: DiagnosticContextSchema,
  code: "diagnostic_context.schema_invalid",
  subject: "diagnostic context",
  clone: false,
});

export const RendererDiagnosticReportContract =
  defineContract<RendererDiagnosticReport>({
    schema: RendererDiagnosticReportSchema,
    code: "renderer_diagnostic_report.schema_invalid",
    subject: "Renderer diagnostic report",
    clone: false,
  });

export const DiagnosticInputContract = defineContract<DiagnosticInput>({
  schema: DiagnosticInputSchema,
  code: "diagnostic_input.schema_invalid",
  subject: "diagnostic input",
  clone: false,
});

export const DiagnosticEventContract = defineContract<DiagnosticEvent>({
  schema: DiagnosticEventSchema,
  code: "diagnostic_event.schema_invalid",
  subject: "diagnostic event",
  clone: false,
});

export function isDiagnosticContext(
  value: unknown,
): value is DiagnosticContext {
  return DiagnosticContextContract.parse(value).ok;
}

export function isRendererDiagnosticReport(
  value: unknown,
): value is RendererDiagnosticReport {
  return RendererDiagnosticReportContract.parse(value).ok;
}

export function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  return DiagnosticEventContract.parse(value).ok;
}

export function formatDiagnosticReport(event: DiagnosticEvent): string {
  const lines = [
    "OpenDesign diagnostic",
    `Event ID: ${event.eventId}`,
    `Time: ${event.occurredAt}`,
    `Level: ${event.level}`,
    `Source: ${event.source}`,
    `Code: ${event.code}`,
    `App: ${event.appVersion}`,
    `Platform: ${event.platform}`,
  ];
  const labels: Array<[keyof DiagnosticContext, string]> = [
    ["conversationId", "Conversation ID"],
    ["runId", "Run ID"],
    ["requestId", "Request ID"],
    ["toolCallId", "Tool Call ID"],
    ["projectId", "Project ID"],
    ["designFileId", "Design File ID"],
  ];
  for (const [key, label] of labels) {
    const value = event.context?.[key];
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push("", "Error:", event.message);
  if (event.details) {
    lines.push("", "Details:", JSON.stringify(event.details, null, 2));
  }
  if (event.failure) {
    lines.push("", "Failure:", JSON.stringify(event.failure, null, 2));
  }
  return lines.join("\n");
}
