import { Type, type Static } from "@sinclair/typebox";
import { defineContract } from "./contract-validation";

export const AgentRequestErrorCodeSchema = Type.Union([
  Type.Literal("conversation_busy"),
  Type.Literal("preflight_stale"),
  Type.Literal("request_rejected"),
]);

export const AgentRequestResultSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object(
    {
      ok: Type.Literal(false),
      error: Type.Object(
        {
          code: AgentRequestErrorCodeSchema,
          message: Type.String({ minLength: 1, maxLength: 20_000 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);

export type AgentRequestErrorCode = Static<typeof AgentRequestErrorCodeSchema>;
export type AgentRequestResult = Static<typeof AgentRequestResultSchema>;

export const AgentRequestResultContract = defineContract<AgentRequestResult>({
  schema: AgentRequestResultSchema,
  code: "agent_request_result.schema_invalid",
  subject: "Agent request result",
  clone: false,
});
