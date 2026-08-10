export const DIAGNOSTIC_EVENT_VERSION = 1 as const;

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
};

export type RendererDiagnosticReport = Omit<DiagnosticInput, "source">;

export type DiagnosticEvent = DiagnosticInput & {
  version: typeof DIAGNOSTIC_EVENT_VERSION;
  eventId: string;
  occurredAt: string;
  appVersion: string;
  platform: NodeJS.Platform;
};

const diagnosticLevels = new Set<DiagnosticLevel>(["info", "warning", "error"]);
const diagnosticSources = new Set<DiagnosticSource>([
  "agent",
  "design-tool",
  "main",
  "model-provider",
  "renderer",
  "storage",
]);
const diagnosticPresentations = new Set<DiagnosticPresentation>([
  "silent",
  "toast",
]);
const contextKeys = [
  "conversationId",
  "runId",
  "requestId",
  "toolCallId",
  "projectId",
  "designFileId",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  );
}

export function isDiagnosticContext(
  value: unknown,
): value is DiagnosticContext {
  if (!isRecord(value) || !hasOnlyKeys(value, contextKeys)) return false;
  return contextKeys.every(
    (key) => value[key] === undefined || isIdentifier(value[key]),
  );
}

function isDiagnosticPayload(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return (
    diagnosticLevels.has(value.level as DiagnosticLevel) &&
    diagnosticPresentations.has(value.presentation as DiagnosticPresentation) &&
    isIdentifier(value.code) &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    value.message.length <= 20_000 &&
    (value.context === undefined || isDiagnosticContext(value.context)) &&
    hasOnlyKeys(value, allowedKeys)
  );
}

export function isRendererDiagnosticReport(
  value: unknown,
): value is RendererDiagnosticReport {
  return (
    isRecord(value) &&
    isDiagnosticPayload(value, [
      "level",
      "presentation",
      "code",
      "message",
      "context",
    ])
  );
}

export function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  return (
    isRecord(value) &&
    value.version === DIAGNOSTIC_EVENT_VERSION &&
    isIdentifier(value.eventId) &&
    typeof value.occurredAt === "string" &&
    Number.isFinite(Date.parse(value.occurredAt)) &&
    isIdentifier(value.appVersion) &&
    isIdentifier(value.platform) &&
    diagnosticSources.has(value.source as DiagnosticSource) &&
    isDiagnosticPayload(value, [
      "version",
      "eventId",
      "occurredAt",
      "appVersion",
      "platform",
      "level",
      "source",
      "presentation",
      "code",
      "message",
      "context",
    ])
  );
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
  return lines.join("\n");
}
