import { Type, type Static } from "@sinclair/typebox";
import { defineContract } from "@opendesign/contract-runtime";

const ProviderObjectInputSchema = Type.Object(
  {
    type: Type.Literal("object"),
    additionalProperties: Type.Literal(false),
  },
  { additionalProperties: true },
);

export const ModelToolDisclosureSchema = Type.Object(
  {
    bootstrap: Type.Union([
      Type.Literal("available"),
      Type.Literal("deferred"),
    ]),
    afterInspection: Type.Optional(Type.Literal("available")),
    continuation: Type.Optional(Type.Literal("available")),
    role: Type.Optional(
      Type.Union([
        Type.Literal("inspection"),
        Type.Literal("plan"),
        Type.Literal("delivery-scope"),
        Type.Literal("material-write"),
        Type.Literal("capability-discovery"),
      ]),
    ),
    bootstrapDescription: Type.Optional(
      Type.String({ minLength: 1, maxLength: 20_000 }),
    ),
    bootstrapInputSchema: Type.Optional(ProviderObjectInputSchema),
    continuationDescription: Type.Optional(
      Type.String({ minLength: 1, maxLength: 20_000 }),
    ),
    continuationInputSchema: Type.Optional(ProviderObjectInputSchema),
  },
  { additionalProperties: false },
);

export type ModelToolDisclosure = Omit<
  Static<typeof ModelToolDisclosureSchema>,
  "bootstrapInputSchema"
> & {
  bootstrapInputSchema?: Record<string, unknown>;
  continuationInputSchema?: Record<string, unknown>;
};

export const ModelToolDisclosureContract = defineContract<ModelToolDisclosure>({
  schema: ModelToolDisclosureSchema,
  code: "agent_tool_disclosure.schema_invalid",
  subject: "Agent tool disclosure",
  maximum: 16,
  clone: false,
});
