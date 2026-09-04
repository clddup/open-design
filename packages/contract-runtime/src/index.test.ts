import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import {
  defineContract,
  schemaValidationIssues,
  selectDiscriminatedUnionSchema,
} from "./index.js";

describe("contract runtime", () => {
  it("returns the actionable field for a discriminated union", () => {
    const schema = Type.Union([
      Type.Object(
        {
          kind: Type.Literal("text"),
          text: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("image"), assetId: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ]);
    expect(schemaValidationIssues(schema, { kind: "text", text: 4 })).toEqual([
      expect.objectContaining({ path: "/text" }),
    ]);
  });

  it("runs structure once before domain refinement", () => {
    let refined = false;
    const contract = defineContract<{ id: string }>({
      schema: Type.Object(
        { id: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      code: "example.schema_invalid",
      subject: "example",
      refine: () => {
        refined = true;
        return [];
      },
    });
    expect(contract.parse({ id: 4 })).toMatchObject({
      ok: false,
      issues: [{ code: "example.schema_invalid", path: "/id" }],
    });
    expect(refined).toBe(false);
    expect(contract.parse({ id: "ready" })).toEqual({
      ok: true,
      value: { id: "ready" },
    });
    expect(refined).toBe(true);
  });

  it("validates model input before trusted host binding without inventing canonical fields", () => {
    const contract = defineContract<
      { localId: string },
      { localId: string; stableId: string },
      { stableId?: string }
    >(
      {
        schema: Type.Object(
          { localId: Type.String({ minLength: 1 }) },
          { additionalProperties: false },
        ),
        code: "example.model_invalid",
        subject: "model input",
        bind: (value, context) => ({
          ...value,
          stableId: context.stableId ?? "",
        }),
        canonical: {
          schema: Type.Object(
            {
              localId: Type.String({ minLength: 1 }),
              stableId: Type.String({ minLength: 1 }),
            },
            { additionalProperties: false },
          ),
          code: "example.host_binding_invalid",
          subject: "host-bound input",
        },
      },
      () => ({}),
    );

    expect(contract.modelIssues({ localId: "shape" })).toEqual([]);
    expect(contract.parse({ localId: "shape" })).toMatchObject({ ok: false });
    expect(
      contract.parse({ localId: "shape" }, { stableId: "node_shape" }),
    ).toEqual({
      ok: true,
      value: { localId: "shape", stableId: "node_shape" },
    });
  });

  it("selects only a matching literal-discriminated union branch", () => {
    const schema = Type.Union([
      Type.Object(
        { kind: Type.Literal("text"), text: Type.String() },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("image"), assetId: Type.String() },
        { additionalProperties: false },
      ),
    ]);

    expect(
      selectDiscriminatedUnionSchema(schema, { kind: "image" }, "kind"),
    ).toBe(schema.anyOf[1]);
    expect(
      selectDiscriminatedUnionSchema(schema, { kind: "video" }, "kind"),
    ).toBeUndefined();
    expect(
      selectDiscriminatedUnionSchema(schema, null, "kind"),
    ).toBeUndefined();
  });
});
