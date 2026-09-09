import type { DesignVisualCriticContext } from "./design-visual-critic";

export function criticDocumentReferences(context: DesignVisualCriticContext) {
  const documents = new Map(
    (context.userRequirements ?? []).flatMap((requirement) =>
      requirement.documents.map(
        (document) => [document.attachmentId, document] as const,
      ),
    ),
  );
  return [...documents.values()].map((document) => ({
    type: "document_ref" as const,
    ...document,
  }));
}

export function criticEvidenceContract(
  context: DesignVisualCriticContext,
  requiredCriteria: readonly string[],
  logoDirectionCriteria: readonly unknown[],
) {
  const logoEvidence =
    context.plan.deliverable === "logo"
      ? {
          logoDirectionCriteria,
        }
      : {};
  return {
    phase: context.phase,
    observedRevision: context.observedRevision,
    checkedQualityNodeCount: context.checkedQualityNodeCount,
    geometryAssessment:
      context.checkedQualityNodeCount === 0
        ? "No safe-area or interactive targets were evaluated. Do not claim these checks passed; judge visible layout separately."
        : undefined,
    ...(context.userRequirements?.length
      ? { userRequirements: context.userRequirements }
      : { userRequest: context.userRequest }),
    deliverable: context.plan.deliverable,
    objective: context.plan.objective,
    target: {
      targetId: context.target.targetId,
      label: context.target.label,
      objective: context.target.objective,
      qualityProfile: context.target.qualityProfile,
      editableLayers: context.target.editableLayers,
    },
    briefFidelity: context.plan.briefFidelity,
    logoOutputs: context.plan.logoOutputs,
    referenceStrategy: context.plan.referenceStrategy
      ? {
          references: context.plan.referenceStrategy.references.map(
            (reference) => ({
              attachmentId: reference.attachmentId,
              decision: reference.decision,
            }),
          ),
        }
      : undefined,
    deliveryCaptureAttachmentId: context.attachment.attachmentId,
    visualReferenceAttachmentIds: context.referenceAttachments.map(
      (attachment) => attachment.attachmentId,
    ),
    ...logoEvidence,
    requiredCriteria,
  };
}
