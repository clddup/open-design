import { advanceDesignEditInspection } from "./design-edit-inspection.js";
import { committedEditChanges } from "./design-edit-change-set.js";
import { computeCommittedDesignEditImpact } from "./design-edit-committed-impact.js";
import { isIndependentNodeEdit } from "./design-edit-plan-impact.js";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import type {
  AgentAttachment,
  AgentEvent,
  AgentImageAttachment,
  AgentRequest,
  DesignMutationTarget,
  SelectionScope,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import type {
  DesignDocument,
  DesignOperation,
  Transform,
} from "@opendesign/design-contracts";
import type { ModelSelection } from "@opendesign/model-gateway";
import type { DesignLayoutQualityReport } from "@opendesign/editor-runtime";
import type { SessionStore } from "@opendesign/session-store";
import { toolResultAttachments } from "@opendesign/agent-runtime";
import {
  DESIGN_DELIVERY_LEDGER_VERSION,
  WORKSPACE_CONTRACT_VERSION,
  type DesignDeliveryLedger,
  type DesignDeliveryTarget,
  type GlobalTaskLifecycle,
  type GlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import type { ProjectHost } from "../project/project-host.js";
import type { WorkspaceStore } from "../project/workspace-store.js";
import {
  DESIGN_EDIT_TOOL_NAME,
  designApplyRequiresPlan,
  activeVisualReferenceIds,
  designPlanComponentStrategy,
  designPlanReferenceStrategy,
  designPlanTargets,
  isPlaceableRasterAssetRole,
  type DesignApplyToolInput,
  type DesignDeliveryScope,
  type DesignComponentToolInput,
  type FirstSliceTargetBinding,
  type DesignPlanTarget,
  type DesignPlanToolInput,
  type DesignReferenceStrategy,
  type DesignVisualReviewToolInput,
  type PlannedDesignRebaseGuard,
  type PlaceableRasterAssetRole,
  type RasterAssetRole,
} from "@/shared/design-agent-tools.js";
import type { RendererDesignCaptureTarget } from "@/shared/design-tool-bridge.js";
import type { DesignDeliveryStage } from "@opendesign/agent-contracts";
import {
  registerDesignWorkflowPlan,
  reconcileEstablishedArtboardDescendants,
  inspectedSubtreeIds,
  plannedNodeIdsForTarget,
  type DesignDeliveryTargetState,
  type DesignPlanRegistration,
  type DesignWorkflowState,
  type InspectedHierarchy,
} from "./design-plan-registration.js";
import {
  assertDeliveryTargetStructure,
  assertLayoutQualityMatchesCapture,
  parseInspectedHierarchy,
} from "./design-inspection.js";
import {
  conversationActivityAt,
  projectGlobalTaskLifecycle,
} from "./global-task-lifecycle.js";
import type {
  DesignVisualCriticContext,
  DesignVisualCriticResult,
} from "./design-visual-critic.js";
import { AgentRunAdmissionError } from "./agent-run-admission-error.js";
import { projectDesignDeliveryStage } from "./design-delivery-stage-projection.js";
import {
  createScopeArtboardReservation,
  finalizeScopeReservation,
  nextArtboardOrigin,
  scopeReservationLedger,
  type DeliveryScopeReservation,
  type DeliveryScopeArtboardReservation,
} from "./delivery-scope-artboard-reservation.js";
import {
  assertApplyPlanSteps,
  bindApplyToActivePlanSteps,
} from "./design-plan-apply-execution.js";
import { bindDesignOperationStructure } from "./design-apply-structure-binding.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

export type DesignPlanApplyAuthorization = {
  input: DesignApplyToolInput;
  plan: DesignPlanToolInput;
  rebaseGuard?: PlannedDesignRebaseGuard;
  targetIds: string[];
};

export type DesignPlanAllocation = {
  input: DesignApplyToolInput;
  targetIds: string[];
};

type RunToolBinding = {
  conversationId: string;
  documentId: string;
  revision: number;
  scope: SelectionScope;
  mutationTarget: DesignMutationTarget;
  prompt: string;
  modelSelection: ModelSelection;
  attachments: AgentAttachment[];
  imageAttachments: AgentImageAttachment[];
  continuationParentRunId?: string;
};

type ContinuationTransfer = {
  parentRunId: string;
  plan?: DesignWorkflowState;
  delivery?: DesignDeliveryLedger;
  deliveryScope?: DesignDeliveryScope;
  scopeReservations?: Map<string, DeliveryScopeArtboardReservation>;
  rasterRoles?: Map<string, RasterAssetRole>;
};

const activeLifecycles = new Set<GlobalTaskLifecycle>([
  "queued",
  "running",
  "waiting_approval",
]);

function publicCriticResult(result: DesignVisualCriticResult) {
  return {
    version: result.version,
    observedRevision: result.observedRevision,
    passed: result.passed,
    averageScore: result.averageScore,
    summary: result.summary,
    criteria: structuredClone(result.criteria),
    failedCriteria: [...result.failedCriteria],
    refinements: [...result.refinements],
  };
}

function requireFailedCriticReview(
  result: DesignVisualCriticResult,
): DesignVisualReviewToolInput {
  if (result.review) return result.review;
  throw new TypeError(
    "A failed visual critic result requires a review payload",
  );
}

export class GlobalTaskCoordinator {
  readonly #tasksByRunId = new Map<string, GlobalTaskProjection>();
  readonly #toolBindingsByRunId = new Map<string, RunToolBinding>();
  readonly #designPlansByRunId = new Map<string, DesignWorkflowState>();
  readonly #generatedRasterRolesByRunId = new Map<
    string,
    Map<string, RasterAssetRole>
  >();
  readonly #inspectionsByRunId = new Map<string, InspectedHierarchy>();
  readonly #pageStructureAccessByRunId = new Map<
    string,
    {
      approvalId: string;
      toolCallId: string;
      actions: Set<string>;
      completedActions: Set<string>;
    }
  >();
  readonly #deliveryScopesByRunId = new Map<string, DesignDeliveryScope>();
  readonly #deliveryScopeReservationsByRunId = new Map<
    string,
    Map<string, DeliveryScopeArtboardReservation>
  >();
  readonly #continuationTransfersByRunId = new Map<
    string,
    ContinuationTransfer
  >();

  constructor(
    private readonly projectHost: ProjectHost,
    private readonly workspaceStore: WorkspaceStore,
    private readonly now: () => Date = () => new Date(),
    private readonly sessionStore?: Pick<SessionStore, "readTimeline">,
  ) {}

  reconcileInterruptedTasks(): void {
    const timestamp = this.now().toISOString();
    for (const task of this.workspaceStore.listGlobalTasks()) {
      if (!activeLifecycles.has(task.lifecycle)) continue;
      this.workspaceStore.saveGlobalTask({
        ...task,
        lifecycle: "interrupted",
        updatedAt: timestamp,
      });
      this.#touchConversation(task.conversationId, timestamp);
    }
  }

  async registerRun(request: RunStartRequest): Promise<GlobalTaskProjection> {
    if (
      this.#tasksByRunId.has(request.runId) ||
      this.workspaceStore
        .listGlobalTasks()
        .some((task) => task.runId === request.runId)
    ) {
      throw new Error("Agent run ID is already registered");
    }
    const conversation = this.workspaceStore.getConversation(request.sessionId);
    if (!conversation || conversation.lifecycle !== "active") {
      throw new Error("Agent run requires an active Conversation");
    }
    const matches = this.projectHost
      .listOpenProjects()
      .flatMap((project) =>
        project.designFiles
          .filter((file) => file.documentId === request.documentId)
          .map((file) => ({ project, file })),
      );
    if (matches.length !== 1) {
      throw new Error(
        "Agent run document identity is unavailable or ambiguous",
      );
    }
    const match = matches[0];
    if (!match) throw new Error("Agent run document identity is unavailable");
    const opened = await this.projectHost.readDesignFile(
      match.project.projectId,
      match.file.designFileId,
    );
    if (request.revision < opened.document.revision) {
      throw new Error("Agent run revision is stale");
    }
    const pageId =
      request.mutationTarget.kind === "page"
        ? request.mutationTarget.pageId
        : (request.scope.pageId ?? opened.document.pageOrder[0]);
    if (!pageId || !opened.document.pagesById[pageId]) {
      throw new Error("Agent run requires a valid target page");
    }
    if (
      request.revision === opened.document.revision &&
      request.scope.selectedNodeIds.some(
        (nodeId) => !nodeBelongsToPage(opened.document, pageId, nodeId),
      )
    ) {
      throw new Error("Agent run selection is outside the target page");
    }
    const continuationTransfer = request.continuation
      ? this.#consumeContinuationTransfer(request)
      : undefined;
    const timestamp = this.now().toISOString();
    const primaryTarget = {
      targetId: `target_${request.runId}`,
      projectId: match.project.projectId,
      designFileId: match.file.designFileId,
      documentId: match.file.documentId,
      pageId,
      selectedNodeIds: [...request.scope.selectedNodeIds],
      ...(request.scope.primaryNodeId
        ? { primaryNodeId: request.scope.primaryNodeId }
        : {}),
      baseRevision: request.revision,
    };
    const continuedPlan = continuationTransfer?.plan;
    const continuedScopeReservation = continuationTransfer?.scopeReservations;
    const continuedDelivery = continuedPlan
      ? deliveryLedger(continuedPlan)
      : continuationTransfer?.delivery
        ? structuredClone(continuationTransfer.delivery)
        : continuedScopeReservation
          ? scopeReservationLedger([...continuedScopeReservation.values()])
          : undefined;
    const task: GlobalTaskProjection = {
      version: WORKSPACE_CONTRACT_VERSION,
      taskId: `task_${request.runId}`,
      conversationId: conversation.conversationId,
      runId: request.runId,
      title: conversation.title,
      lifecycle: "queued",
      targetSet: { targets: [primaryTarget], primaryTarget },
      ...(continuedDelivery ? { delivery: continuedDelivery } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.workspaceStore.saveConversation({
      ...conversation,
      updatedAt: timestamp,
    });
    this.workspaceStore.saveGlobalTask(task);
    this.#tasksByRunId.set(request.runId, task);
    if (continuedPlan) {
      this.#designPlansByRunId.set(request.runId, continuedPlan);
    }
    if (continuationTransfer?.deliveryScope) {
      this.#deliveryScopesByRunId.set(
        request.runId,
        continuationTransfer.deliveryScope,
      );
    }
    if (continuedScopeReservation) {
      this.#deliveryScopeReservationsByRunId.set(
        request.runId,
        continuedScopeReservation,
      );
    }
    if (continuationTransfer?.rasterRoles) {
      this.#generatedRasterRolesByRunId.set(
        request.runId,
        continuationTransfer.rasterRoles,
      );
    }
    const attachments = await this.#conversationAttachments(request);
    this.#toolBindingsByRunId.set(request.runId, {
      conversationId: request.sessionId,
      documentId: request.documentId,
      revision: request.revision,
      scope: structuredClone(request.scope),
      mutationTarget: structuredClone(request.mutationTarget),
      ...(request.continuation
        ? { continuationParentRunId: request.continuation.parentRunId }
        : {}),
      prompt: request.prompt,
      modelSelection: structuredClone(request.modelSelection),
      attachments,
      imageAttachments: attachments
        .filter(isImageAttachmentMetadata)
        .map((attachment) => structuredClone(attachment)),
    });
    return task;
  }

  #consumeContinuationTransfer(request: RunStartRequest): ContinuationTransfer {
    const transfer = this.#continuationTransfersByRunId.get(request.runId);
    if (
      !transfer ||
      transfer.parentRunId !== request.continuation?.parentRunId
    ) {
      throw new Error("Agent continuation workflow state is unavailable");
    }
    this.#continuationTransfersByRunId.delete(request.runId);
    return transfer;
  }

  referenceAttachmentsForRun(runId: string): AgentAttachment[] {
    return structuredClone(
      this.#toolBindingsByRunId.get(runId)?.attachments ?? [],
    );
  }

  async #conversationAttachments(
    request: RunStartRequest,
  ): Promise<AgentAttachment[]> {
    const byId = new Map<string, AgentAttachment>();
    if (this.sessionStore) {
      const timeline = await this.sessionStore.readTimeline(request.sessionId);
      for (const item of timeline) {
        if (item.type === "user.message") {
          for (const attachment of item.attachments ?? []) {
            byId.set(attachment.attachmentId, structuredClone(attachment));
          }
          continue;
        }
        if (item.type === "tool" && item.status === "completed") {
          for (const attachment of toolResultAttachments(item.result)) {
            byId.set(attachment.attachmentId, structuredClone(attachment));
          }
        }
      }
    }
    for (const attachment of request.attachments ?? []) {
      byId.set(attachment.attachmentId, structuredClone(attachment));
    }
    return [...byId.values()];
  }

  async assertRunRevisionCurrent(runId: string): Promise<void> {
    const task = this.#tasksByRunId.get(runId);
    if (!task) throw new Error("Agent Run is not registered");
    const target = task.targetSet.primaryTarget;
    const opened = await this.projectHost.readDesignFile(
      target.projectId,
      target.designFileId,
    );
    if (
      opened.document.documentId !== target.documentId ||
      opened.document.revision > target.baseRevision
    ) {
      throw new AgentRunAdmissionError(
        "preflight_stale",
        `Design File advanced from revision ${target.baseRevision} to ${opened.document.revision} before the task started. Send the message again against the current design.`,
      );
    }
  }

  assertDesignToolContext(context: TrustedToolContext): void {
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) {
      throw new Error("Design tool requires an active registered Run");
    }
    if (
      binding.conversationId !== context.sessionId ||
      binding.documentId !== context.documentId ||
      !sameScope(binding.scope, context.scope) ||
      !sameMutationTarget(binding.mutationTarget, context.mutationTarget)
    ) {
      throw new Error("Design tool context does not match its registered Run");
    }
    if (binding.revision !== context.revision) {
      throw designWorkflowError(
        "revision_conflict",
        `Design tool revision conflict: expected ${binding.revision}, received ${context.revision}`,
      );
    }
  }

  authoritativeDesignPrompt(context: TrustedToolContext): string {
    this.assertDesignToolContext(context);
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) throw new Error("Design brief requires an active Run");
    return binding.prompt;
  }

  firstSliceTargetBinding(
    context: TrustedToolContext,
  ): FirstSliceTargetBinding {
    this.assertDesignToolContext(context);
    const scope = this.#deliveryScopesByRunId.get(context.runId);
    if (scope) {
      const next = this.getDeliveryStageContext(context.runId)?.nextTarget;
      if (!next) {
        throw designWorkflowError(
          "delivery_scope_mismatch",
          "The recorded delivery scope has no unplanned target available for a new first slice",
        );
      }
      return {
        targetId: next.targetId,
        label: next.label,
        objective: next.objective,
        pageId: next.artboard.pageId,
        frame: {
          frameId: next.artboard.frameId,
          x: next.artboard.x,
          y: next.artboard.y,
          width: next.artboard.width,
          height: next.artboard.height,
        },
      };
    }
    const inspection = this.#requireDocumentInspection(context);
    const binding = this.#toolBindingsByRunId.get(context.runId);
    const pageId =
      binding?.mutationTarget.kind === "page"
        ? binding.mutationTarget.pageId
        : context.scope.pageId;
    if (!pageId || !inspection.pageRootsById.has(pageId)) {
      throw designWorkflowError(
        "allocated_artboard_invalid",
        "First Slice requires the current inspected Page",
      );
    }
    if (!inspection.newNodeIdPrefix) {
      throw designWorkflowError(
        "allocated_artboard_invalid",
        "First Slice requires the current Run node ID allocation",
      );
    }
    const origin = nextArtboardOrigin(pageId, inspection);
    return {
      targetId: "first_slice",
      pageId,
      frame: {
        frameId: `${inspection.newNodeIdPrefix}artboard`,
        x: origin.x,
        y: origin.y,
      },
    };
  }

  createDeliveryScopeReservation(
    context: TrustedToolContext,
    scope: DesignDeliveryScope,
  ): DeliveryScopeReservation {
    this.assertDesignToolContext(context);
    this.#assertDeliveryScopeCanBeReviewed(context);
    const inspection = this.#requireDocumentInspection(context);
    const binding = this.#toolBindingsByRunId.get(context.runId);
    const pageId =
      binding?.mutationTarget.kind === "page"
        ? binding.mutationTarget.pageId
        : context.scope.pageId;
    if (!pageId || !inspection.pageRootsById.has(pageId)) {
      throw designWorkflowError(
        "allocated_artboard_invalid",
        "Delivery scope artboards require the current inspected Page",
      );
    }
    if (!inspection.newNodeIdPrefix) {
      throw designWorkflowError(
        "allocated_artboard_invalid",
        "Delivery scope artboards require the current Run node ID allocation",
      );
    }
    return createScopeArtboardReservation(scope, pageId, inspection);
  }

  recordDeliveryScopeCompleted(
    context: TrustedToolContext,
    scope: DesignDeliveryScope,
    reservation: DeliveryScopeReservation,
  ): {
    scope: DesignDeliveryScope;
    artboards: DeliveryScopeArtboardReservation[];
  } {
    this.assertDesignToolContext(context);
    this.#assertDeliveryScopeCanBeReviewed(context);
    const accepted = structuredClone(scope);
    const artboards = finalizeScopeReservation(accepted, reservation);
    this.#deliveryScopesByRunId.set(context.runId, accepted);
    this.#deliveryScopeReservationsByRunId.set(
      context.runId,
      new Map(artboards.map((artboard) => [artboard.targetId, artboard])),
    );
    this.#persistScopeReservation(context.runId, artboards);
    return {
      scope: structuredClone(accepted),
      artboards: structuredClone(artboards),
    };
  }

  #assertDeliveryScopeCanBeReviewed(context: TrustedToolContext): void {
    if (this.#deliveryScopesByRunId.has(context.runId)) {
      throw designWorkflowError(
        "delivery_scope_already_reviewed",
        "Delivery scope is already recorded for this Run; start a new user-directed Run to revise it",
      );
    }
    if (this.#designPlansByRunId.has(context.runId)) {
      throw designWorkflowError(
        "delivery_scope_late",
        "Review delivery scope before defining an executable design Plan or writing canvas content",
      );
    }
  }

  grantPageStructureAccess(
    runId: string,
    approvalId: string,
    toolCallId: string,
    actions: readonly string[] = [],
  ): void {
    if (!this.#toolBindingsByRunId.has(runId)) {
      throw new Error(
        "Page structure access requires an active registered Run",
      );
    }
    this.#pageStructureAccessByRunId.set(runId, {
      approvalId,
      toolCallId,
      actions: new Set(actions),
      completedActions: new Set(),
    });
    this.#inspectionsByRunId.delete(runId);
  }

  revokePageStructureAccess(runId: string, approvalId: string): void {
    if (
      this.#pageStructureAccessByRunId.get(runId)?.approvalId === approvalId
    ) {
      this.#pageStructureAccessByRunId.delete(runId);
    }
  }

  hasPageStructureAccess(runId: string): boolean {
    return this.#pageStructureAccessByRunId.has(runId);
  }

  hasPageStructureAuthorization(
    runId: string,
    toolCallId: string,
    actions: readonly string[],
  ): boolean {
    const access = this.#pageStructureAccessByRunId.get(runId);
    return (
      access?.toolCallId === toolCallId &&
      access.actions.size === actions.length &&
      actions.every((action) => access.actions.has(action))
    );
  }

  resolveExecutionContext(context: TrustedToolContext): TrustedToolContext {
    this.assertDesignToolContext(context);
    if (
      context.mutationTarget.kind === "document" ||
      !this.hasPageStructureAccess(context.runId)
    ) {
      return context;
    }
    return {
      ...context,
      scope: {
        kind: "document",
        selectedNodeIds: [...context.scope.selectedNodeIds],
        ...(context.scope.primaryNodeId
          ? { primaryNodeId: context.scope.primaryNodeId }
          : {}),
        ...(context.scope.pageId ? { pageId: context.scope.pageId } : {}),
      },
      mutationTarget: { kind: "document" },
    };
  }

  assertPageToolAccess(
    context: TrustedToolContext,
    input: { action: string; pageId?: string },
  ): void {
    this.assertDesignToolContext(context);
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) throw new Error("Page tool requires an active Run");
    if (
      binding.mutationTarget.kind === "document" ||
      this.hasPageStructureAccess(context.runId)
    ) {
      return;
    }
    if (
      (input.action === "rename" || input.action === "clear") &&
      input.pageId === binding.mutationTarget.pageId
    ) {
      return;
    }
    throw designWorkflowError(
      "page_structure_access_required",
      "Call opendesign_request_page_structure_access and wait for the user's one-time approval before modifying Page structure or another Page",
    );
  }

  recordPageToolCompleted(runId: string, action: string): void {
    this.#pageStructureAccessByRunId.get(runId)?.completedActions.add(action);
  }

  supersedeDesignDeliveryForClearedPage(
    context: TrustedToolContext,
    pageId: string,
  ): boolean {
    this.assertDesignToolContext(context);
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) throw new Error("Page clear requires an active Run");
    if (
      binding.mutationTarget.kind === "page" &&
      binding.mutationTarget.pageId !== pageId
    ) {
      throw new Error("Page clear cannot supersede another Page delivery");
    }
    this.#inspectionsByRunId.delete(context.runId);
    const delivery = this.getDeliveryLedger(context.runId);
    if (
      delivery &&
      !delivery.targets.some((target) => target.pageId === pageId)
    ) {
      return false;
    }
    this.#designPlansByRunId.delete(context.runId);
    this.#deliveryScopesByRunId.delete(context.runId);
    this.#deliveryScopeReservationsByRunId.delete(context.runId);

    const timestamp = this.now().toISOString();
    for (const task of this.workspaceStore.listGlobalTasks()) {
      if (
        (task.runId !== context.runId &&
          task.runId !== binding.continuationParentRunId) ||
        task.conversationId !== context.sessionId ||
        task.targetSet.primaryTarget.documentId !== context.documentId ||
        !task.delivery?.targets.some((target) => target.pageId === pageId)
      ) {
        continue;
      }
      const { delivery: _delivery, ...withoutDelivery } = task;
      void _delivery;
      const updated: GlobalTaskProjection = {
        ...withoutDelivery,
        lifecycle: task.runId === context.runId ? task.lifecycle : "cancelled",
        updatedAt: timestamp,
      };
      this.workspaceStore.saveGlobalTask(updated);
      if (task.runId === context.runId) {
        this.#tasksByRunId.set(context.runId, updated);
      }
    }
    return true;
  }

  assertComponentToolAccess(
    context: TrustedToolContext,
    input: DesignComponentToolInput,
  ): void {
    this.assertDesignToolContext(context);
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) throw new Error("Component tool requires an active Run");
    if (
      binding.mutationTarget.kind === "document" ||
      this.hasPageStructureAccess(context.runId) ||
      input.pageId === binding.mutationTarget.pageId
    ) {
      return;
    }
    throw designWorkflowError(
      "page_structure_access_required",
      "Call opendesign_request_page_structure_access and wait for the user's one-time approval before modifying components on another Page",
    );
  }

  registerDesignPlan(
    context: TrustedToolContext,
    plan: DesignPlanToolInput,
  ): Omit<DesignPlanRegistration, "state"> {
    return this.commitDesignPlan(
      context,
      this.prepareDesignPlan(context, plan),
    );
  }

  prepareDesignPlan(
    context: TrustedToolContext,
    plan: DesignPlanToolInput,
  ): DesignPlanRegistration {
    this.assertDesignToolContext(context);
    const inspection = this.#requireDocumentInspection(context);
    const existingPlan = this.#designPlansByRunId.get(context.runId);
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) throw new Error("Design plan requires an active Run");
    const executablePlan = bindPlanToReviewedScope(
      this.#deliveryScopesByRunId.get(context.runId),
      this.#deliveryScopeReservationsByRunId.get(context.runId),
      existingPlan,
      plan,
    );
    const targets = designPlanTargets(executablePlan);
    const recoverableDelivery = this.getRecoverableDelivery(context);
    assertPlanUsesNewNodeIdNamespace(
      executablePlan,
      inspection,
      recoverableDelivery,
    );
    if (
      binding.mutationTarget.kind === "page" &&
      !this.hasPageStructureAccess(context.runId)
    ) {
      const targetPageId = binding.mutationTarget.pageId;
      if (targets.some((target) => target.pageId !== targetPageId)) {
        throw designWorkflowError(
          "scope_conflict",
          "Design plan targets a Page outside the registered Page mutation target",
        );
      }
    }
    if (
      targets.some((target) => !inspection.pageRootsById.has(target.pageId))
    ) {
      throw designWorkflowError(
        "target_stale",
        "Design plan target Page is missing from the current document inspection",
      );
    }
    assertDeclaredReferencesAuthorizedForRun(
      designPlanReferenceStrategy(executablePlan),
      binding.imageAttachments,
    );
    const registration = registerDesignWorkflowPlan({
      existing: existingPlan,
      inspection,
      plan: executablePlan,
      recoverableDelivery,
    });
    return registration;
  }

  commitDesignPlan(
    context: TrustedToolContext,
    registration: DesignPlanRegistration,
  ): Omit<DesignPlanRegistration, "state"> {
    this.assertDesignToolContext(context);
    this.#designPlansByRunId.set(context.runId, registration.state);
    const executablePlan = registration.state.plan;
    const generatedRoles =
      this.#generatedRasterRolesByRunId.get(context.runId) ??
      new Map<string, RasterAssetRole>();
    for (const [attachmentId, role] of generatedRoles) {
      if (!executablePlan.rasterAssetRoles.includes(role)) {
        generatedRoles.delete(attachmentId);
      }
    }
    this.#generatedRasterRolesByRunId.set(context.runId, generatedRoles);
    this.#persistDelivery(context.runId, registration.state);
    const { state, ...result } = registration;
    void state;
    return result;
  }

  createDesignPlanAllocation(
    runId: string,
    prepared?: DesignPlanRegistration,
  ): DesignPlanAllocation | undefined {
    const state = prepared?.state ?? this.#designPlansByRunId.get(runId);
    if (!state) return undefined;
    const inspection = this.#inspectionsByRunId.get(runId);
    const targets = state.targetOrder.flatMap((targetId) => {
      const target = state.targetsById.get(targetId);
      return target &&
        target.planned.artboard.mode === "create" &&
        target.delivery.status === "pending" &&
        !target.artboardEstablished
        ? [target]
        : [];
    });
    if (targets.length === 0) return undefined;
    const pageRootOffsets = new Map<string, number>();
    return {
      targetIds: targets.map((target) => target.delivery.targetId),
      input: {
        label:
          targets.length === 1
            ? `Allocate ${targets[0]?.delivery.label ?? "design"} artboard`
            : `Allocate ${targets.length} planned artboards`,
        summary:
          "Create stable editable Frame roots before material design work begins",
        commands: targets.map((target) => {
          const { artboard } = target.planned;
          const pageId = target.planned.pageId;
          const index =
            (inspection?.pageRootsById.get(pageId)?.size ?? 0) +
            (pageRootOffsets.get(pageId) ?? 0);
          pageRootOffsets.set(pageId, (pageRootOffsets.get(pageId) ?? 0) + 1);
          return {
            commandId: `allocate_${target.delivery.targetId}`,
            type: "insert_element" as const,
            pageId: target.planned.pageId,
            parentId: null,
            index,
            node: {
              id: artboard.frameId,
              kind: "frame" as const,
              name: target.delivery.label,
              parentId: null,
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, artboard.x, artboard.y] as Transform,
              size: { width: artboard.width, height: artboard.height },
              exportSettings: [],
              opacity: 1,
              properties: {
                fills: [
                  { type: "solid" as const, color: "#ffffff", opacity: 1 },
                ],
                strokes: [],
                strokeWidth: 0,
                cornerRadius: 0,
                clipsContent: true,
              },
              extensions: {
                agentTargetId: target.delivery.targetId,
              },
            },
          };
        }),
      },
    };
  }

  recordDesignPlanAllocated(
    runId: string,
    targetIds: readonly string[],
    revision?: number,
  ): void {
    if (!validRevision(revision)) {
      throw designWorkflowError(
        "allocation_revision_invalid",
        "Artboard allocation did not return a valid document revision",
      );
    }
    const state = this.#designPlansByRunId.get(runId);
    if (!state) throw new Error("Artboard allocation requires an active plan");
    for (const targetId of targetIds) {
      const target = state.targetsById.get(targetId);
      if (!target || target.delivery.status !== "pending") {
        throw designWorkflowError(
          "allocation_state_invalid",
          `Delivery target ${targetId} is not pending allocation`,
        );
      }
      target.artboardEstablished = true;
      target.delivery = {
        ...target.delivery,
        status: "allocated",
        allocatedRevision: revision,
      };
    }
    this.#persistDelivery(runId, state);
  }

  recordDocumentInspection(
    context: TrustedToolContext,
    result: TrustedToolResult,
  ): void {
    this.assertDesignToolContext(context);
    const inspection = parseInspectedHierarchy(context, result);
    this.#inspectionsByRunId.set(context.runId, inspection);
    const state = this.#designPlansByRunId.get(context.runId);
    if (state) reconcileEstablishedArtboardDescendants(state, inspection);
  }

  assertDocumentInspected(context: TrustedToolContext): void {
    this.#requireDocumentInspection(context);
  }

  assertPageLifecycleInspected(context: TrustedToolContext): void {
    this.assertDesignToolContext(context);
    if (!this.#inspectionsByRunId.has(context.runId)) {
      throw designWorkflowError(
        "inspection_required",
        "Inspect the bound design document before modifying Page structure",
      );
    }
  }

  recordCanvasCapture(
    context: TrustedToolContext,
    observedRevision = context.revision,
    layoutQuality?: DesignLayoutQualityReport,
    visualCritic?: DesignVisualCriticResult,
    visualCriticUnavailable?: { message: string },
  ) {
    this.assertDesignToolContext(context);
    if (!Number.isSafeInteger(observedRevision) || observedRevision < 0) {
      throw designWorkflowError(
        "capture_revision_invalid",
        "The rendered capture returned an invalid document revision; capture the current canvas again",
      );
    }
    const state = this.#designPlansByRunId.get(context.runId);
    const target = state ? nextCaptureTarget(state) : undefined;
    if (
      !state ||
      !target ||
      target.delivery.status === "pending" ||
      target.delivery.status === "allocated"
    ) {
      return {
        capturedRevision: observedRevision,
        nextAction: state
          ? "write-material-content"
          : "define-plan-write-capture",
        reviewEligible: false,
      };
    }
    if (
      target.lastMaterialWriteRevision !== null &&
      observedRevision < target.lastMaterialWriteRevision
    ) {
      throw designWorkflowError(
        "capture_revision_invalid",
        "The rendered capture predates the latest material design revision; capture the current canvas again",
      );
    }
    if (!layoutQuality) {
      throw designWorkflowError(
        "layout_quality_unavailable",
        "A delivery Frame capture requires a trusted deterministic layout-quality report; inspect and capture the current target again",
      );
    }
    assertLayoutQualityMatchesCapture(
      context,
      target,
      observedRevision,
      layoutQuality,
    );
    const captureSequence = target.captureCount + 1;
    if (layoutQuality.errorCount > 0) {
      target.captureCount = captureSequence;
      target.lastCaptureRevision = observedRevision;
      this.#persistDelivery(context.runId, state);
      return {
        captureSequence,
        capturedRevision: observedRevision,
        deliveryTargetId: target.delivery.targetId,
        nextAction: "repair-layout-overflow",
        reviewEligible: false,
        repair: {
          toolName: DESIGN_EDIT_TOOL_NAME,
          input: {
            label: "Repair delivery overflow",
            edits: [
              {
                kind: "arrange",
                input: {
                  action: "repair-overflow",
                  label: "Expand safe trailing overflow",
                  pageId: target.planned.pageId,
                  frameId: target.planned.artboard.frameId,
                },
              },
            ],
          },
          errorCount: layoutQuality.errorCount,
        },
      };
    }
    if (
      visualCritic !== undefined &&
      visualCritic.observedRevision !== observedRevision
    ) {
      throw designWorkflowError(
        "visual_critic_unavailable",
        "The independent visual critic does not match the exact captured revision",
      );
    }
    const pendingRasterRoles = pendingPlaceableRasterRoles(
      state,
      target,
      this.#inspectionsByRunId.get(context.runId),
      observedRevision,
    );
    if (pendingRasterRoles.length > 0) {
      target.captureCount = captureSequence;
      target.lastCaptureRevision = observedRevision;
      this.#persistDelivery(context.runId, state);
      return {
        captureSequence,
        capturedRevision: observedRevision,
        deliveryTargetId: target.delivery.targetId,
        nextAction: "place-required-raster-assets",
        pendingRasterRoles,
        reviewEligible: false,
        ...(visualCritic === undefined
          ? {}
          : { critic: publicCriticResult(visualCritic) }),
      };
    }
    if (!implementationPlanCompleted(state, target.delivery.targetId)) {
      target.captureCount = captureSequence;
      target.lastCaptureRevision = observedRevision;
      this.#persistDelivery(context.runId, state);
      const activeStep = state.planExecution.targets
        .find((candidate) => candidate.targetId === target.delivery.targetId)
        ?.steps.find((step) => step.status === "in_progress");
      return {
        captureSequence,
        capturedRevision: observedRevision,
        deliveryTargetId: target.delivery.targetId,
        nextAction: "continue-current-plan-step",
        ...(activeStep
          ? {
              currentPlanStep: {
                stepId: activeStep.stepId,
                label: activeStep.label,
              },
            }
          : {}),
        reviewEligible: false,
      };
    }
    if (
      visualCritic?.passed === true &&
      (target.delivery.status === "drafted" ||
        target.delivery.status === "captured")
    ) {
      const inspection = this.#inspectionsByRunId.get(context.runId);
      if (!inspection || inspection.revision !== observedRevision) {
        throw designWorkflowError(
          "delivery_verification_required",
          "Passed visual delivery still requires authoritative structure from the exact captured revision",
        );
      }
      const componentStrategy = assertDeliveryTargetStructure(
        inspection,
        target,
        state.plan,
      );
      target.captureCount = captureSequence;
      target.lastCaptureRevision = observedRevision;
      target.reviewedCaptureCount = captureSequence;
      target.reviewedCaptureRevision = observedRevision;
      completeReviewPlanStep(state, target.delivery.targetId, observedRevision);
      target.delivery = {
        ...target.delivery,
        status: "verified",
        captureRevision: observedRevision,
        reviewRevision: observedRevision,
        verifiedRevision: observedRevision,
      };
      this.#persistDelivery(context.runId, state);
      return {
        captureSequence,
        capturedRevision: observedRevision,
        deliveryTargetId: target.delivery.targetId,
        nextAction: nextIncompleteTarget(state)
          ? "continue-next-target"
          : this.#nextUnplannedScopeTarget(context.runId, state)
            ? "generate-next-slice"
            : "complete-delivery",
        reviewEligible: false,
        verified: true,
        verification: "independent-visual-critic",
        critic: publicCriticResult(visualCritic),
        ...(componentStrategy.issueCount === 0 ? {} : { componentStrategy }),
      };
    }
    if (
      visualCritic !== undefined &&
      (target.delivery.status === "drafted" ||
        target.delivery.status === "captured")
    ) {
      target.captureCount = captureSequence;
      target.lastCaptureRevision = observedRevision;
      target.lastReview = structuredClone(
        requireFailedCriticReview(visualCritic),
      );
      target.reviewedCaptureCount = captureSequence;
      target.reviewedCaptureRevision = observedRevision;
      target.delivery = {
        ...target.delivery,
        status: "reviewed",
        captureRevision: observedRevision,
        reviewRevision: observedRevision,
      };
      this.#persistDelivery(context.runId, state);
      return {
        captureSequence,
        capturedRevision: observedRevision,
        deliveryTargetId: target.delivery.targetId,
        nextAction: "refine-independent-critic-findings",
        reviewEligible: false,
        critic: publicCriticResult(visualCritic),
      };
    }
    if (
      visualCritic !== undefined &&
      target.delivery.status === "refined" &&
      !visualCritic.passed
    ) {
      target.captureCount = captureSequence;
      target.lastCaptureRevision = observedRevision;
      target.lastReview = structuredClone(
        requireFailedCriticReview(visualCritic),
      );
      target.reviewedCaptureCount = captureSequence;
      target.reviewedCaptureRevision = observedRevision;
      this.#persistDelivery(context.runId, state);
      return {
        captureSequence,
        capturedRevision: observedRevision,
        deliveryTargetId: target.delivery.targetId,
        nextAction: "refine-independent-critic-findings",
        reviewEligible: false,
        critic: publicCriticResult(visualCritic),
      };
    }
    if (
      visualCriticUnavailable !== undefined &&
      (target.delivery.status === "drafted" ||
        target.delivery.status === "captured" ||
        target.delivery.status === "refined")
    ) {
      const inspection = this.#inspectionsByRunId.get(context.runId);
      if (!inspection || inspection.revision !== observedRevision) {
        throw designWorkflowError(
          "delivery_verification_required",
          "Visual review fallback requires authoritative structure from the exact captured revision",
        );
      }
      const componentStrategy = assertDeliveryTargetStructure(
        inspection,
        target,
        state.plan,
      );
      target.captureCount = captureSequence;
      target.lastCaptureRevision = observedRevision;
      target.reviewedCaptureCount = captureSequence;
      target.reviewedCaptureRevision = observedRevision;
      completeReviewPlanStep(state, target.delivery.targetId, observedRevision);
      target.delivery = {
        ...target.delivery,
        status: "verified",
        captureRevision: observedRevision,
        reviewRevision: observedRevision,
        verifiedRevision: observedRevision,
      };
      this.#persistDelivery(context.runId, state);
      return {
        captureSequence,
        capturedRevision: observedRevision,
        deliveryTargetId: target.delivery.targetId,
        nextAction: nextIncompleteTarget(state)
          ? "continue-next-target"
          : this.#nextUnplannedScopeTarget(context.runId, state)
            ? "generate-next-slice"
            : "complete-delivery",
        reviewEligible: false,
        verified: true,
        verification: "deterministic-structure-fallback",
        criticUnavailable: visualCriticUnavailable,
        ...(componentStrategy.issueCount === 0 ? {} : { componentStrategy }),
      };
    }
    let componentStrategy:
      ReturnType<typeof assertDeliveryTargetStructure> | undefined;
    if (target.delivery.status === "refined") {
      if (visualCritic === undefined) {
        throw designWorkflowError(
          "visual_critic_unavailable",
          "Final delivery verification requires an independent visual critic for the exact captured revision",
        );
      }
      const inspection = this.#inspectionsByRunId.get(context.runId);
      if (!inspection || inspection.revision !== observedRevision) {
        throw designWorkflowError(
          "delivery_verification_required",
          "Final delivery verification requires an authoritative document inspection from the exact captured revision; inspect and capture the current target again",
        );
      }
      componentStrategy = assertDeliveryTargetStructure(
        inspection,
        target,
        state.plan,
      );
    }
    target.captureCount = captureSequence;
    target.lastCaptureRevision = observedRevision;
    if (target.delivery.status === "refined") {
      completeReviewPlanStep(state, target.delivery.targetId, observedRevision);
      target.delivery = {
        ...target.delivery,
        status: "verified",
        verifiedRevision: observedRevision,
      };
      this.#persistDelivery(context.runId, state);
      return {
        captureSequence,
        capturedRevision: observedRevision,
        deliveryTargetId: target.delivery.targetId,
        nextAction: nextIncompleteTarget(state)
          ? "continue-next-target"
          : this.#nextUnplannedScopeTarget(context.runId, state)
            ? "generate-next-slice"
            : "complete-delivery",
        reviewEligible: false,
        verified: true,
        ...(componentStrategy === undefined ||
        componentStrategy.issueCount === 0
          ? {}
          : { componentStrategy }),
      };
    }
    if (target.delivery.status === "reviewed") {
      return {
        captureSequence,
        capturedRevision: observedRevision,
        deliveryTargetId: target.delivery.targetId,
        nextAction: "refine-reviewed-target",
        reviewEligible: false,
      };
    }
    return {
      captureSequence,
      capturedRevision: observedRevision,
      deliveryTargetId: target.delivery.targetId,
      nextAction: "retry-independent-review",
      reviewEligible: false,
    };
  }

  resolveCanvasCaptureTarget(
    context: TrustedToolContext,
  ): RendererDesignCaptureTarget {
    this.assertDesignToolContext(context);
    const state = this.#designPlansByRunId.get(context.runId);
    const target = state ? nextCaptureTarget(state) : undefined;
    if (target?.artboardEstablished) {
      return {
        kind: "frame",
        pageId: target.planned.pageId,
        nodeId: target.planned.artboard.frameId,
        ...(target.planned.qualityProfile
          ? { qualityProfile: structuredClone(target.planned.qualityProfile) }
          : {}),
      };
    }
    const binding = this.#toolBindingsByRunId.get(context.runId);
    const pageId =
      target?.planned.pageId ??
      (binding?.mutationTarget.kind === "page"
        ? binding.mutationTarget.pageId
        : binding?.scope.pageId);
    if (!pageId) {
      throw new Error(
        "Canvas capture requires a Page in the registered Run scope",
      );
    }
    return { kind: "page", pageId };
  }

  resolveVisualCriticContext(
    context: TrustedToolContext,
    observedRevision: number,
    attachment: DesignVisualCriticContext["attachment"],
  ): DesignVisualCriticContext | null {
    this.assertDesignToolContext(context);
    const state = this.#designPlansByRunId.get(context.runId);
    const target = state ? nextCaptureTarget(state) : undefined;
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (
      !state ||
      !target ||
      !binding ||
      target.delivery.status === "pending" ||
      target.delivery.status === "allocated" ||
      target.delivery.status === "verified"
    ) {
      return null;
    }
    if (!implementationPlanCompleted(state, target.delivery.targetId)) {
      return null;
    }
    return {
      runId: context.runId,
      modelSelection: structuredClone(binding.modelSelection),
      userRequest: binding.prompt,
      plan: structuredClone(state.plan),
      target: structuredClone(target.planned),
      observedRevision,
      phase: target.delivery.status === "refined" ? "final" : "draft",
      attachment: structuredClone(attachment),
      referenceAttachments: activeVisualReferenceIds(
        state.plan.referenceStrategy,
      ).map((attachmentId) => {
        const reference = binding.imageAttachments.find(
          (candidate) => candidate.attachmentId === attachmentId,
        );
        if (!reference) {
          throw designWorkflowError(
            "reference_unavailable",
            "An active visual reference is no longer authorized for this Run",
          );
        }
        return structuredClone(reference);
      }),
    };
  }

  assertDesignRefinementReady(context: TrustedToolContext): void {
    const state = this.#requireDesignPlan(context);
    const target = nextCaptureTarget(state);
    if (
      !target ||
      (target.delivery.status !== "reviewed" &&
        target.delivery.status !== "refined")
    ) {
      throw designWorkflowError(
        "visual_review_required",
        "Capture the complete material draft and use its trusted independent visual review before starting the refinement checkpoint",
      );
    }
  }

  assertDesignPlanForRaster(
    context: TrustedToolContext,
    role: RasterAssetRole,
  ): DesignPlanToolInput | undefined {
    void role;
    this.assertDesignToolContext(context);
    return this.#designPlansByRunId.get(context.runId)?.plan;
  }

  recordGeneratedRaster(
    context: TrustedToolContext,
    attachmentId: string,
    role: RasterAssetRole,
  ): void {
    this.assertDesignToolContext(context);
    const roles =
      this.#generatedRasterRolesByRunId.get(context.runId) ??
      new Map<string, RasterAssetRole>();
    roles.set(attachmentId, role);
    this.#generatedRasterRolesByRunId.set(context.runId, roles);
  }

  resolveGeneratedRasterAttachmentId(
    context: TrustedToolContext,
    requestedAttachmentId: string,
    role: PlaceableRasterAssetRole,
  ): string {
    this.assertDesignToolContext(context);
    const generated = this.#generatedRasterRolesByRunId.get(context.runId);
    if (generated?.has(requestedAttachmentId)) return requestedAttachmentId;
    const candidates = [...(generated?.entries() ?? [])].flatMap(
      ([attachmentId, candidateRole]) =>
        candidateRole === role ? [attachmentId] : [],
    );
    if (candidates.length === 1) return candidates[0] ?? requestedAttachmentId;
    if (candidates.length > 1) {
      throw designWorkflowError(
        "image_attachment_ambiguous",
        `Attachment ${requestedAttachmentId} is not authorized, and ${candidates.length} generated ${role} images are available in this Run; use the exact attachmentId returned by the intended generation result`,
      );
    }
    return requestedAttachmentId;
  }

  assertImagePlacement(
    context: TrustedToolContext,
    parentId: string | null,
    nodeId?: string,
  ): void {
    this.assertDesignToolContext(context);
    const inspection = this.#inspectionsByRunId.get(context.runId);
    if (parentId !== null && !inspection?.nodesById.has(parentId)) {
      throw designWorkflowError(
        "target_stale",
        `Image parent ${parentId} is not present in the current document inspection`,
        { nodeId: parentId },
      );
    }
    const state = this.#designPlansByRunId.get(context.runId);
    if (!state) {
      assertNewNodeIdUsesInspectionNamespace(inspection, nodeId);
      return;
    }
    const target = findTargetForParent(state, parentId);
    if (!target && parentId !== null) {
      const plannedRegionTarget = [...state.targetsById.values()].find(
        (candidate) =>
          candidate.planned.composition.regions.some(
            (region) => region.nodeId === parentId,
          ) && !candidate.artboardDescendantIds.has(parentId),
      );
      if (plannedRegionTarget?.artboardEstablished) {
        throw designWorkflowError(
          "planned_parent_not_materialized",
          `Planned region ${parentId} is a logical region and is not a real container in the current document; place the image inside an inspected descendant of artboard ${plannedRegionTarget.planned.artboard.frameId}, or first insert a current-namespace Frame under that artboard`,
        );
      }
    }
    assertNewNodeIdUsesInspectionNamespace(
      inspection,
      nodeId,
      new Set(target?.delivery.reservedNodeIds ?? []),
    );
  }

  authorizeIndependentDesignEdit(
    context: TrustedToolContext,
    input: DesignApplyToolInput,
  ): DesignPlanApplyAuthorization | undefined {
    this.assertDesignToolContext(context);
    const state = this.#designPlansByRunId.get(context.runId);
    if (!state) return this.assertDesignPlanForApply(context, input);
    const inspection = this.#inspectionsByRunId.get(context.runId);
    const scoped = this.#bindApplyToRegisteredPage(context, input);
    if (
      !inspection ||
      inspection.revision !== context.revision ||
      !isIndependentNodeEdit(scoped.commands, state, inspection)
    ) {
      return this.assertDesignPlanForApply(context, input);
    }
    const bound = bindDesignOperationStructure(scoped, inspection);
    assertApplyUsesNewNodeIdNamespace(bound, inspection);
    return {
      input: {
        label: bound.label,
        ...(bound.summary === undefined ? {} : { summary: bound.summary }),
        commands: bound.commands,
      },
      plan: state.plan,
      targetIds: [],
    };
  }

  assertDesignPlanForApply(
    context: TrustedToolContext,
    input: DesignApplyToolInput,
    prepared?: DesignPlanRegistration,
  ): DesignPlanApplyAuthorization | undefined {
    const state =
      prepared?.state ?? this.#designPlansByRunId.get(context.runId);
    const scopedInput = this.#bindApplyToRegisteredPage(context, input);
    if (!state) {
      const boundInput = bindDesignOperationStructure(
        scopedInput,
        this.#inspectionsByRunId.get(context.runId),
      );
      assertApplyUsesNewNodeIdNamespace(
        boundInput,
        this.#inspectionsByRunId.get(context.runId),
      );
      return undefined;
    }
    const resolvedInput = bindDesignOperationStructure(
      resolvePlannedStructureGeometry(
        scopedInput,
        state,
        this.#deliveryScopeReservationsByRunId.get(context.runId),
      ),
      this.#inspectionsByRunId.get(context.runId),
    );
    const targetIds = [...assertPlannedTargetWrites(resolvedInput, state)];
    const boundInput = bindApplyToActivePlanSteps(
      state,
      targetIds,
      resolvedInput,
    );
    if (designApplyRequiresPlan(boundInput) && targetIds.length === 0) {
      throw designWorkflowError(
        "material_write_required",
        "Material design commands must target a declared delivery artboard",
      );
    }
    assertApplyUsesNewNodeIdNamespace(
      boundInput,
      this.#inspectionsByRunId.get(context.runId),
      reservedNodeIdsForTargets(state, targetIds),
    );
    if (
      hasActivePlanStepForTargets(state, targetIds) &&
      (designApplyRequiresPlan(boundInput) || boundInput.steps !== undefined)
    ) {
      assertApplyPlanSteps(state, targetIds, boundInput.steps);
    }
    const rebaseTargets = targetIds.flatMap((targetId) => {
      const target = state.targetsById.get(targetId);
      if (!target?.artboardEstablished) return [];
      return [
        {
          frameId: target.planned.artboard.frameId,
          pageId: target.planned.pageId,
          width: target.planned.artboard.width,
          height: target.planned.artboard.height,
        },
      ];
    });
    return {
      input: boundInput,
      plan: state.plan,
      ...(rebaseTargets.length === targetIds.length && rebaseTargets.length > 0
        ? {
            rebaseGuard: {
              fromRevision: context.revision,
              targets: rebaseTargets,
            },
          }
        : {}),
      targetIds,
    };
  }

  #bindApplyToRegisteredPage(
    context: TrustedToolContext,
    input: DesignApplyToolInput,
  ): DesignApplyToolInput {
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (
      binding?.mutationTarget.kind !== "page" ||
      this.hasPageStructureAccess(context.runId)
    ) {
      return input;
    }
    const pageId = binding.mutationTarget.pageId;
    let changed = false;
    const commands = input.commands.map((command) => {
      if (
        (command.type === "insert_element" ||
          command.type === "move_element") &&
        command.pageId !== pageId
      ) {
        changed = true;
        return { ...command, pageId };
      }
      return command;
    });
    return changed ? { ...input, commands } : input;
  }

  assertDesignPlanForAllocatedApply(
    context: TrustedToolContext,
    input: DesignApplyToolInput,
    allocationTargetIds: readonly string[],
    prepared?: DesignPlanRegistration,
  ): DesignPlanApplyAuthorization {
    const state = prepared?.state ?? this.#requireDesignPlan(context);
    const assumedAllocatedTargetIds = new Set(allocationTargetIds);
    if (assumedAllocatedTargetIds.size !== allocationTargetIds.length) {
      throw designWorkflowError(
        "allocation_state_invalid",
        "Compact allocation target IDs must be unique",
      );
    }
    for (const targetId of assumedAllocatedTargetIds) {
      const target = state.targetsById.get(targetId);
      if (
        !target ||
        target.delivery.status !== "pending" ||
        target.artboardEstablished ||
        target.planned.artboard.mode !== "create"
      ) {
        throw designWorkflowError(
          "allocation_state_invalid",
          `Delivery target ${targetId} is not pending creation`,
        );
      }
    }
    const resolvedInput = bindDesignOperationStructure(
      resolvePlannedStructureGeometry(
        input,
        state,
        this.#deliveryScopeReservationsByRunId.get(context.runId),
      ),
      this.#inspectionsByRunId.get(context.runId),
    );
    const targetIds = [
      ...assertPlannedTargetWrites(
        resolvedInput,
        state,
        assumedAllocatedTargetIds,
      ),
    ];
    const boundInput = bindApplyToActivePlanSteps(
      state,
      targetIds,
      resolvedInput,
    );
    if (targetIds.length === 0) {
      throw designWorkflowError(
        "material_write_required",
        "Compact first-slice input must create real editable content inside the first allocated target",
      );
    }
    assertFocusedUiTargetWrites(state, targetIds);
    assertApplyUsesNewNodeIdNamespace(
      boundInput,
      this.#inspectionsByRunId.get(context.runId),
      reservedNodeIdsForTargets(state, targetIds),
    );
    assertApplyPlanSteps(state, targetIds, boundInput.steps);
    return {
      input: boundInput,
      plan: state.plan,
      targetIds,
    };
  }

  assertDesignApplyResult(
    context: TrustedToolContext,
    authorization: DesignPlanApplyAuthorization | undefined,
    result: TrustedToolResult,
  ): void {
    this.assertDesignToolContext(context);
    const revision = result.designRevision;
    if (
      !revision ||
      (revision.previousRevision === context.revision &&
        revision.rebasedFromRevision === undefined)
    ) {
      return;
    }
    if (
      !authorization?.rebaseGuard ||
      authorization.input.commands.some(
        (command) => command.type !== "insert_element",
      ) ||
      revision.rebasedFromRevision !== context.revision ||
      revision.previousRevision <= context.revision
    ) {
      throw new Error(
        "Renderer returned an unauthorized planned design revision rebase",
      );
    }
  }

  recordDesignEditCompleted(
    context: TrustedToolContext,
    authorization: DesignPlanApplyAuthorization | undefined,
    result: TrustedToolResult,
  ): void {
    this.assertDesignToolContext(context);
    const state = this.#designPlansByRunId.get(context.runId);
    if (!state) return;
    const changes = committedEditChanges(context, result);
    if (!changes) return;
    const inspection = this.#inspectionsByRunId.get(context.runId);
    const exactInspection =
      inspection?.revision === changes.fromRevision ||
      inspection?.revision === changes.toRevision
        ? inspection
        : undefined;
    const impact = computeCommittedDesignEditImpact(
      changes,
      exactInspection,
      state.targetsById,
    );
    const progressTargets =
      authorization?.targetIds.filter(
        (id) => impact.get(id)?.materialChanged === true,
      ) ?? [];
    if (authorization && progressTargets.length > 0) {
      this.recordDesignApplyCompleted(
        context.runId,
        { ...authorization, targetIds: progressTargets },
        changes.toRevision,
        result.content,
      );
    }
    const affected = [...impact]
      .filter(([, value]) => value.affected)
      .map(([id]) => id);
    for (const [id, value] of impact) {
      const target = state.targetsById.get(id);
      if (!target) continue;
      if (exactInspection) {
        target.artboardDescendantIds = new Set(value.afterDescendantIds);
      } else {
        // Partial ancestry is not a complete replacement for validated members.
        value.removedNodeIds.forEach((nodeId) =>
          target.artboardDescendantIds.delete(nodeId),
        );
        value.addedNodeIds.forEach((nodeId) =>
          target.artboardDescendantIds.add(nodeId),
        );
      }
    }
    this.#recordTargetWrites(
      context.runId,
      state,
      affected,
      changes.toRevision,
    );
    const nextInspection = advanceDesignEditInspection(inspection, changes);
    if (nextInspection)
      this.#inspectionsByRunId.set(context.runId, nextInspection);
  }

  recordDesignApplyCompleted(
    runId: string,
    authorization: DesignPlanApplyAuthorization | undefined,
    revision?: number,
    resultContent?: unknown,
    addedNodeIds: readonly string[] = [],
  ): void {
    const state = this.#designPlansByRunId.get(runId);
    if (!state || !authorization || authorization.targetIds.length === 0)
      return;
    const input = authorization.input;
    for (const targetId of authorization.targetIds) {
      const target = state.targetsById.get(targetId);
      if (!target) continue;
      addedNodeIds.forEach((nodeId) =>
        target.artboardDescendantIds.add(nodeId),
      );
      const inspection = this.#inspectionsByRunId.get(runId);
      if (
        input.commands.some(
          (command) =>
            command.type === "insert_element" &&
            command.node.id === target.planned.artboard.frameId &&
            command.node.kind === "frame",
        )
      ) {
        target.artboardEstablished = true;
      }
      input.commands.forEach((command) => {
        if (
          command.type === "insert_element" &&
          command.node.id !== target.planned.artboard.frameId &&
          commandBelongsToTarget(command, target, input)
        ) {
          target.artboardDescendantIds.add(command.node.id);
        }
        if (
          command.type === "replace_subtree" &&
          commandBelongsToTarget(command, target, input)
        ) {
          for (const nodeId of inspectedSubtreeIds(
            inspection,
            command.rootNodeId,
          )) {
            if (nodeId !== command.rootNodeId) {
              target.artboardDescendantIds.delete(nodeId);
            }
          }
          for (const node of command.nodes) {
            if (node.id !== target.planned.artboard.frameId) {
              target.artboardDescendantIds.add(node.id);
            }
          }
        }
        if (
          command.type === "delete_element" &&
          commandBelongsToTarget(command, target, input)
        ) {
          for (const nodeId of inspectedSubtreeIds(
            inspection,
            command.nodeId,
          )) {
            target.artboardDescendantIds.delete(nodeId);
          }
        }
      });
    }
    this.#recordTargetWrites(runId, state, authorization.targetIds, revision);
    this.#recordCommittedPlanSteps(
      runId,
      state,
      authorization.targetIds,
      input.steps,
      revision,
      resultContent,
    );
  }

  recordMaterialDesignWriteCompleted(
    runId: string,
    targetIds: readonly string[],
    revision?: number,
    addedNodeIds: readonly string[] = [],
  ): void {
    const state = this.#designPlansByRunId.get(runId);
    if (!state || targetIds.length === 0) return;
    for (const targetId of targetIds) {
      const target = state.targetsById.get(targetId);
      if (!target) continue;
      addedNodeIds.forEach((nodeId) =>
        target.artboardDescendantIds.add(nodeId),
      );
    }
    this.#recordTargetWrites(runId, state, targetIds, revision);
  }

  resolveMaterialTargetIdsIfPlanned(
    context: TrustedToolContext,
    nodeIds: readonly string[],
    parentId?: string | null,
  ): string[] {
    this.assertDesignToolContext(context);
    const state = this.#designPlansByRunId.get(context.runId);
    if (!state) return [];
    const targets = new Set<string>();
    for (const nodeId of nodeIds) {
      const target = findTargetForNode(state, nodeId);
      if (target) targets.add(target.delivery.targetId);
    }
    if (parentId !== undefined) {
      const target = findTargetForParent(state, parentId);
      if (target) targets.add(target.delivery.targetId);
    }
    return [...targets];
  }

  getDeliveryLedger(runId: string): DesignDeliveryLedger | undefined {
    const state = this.#designPlansByRunId.get(runId);
    if (state) return deliveryLedger(state);
    const reservation = this.#deliveryScopeReservationsByRunId.get(runId);
    if (reservation) return scopeReservationLedger([...reservation.values()]);
    const delivery = this.#tasksByRunId.get(runId)?.delivery;
    return delivery ? structuredClone(delivery) : undefined;
  }

  getDeliveryStageContext(runId: string): DesignDeliveryStage | undefined {
    return projectDesignDeliveryStage(
      this.#designPlansByRunId.get(runId),
      this.#deliveryScopesByRunId.get(runId),
      this.#deliveryScopeReservationsByRunId.get(runId),
    );
  }

  getRecoverableDelivery(
    context: TrustedToolContext,
  ): DesignDeliveryLedger | undefined {
    this.assertDesignToolContext(context);
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding?.continuationParentRunId) return undefined;
    const current = this.getDeliveryLedger(context.runId);
    if (current) return current;
    const candidate = this.workspaceStore
      .listGlobalTasks()
      .filter(
        (task) =>
          task.runId === binding.continuationParentRunId &&
          task.conversationId === context.sessionId &&
          task.targetSet.primaryTarget.documentId === context.documentId &&
          task.delivery?.activeTargetId !== null &&
          task.delivery !== undefined &&
          task.lifecycle !== "completed" &&
          task.lifecycle !== "cancelled",
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return candidate?.delivery
      ? structuredClone(candidate.delivery)
      : undefined;
  }

  #recordTargetWrites(
    runId: string,
    state: DesignWorkflowState,
    targetIds: readonly string[],
    revision?: number,
  ): void {
    if (!validRevision(revision)) return;
    for (const targetId of targetIds) {
      const target = state.targetsById.get(targetId);
      if (!target) continue;
      target.lastMaterialWriteRevision = revision;
      if (
        target.delivery.status === "reviewed" ||
        target.delivery.status === "refined"
      ) {
        target.delivery = {
          ...target.delivery,
          status: "refined",
          refinementRevision: revision,
        };
        continue;
      }
      target.captureCount = 0;
      target.lastCaptureRevision = null;
      target.lastReview = null;
      target.reviewedCaptureCount = 0;
      target.reviewedCaptureRevision = null;
      target.delivery = {
        targetId: target.delivery.targetId,
        label: target.delivery.label,
        pageId: target.delivery.pageId,
        rootNodeId: target.delivery.rootNodeId,
        reservedNodeIds: [...target.delivery.reservedNodeIds],
        status: "drafted",
        allocatedRevision: target.delivery.allocatedRevision ?? revision,
        draftRevision: revision,
      };
    }
    this.#persistDelivery(runId, state);
  }

  #recordCommittedPlanSteps(
    runId: string,
    state: DesignWorkflowState,
    targetIds: readonly string[],
    steps: DesignApplyToolInput["steps"],
    revision?: number,
    resultContent?: unknown,
  ): void {
    const completions = resolveCommittedPlanStepEvidence(
      state,
      targetIds,
      steps,
      revision,
      resultContent,
    );
    if (!completions) return;
    for (const completed of completions) {
      const owner = state.planExecution.targets.find((target) =>
        target.steps.some((step) => step.status === "in_progress"),
      );
      const step = owner?.steps.find(
        (candidate) => candidate.status === "in_progress",
      );
      if (!owner || !step || step.stepId !== completed.stepId) return;
      if (step.kind === "review-refine") continue;
      step.status = "completed";
      step.completedRevision = completed.revision;
      activateNextPlanStep(state, completed.revision);
    }
    this.#persistDelivery(runId, state);
  }

  #persistDelivery(runId: string, state: DesignWorkflowState): void {
    const task = this.#tasksByRunId.get(runId);
    if (!task) return;
    const updated: GlobalTaskProjection = {
      ...task,
      delivery: deliveryLedger(state),
      updatedAt: this.now().toISOString(),
    };
    this.#tasksByRunId.set(runId, updated);
    this.workspaceStore.saveGlobalTask(updated);
  }

  #persistScopeReservation(
    runId: string,
    artboards: readonly DeliveryScopeArtboardReservation[],
  ): void {
    const task = this.#tasksByRunId.get(runId);
    if (!task) return;
    const updated: GlobalTaskProjection = {
      ...task,
      delivery: scopeReservationLedger(artboards),
      updatedAt: this.now().toISOString(),
    };
    this.#tasksByRunId.set(runId, updated);
    this.workspaceStore.saveGlobalTask(updated);
  }

  handleAgentEvent(event: AgentEvent): void {
    if (event.type === "agent.error" && event.runId === undefined) {
      this.#interruptActiveTasks();
      return;
    }
    const runId = "runId" in event ? event.runId : undefined;
    if (!runId) return;
    if (
      event.type === "run.continuation" &&
      event.status === "scheduled" &&
      event.nextRunId
    ) {
      const persistedParent = this.workspaceStore
        .listGlobalTasks()
        .find((candidate) => candidate.runId === runId);
      const parentDelivery =
        this.#tasksByRunId.get(runId)?.delivery ?? persistedParent?.delivery;
      this.#continuationTransfersByRunId.set(event.nextRunId, {
        parentRunId: runId,
        ...(this.#designPlansByRunId.get(runId)
          ? { plan: structuredClone(this.#designPlansByRunId.get(runId)!) }
          : {}),
        ...(this.#deliveryScopesByRunId.get(runId)
          ? {
              deliveryScope: structuredClone(
                this.#deliveryScopesByRunId.get(runId)!,
              ),
            }
          : {}),
        ...(parentDelivery
          ? { delivery: structuredClone(parentDelivery) }
          : {}),
        ...(this.#deliveryScopeReservationsByRunId.get(runId)
          ? {
              scopeReservations: structuredClone(
                this.#deliveryScopeReservationsByRunId.get(runId)!,
              ),
            }
          : {}),
        ...(this.#generatedRasterRolesByRunId.get(runId)
          ? {
              rasterRoles: structuredClone(
                this.#generatedRasterRolesByRunId.get(runId)!,
              ),
            }
          : {}),
      });
    }
    if (event.type === "tool.completed" && event.revision !== undefined) {
      const binding = this.#toolBindingsByRunId.get(runId);
      if (binding && event.revision > binding.revision) {
        this.#toolBindingsByRunId.set(runId, {
          ...binding,
          revision: event.revision,
        });
      }
    }
    const task =
      this.#tasksByRunId.get(runId) ??
      (event.type === "run.continuation"
        ? this.workspaceStore
            .listGlobalTasks()
            .find((candidate) => candidate.runId === runId)
        : undefined);
    if (!task) {
      if (
        event.type === "run.completed" ||
        (event.type === "run.continuation" &&
          event.status === "needs_attention" &&
          event.nextRunId)
      ) {
        const abandonedRunId =
          event.type === "run.continuation" && event.nextRunId
            ? event.nextRunId
            : runId;
        this.disposeRun(abandonedRunId);
      }
      return;
    }
    const activityAt = conversationActivityAt(event, this.now);
    if (activityAt) this.#touchConversation(task.conversationId, activityAt);
    const projectedLifecycle = projectGlobalTaskLifecycle(
      { ...event, runId },
      task.lifecycle,
    );
    const lifecycle =
      projectedLifecycle === "completed" &&
      !designDeliveryCanComplete(task.delivery)
        ? "needs_attention"
        : projectedLifecycle;
    if (lifecycle === task.lifecycle) {
      if (event.type === "run.completed") {
        this.disposeRun(runId);
      }
      return;
    }
    const updated: GlobalTaskProjection = {
      ...task,
      lifecycle,
      updatedAt: this.now().toISOString(),
    };
    this.workspaceStore.saveGlobalTask(updated);
    if (activeLifecycles.has(lifecycle)) {
      this.#tasksByRunId.set(runId, updated);
    } else {
      this.#tasksByRunId.delete(runId);
    }
    if (!activeLifecycles.has(lifecycle)) {
      this.disposeRun(runId);
    }
  }

  disposeRun(runId: string): void {
    this.#tasksByRunId.delete(runId);
    this.#toolBindingsByRunId.delete(runId);
    this.#designPlansByRunId.delete(runId);
    this.#generatedRasterRolesByRunId.delete(runId);
    this.#inspectionsByRunId.delete(runId);
    this.#pageStructureAccessByRunId.delete(runId);
    this.#deliveryScopesByRunId.delete(runId);
    this.#deliveryScopeReservationsByRunId.delete(runId);
    this.#continuationTransfersByRunId.delete(runId);
  }

  #interruptActiveTasks(): void {
    const timestamp = this.now().toISOString();
    for (const [runId, task] of this.#tasksByRunId) {
      this.workspaceStore.saveGlobalTask({
        ...task,
        lifecycle: "interrupted",
        updatedAt: timestamp,
      });
      this.disposeRun(runId);
      this.#touchConversation(task.conversationId, timestamp);
    }
    this.#continuationTransfersByRunId.clear();
  }

  #touchConversation(conversationId: string, updatedAt: string): void {
    const conversation = this.workspaceStore.getConversation(conversationId);
    if (!conversation || conversation.updatedAt >= updatedAt) return;
    this.workspaceStore.saveConversation({ ...conversation, updatedAt });
  }

  #requireDesignPlan(context: TrustedToolContext) {
    this.assertDesignToolContext(context);
    const state = this.#designPlansByRunId.get(context.runId);
    if (!state) {
      throw new Error(
        "Create and record a structured design plan before generating imagery or creating design layers",
      );
    }
    return state;
  }

  #nextUnplannedScopeTarget(
    runId: string,
    state: DesignWorkflowState,
  ): DesignDeliveryScope["targets"][number] | undefined {
    return this.#deliveryScopesByRunId
      .get(runId)
      ?.targets.find((target) => !state.targetsById.has(target.targetId));
  }

  #requireDocumentInspection(context: TrustedToolContext): InspectedHierarchy {
    this.assertDesignToolContext(context);
    const inspection = this.#inspectionsByRunId.get(context.runId);
    if (!inspection) {
      throw designWorkflowError(
        "inspection_required",
        "Inspect the bound design document before using stable design targets",
      );
    }
    if (inspection.revision !== context.revision) {
      throw designWorkflowError(
        "inspection_stale",
        `Inspect the current document revision before continuing; inspected ${inspection.revision}, current ${context.revision}`,
      );
    }
    return inspection;
  }
}

function assertPlanUsesNewNodeIdNamespace(
  plan: DesignPlanToolInput,
  inspection: InspectedHierarchy,
  recoverableDelivery: DesignDeliveryLedger | undefined,
): void {
  const prefix = inspection.newNodeIdPrefix;
  if (!prefix) return;
  const targets = designPlanTargets(plan);
  for (const target of targets) {
    const recovered = recoverableDelivery?.targets.find(
      (candidate) =>
        candidate.targetId === target.targetId &&
        candidate.pageId === target.pageId &&
        candidate.rootNodeId === target.artboard.frameId,
    );
    const reserved = new Set(recovered?.reservedNodeIds ?? []);
    for (const nodeId of plannedNodeIdsForTarget(plan, target.targetId)) {
      if (inspection.nodesById.has(nodeId) || reserved.has(nodeId)) continue;
      assertNewNodeIdHasPrefix(nodeId, prefix);
    }
  }
  const strategy = designPlanComponentStrategy(plan);
  if (!strategy) return;
  for (const candidate of strategy.candidates) {
    if (
      candidate.decision === "component" &&
      !inspection.componentsById.has(candidate.componentId)
    ) {
      assertNewNodeIdHasPrefix(candidate.componentId, prefix);
    }
  }
}

function assertApplyUsesNewNodeIdNamespace(
  input: DesignApplyToolInput,
  inspection: InspectedHierarchy | undefined,
  reservedNodeIds: ReadonlySet<string> = new Set(),
): void {
  const prefix = inspection?.newNodeIdPrefix;
  if (!prefix) return;
  for (const command of input.commands) {
    if (command.type === "insert_element") {
      assertNewNodeIdHasPrefixOrReservation(
        command.node.id,
        prefix,
        reservedNodeIds,
      );
      continue;
    }
    if (command.type !== "replace_subtree") continue;
    for (const node of command.nodes) {
      if (!inspection.nodesById.has(node.id)) {
        assertNewNodeIdHasPrefixOrReservation(node.id, prefix, reservedNodeIds);
      }
    }
  }
}

function assertNewNodeIdUsesInspectionNamespace(
  inspection: InspectedHierarchy | undefined,
  nodeId: string | undefined,
  reservedNodeIds: ReadonlySet<string> = new Set(),
): void {
  if (inspection?.newNodeIdPrefix && nodeId !== undefined) {
    assertNewNodeIdHasPrefixOrReservation(
      nodeId,
      inspection.newNodeIdPrefix,
      reservedNodeIds,
    );
  }
}

function assertNewNodeIdHasPrefixOrReservation(
  nodeId: string,
  prefix: string,
  reservedNodeIds: ReadonlySet<string>,
): void {
  if (reservedNodeIds.has(nodeId)) return;
  assertNewNodeIdHasPrefix(nodeId, prefix);
}

function reservedNodeIdsForTargets(
  state: DesignWorkflowState,
  targetIds: readonly string[],
): Set<string> {
  return new Set(
    targetIds.flatMap(
      (targetId) =>
        state.targetsById.get(targetId)?.delivery.reservedNodeIds ?? [],
    ),
  );
}

function assertNewNodeIdHasPrefix(nodeId: string, prefix: string): void {
  if (nodeId.startsWith(prefix)) return;
  throw designWorkflowError(
    "new_node_id_namespace_required",
    `New node ID ${nodeId} must start with ${prefix} from the latest trusted inspection so it cannot collide with hidden nodes on another Page`,
  );
}

/**
 * The accepted plan owns create-target structure. Main materializes a planned
 * region's parent-first Frame closure when real content first references it,
 * and canonicalizes any legacy Group/Frame scaffold request to the same
 * trusted geometry. Models never own region kind, parent, transform, or size.
 * Real content geometry remains model-authored.
 */
function resolvePlannedStructureGeometry(
  input: DesignApplyToolInput,
  state: DesignWorkflowState,
  scopeReservations?: ReadonlyMap<string, DeliveryScopeArtboardReservation>,
): DesignApplyToolInput {
  const plannedNodes = new Map<
    string,
    | { kind: "artboard"; target: DesignDeliveryTargetState }
    | {
        kind: "region";
        region: DesignPlanTarget["composition"]["regions"][number];
        target: DesignDeliveryTargetState;
      }
  >();
  const materializableRegions = new Map<
    string,
    {
      region: DesignPlanTarget["composition"]["regions"][number];
      target: DesignDeliveryTargetState;
    }
  >();
  for (const target of state.targetsById.values()) {
    registerPlannedNode(plannedNodes, target.planned.artboard.frameId, {
      kind: "artboard",
      target,
    });
    for (const region of target.planned.composition.regions) {
      registerPlannedNode(materializableRegions, region.nodeId, {
        region,
        target,
      });
      if (
        target.planned.artboard.mode !== "create" &&
        !scopeReservations?.has(target.delivery.targetId)
      ) {
        continue;
      }
      registerPlannedNode(plannedNodes, region.nodeId, {
        kind: "region",
        region,
        target,
      });
    }
  }

  let changed = false;
  const availableNodeIds = new Set<string>();
  for (const target of state.targetsById.values()) {
    if (target.artboardEstablished) {
      availableNodeIds.add(target.planned.artboard.frameId);
    }
    for (const nodeId of target.artboardDescendantIds) {
      availableNodeIds.add(nodeId);
    }
  }
  const nextRegionIndexByParent = new Map<string, number>();
  for (const planned of plannedNodes.values()) {
    if (
      planned.kind !== "region" ||
      !availableNodeIds.has(planned.region.nodeId)
    ) {
      continue;
    }
    const parentId =
      planned.region.parentId ?? planned.target.planned.artboard.frameId;
    nextRegionIndexByParent.set(
      parentId,
      (nextRegionIndexByParent.get(parentId) ?? 0) + 1,
    );
  }
  const usedCommandIds = new Set(
    input.commands.map((command) => command.commandId),
  );
  const authoredRegionsById = new Map(
    input.commands.flatMap((command) => {
      if (command.type !== "insert_element") return [];
      const planned = plannedNodes.get(command.node.id);
      return planned?.kind === "region" &&
        (command.node.kind === "group" || command.node.kind === "frame")
        ? [[command.node.id, command.node] as const]
        : [];
    }),
  );
  const injectedBefore = new Map<string, DesignOperation[]>();
  const hostOwnedRegionCommandIds = new Set<string>();
  const ensureRegion = (regionId: string, output: DesignOperation[]): void => {
    if (availableNodeIds.has(regionId)) return;
    const planned = materializableRegions.get(regionId);
    if (!planned) return;
    const parentId =
      planned.region.parentId ?? planned.target.planned.artboard.frameId;
    ensureRegion(parentId, output);
    const commandId = uniqueGeneratedCommandId(
      `materialize_region_${regionId}`,
      usedCommandIds,
    );
    usedCommandIds.add(commandId);
    const index = nextRegionIndexByParent.get(parentId) ?? 0;
    nextRegionIndexByParent.set(parentId, index + 1);
    output.push({
      commandId,
      type: "insert_element",
      pageId: planned.target.planned.pageId,
      parentId,
      index,
      node: plannedRegionFrame(
        planned.region,
        parentId,
        authoredRegionsById.get(regionId),
      ),
    });
    availableNodeIds.add(regionId);
    changed = true;
  };
  for (const command of input.commands) {
    if (command.type !== "insert_element") continue;
    const planned = plannedNodes.get(command.node.id);
    if (planned?.kind === "region") {
      if (command.node.kind !== "group" && command.node.kind !== "frame") {
        throw designWorkflowError(
          "planned_region_id_reserved",
          `Planned region ${command.node.id} is a host-owned Frame identity and cannot be inserted as ${command.node.kind}; parent real content to that region ID instead`,
        );
      }
      hostOwnedRegionCommandIds.add(command.commandId);
    }
    const injected: DesignOperation[] = [];
    ensureRegion(
      planned?.kind === "region" ? command.node.id : (command.parentId ?? ""),
      injected,
    );
    if (injected.length > 0) injectedBefore.set(command.commandId, injected);
  }
  const commandsWithHostRegions = input.commands.flatMap((command) => [
    ...(injectedBefore.get(command.commandId) ?? []),
    command,
  ]);
  const stepsWithHostRegions = input.steps?.map((step) => ({
    ...step,
    commandIds: step.commandIds.flatMap((commandId) => [
      ...(injectedBefore.get(commandId)?.map((command) => command.commandId) ??
        []),
      commandId,
    ]),
  }));
  const commands = commandsWithHostRegions.flatMap((command) => {
    if (command.type !== "insert_element") return command;
    const planned = plannedNodes.get(command.node.id);
    if (!planned) return command;
    if (planned.kind === "artboard") {
      if (command.node.kind !== "frame") return command;
      if (planned.target.artboardEstablished) {
        changed = true;
        return [];
      }
      const { artboard } = planned.target.planned;
      changed = true;
      return [
        {
          ...command,
          pageId: planned.target.planned.pageId,
          parentId: null,
          node: {
            ...command.node,
            parentId: null,
            transform: [1, 0, 0, 1, artboard.x, artboard.y] as Transform,
            size: { width: artboard.width, height: artboard.height },
          },
        },
      ];
    }
    if (
      planned.kind === "region" &&
      hostOwnedRegionCommandIds.has(command.commandId)
    ) {
      changed = true;
      return [];
    }
    if (command.node.kind !== "group" && command.node.kind !== "frame") {
      return command;
    }
    changed = true;
    return [
      {
        ...command,
        pageId: planned.target.planned.pageId,
        parentId:
          planned.region.parentId ?? planned.target.planned.artboard.frameId,
        node: {
          ...command.node,
          parentId:
            planned.region.parentId ?? planned.target.planned.artboard.frameId,
          transform: [
            1,
            0,
            0,
            1,
            planned.region.x,
            planned.region.y,
          ] as Transform,
          size: {
            width: planned.region.width,
            height: planned.region.height,
          },
        },
      },
    ];
  });
  if (commands.length === 0) {
    throw designWorkflowError(
      "material_write_required",
      "The planned artboard Frame is already allocated; add real editable content inside it instead of recreating the Frame",
    );
  }
  if (!changed) return input;
  const retainedCommandIds = new Set(
    commands.map((command) => command.commandId),
  );
  const steps = stepsWithHostRegions
    ?.map((step) => ({
      ...step,
      commandIds: step.commandIds.filter((commandId) =>
        retainedCommandIds.has(commandId),
      ),
    }))
    .filter((step) => step.commandIds.length > 0);
  return {
    ...input,
    commands,
    ...(steps === undefined ? {} : { steps }),
  };
}

function uniqueGeneratedCommandId(
  base: string,
  used: ReadonlySet<string>,
): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function plannedRegionFrame(
  region: DesignPlanTarget["composition"]["regions"][number],
  parentId: string,
  authored?: Extract<DesignOperation, { type: "insert_element" }>["node"],
): Extract<DesignOperation, { type: "insert_element" }>["node"] {
  const authoredFrame = authored?.kind === "frame" ? authored : undefined;
  return {
    id: region.nodeId,
    name: region.name,
    kind: "frame",
    parentId,
    childIds: [],
    visible: authored?.visible ?? true,
    locked: authored?.locked ?? false,
    transform: [1, 0, 0, 1, region.x, region.y],
    size: { width: region.width, height: region.height },
    exportSettings: authored?.exportSettings ?? [],
    opacity: authored?.opacity ?? 1,
    properties: authoredFrame?.properties ?? {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent: false,
    },
    extensions: {
      ...authored?.extensions,
      generatedBy: "host-planned-region",
    },
  };
}

function registerPlannedNode<T>(
  nodes: Map<string, T>,
  nodeId: string,
  value: T,
): void {
  if (nodes.has(nodeId)) {
    throw designWorkflowError(
      "plan_node_ambiguous",
      `Planned node ID ${nodeId} is reused across delivery targets; inspect and define unique stable IDs`,
    );
  }
  nodes.set(nodeId, value);
}

function assertPlannedTargetWrites(
  input: DesignApplyToolInput,
  state: DesignWorkflowState,
  assumedAllocatedTargetIds: ReadonlySet<string> = new Set(),
): Set<string> {
  const targetIds = new Set<string>();
  const insertedParents = new Map(
    input.commands.flatMap((command) =>
      command.type === "insert_element"
        ? [[command.node.id, command.parentId] as const]
        : [],
    ),
  );
  for (const command of input.commands) {
    if (
      command.type === "put_asset" ||
      command.type === "delete_asset" ||
      command.type === "insert_page" ||
      command.type === "update_page" ||
      command.type === "move_page" ||
      command.type === "delete_page"
    ) {
      continue;
    }
    const target = targetForCommand(command, state, insertedParents);
    if (!target) {
      if (
        command.type === "insert_element" &&
        [...state.targetsById.values()].some(
          (candidate) =>
            candidate.artboardEstablished ||
            assumedAllocatedTargetIds.has(candidate.delivery.targetId),
        )
      ) {
        throw designWorkflowError(
          "target_stale",
          "New design layers cannot be scattered outside the planned artboard Frame",
          { commandId: command.commandId, nodeId: command.node.id },
        );
      }
      if (command.type === "insert_element") {
        throw designWorkflowError(
          "delivery_structure_incomplete",
          "The first design creation transaction must create the planned axis-aligned Page-root Frame at its declared position and dimensions",
          { commandId: command.commandId, nodeId: command.node.id },
        );
      }
      throw designWorkflowError(
        "target_stale",
        `Design command ${command.commandId} targets content outside every declared delivery artboard`,
        { commandId: command.commandId },
      );
    }
    targetIds.add(target.delivery.targetId);
  }
  for (const targetId of targetIds) {
    const target = state.targetsById.get(targetId);
    if (!target) continue;
    assertPlannedArtboardWrite(
      input,
      target,
      assumedAllocatedTargetIds.has(targetId),
    );
  }
  return targetIds;
}

function assertPlannedArtboardWrite(
  input: DesignApplyToolInput,
  state: DesignDeliveryTargetState,
  assumeAllocated = false,
): void {
  const inserts = input.commands.filter(
    (
      command,
    ): command is Extract<
      DesignApplyToolInput["commands"][number],
      { type: "insert_element" }
    > =>
      command.type === "insert_element" &&
      commandBelongsToTarget(command, state, input),
  );
  const { artboard, pageId } = state.planned;
  if (inserts.length === 0) {
    if (
      !state.artboardEstablished &&
      !assumeAllocated &&
      input.commands.some(
        (command) =>
          command.type === "replace_subtree" &&
          commandBelongsToTarget(command, state, input),
      )
    ) {
      throw designWorkflowError(
        "delivery_structure_incomplete",
        "Create the planned artboard Frame before replacing design subtrees",
      );
    }
    return;
  }
  if (!state.artboardEstablished && !assumeAllocated) {
    const artboardInsert = inserts.find(
      (command) => command.node.id === artboard.frameId,
    );
    if (
      !artboardInsert ||
      artboardInsert.node.kind !== "frame" ||
      artboardInsert.pageId !== pageId ||
      artboardInsert.parentId !== null ||
      artboardInsert.node.parentId !== null ||
      artboardInsert.node.transform[0] !== 1 ||
      artboardInsert.node.transform[1] !== 0 ||
      artboardInsert.node.transform[2] !== 0 ||
      artboardInsert.node.transform[3] !== 1 ||
      artboardInsert.node.transform[4] !== artboard.x ||
      artboardInsert.node.transform[5] !== artboard.y ||
      artboardInsert.node.size.width !== artboard.width ||
      artboardInsert.node.size.height !== artboard.height
    ) {
      throw designWorkflowError(
        "delivery_structure_incomplete",
        "The first design creation transaction must create the planned axis-aligned Page-root Frame at its declared position and dimensions",
      );
    }
    const insertedParents = new Map(
      inserts.map((command) => [command.node.id, command.parentId]),
    );
    for (const command of inserts) {
      if (command.node.id === artboard.frameId) continue;
      if (
        !parentChainReaches(
          command.parentId,
          artboard.frameId,
          insertedParents,
          state.artboardDescendantIds,
        )
      ) {
        throw designWorkflowError(
          "target_stale",
          "Every new design layer must be nested under the planned artboard Frame",
          { commandId: command.commandId, nodeId: command.node.id },
        );
      }
    }
    if (artboard.mode === "create") {
      assertPlannedRegionWrites(inserts, state.planned);
    }
    assertInitialArtboardMaterial(inserts, state.planned);
    return;
  }
  const insertedParents = new Map(
    inserts.map((command) => [command.node.id, command.parentId]),
  );
  for (const command of inserts) {
    if (
      !parentChainReaches(
        command.parentId,
        artboard.frameId,
        insertedParents,
        state.artboardDescendantIds,
      )
    ) {
      throw designWorkflowError(
        "target_stale",
        "New design layers cannot be scattered outside the planned artboard Frame",
        { commandId: command.commandId, nodeId: command.node.id },
      );
    }
  }
  if (artboard.mode === "create") {
    assertPlannedRegionWrites(inserts, state.planned);
  }
}

function assertPlannedRegionWrites(
  inserts: readonly Extract<
    DesignApplyToolInput["commands"][number],
    { type: "insert_element" }
  >[],
  target: DesignPlanTarget,
): void {
  const regionsById = new Map(
    target.composition.regions.map((region) => [region.nodeId, region]),
  );
  for (const command of inserts) {
    const region = regionsById.get(command.node.id);
    if (!region) continue;
    const expectedParentId = region.parentId ?? target.artboard.frameId;
    if (
      (command.node.kind !== "group" && command.node.kind !== "frame") ||
      command.parentId !== expectedParentId ||
      command.node.parentId !== expectedParentId ||
      command.node.transform[0] !== 1 ||
      command.node.transform[1] !== 0 ||
      command.node.transform[2] !== 0 ||
      command.node.transform[3] !== 1 ||
      command.node.transform[4] !== region.x ||
      command.node.transform[5] !== region.y ||
      command.node.size.width !== region.width ||
      command.node.size.height !== region.height
    ) {
      throw designWorkflowError(
        "delivery_structure_incomplete",
        `Planned region ${region.nodeId} must be an axis-aligned Group or Frame inside declared parent ${expectedParentId} at its parent-local bounds`,
        { commandId: command.commandId, nodeId: command.node.id },
      );
    }
  }
}

function assertInitialArtboardMaterial(
  inserts: readonly Extract<
    DesignApplyToolInput["commands"][number],
    { type: "insert_element" }
  >[],
  target: DesignPlanTarget,
): void {
  if (insertedSubtreeHasMaterialNode(inserts, target.artboard.frameId)) return;
  throw designWorkflowError(
    "empty_artboard_draft",
    `The first transaction for ${target.artboard.frameId} must include at least one real editable content layer; do not commit an empty artboard and defer all visible content to a later call`,
  );
}

function insertedSubtreeHasMaterialNode(
  inserts: readonly Extract<
    DesignApplyToolInput["commands"][number],
    { type: "insert_element" }
  >[],
  rootNodeId: string,
): boolean {
  const insertedParents = new Map(
    inserts.map((command) => [command.node.id, command.parentId]),
  );
  return inserts.some(
    (command) =>
      command.node.id !== rootNodeId &&
      isVisibleMaterialDraftNode(command.node) &&
      parentChainReaches(
        command.parentId,
        rootNodeId,
        insertedParents,
        new Set(),
      ),
  );
}

function isVisibleMaterialDraftNode(
  node: Extract<
    DesignApplyToolInput["commands"][number],
    { type: "insert_element" }
  >["node"],
): boolean {
  if (
    node.kind === "group" ||
    node.kind === "frame" ||
    node.kind === "slice" ||
    !node.visible ||
    node.opacity <= 0 ||
    node.size.width <= 0 ||
    node.size.height <= 0
  ) {
    return false;
  }
  if (node.kind === "text") return node.properties.content.trim().length > 0;
  if (node.kind === "image") return true;
  if (node.kind === "instance") return false;
  const visiblePaint = (paint: (typeof node.properties.fills)[number]) =>
    paint.visible !== false && paint.opacity > 0;
  return (
    node.properties.fills.some(visiblePaint) ||
    (node.properties.strokeWidth > 0 &&
      node.properties.strokes.some(visiblePaint))
  );
}

function parentChainReaches(
  parentId: string | null,
  frameId: string,
  insertedParents: ReadonlyMap<string, string | null>,
  knownDescendants: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>();
  let current = parentId;
  while (current !== null && !visited.has(current)) {
    if (current === frameId) return true;
    if (knownDescendants.has(current)) return true;
    visited.add(current);
    current = insertedParents.get(current) ?? null;
  }
  return false;
}

function targetForCommand(
  command: DesignOperation,
  state: DesignWorkflowState,
  insertedParents: ReadonlyMap<string, string | null>,
): DesignDeliveryTargetState | undefined {
  if (command.type === "insert_element") {
    return state.targetOrder
      .map((targetId) => state.targetsById.get(targetId))
      .find(
        (target) =>
          target !== undefined &&
          (command.node.id === target.planned.artboard.frameId ||
            parentChainReaches(
              command.parentId,
              target.planned.artboard.frameId,
              insertedParents,
              target.artboardDescendantIds,
            )),
      );
  }
  if (command.type === "move_element") {
    const source = findTargetForNode(state, command.nodeId);
    if (!source) return undefined;
    if (command.parentId === null) {
      if (
        command.nodeId === source.planned.artboard.frameId &&
        command.pageId === source.planned.pageId
      ) {
        return source;
      }
      return undefined;
    }
    const destination = targetForParentWithInserted(
      state,
      command.parentId,
      insertedParents,
    );
    if (destination?.delivery.targetId !== source.delivery.targetId) {
      throw new Error(
        `Design command ${command.commandId} cannot move layers across delivery artboards`,
      );
    }
    return source;
  }
  if (command.type === "reflow_text") {
    const targets = command.nodeIds.flatMap((nodeId) => {
      const target = findTargetForNode(state, nodeId);
      return target ? [target] : [];
    });
    const targetIds = new Set(
      targets.map((target) => target.delivery.targetId),
    );
    if (targetIds.size > 1) {
      throw new Error(
        `Design command ${command.commandId} cannot reflow text across delivery artboards`,
      );
    }
    return targets[0];
  }
  const nodeId =
    command.type === "replace_subtree"
      ? command.rootNodeId
      : "nodeId" in command
        ? command.nodeId
        : undefined;
  if (nodeId === undefined) return undefined;
  const target = findTargetForNode(state, nodeId);
  if (
    command.type === "delete_element" &&
    target?.planned.artboard.frameId === nodeId
  ) {
    throw new Error(
      `Design command ${command.commandId} cannot delete a required delivery artboard`,
    );
  }
  return target;
}

function commandBelongsToTarget(
  command: DesignOperation,
  target: DesignDeliveryTargetState,
  input: DesignApplyToolInput,
): boolean {
  if (command.type === "insert_element") {
    if (command.node.id === target.planned.artboard.frameId) return true;
    const insertedParents = new Map(
      input.commands.flatMap((candidate) =>
        candidate.type === "insert_element"
          ? [[candidate.node.id, candidate.parentId] as const]
          : [],
      ),
    );
    return parentChainReaches(
      command.parentId,
      target.planned.artboard.frameId,
      insertedParents,
      target.artboardDescendantIds,
    );
  }
  if (command.type === "reflow_text") {
    return command.nodeIds.every(
      (nodeId) =>
        nodeId === target.planned.artboard.frameId ||
        target.artboardDescendantIds.has(nodeId),
    );
  }
  const nodeId =
    command.type === "replace_subtree"
      ? command.rootNodeId
      : "nodeId" in command
        ? command.nodeId
        : undefined;
  return (
    nodeId !== undefined &&
    (nodeId === target.planned.artboard.frameId ||
      target.artboardDescendantIds.has(nodeId))
  );
}

function findTargetForNode(
  state: DesignWorkflowState,
  nodeId: string,
): DesignDeliveryTargetState | undefined {
  return state.targetOrder
    .map((targetId) => state.targetsById.get(targetId))
    .find(
      (target) =>
        target !== undefined &&
        (nodeId === target.planned.artboard.frameId ||
          target.artboardDescendantIds.has(nodeId)),
    );
}

function findTargetForParent(
  state: DesignWorkflowState,
  parentId: string | null,
): DesignDeliveryTargetState | undefined {
  return parentId === null ? undefined : findTargetForNode(state, parentId);
}

function targetForParentWithInserted(
  state: DesignWorkflowState,
  parentId: string,
  insertedParents: ReadonlyMap<string, string | null>,
): DesignDeliveryTargetState | undefined {
  return state.targetOrder
    .map((targetId) => state.targetsById.get(targetId))
    .find(
      (target) =>
        target !== undefined &&
        (parentId === target.planned.artboard.frameId ||
          target.artboardDescendantIds.has(parentId) ||
          parentChainReaches(
            parentId,
            target.planned.artboard.frameId,
            insertedParents,
            target.artboardDescendantIds,
          )),
    );
}

function firstTargetWithStatus(
  state: DesignWorkflowState,
  status: DesignDeliveryTarget["status"],
): DesignDeliveryTargetState | undefined {
  return state.targetOrder
    .map((targetId) => state.targetsById.get(targetId))
    .find((target) => target?.delivery.status === status);
}

function nextCaptureTarget(
  state: DesignWorkflowState,
): DesignDeliveryTargetState | undefined {
  for (const status of [
    "refined",
    "captured",
    "reviewed",
    "drafted",
    "allocated",
    "pending",
  ] as const) {
    const target = firstTargetWithStatus(state, status);
    if (target) return target;
  }
  return undefined;
}

function nextIncompleteTarget(
  state: DesignWorkflowState,
): DesignDeliveryTargetState | undefined {
  return state.targetOrder
    .map((targetId) => state.targetsById.get(targetId))
    .find((target) => target?.delivery.status !== "verified");
}

function pendingPlaceableRasterRoles(
  state: DesignWorkflowState,
  target: DesignDeliveryTargetState,
  inspection: InspectedHierarchy | undefined,
  expectedRevision: number | null,
): PlaceableRasterAssetRole[] {
  const required = state.plan.rasterAssetRoles.filter(
    (role): role is PlaceableRasterAssetRole => role !== "reference",
  );
  if (required.length === 0) return [];
  if (!inspection || inspection.revision !== expectedRevision) return required;
  const placed = new Set<PlaceableRasterAssetRole>();
  for (const nodeId of target.artboardDescendantIds) {
    const node = inspection?.nodesById.get(nodeId);
    const role = node?.designRole;
    if (
      node?.kind === "image" &&
      node.assetId !== undefined &&
      isPlaceableRasterAssetRole(role) &&
      required.includes(role)
    ) {
      placed.add(role);
    }
  }
  return required.filter((role) => !placed.has(role));
}

function assertFocusedUiTargetWrites(
  state: DesignWorkflowState,
  targetIds: readonly string[],
): void {
  if (state.plan.deliverable !== "ui" || targetIds.length === 0) return;
  const activeTarget = nextIncompleteTarget(state);
  if (!activeTarget) return;
  if (
    targetIds.length === 1 &&
    activeTarget.delivery.targetId === targetIds[0]
  ) {
    return;
  }
  throw designWorkflowError(
    "active_ui_target_required",
    `Complete the current UI target ${activeTarget.delivery.targetId} before writing another artboard; create one target-specific editable hierarchy, capture it, and then continue to the next target instead of bulk-filling several screens`,
  );
}

function hasActivePlanStepForTargets(
  state: DesignWorkflowState,
  targetIds: readonly string[],
): boolean {
  const targets = new Set(targetIds);
  return state.planExecution.targets.some(
    (target) =>
      targets.has(target.targetId) &&
      target.steps.some((step) => step.status === "in_progress"),
  );
}

function assertDeclaredReferencesAuthorizedForRun(
  strategy: DesignReferenceStrategy | undefined,
  attachments: readonly AgentImageAttachment[],
): void {
  if (strategy === undefined) return;
  const authorized = new Set(
    attachments.map((attachment) => attachment.attachmentId),
  );
  const declared = new Set<string>();
  const invalid = strategy.references.find((reference) => {
    if (
      declared.has(reference.attachmentId) ||
      !authorized.has(reference.attachmentId)
    ) {
      return true;
    }
    declared.add(reference.attachmentId);
    return false;
  });
  if (invalid) {
    throw designWorkflowError(
      "reference_strategy_invalid",
      "Every image explicitly declared in referenceStrategy must belong to the current Conversation and may be declared at most once",
    );
  }
}

function isImageAttachmentMetadata(
  attachment: AgentAttachment,
): attachment is AgentImageAttachment {
  return (
    attachment.attachmentId.startsWith("image_") &&
    (attachment.mimeType === "image/png" ||
      attachment.mimeType === "image/jpeg" ||
      attachment.mimeType === "image/webp" ||
      attachment.mimeType === "image/gif")
  );
}

function deliveryLedger(state: DesignWorkflowState): DesignDeliveryLedger {
  return {
    version: DESIGN_DELIVERY_LEDGER_VERSION,
    targets: state.targetOrder.flatMap((targetId) => {
      const target = state.targetsById.get(targetId);
      return target ? [structuredClone(target.delivery)] : [];
    }),
    activeTargetId: nextIncompleteTarget(state)?.delivery.targetId ?? null,
    planExecution: structuredClone(state.planExecution),
  };
}

function committedPlanStepRevisions(content: unknown): Map<string, number> {
  if (!isPlainRecord(content) || !Array.isArray(content.committedSteps)) {
    return new Map();
  }
  const revisions = new Map<string, number>();
  for (const candidate of content.committedSteps) {
    if (
      !isPlainRecord(candidate) ||
      !Array.isArray(candidate.stepIds) ||
      !Number.isSafeInteger(candidate.revision) ||
      Number(candidate.revision) < 0
    ) {
      continue;
    }
    for (const stepId of candidate.stepIds) {
      if (typeof stepId === "string") {
        revisions.set(stepId, Number(candidate.revision));
      }
    }
  }
  return revisions;
}

type CommittedPlanStep = { stepId: string; revision: number };

function resolveCommittedPlanStepEvidence(
  state: DesignWorkflowState,
  targetIds: readonly string[],
  steps: DesignApplyToolInput["steps"],
  revision: number | undefined,
  resultContent: unknown,
): CommittedPlanStep[] | undefined {
  if (!validRevision(revision) || !steps || steps.length === 0) return [];
  const flattened = state.planExecution.targets.flatMap((target) =>
    target.steps.map((step) => ({ ...step, targetId: target.targetId })),
  );
  const activeIndex = flattened.findIndex(
    (step) => step.status === "in_progress",
  );
  const allowedTargets = new Set(targetIds);
  const reported = committedPlanStepRevisions(resultContent);
  const completions: CommittedPlanStep[] = [];
  const initialRevision = flattened[activeIndex]?.startedRevision;
  let previousRevision = initialRevision;
  for (const [offset, submitted] of steps.entries()) {
    const expected = flattened[activeIndex + offset];
    const completedRevision = reported.get(submitted.stepId) ?? revision;
    if (
      !expected ||
      !allowedTargets.has(expected.targetId) ||
      expected.stepId !== submitted.stepId ||
      (offset === 0
        ? expected.status !== "in_progress"
        : expected.status !== "pending") ||
      (expected.kind === "review-refine" && steps.length > 1) ||
      initialRevision === undefined ||
      previousRevision === undefined ||
      completedRevision <= initialRevision ||
      completedRevision < previousRevision ||
      completedRevision > revision
    ) {
      return undefined;
    }
    completions.push({ stepId: submitted.stepId, revision: completedRevision });
    previousRevision = completedRevision;
  }
  return completions;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function designDeliveryCanComplete(
  delivery: DesignDeliveryLedger | undefined,
): boolean {
  if (!delivery) return true;
  return (
    delivery.targets.every((target) => target.status === "verified") &&
    delivery.planExecution !== undefined &&
    delivery.planExecution.targets.every((target) =>
      target.steps.every((step) => step.status === "completed"),
    )
  );
}

function activateNextPlanStep(
  state: DesignWorkflowState,
  revision: number,
): void {
  const steps = state.planExecution.targets.flatMap((target) => target.steps);
  if (steps.some((step) => step.status === "in_progress")) return;
  const next = steps.find((step) => step.status === "pending");
  if (!next) return;
  next.status = "in_progress";
  next.startedRevision = revision;
}

function implementationPlanCompleted(
  state: DesignWorkflowState,
  targetId: string,
): boolean {
  return (
    state.planExecution.targets
      .find((target) => target.targetId === targetId)
      ?.steps.filter((step) => step.kind === "implementation")
      .every((step) => step.status === "completed") ?? false
  );
}

function completeReviewPlanStep(
  state: DesignWorkflowState,
  targetId: string,
  revision: number,
): void {
  const step = state.planExecution.targets
    .find((target) => target.targetId === targetId)
    ?.steps.find((candidate) => candidate.kind === "review-refine");
  if (!step || step.status !== "in_progress") {
    throw designWorkflowError(
      "plan_review_step_invalid",
      `Target ${targetId} cannot be verified before its review Plan step is active`,
    );
  }
  step.status = "completed";
  step.completedRevision = revision;
  activateNextPlanStep(state, revision);
}

function sameMutationTarget(
  left: DesignMutationTarget,
  right: DesignMutationTarget,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== "page" ||
      (right.kind === "page" && left.pageId === right.pageId))
  );
}

function sameScope(left: SelectionScope, right: SelectionScope): boolean {
  if (left.kind !== right.kind) return false;
  const leftPageId = "pageId" in left ? left.pageId : undefined;
  const rightPageId = "pageId" in right ? right.pageId : undefined;
  if (leftPageId !== rightPageId) return false;
  const leftPrimaryNodeId =
    "primaryNodeId" in left ? left.primaryNodeId : undefined;
  const rightPrimaryNodeId =
    "primaryNodeId" in right ? right.primaryNodeId : undefined;
  if (leftPrimaryNodeId !== rightPrimaryNodeId) return false;
  return (
    left.selectedNodeIds.length === right.selectedNodeIds.length &&
    left.selectedNodeIds.every(
      (nodeId, index) => nodeId === right.selectedNodeIds[index],
    )
  );
}

function bindPlanToReviewedScope(
  scope: DesignDeliveryScope | undefined,
  reservations:
    ReadonlyMap<string, DeliveryScopeArtboardReservation> | undefined,
  existing: DesignWorkflowState | undefined,
  plan: DesignPlanToolInput,
): DesignPlanToolInput {
  if (scope === undefined) return plan;
  const mismatch = (message: string): never => {
    throw designWorkflowError(
      "delivery_scope_mismatch",
      `${message}. Preserve the recorded delivery targets exactly instead of silently shrinking or expanding scope`,
    );
  };
  if (plan.deliverable !== scope.deliverable) {
    mismatch(
      `Deliverable ${plan.deliverable} does not match confirmed ${scope.deliverable}`,
    );
  }
  const targets = designPlanTargets(plan);
  const previousStageTargets = existing ? designPlanTargets(existing.plan) : [];
  const previousStageIncomplete = previousStageTargets.some(
    (target) =>
      existing?.targetsById.get(target.targetId)?.delivery.status !==
      "verified",
  );
  const expectedTargets = previousStageIncomplete
    ? previousStageTargets.map((target) =>
        scope.targets.find(
          (confirmed) => confirmed.targetId === target.targetId,
        ),
      )
    : [
        scope.targets.find(
          (confirmed) => !existing?.targetsById.has(confirmed.targetId),
        ),
      ];
  if (expectedTargets.some((target) => target === undefined)) {
    mismatch("The recorded delivery scope has no remaining executable target");
  }
  const confirmedTargets = expectedTargets.filter(
    (target): target is DesignDeliveryScope["targets"][number] =>
      target !== undefined,
  );
  if (targets.length !== confirmedTargets.length) {
    mismatch(
      previousStageIncomplete
        ? `The current stage has ${confirmedTargets.length} target(s) and must be amended in place before advancing`
        : `The next executable stage must contain only ${confirmedTargets[0]?.label ?? "the next recorded target"}`,
    );
  }
  for (const [index, confirmed] of confirmedTargets.entries()) {
    const target = targets[index];
    if (!target || target.targetId !== confirmed.targetId) {
      mismatch(`Stage target ${index + 1} must be ${confirmed.label}`);
    }
  }
  const bound = structuredClone(plan);
  bound.objective = scope.objective;
  for (const [index, confirmed] of confirmedTargets.entries()) {
    const target = bound.targets[index];
    if (!target) mismatch(`Target ${index + 1} is missing`);
    target.label = confirmed.label;
    target.objective = confirmed.objective;
    const reservation = reservations?.get(confirmed.targetId);
    if (reservation) {
      target.pageId = reservation.pageId;
      target.artboard = {
        mode: "create",
        frameId: reservation.frameId,
        x: reservation.x,
        y: reservation.y,
        width: reservation.width,
        height: reservation.height,
      };
    }
  }
  bound.briefFidelity = {
    ...bound.briefFidelity,
    requiredContent: confirmedTargets.flatMap(
      (target) => target.requiredContent,
    ),
    prohibitedAdditions: Array.from(
      new Set([
        ...bound.briefFidelity.prohibitedAdditions,
        ...scope.exclusions,
      ]),
    ),
    assumptions: [...scope.assumptions],
  };
  return bound;
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const page = document.pagesById[pageId];
  if (!page) return false;
  const pending = [...page.rootNodeIds];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === nodeId) return true;
    visited.add(current);
    const node = document.nodesById[current];
    if (node) pending.push(...node.childIds);
  }
  return false;
}

function validRevision(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}
