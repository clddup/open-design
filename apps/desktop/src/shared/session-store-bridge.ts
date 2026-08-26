import { defineContract, formatValidationFailure } from "./contract-validation";
import {
  refineSessionStoreBridgeRequest,
  refineSessionStoreBridgeResponse,
} from "./session-store-bridge-domain";
import {
  SessionStoreBridgeRequestIdentitySchema,
  SessionStoreBridgeRequestOperationSchema,
  SessionStoreBridgeRequestSchema,
  SessionStoreBridgeResponseIdentitySchema,
  SessionStoreBridgeResponseSchema,
  type SessionStoreBridgeRequest,
  type SessionStoreBridgeRequestIdentity,
  type SessionStoreBridgeRequestOperation,
  type SessionStoreBridgeResponse,
  type SessionStoreBridgeResponseIdentity,
  type SessionStoreOperation,
} from "./session-store-bridge-schemas";

export type {
  SessionStoreBridgeRequest,
  SessionStoreBridgeResponse,
  SessionStoreOperation,
} from "./session-store-bridge-schemas";

export const SessionStoreBridgeRequestContract =
  defineContract<SessionStoreBridgeRequest>({
    schema: SessionStoreBridgeRequestSchema,
    code: "session_store_bridge_request.schema_invalid",
    subject: "Session Store bridge request",
    clone: false,
    refine: refineSessionStoreBridgeRequest,
  });

export const SessionStoreBridgeResponseContract =
  defineContract<SessionStoreBridgeResponse>({
    schema: SessionStoreBridgeResponseSchema,
    code: "session_store_bridge_response.schema_invalid",
    subject: "Session Store bridge response",
    clone: false,
    refine: refineSessionStoreBridgeResponse,
  });

const SessionStoreBridgeRequestIdentityContract =
  defineContract<SessionStoreBridgeRequestIdentity>({
    schema: SessionStoreBridgeRequestIdentitySchema,
    code: "session_store_bridge_request_identity.schema_invalid",
    subject: "Session Store bridge request identity",
    clone: false,
  });
const SessionStoreBridgeRequestOperationContract =
  defineContract<SessionStoreBridgeRequestOperation>({
    schema: SessionStoreBridgeRequestOperationSchema,
    code: "session_store_bridge_request_operation.schema_invalid",
    subject: "Session Store bridge request operation",
    clone: false,
  });
const SessionStoreBridgeResponseIdentityContract =
  defineContract<SessionStoreBridgeResponseIdentity>({
    schema: SessionStoreBridgeResponseIdentitySchema,
    code: "session_store_bridge_response_identity.schema_invalid",
    subject: "Session Store bridge response identity",
    clone: false,
  });

export function isSessionStoreBridgeRequest(
  value: unknown,
): value is SessionStoreBridgeRequest {
  return SessionStoreBridgeRequestContract.parse(value).ok;
}

export function sessionStoreBridgeRequestValidationError(
  value: unknown,
): string | null {
  const result = SessionStoreBridgeRequestContract.parse(value);
  return result.ok
    ? null
    : formatValidationFailure("Session Store bridge request", result.issues);
}

export function sessionStoreBridgeRequestId(value: unknown): string | null {
  const result = SessionStoreBridgeRequestIdentityContract.parse(value);
  return result.ok ? result.value.requestId : null;
}

export function sessionStoreBridgeRequestOperation(
  value: unknown,
): SessionStoreOperation | null {
  const result = SessionStoreBridgeRequestOperationContract.parse(value);
  return result.ok ? result.value.operation : null;
}

export function isSessionStoreBridgeResponse(
  value: unknown,
): value is SessionStoreBridgeResponse {
  return SessionStoreBridgeResponseContract.parse(value).ok;
}

export function sessionStoreBridgeResponseValidationError(
  value: unknown,
): string | null {
  const result = SessionStoreBridgeResponseContract.parse(value);
  return result.ok
    ? null
    : formatValidationFailure("Session Store bridge response", result.issues);
}

export function sessionStoreBridgeResponseId(value: unknown): string | null {
  const result = SessionStoreBridgeResponseIdentityContract.parse(value);
  return result.ok ? result.value.requestId : null;
}
