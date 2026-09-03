import { describe, expect, it } from "vitest";
import { DESIGN_FOCUSED_VISUAL_APPLY_TOOL_INPUT_SCHEMA } from "./design-focused-apply-schema";

type JsonRecord = Record<string, unknown>;

describe("focused visual Apply schema", () => {
  it("projects only properties supported by its disclosed node kinds", () => {
    const update = operationBranch("update_properties");
    const operationProperties = record(update.properties);
    const fields = record(operationProperties.properties)
      .properties as JsonRecord;

    expect(fields).toHaveProperty("path");
    expect(fields).toHaveProperty("fills");
    expect(fields).toHaveProperty("content");
    expect(operationProperties).toHaveProperty("effects");
    for (const unsupported of [
      "network",
      "assetId",
      "placement",
      "altText",
      "start",
      "end",
      "startEndpoint",
      "endEndpoint",
      "pointCount",
      "innerRadius",
    ]) {
      expect(fields).not.toHaveProperty(unsupported);
    }
  });
});

function operationBranch(type: string): JsonRecord {
  const root = record(DESIGN_FOCUSED_VISUAL_APPLY_TOOL_INPUT_SCHEMA);
  const commands = record(record(root.properties).commands);
  const branches = record(commands.items).anyOf as unknown[];
  const branch = branches.find(
    (candidate) =>
      record(record(record(candidate).properties).type).const === type,
  );
  if (!branch) throw new Error(`Missing ${type} operation branch`);
  return record(branch);
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected JSON Schema object");
  }
  return value as JsonRecord;
}
