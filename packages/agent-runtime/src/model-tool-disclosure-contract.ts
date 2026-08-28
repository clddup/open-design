import { Type, type Static } from "@sinclair/typebox";
import { defineContract } from "@opendesign/contract-runtime";

export const ModelToolSurfaceSchema = Type.Union([
  Type.Literal("general"),
  Type.Literal("new-design"),
]);

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
    beforePlan: Type.Optional(
      Type.Union([Type.Literal("available"), Type.Literal("deferred")]),
    ),
    afterInspection: Type.Optional(Type.Literal("available")),
    role: Type.Optional(
      Type.Union([
        Type.Literal("inspection"),
        Type.Literal("plan"),
        Type.Literal("material-write"),
      ]),
    ),
    surfaces: Type.Optional(
      Type.Array(ModelToolSurfaceSchema, {
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
      }),
    ),
    bootstrapDescription: Type.Optional(
      Type.String({ minLength: 1, maxLength: 20_000 }),
    ),
    bootstrapInputSchema: Type.Optional(ProviderObjectInputSchema),
    continuationDescription: Type.Optional(
      Type.String({ minLength: 1, maxLength: 20_000 }),
    ),
    continuationInputSchema: Type.Optional(ProviderObjectInputSchema),
    whenDeliveryScopeReview: Type.Optional(Type.Literal("required")),
  },
  { additionalProperties: false },
);

export type ModelToolSurface = Static<typeof ModelToolSurfaceSchema>;
export type ModelToolDisclosure = Omit<
  Static<typeof ModelToolDisclosureSchema>,
  "surfaces" | "bootstrapInputSchema"
> & {
  surfaces?: readonly ModelToolSurface[];
  bootstrapInputSchema?: Record<string, unknown>;
  continuationDescription?: string;
  continuationInputSchema?: Record<string, unknown>;
};

export const ModelToolDisclosureContract = defineContract<ModelToolDisclosure>({
  schema: ModelToolDisclosureSchema,
  code: "agent_tool_disclosure.schema_invalid",
  subject: "Agent tool disclosure",
  maximum: 16,
  clone: false,
});
