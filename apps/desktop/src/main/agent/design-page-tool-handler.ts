import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_PAGE_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  type DesignPageToolInput,
  type PageStructureAccessToolInput,
} from "@/shared/design-agent-tools.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export async function handleDesignPageTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute(call: ToolCallRequest): Promise<TrustedToolResult>;
}): Promise<TrustedToolResult | null> {
  if (input.call.toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME) {
    const access = input.call.input as PageStructureAccessToolInput;
    if (!input.coordinator.hasPageStructureAccess(input.context.runId)) {
      throw new Error("Page structure access was not approved for this Run");
    }
    return {
      content: {
        ok: true,
        capability: "page-structure",
        scope: "current-design-file",
        expires: "run-end",
        actions: access.actions,
      },
    };
  }
  if (input.call.toolName !== DESIGN_PAGE_TOOL_NAME) return null;

  const pageInput = input.call.input as DesignPageToolInput;
  input.coordinator.assertPageToolAccess(input.context, pageInput);
  input.coordinator.assertPageLifecycleInspected(input.context);
  const result = await input.execute({ ...input.call, input: pageInput });
  if (result.designRevision || pageInput.action === "clear") {
    input.coordinator.recordPageToolCompleted(
      input.context.runId,
      pageInput.action,
    );
  }
  if (pageInput.action !== "clear") return result;

  const superseded = input.coordinator.supersedeDesignDeliveryForClearedPage(
    input.context,
    pageInput.pageId,
  );
  if (!superseded) return result;
  if (!isRecord(result.content)) {
    throw new TypeError("Page clear result must be structured");
  }
  return {
    ...result,
    content: {
      ...result.content,
      deliveryDisposition: "superseded",
    },
  };
}

export function designPageToolPreauthorization(
  call: ToolCallRequest,
  context: TrustedToolContext,
  coordinator: GlobalTaskCoordinator | null,
): boolean | null {
  if (call.toolName !== PAGE_STRUCTURE_ACCESS_TOOL_NAME) return null;
  const access = call.input as PageStructureAccessToolInput;
  return (
    coordinator?.hasPageStructureAuthorization(
      context.runId,
      call.toolCallId,
      access.actions,
    ) ?? false
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
