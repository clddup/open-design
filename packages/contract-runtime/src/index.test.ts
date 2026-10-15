import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import {
  defineContract,
  schemaValidationIssues,
  selectDiscriminatedUnionSchema,
} from "./index.js";

describe("contract runtime", () => {
  it.each([
    {
      input: { width: "wide" },
      expected: { type: "number", minimum: 1, maximum: 20 },
      actual: "wide",
    },
    {
      input: { width: 21 },
      expected: { type: "number", minimum: 1, maximum: 20 },
      actual: 21,
    },
  ])(
    "derives bounded type and range diagnostics from Schema: $input",
    ({ input, expected, actual }) => {
      const contract = defineContract<{ width: number }>({
        schema: Type.Object({
          width: Type.Number({ minimum: 1, maximum: 20 }),
        }),
        code: "example.schema_invalid",
        subject: "example",
      });
      expect(contract.parse(input)).toMatchObject({
        ok: false,
        issues: [
          {
            path: "/width",
            expected,
            actual,
            recovery: expect.any(String) as unknown,
          },
        ],
      });
    },
  );

  it("lists every allowed enum value without unrelated union branch errors", () => {
    const schema = Type.Object({
      mode: Type.Union([Type.Literal("read"), Type.Literal("write")]),
    });
    expect(schemaValidationIssues(schema, { mode: "execute" })).toEqual([
      expect.objectContaining({
        path: "/mode",
        expected: ["read", "write"],
        actual: "execute",
      }),
    ]);
  });

  it.each(["x".repeat(10000), { token: "never-disclose" }])(
    "bounds unknown discriminants without exposing object contents",
    (kind) => {
      const schema = Type.Union([
        Type.Object({ kind: Type.Literal("text"), text: Type.String() }),
        Type.Object({ kind: Type.Literal("image"), assetId: Type.String() }),
      ]);
      const issues = schemaValidationIssues(schema, { kind });
      expect(issues).toEqual([
        expect.objectContaining({ path: "/kind", expected: ["text", "image"] }),
      ]);
      expect(JSON.stringify(issues)).not.toContain("never-disclose");
      expect(JSON.stringify(issues).length).toBeLessThan(1000);
    },
  );

  it("reports removal of additional fields without exposing object contents", () => {
    const contract = defineContract<{ width: number }>({
      schema: Type.Object(
        { width: Type.Number() },
        { additionalProperties: false },
      ),
      code: "example.schema_invalid",
      subject: "example",
    });
    const result = contract.parse({
      width: 1,
      "secret/data": { token: "never-disclose", huge: "x".repeat(10000) },
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          path: "/secret~1data",
          expected: "absent",
          actual: { type: "object" },
          recovery: expect.stringContaining("Remove") as unknown,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("never-disclose");
    expect(JSON.stringify(result).length).toBeLessThan(1000);
  });

  it("bounds invalid strings and summarizes arrays instead of copying payloads", () => {
    const schema = Type.Object({
      label: Type.Number(),
      items: Type.Array(Type.Unknown(), { maxItems: 0 }),
    });
    const issues = schemaValidationIssues(schema, {
      label: "x".repeat(10000),
      items: [{ token: "never-disclose" }],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: "/items",
        expected: { type: "array", maxItems: 0 },
        actual: { type: "array", length: 1 },
      }),
    );
    expect(JSON.stringify(issues)).not.toContain("never-disclose");
    expect(JSON.stringify(issues).length).toBeLessThan(1000);
  });

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
