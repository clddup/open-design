import type {
  SessionStoreBridgeRequest,
  SessionStoreBridgeResponse,
} from "./session-store-bridge-schemas";
import type { ValidationIssue } from "./contract-validation";

const EVENT_PAYLOAD_MAX_CHARACTERS = 4_000_000;
const RESPONSE_RESULT_MAX_CHARACTERS = 16_000_000;

export function refineSessionStoreBridgeRequest(
  value: SessionStoreBridgeRequest,
): ValidationIssue[] {
  if (value.operation !== "append") return [];
  return eventIssues(value.event, "/event");
}

export function refineSessionStoreBridgeResponse(
  value: SessionStoreBridgeResponse,
): ValidationIssue[] {
  if (!value.ok) return [];
  if (value.operation === "read") {
    const issues = value.result.flatMap((event, index) =>
      eventIssues(event, `/result/${index}`),
    );
    return [
      ...issues,
      ...jsonBudgetIssues(
        value.result,
        RESPONSE_RESULT_MAX_CHARACTERS,
        "/result",
        "session_store_bridge_response.result_too_large",
        "Session Store read result exceeds the bridge size limit",
      ),
    ];
  }
  if (value.operation === "readTimeline") {
    return jsonBudgetIssues(
      value.result,
      RESPONSE_RESULT_MAX_CHARACTERS,
      "/result",
      "session_store_bridge_response.result_too_large",
      "Session Store timeline result exceeds the bridge size limit",
    );
  }
  if (value.operation === "project") {
    return value.result.compactedRanges.flatMap((range, index) =>
      range.toSequence >= range.fromSequence
        ? []
        : [
            issue(
              "session_store_bridge_response.compacted_range_invalid",
              `/result/compactedRanges/${index}/toSequence`,
              "Compacted range must end at or after its starting sequence",
            ),
          ],
    );
  }
  return [];
}

type DurableEvent = Extract<
  SessionStoreBridgeRequest,
  { operation: "append" }
>["event"];

function eventIssues(event: DurableEvent, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isFinite(Date.parse(event.createdAt))) {
    issues.push(
      issue(
        "session_store_bridge_event.timestamp_invalid",
        `${path}/createdAt`,
        "Journal event createdAt must be a parseable timestamp",
      ),
    );
  }
  issues.push(
    ...jsonBudgetIssues(
      event.payload,
      EVENT_PAYLOAD_MAX_CHARACTERS,
      `${path}/payload`,
      "session_store_bridge_event.payload_too_large",
      "Journal event payload exceeds the bridge size limit",
    ),
  );
  return issues;
}

function jsonBudgetIssues(
  value: unknown,
  maximum: number,
  path: string,
  code: string,
  message: string,
): ValidationIssue[] {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && serialized.length <= maximum
      ? []
      : [issue(code, path, message)];
  } catch {
    return [
      issue(
        "session_store_bridge.json_not_serializable",
        path,
        "Session Store bridge data must be JSON serializable",
      ),
    ];
  }
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery:
      "Correct the reported Session Store bridge field before retrying.",
  };
}
