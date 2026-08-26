import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_PAGE_TOOL_NAME,
  DesignPageContract,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  PageStructureAccessContract,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export async function handleDesignPageTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute(call: ToolCallRequest): Promise<TrustedToolResult>;
}): Promise<TrustedToolResult | null> {
  if (input.call.toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME) {
    const parsed = PageStructureAccessContract.parse(input.call.input);
    if (!parsed.ok) {
      throw new TypeError(
        formatValidationFailure("Page Structure Access", parsed.issues),
      );
    }
    if (!input.coordinator.hasPageStructureAccess(input.context.runId)) {
      throw new Error("Page structure access was not approved for this Run");
    }
    input.coordinator.assertDeliveryScopeReviewed(input.context);
    return {
      content: {
        ok: true,
        capability: "page-structure",
        scope: "current-design-file",
        expires: "run-end",
        actions: parsed.value.actions,
      },
    };
  }
  if (input.call.toolName !== DESIGN_PAGE_TOOL_NAME) return null;

  const parsed = DesignPageContract.parse(input.call.input);
  if (!parsed.ok) {
    throw new TypeError(formatValidationFailure("Page", parsed.issues));
  }
  const pageInput = parsed.value;
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

  input.coordinator.supersedeDesignDeliveryForClearedPage(
    input.context,
    pageInput.pageId,
  );
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
  const parsed = PageStructureAccessContract.parse(call.input);
  if (!parsed.ok) return true;
  return (
    coordinator?.hasPageStructureAuthorization(
      context.runId,
      call.toolCallId,
      parsed.value.actions,
    ) ?? false
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
