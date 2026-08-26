import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { defineContract, schemaValidationIssues } from "./index.js";

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
});
