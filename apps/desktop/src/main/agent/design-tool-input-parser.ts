import {
  isTrustedToolFailure,
  type ToolCallRequest,
  type TrustedToolContext,
} from "@opendesign/agent-contracts";
import type {
  ValidationIssue,
  ValidationResult,
} from "@/shared/contract-validation.js";
import {
  DESIGN_CAPABILITIES_TOOL_NAME,
  DesignCapabilityQueryContract,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  DESIGN_EDIT_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_FONT_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_SYSTEM_TOOL_NAME,
  DESIGN_TEXT_RANGE_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  EDIT_IMAGE_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  READ_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
  DeliveryScopeContract,
  DesignFontContract,
  DesignPageContract,
  DesignPlanContract,
  DesignSystemContract,
  DesignTextRangeContract,
  DesignVectorContract,
  EditDesignContract,
  EditImageContract,
  ExportRasterContract,
  ExportSvgContract,
  FirstSliceContract,
  GenerateImageContract,
  ImportSvgContract,
  PageStructureAccessContract,
  PlaceImageContract,
  ReadImageContract,
  UpdateImageContract,
  designAgentToolInputIssues,
} from "@/shared/design-agent-tools.js";
import { agentDesignNodeIdPrefix } from "@/shared/design-id-allocation.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import { FatalAgentRunError } from "./fatal-agent-run-error.js";

type InputContract = {
  parse(input: unknown): ValidationResult<unknown>;
};

const CONTRACTS = new Map<string, InputContract>([
  [DESIGN_CAPABILITIES_TOOL_NAME, DesignCapabilityQueryContract],
  [DESIGN_DELIVERY_SCOPE_TOOL_NAME, DeliveryScopeContract],
  [READ_IMAGE_TOOL_NAME, ReadImageContract],
  [GENERATE_IMAGE_TOOL_NAME, GenerateImageContract],
  [PLACE_IMAGE_TOOL_NAME, PlaceImageContract],
  [UPDATE_IMAGE_TOOL_NAME, UpdateImageContract],
  [EDIT_IMAGE_TOOL_NAME, EditImageContract],
  [IMPORT_SVG_TOOL_NAME, ImportSvgContract],
  [EXPORT_SVG_TOOL_NAME, ExportSvgContract],
  [EXPORT_RASTER_TOOL_NAME, ExportRasterContract],
  [DESIGN_EDIT_TOOL_NAME, EditDesignContract],
  [DESIGN_VECTOR_TOOL_NAME, DesignVectorContract],
  [DESIGN_SYSTEM_TOOL_NAME, DesignSystemContract],
  [PAGE_STRUCTURE_ACCESS_TOOL_NAME, PageStructureAccessContract],
  [DESIGN_PAGE_TOOL_NAME, DesignPageContract],
  [DESIGN_TEXT_RANGE_TOOL_NAME, DesignTextRangeContract],
  [DESIGN_FONT_TOOL_NAME, DesignFontContract],
]);

const EMPTY_INPUT_TOOLS = new Set([
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
]);

export function parseDesignToolInput(
  coordinator: GlobalTaskCoordinator,
  call: ToolCallRequest,
  context: TrustedToolContext,
): ValidationResult<unknown> {
  assertActiveDesignContext(coordinator, context);
  if (call.toolName === DESIGN_FIRST_SLICE_TOOL_NAME) {
    return FirstSliceContract.parse(call.input, {
      authoritativePrompt: coordinator.authoritativeDesignPrompt(context),
      newNodeIdPrefix: agentDesignNodeIdPrefix(context.runId),
      target: coordinator.firstSliceTargetBinding(context),
    });
  }
  if (call.toolName === DESIGN_PLAN_TOOL_NAME) {
    return DesignPlanContract.parse(call.input, {
      authoritativePrompt: coordinator.authoritativeDesignPrompt(context),
    });
  }
  const contract = CONTRACTS.get(call.toolName);
  if (contract) return contract.parse(call.input);
  if (EMPTY_INPUT_TOOLS.has(call.toolName)) {
    const issues = designAgentToolInputIssues(call.toolName, call.input);
    return issues.length === 0
      ? { ok: true, value: {} }
      : { ok: false, issues: requiredCodes(issues) };
  }
  return {
    ok: false,
    issues: requiredCodes(
      designAgentToolInputIssues(call.toolName, call.input),
    ),
  };
}

function assertActiveDesignContext(
  coordinator: GlobalTaskCoordinator,
  context: TrustedToolContext,
): void {
  try {
    coordinator.assertDesignToolContext(context);
  } catch (error) {
    if (error instanceof Error && isTrustedToolFailure(error.cause)) {
      throw error;
    }
    throw new FatalAgentRunError(
      "run_context_invalid",
      error instanceof Error
        ? error.message
        : "Design tool Run context is invalid",
    );
  }
}

function requiredCodes(
  issues: ReturnType<typeof designAgentToolInputIssues>,
): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    code: issue.code ?? "design_tool.input_invalid",
  }));
}
