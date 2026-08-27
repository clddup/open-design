import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { ModelSelectionSchema } from "./index.js";

describe("model selection contract", () => {
  it("requires a non-empty model ID at every consumer boundary", () => {
    expect(
      Value.Check(ModelSelectionSchema, {
        providerId: "provider_1",
        modelId: "design-model",
      }),
    ).toBe(true);
    expect(
      Value.Check(ModelSelectionSchema, {
        providerId: "provider_1",
        modelId: "",
      }),
    ).toBe(false);
  });
});
