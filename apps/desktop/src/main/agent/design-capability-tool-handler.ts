import type {
  ToolCallRequest,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { capabilityManifestForAgent } from "@opendesign/design-capabilities";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_CAPABILITIES_TOOL_NAME,
  type DesignCapabilityQueryInput,
} from "@/shared/design-agent-tools.js";

/** Input has already been parsed once by Main's authoritative query Contract. */
export function handleDesignCapabilityTool(
  call: ToolCallRequest,
): TrustedToolResult | null {
  if (call.toolName !== DESIGN_CAPABILITIES_TOOL_NAME) return null;
  const input = call.input as DesignCapabilityQueryInput;
  return {
    content: {
      ...(input.tools === undefined
        ? {
            ...capabilityManifestForAgent(),
            toolCatalog: DESIGN_AGENT_TOOL_SPECS.map((tool) => ({
              name: tool.name,
              description:
                tool.description.split(". ")[0] +
                (tool.description.includes(". ") ? "." : ""),
            })),
          }
        : { selectedTools: [...input.tools] }),
      selectionUsage:
        input.tools === undefined
          ? "Information-only query: the current schema selection is unchanged. Set tools to registered names to request their complete schemas for the next response."
          : "The selected set replaces prior choices for the next model response; basic tools remain available. Schema visibility does not grant execution permissions.",
    },
    ...(input.tools === undefined
      ? {}
      : { modelToolSelection: [...input.tools] }),
  };
}
