import { describe, expect, it } from "vitest";
import { capabilityManifestForAgent } from "@opendesign/design-capabilities";
import { TrustedToolResultContract } from "@opendesign/agent-contracts";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_CAPABILITIES_TOOL_NAME,
  DesignCapabilityQueryContract,
} from "@/shared/design-agent-tools";
import { handleDesignCapabilityTool } from "./design-capability-tool-handler";

const query = (input: unknown) => {
  const parsed = DesignCapabilityQueryContract.parse(input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return handleDesignCapabilityTool({
    toolCallId: "query",
    toolName: DESIGN_CAPABILITIES_TOOL_NAME,
    input: parsed.value,
  });
};

describe("Main capability selection", () => {
  it("lists existing tools without selecting all schemas", () => {
    const result = query({});
    expect(result).not.toHaveProperty("modelToolSelection");
    expect(result?.content).toMatchObject(capabilityManifestForAgent());
    expect(result).toHaveProperty("content.toolCatalog");
    expect(TrustedToolResultContract.parse(result).ok).toBe(true);
  });
  it("uses tool names from the real catalog, not a second maintained name list", () => {
    const names = DESIGN_AGENT_TOOL_SPECS.map((tool) => tool.name);
    const result = query({ tools: names });
    expect(result?.modelToolSelection).toEqual(names);
    expect(TrustedToolResultContract.parse(result).ok).toBe(true);
  });
  it("distinguishes an explicit reset from a manifest-only query", () => {
    expect(query({ tools: [] })?.modelToolSelection).toEqual([]);
    expect(query({})?.modelToolSelection).toBeUndefined();
  });
  it.each([
    { tools: ["unknown_tool"] },
    { tools: ["opendesign_edit_vector", "opendesign_edit_vector"] },
    { tools: "opendesign_edit_vector" },
  ])("rejects invalid selection %j using the one contract", (input) => {
    const result = DesignCapabilityQueryContract.parse(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid selection");
    expect(result.issues.some((issue) => issue.path.startsWith("/tools"))).toBe(
      true,
    );
  });
});
