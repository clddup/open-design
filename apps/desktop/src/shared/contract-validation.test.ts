import { executableJsonSchema } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { defineContract, type ValidationIssue } from "./contract-validation";

const MODEL_SCHEMA = executableJsonSchema({
  type: "object",
  properties: {
    action: { const: "create" },
    label: { type: "string", minLength: 1 },
  },
  required: ["action", "label"],
  additionalProperties: false,
} as const);

const CANONICAL_SCHEMA = executableJsonSchema({
  type: "object",
  properties: {
    action: { const: "create" },
    label: { type: "string", minLength: 1 },
    pageId: { type: "string", minLength: 1 },
  },
  required: ["action", "label", "pageId"],
  additionalProperties: false,
} as const);

type ModelValue = { action: "create"; label: string };
type CanonicalValue = ModelValue & { pageId: string };
type Context = { pageId: string };

function labelIssue(value: CanonicalValue): ValidationIssue[] {
  return value.label === "duplicate"
    ? [
        {
          code: "example.label_duplicate",
          path: "/label",
          message: "Label is already used",
          actual: value.label,
          recovery: "Choose a distinct label.",
        },
      ]
    : [];
}

const ExampleContract = defineContract<ModelValue, CanonicalValue, Context>({
  schema: MODEL_SCHEMA,
  code: "example.schema_invalid",
  subject: "example",
  canonical: {
    schema: CANONICAL_SCHEMA,
    code: "example.host_binding_invalid",
    subject: "host-bound example",
  },
  bind: (value, context) => ({ ...value, pageId: context.pageId }),
  refine: labelIssue,
});

describe("defineContract", () => {
  it("uses the disclosed schema as the only model structure boundary", () => {
    expect(ExampleContract.schema).toBe(MODEL_SCHEMA);
    const parsed = ExampleContract.parse(
      { action: "create", label: "Ready", pageId: "model-owned" },
      { pageId: "page_1" },
    );
    expect(parsed).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "example.schema_invalid",
          path: "/pageId",
        }),
      ],
    });
  });

  it("binds trusted host context before canonical validation", () => {
    expect(
      ExampleContract.parse(
        { action: "create", label: "Ready" },
        { pageId: "" },
      ),
    ).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "example.host_binding_invalid",
          path: "/pageId",
        }),
      ],
    });
    expect(
      ExampleContract.parse(
        { action: "create", label: "Ready" },
        { pageId: "page_1" },
      ),
    ).toEqual({
      ok: true,
      value: { action: "create", label: "Ready", pageId: "page_1" },
    });
  });

  it("returns domain issues without reimplementing field structure", () => {
    expect(
      ExampleContract.parse(
        { action: "create", label: "duplicate" },
        { pageId: "page_1" },
      ),
    ).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "example.label_duplicate",
          path: "/label",
        }),
      ],
    });
  });
});
