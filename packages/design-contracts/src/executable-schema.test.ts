import { describe, expect, it } from "vitest";
import { schemaValidationIssues, executableJsonSchema } from "./index.js";

describe("executable JSON Schema", () => {
  it("keeps Provider JSON unchanged while enforcing the same Runtime tree", () => {
    const source = {
      type: "object",
      properties: {
        action: { enum: ["insert", "remove"] },
        label: { type: "string", minLength: 1 },
      },
      required: ["action", "label"],
      additionalProperties: false,
    } as const;
    const schema = executableJsonSchema(source);

    expect(JSON.stringify(schema)).toBe(JSON.stringify(source));
    expect(
      schemaValidationIssues(schema, { action: "insert", label: "A" }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(schema, { action: "rename", label: "A" }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/action" })]),
    );
    expect(
      schemaValidationIssues(schema, { action: "insert", label: "" }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/label" })]),
    );
  });

  it("rejects unsupported schema composition instead of silently weakening it", () => {
    expect(() =>
      executableJsonSchema({ oneOf: [{ type: "string" }, { type: "number" }] }),
    ).toThrow("Unsupported executable JSON Schema keyword: oneOf");
  });

  it("executes a closed object and its discriminated branches as one schema", () => {
    const source = {
      type: "object",
      properties: {
        action: { enum: ["insert", "remove"] },
        label: { type: "string" },
        nodeId: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
      anyOf: [
        {
          type: "object",
          properties: {
            action: { const: "insert" },
            label: { type: "string", minLength: 1 },
          },
          required: ["action", "label"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            action: { const: "remove" },
            nodeId: { type: "string", minLength: 1 },
          },
          required: ["action", "nodeId"],
          additionalProperties: false,
        },
      ],
    } as const;
    const schema = executableJsonSchema(source);

    expect(JSON.stringify(schema)).toBe(JSON.stringify(source));
    expect(
      schemaValidationIssues(schema, { action: "insert", label: "A" }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(schema, { action: "remove", nodeId: "node_1" }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(schema, { action: "insert", nodeId: "node_1" }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/label" })]),
    );
    expect(
      schemaValidationIssues(schema, {
        action: "remove",
        nodeId: "node_1",
        unexpected: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/unexpected" }),
      ]),
    );
  });

  it("follows nested discriminants before choosing union errors", () => {
    const schema = executableJsonSchema({
      anyOf: [
        { type: "boolean" },
        {
          anyOf: [
            {
              type: "object",
              properties: {
                type: { const: "CUSTOM" },
                amount: { type: "number" },
              },
              required: ["type", "amount"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "ALIAS" },
                id: { type: "string" },
              },
              required: ["type", "id"],
              additionalProperties: false,
            },
          ],
        },
      ],
    } as const);

    expect(schemaValidationIssues(schema, { type: "CUSTOM" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/amount" })]),
    );
    expect(schemaValidationIssues(schema, { type: "CUSTOM" })).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Expected boolean" }),
      ]),
    );
  });

  it("preserves empty-object runtime metadata when executable schemas are composed", () => {
    const nested = executableJsonSchema({
      type: "object",
      properties: {
        action: { const: "replace" },
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              extensions: { type: "object" },
            },
            required: ["extensions"],
            additionalProperties: false,
          },
        },
      },
      required: ["action", "nodes"],
      additionalProperties: false,
    } as const);
    const composed = executableJsonSchema({
      type: "object",
      properties: {
        version: { const: 1 },
        apply: { type: "object" },
      },
      required: ["version"],
      additionalProperties: false,
      anyOf: [
        {
          type: "object",
          properties: {
            version: { const: 1 },
            apply: nested,
          },
          required: ["version", "apply"],
          additionalProperties: false,
        },
      ],
    } as const);

    expect(
      schemaValidationIssues(composed, {
        version: 1,
        apply: { action: "replace", nodes: [{ extensions: {} }] },
      }),
    ).toHaveLength(0);
  });

  it("preserves tuple item metadata when executable schemas are composed", () => {
    const transform = executableJsonSchema({
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: [
        { type: "number" },
        { type: "number" },
        { type: "number" },
        { type: "number" },
        { type: "number" },
        { type: "number" },
      ],
    } as const);
    const composed = executableJsonSchema({
      type: "object",
      properties: { transform },
      required: ["transform"],
      additionalProperties: false,
    } as const);

    expect(
      schemaValidationIssues(composed, {
        transform: [1, 0, 0, 1, 32, 48],
      }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(composed, {
        transform: [1, 0, "invalid", 1, 32, 48],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/transform/2" }),
      ]),
    );
  });

  it("recomposes nested executable discriminated intersections", () => {
    const nested = executableJsonSchema({
      type: "object",
      properties: {
        kind: { enum: ["text", "shape"] },
        properties: { type: "object" },
      },
      required: ["kind", "properties"],
      additionalProperties: false,
      anyOf: [
        {
          type: "object",
          properties: {
            kind: { const: "text" },
            properties: {
              type: "object",
              properties: {
                mode: { enum: ["fixed", "auto"] },
                maxLines: { anyOf: [{ type: "integer" }, { type: "null" }] },
              },
              required: ["mode", "maxLines"],
              additionalProperties: false,
              anyOf: [
                {
                  type: "object",
                  properties: {
                    mode: { const: "fixed" },
                    maxLines: { type: "null" },
                  },
                  required: ["mode", "maxLines"],
                },
                {
                  type: "object",
                  properties: {
                    mode: { const: "auto" },
                    maxLines: { type: "integer", minimum: 1 },
                  },
                  required: ["mode", "maxLines"],
                },
              ],
            },
          },
          required: ["kind", "properties"],
        },
        {
          type: "object",
          properties: {
            kind: { const: "shape" },
            properties: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
          required: ["kind", "properties"],
        },
      ],
    } as const);

    expect(() =>
      executableJsonSchema({
        type: "object",
        properties: { node: nested },
        required: ["node"],
        additionalProperties: false,
      } as const),
    ).not.toThrow();
  });

  it("supports standard empty schemas for compact shared-field branches", () => {
    const schema = executableJsonSchema({
      type: "object",
      properties: {
        kind: { enum: ["text", "shape"] },
        value: { type: "string", minLength: 1 },
      },
      required: ["kind", "value"],
      additionalProperties: false,
      anyOf: [
        {
          type: "object",
          properties: { kind: { const: "text" }, value: {} },
          required: ["kind", "value"],
        },
        {
          type: "object",
          properties: { kind: { const: "shape" }, value: {} },
          required: ["kind", "value"],
        },
      ],
    } as const);

    expect(
      schemaValidationIssues(schema, { kind: "text", value: "A" }),
    ).toEqual([]);
    expect(schemaValidationIssues(schema, { kind: "text", value: "" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/value" })]),
    );
  });
});
