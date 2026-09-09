import type {
  AgentImageAttachment,
  TrustedToolContext,
} from "@opendesign/agent-contracts";
import type { ModelSelection } from "@opendesign/model-gateway";
import { builtinDesignSkillRefsForDeliverable } from "@opendesign/design-skills";
import type { ExplicitCaptureTarget } from "@/shared/design-capture-tool";
import type { RendererDesignCaptureTarget } from "@/shared/design-tool-bridge";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification";
import {
  inspectedNodeBelongsToPage,
  type InspectedHierarchy,
} from "./design-plan-registration";
import type { DesignVisualCriticContext } from "./design-visual-critic";
import type { VisualCriticUserRequirement } from "./visual-critic-user-requirements";

export type ExplicitCanvasReviewEvidence = {
  readonly prompt: string;
  readonly modelSelection: ModelSelection;
  readonly userRequirements: readonly VisualCriticUserRequirement[];
  readonly imageAttachments: readonly AgentImageAttachment[];
};

export type ExplicitCanvasReview = {
  captureTarget: RendererDesignCaptureTarget;
  criticContext: Omit<
    DesignVisualCriticContext,
    "observedRevision" | "attachment" | "phase"
  >;
};

export function resolveExplicitCanvasReview({
  context,
  inspection,
  binding,
  target,
}: {
  context: TrustedToolContext;
  inspection: InspectedHierarchy;
  binding: ExplicitCanvasReviewEvidence;
  target: ExplicitCaptureTarget;
}): ExplicitCanvasReview {
  const pageId = requireCurrentFramePage(context, inspection, target.frameId);
  const referenceAttachments = resolveReferences(
    target,
    binding.imageAttachments,
  );
  const quality =
    target.qualityProfile === undefined
      ? {}
      : { qualityProfile: structuredClone(target.qualityProfile) };
  return {
    captureTarget: {
      kind: "frame",
      pageId,
      nodeId: target.frameId,
      ...quality,
    },
    criticContext: {
      runId: context.runId,
      modelSelection: structuredClone(binding.modelSelection),
      userRequest: binding.prompt,
      userRequirements: structuredClone([...binding.userRequirements]),
      plan: {
        deliverable: target.deliverable,
        objective: binding.prompt,
        skillRefs: builtinDesignSkillRefsForDeliverable(target.deliverable),
      },
      target: {
        targetId: target.frameId,
        label: target.frameId,
        objective: binding.prompt,
        ...quality,
      },
      referenceAttachments,
    },
  };
}

function requireCurrentFramePage(
  context: TrustedToolContext,
  inspection: InspectedHierarchy,
  frameId: string,
): string {
  if (
    inspection.documentId !== context.documentId ||
    inspection.revision !== context.revision
  ) {
    throw designWorkflowError(
      "revision_conflict",
      "Inspect the current design revision before reviewing an existing Frame",
      { path: "/target/frameId" },
    );
  }
  const frame = inspection.nodesById.get(frameId);
  if (!frame || frame.kind !== "frame") {
    throw designWorkflowError(
      "target_stale",
      "The requested review target must be an existing Frame in the inspected document",
      { path: "/target/frameId", nodeId: frameId },
    );
  }
  const boundPageId =
    context.mutationTarget.kind === "page"
      ? context.mutationTarget.pageId
      : context.scope.pageId;
  const documentWide =
    context.mutationTarget.kind === "document" &&
    context.scope.kind === "document";
  const pages = boundPageId
    ? [boundPageId]
    : documentWide
      ? [...inspection.pageRootsById.keys()].filter((pageId) =>
          inspectedNodeBelongsToPage(inspection, pageId, frameId),
        )
      : [];
  const pageId = pages.length === 1 ? pages[0] : undefined;
  if (!pageId || !inspectedNodeBelongsToPage(inspection, pageId, frameId)) {
    throw designWorkflowError(
      "scope_conflict",
      "The requested review Frame is outside the current authorized Page",
      { path: "/target/frameId", nodeId: frameId },
    );
  }
  return pageId;
}

function resolveReferences(
  target: ExplicitCaptureTarget,
  attachments: readonly AgentImageAttachment[],
): AgentImageAttachment[] {
  return (target.referenceAttachmentIds ?? []).map((attachmentId, index) => {
    const attachment = attachments.find(
      (candidate) => candidate.attachmentId === attachmentId,
    );
    if (!attachment) {
      throw designWorkflowError(
        "reference_unavailable",
        "The requested visual reference is not authorized for this Run",
        { path: `/target/referenceAttachmentIds/${index}` },
      );
    }
    return structuredClone(attachment);
  });
}
