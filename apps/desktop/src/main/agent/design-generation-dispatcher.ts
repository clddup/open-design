import type {
  ToolCallRequest,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { DESIGN_GENERATION_TOOL_NAME } from "@/shared/design-agent-tools";
import type { DesignCaptureReviewSession } from "./design-capture-review-tool-handler";

export function dispatchDesignGenerationOrCapture(
  call: ToolCallRequest,
  dependencies: {
    generate: () => Promise<TrustedToolResult>;
    captureReview: Pick<DesignCaptureReviewSession, "handle">;
  },
): Promise<TrustedToolResult | null> {
  return call.toolName === DESIGN_GENERATION_TOOL_NAME
    ? dependencies.generate()
    : dependencies.captureReview.handle(call);
}
