import type {
  AgentAttachment,
  AgentEvent,
  AgentImageAttachment,
  AgentRequest,
  DesignGenerationMode,
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
  DESIGN_ARRANGE_TOOL_NAME,
  designApplyRequiresPlan,
  activeVisualReferenceIds,
  designPlanComponentStrategy,
  designPlanReferenceStrategy,
  designPlanTargets,
  type DesignApplyToolInput,
  type DesignComponentToolInput,
  type DesignPlanTarget,
  type DesignPlanToolInput,
  type DesignReferenceStrategy,
  type DesignVisualReviewToolInput,
  type PlannedDesignRebaseGuard,
  type PlaceableRasterAssetRole,
  type RasterAssetRole,
} from "@/shared/design-agent-tools.js";
import type { RendererDesignCaptureTarget } from "@/shared/design-tool-bridge.js";
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

export class GlobalTaskCoordinator {
  readonly #tasksByRunId = new Map<string, GlobalTaskProjection>();
  readonly #toolBindingsByRunId = new Map<
    string,
    {
      conversationId: string;
      documentId: string;
      revision: number;
      scope: SelectionScope;
      mutationTarget: DesignMutationTarget;
      prompt: string;
      generationMode: DesignGenerationMode;
      modelSelection: ModelSelection;
      imageAttachments: AgentImageAttachment[];
    }
  >();
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

  constructor(
    private readonly projectHost: ProjectHost,
    private readonly workspaceStore: WorkspaceStore,
    private readonly now: () => Date = () => new Date(),
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
    const task: GlobalTaskProjection = {
      version: WORKSPACE_CONTRACT_VERSION,
      taskId: `task_${request.runId}`,
      conversationId: conversation.conversationId,
      runId: request.runId,
      title: conversation.title,
      lifecycle: "queued",
      targetSet: { targets: [primaryTarget], primaryTarget },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.workspaceStore.saveConversation({
      ...conversation,
      updatedAt: timestamp,
    });
    this.workspaceStore.saveGlobalTask(task);
    this.#tasksByRunId.set(request.runId, task);
    this.#toolBindingsByRunId.set(request.runId, {
      conversationId: request.sessionId,
      documentId: request.documentId,
      revision: request.revision,
      scope: structuredClone(request.scope),
      mutationTarget: structuredClone(request.mutationTarget),
      generationMode: request.generationMode ?? "thorough",
      prompt: request.prompt,
      modelSelection: structuredClone(request.modelSelection),
      imageAttachments: (request.attachments ?? [])
        .filter(isImageAttachmentMetadata)
        .map((attachment) => structuredClone(attachment)),
    });
    return task;
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
      throw new Error(
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
    throw new Error(
      "design_workflow.page_structure_access_required: Call opendesign_request_page_structure_access and wait for the user's one-time approval before modifying Page structure or another Page",
    );
  }

  recordPageToolCompleted(runId: string, action: string): void {
    this.#pageStructureAccessByRunId.get(runId)?.completedActions.add(action);
  }

  supersedeDesignDeliveryForClearedPage(
    context: TrustedToolContext,
    pageId: string,
  ): void {
    this.assertDesignToolContext(context);
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) throw new Error("Page clear requires an active Run");
    if (
      binding.mutationTarget.kind === "page" &&
      binding.mutationTarget.pageId !== pageId
    ) {
      throw new Error("Page clear cannot supersede another Page delivery");
    }
    this.#designPlansByRunId.delete(context.runId);
    this.#inspectionsByRunId.delete(context.runId);

    const timestamp = this.now().toISOString();
    for (const task of this.workspaceStore.listGlobalTasks()) {
      if (
        task.conversationId !== context.sessionId ||
        task.targetSet.primaryTarget.documentId !== context.documentId ||
        task.delivery === undefined
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
    throw new Error(
      "design_workflow.page_structure_access_required: Call opendesign_request_page_structure_access and wait for the user's one-time approval before modifying components on another Page",
    );
  }

  registerDesignPlan(
    context: TrustedToolContext,
    plan: DesignPlanToolInput,
  ): Omit<DesignPlanRegistration, "state"> {
    this.assertDesignToolContext(context);
    const inspection = this.#requireDocumentInspection(context);
    const existingPlan = this.#designPlansByRunId.get(context.runId);
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) throw new Error("Design plan requires an active Run");
    const targets = designPlanTargets(plan);
    const pageAccess = this.#pageStructureAccessByRunId.get(context.runId);
    if (
      pageAccess?.actions.has("create-page") &&
      !pageAccess.completedActions.has("create") &&
      targets.length > 1 &&
      new Set(targets.map((target) => target.pageId)).size === 1
    ) {
      throw new Error(
        "design_workflow.page_creation_required: Create the approved Pages successfully, inspect the current Design File, and bind each requested Page target before defining a multi-target plan; do not replace separate Pages with Frames on one Page",
      );
    }
    const recoverableDelivery = this.getRecoverableDelivery(context);
    assertPlanUsesNewNodeIdNamespace(plan, inspection, recoverableDelivery);
    if (
      binding.mutationTarget.kind === "page" &&
      !this.hasPageStructureAccess(context.runId)
    ) {
      const targetPageId = binding.mutationTarget.pageId;
      if (targets.some((target) => target.pageId !== targetPageId)) {
        throw new Error(
          "Design plan targets a Page outside the registered Page mutation target",
        );
      }
    }
    if (
      targets.some((target) => !inspection.pageRootsById.has(target.pageId))
    ) {
      throw new Error(
        "Design plan target Page is missing from the current document inspection",
      );
    }
    if (plan.outputMode === "single-raster") {
      const evidence = plan.singleRasterEvidence;
      if (
        !evidence ||
        !binding.prompt.includes(evidence) ||
        !explicitlyRequestsSingleRaster(evidence)
      ) {
        throw new Error(
          "Single-raster output requires an exact excerpt that explicitly requests one flattened image",
        );
      }
    }
    assertReferenceStrategyMatchesRun(
      designPlanReferenceStrategy(plan),
      binding.imageAttachments,
    );
    const registration = registerDesignWorkflowPlan({
      existing: existingPlan,
      inspection,
      plan,
      recoverableDelivery,
    });
    this.#designPlansByRunId.set(context.runId, registration.state);
    const generatedRoles =
      this.#generatedRasterRolesByRunId.get(context.runId) ??
      new Map<string, RasterAssetRole>();
    for (const [attachmentId, role] of generatedRoles) {
      if (!plan.rasterAssetRoles.includes(role)) {
        generatedRoles.delete(attachmentId);
      }
    }
    this.#generatedRasterRolesByRunId.set(context.runId, generatedRoles);
    this.#persistDelivery(context.runId, registration.state);
    const { state, ...result } = registration;
    void state;
    return result;
  }

  createDesignPlanAllocation(runId: string): DesignPlanAllocation | undefined {
    const state = this.#designPlansByRunId.get(runId);
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
      throw new Error(
        "design_workflow.allocation_revision_invalid: Artboard allocation did not return a valid document revision",
      );
    }
    const state = this.#designPlansByRunId.get(runId);
    if (!state) throw new Error("Artboard allocation requires an active plan");
    for (const targetId of targetIds) {
      const target = state.targetsById.get(targetId);
      if (!target || target.delivery.status !== "pending") {
        throw new Error(
          `design_workflow.allocation_state_invalid: Delivery target ${targetId} is not pending allocation`,
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
      throw new Error(
        "design_workflow.inspection_required: Inspect the bound design document before modifying Page structure",
      );
    }
  }

  recordCanvasCapture(
    context: TrustedToolContext,
    observedRevision = context.revision,
    layoutQuality?: DesignLayoutQualityReport,
    visualCritic?: DesignVisualCriticResult,
  ) {
    this.assertDesignToolContext(context);
    if (!Number.isSafeInteger(observedRevision) || observedRevision < 0) {
      throw new Error(
        "design_workflow.capture_revision_invalid: The rendered capture returned an invalid document revision; capture the current canvas again",
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
      throw new Error(
        "design_workflow.capture_revision_invalid: The rendered capture predates the latest material design revision; capture the current canvas again",
      );
    }
    if (!layoutQuality) {
      throw new Error(
        "design_workflow.layout_quality_unavailable: A delivery Frame capture requires a trusted deterministic layout-quality report; inspect and capture the current target again",
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
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "repair-overflow",
            pageId: target.planned.pageId,
            frameId: target.planned.artboard.frameId,
          },
          errorCount: layoutQuality.errorCount,
        },
      };
    }
    if (
      visualCritic !== undefined &&
      visualCritic.observedRevision !== observedRevision
    ) {
      throw new Error(
        "design_workflow.visual_critic_unavailable: The independent visual critic does not match the exact captured revision",
      );
    }
    const generationMode = this.#toolBindingsByRunId.get(
      context.runId,
    )?.generationMode;
    if (
      generationMode === "fast" &&
      visualCritic === undefined &&
      (target.delivery.status === "drafted" ||
        target.delivery.status === "captured" ||
        target.delivery.status === "reviewed" ||
        target.delivery.status === "refined")
    ) {
      const inspection = this.#inspectionsByRunId.get(context.runId);
      if (!inspection || inspection.revision !== observedRevision) {
        throw new Error(
          "design_workflow.delivery_verification_required: Fast delivery requires an authoritative document inspection from the exact captured revision; inspect and capture the current target again",
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
          : "complete-delivery",
        reviewEligible: false,
        verified: true,
        verification: "deterministic-fast-delivery",
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
      target.lastReview = structuredClone(visualCritic.review);
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
      target.lastReview = structuredClone(visualCritic.review);
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
    let componentStrategy:
      ReturnType<typeof assertDeliveryTargetStructure> | undefined;
    if (target.delivery.status === "refined") {
      if (visualCritic === undefined) {
        throw new Error(
          "design_workflow.visual_critic_unavailable: Final delivery verification requires an independent visual critic for the exact captured revision",
        );
      }
      const inspection = this.#inspectionsByRunId.get(context.runId);
      if (!inspection || inspection.revision !== observedRevision) {
        throw new Error(
          "design_workflow.delivery_verification_required: Final delivery verification requires an authoritative document inspection from the exact captured revision; inspect and capture the current target again",
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
    target.delivery = {
      ...target.delivery,
      status: "captured",
      captureRevision: observedRevision,
    };
    this.#persistDelivery(context.runId, state);
    return {
      captureSequence,
      capturedRevision: observedRevision,
      deliveryTargetId: target.delivery.targetId,
      nextAction: "record-visual-review",
      reviewEligible: true,
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
      (binding.generationMode === "fast" &&
        state.plan.deliverable !== "logo") ||
      target.delivery.status === "pending" ||
      target.delivery.status === "allocated" ||
      target.delivery.status === "verified"
    ) {
      return null;
    }
    return {
      runId: context.runId,
      generationMode: binding.generationMode,
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
          throw new Error(
            "design_workflow.reference_unavailable: An active visual reference is no longer authorized for this Run",
          );
        }
        return structuredClone(reference);
      }),
    };
  }

  registerVisualReview(
    context: TrustedToolContext,
    review: DesignVisualReviewToolInput,
  ): void {
    const state = this.#requireDesignPlan(context);
    const target = firstTargetWithStatus(state, "captured");
    if (!target) {
      if (
        [...state.targetsById.values()].some(
          (candidate) =>
            candidate.delivery.status !== "pending" &&
            candidate.delivery.status !== "allocated",
        )
      ) {
        throw new Error(
          "design_workflow.capture_required: Call opendesign_capture_canvas once after the latest material design write, then record the visual review from that returned image; do not retry the review before capturing",
        );
      }
      throw new Error(
        "design_workflow.material_write_required: Apply one successful material design transaction from the accepted plan, then call opendesign_capture_canvas before recording a visual review; do not retry the review yet",
      );
    }
    if (target.captureCount <= target.reviewedCaptureCount) {
      throw new Error(
        "design_workflow.capture_required: Call opendesign_capture_canvas once after the latest material design write, then record the visual review from that returned image; do not retry the review before capturing",
      );
    }
    if (
      target.lastCaptureRevision === null ||
      (target.lastMaterialWriteRevision !== null &&
        target.lastCaptureRevision < target.lastMaterialWriteRevision)
    ) {
      throw new Error(
        "design_workflow.capture_revision_invalid: The latest rendered capture predates the latest material design revision; capture the current canvas again before recording the review",
      );
    }
    target.lastReview = {
      ...structuredClone(review),
      skillRefs: structuredClone(state.plan.skillRefs),
    };
    target.reviewedCaptureCount = target.captureCount;
    target.reviewedCaptureRevision = target.lastCaptureRevision;
    target.delivery = {
      ...target.delivery,
      status: "reviewed",
      reviewRevision: target.lastCaptureRevision,
    };
    this.#persistDelivery(context.runId, state);
  }

  assertVisualReviewBeforeWrite(context: TrustedToolContext): void {
    const state = this.#designPlansByRunId.get(context.runId);
    if (state && firstTargetWithStatus(state, "captured")) {
      throw new Error(
        "Record a structured visual review of the latest canvas capture before refining the design",
      );
    }
  }

  assertDesignRefinementReady(context: TrustedToolContext): void {
    const state = this.#requireDesignPlan(context);
    const target = nextCaptureTarget(state);
    if (
      !target ||
      (target.delivery.status !== "reviewed" &&
        target.delivery.status !== "refined")
    ) {
      throw new Error(
        "design_workflow.visual_review_required: Capture the complete material draft and use its trusted independent visual review before starting the refinement checkpoint",
      );
    }
  }

  assertDesignPlanForRaster(
    context: TrustedToolContext,
    role: RasterAssetRole,
  ): DesignPlanToolInput {
    const state = this.#requireDesignPlan(context);
    if (!state.plan.rasterAssetRoles.includes(role)) {
      throw new Error(
        `Raster role ${role} is not declared by the active design plan`,
      );
    }
    return state.plan;
  }

  recordGeneratedRaster(
    context: TrustedToolContext,
    attachmentId: string,
    role: RasterAssetRole,
  ): void {
    this.assertDesignPlanForRaster(context, role);
    const roles = this.#generatedRasterRolesByRunId.get(context.runId);
    if (!roles) {
      throw new Error("Generated raster requires an active design plan");
    }
    roles.set(attachmentId, role);
  }

  resolveGeneratedRasterAttachmentId(
    context: TrustedToolContext,
    requestedAttachmentId: string,
    role: PlaceableRasterAssetRole,
  ): string {
    this.assertDesignPlanForRaster(context, role);
    const generated = this.#generatedRasterRolesByRunId.get(context.runId);
    const exactRole = generated?.get(requestedAttachmentId);
    if (exactRole !== undefined) {
      if (exactRole !== role) {
        throw new Error(
          `Generated raster was declared as ${exactRole} and cannot be placed as ${role}`,
        );
      }
      return requestedAttachmentId;
    }
    const candidates = [...(generated?.entries() ?? [])].flatMap(
      ([attachmentId, candidateRole]) =>
        candidateRole === role ? [attachmentId] : [],
    );
    if (candidates.length === 1) return candidates[0] ?? requestedAttachmentId;
    if (candidates.length > 1) {
      throw new Error(
        `design_workflow.image_attachment_ambiguous: Attachment ${requestedAttachmentId} is not authorized, and ${candidates.length} generated ${role} images are available in this Run; use the exact attachmentId returned by the intended generation result`,
      );
    }
    return requestedAttachmentId;
  }

  assertDesignPlanForImagePlacement(
    context: TrustedToolContext,
    role: PlaceableRasterAssetRole,
    parentId: string | null,
    attachmentId?: string,
    nodeId?: string,
  ): DesignPlanToolInput {
    const state = this.#requireDesignPlan(context);
    if (!state.plan.rasterAssetRoles.includes(role)) {
      throw new Error(
        `Raster role ${role} is not declared by the active design plan`,
      );
    }
    const generatedRole = attachmentId
      ? this.#generatedRasterRolesByRunId.get(context.runId)?.get(attachmentId)
      : undefined;
    if (generatedRole && generatedRole !== role) {
      throw new Error(
        `Generated raster was declared as ${generatedRole} and cannot be placed as ${role}`,
      );
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
        throw new Error(
          `design_workflow.planned_parent_not_materialized: Planned region ${parentId} is a logical region and is not a real container in the current document; place the image inside an inspected descendant of artboard ${plannedRegionTarget.planned.artboard.frameId}, or first insert a current-namespace Frame under that artboard`,
        );
      }
    }
    if (!target?.artboardEstablished) {
      throw new Error(
        "Image placement requires the planned artboard Frame to be created first",
      );
    }
    if (
      parentId !== target.planned.artboard.frameId &&
      (parentId === null || !target.artboardDescendantIds.has(parentId))
    ) {
      throw new Error(
        "Design images must be placed inside the planned artboard Frame",
      );
    }
    assertNewNodeIdUsesInspectionNamespace(
      this.#inspectionsByRunId.get(context.runId),
      nodeId,
      new Set(target.delivery.reservedNodeIds),
    );
    if (target.delivery.status !== "captured") {
      this.assertVisualReviewBeforeWrite(context);
    }
    assertDeliveryAcceptsMaterialWrites(state);
    return state.plan;
  }

  assertDesignPlanForApply(
    context: TrustedToolContext,
    input: DesignApplyToolInput,
  ): DesignPlanApplyAuthorization | undefined {
    const state = this.#designPlansByRunId.get(context.runId);
    const scopedInput = this.#bindApplyToRegisteredPage(context, input);
    if (!state) {
      assertApplyUsesNewNodeIdNamespace(
        scopedInput,
        this.#inspectionsByRunId.get(context.runId),
      );
      if (!designApplyRequiresPlan(scopedInput)) return undefined;
      this.#requireDesignPlan(context);
      return undefined;
    }
    const resolvedInput = resolvePlannedStructureGeometry(scopedInput, state);
    const targetIds = [...assertPlannedTargetWrites(resolvedInput, state)];
    if (designApplyRequiresPlan(resolvedInput) && targetIds.length === 0) {
      throw new Error(
        "Material design commands must target a declared delivery artboard",
      );
    }
    assertApplyUsesNewNodeIdNamespace(
      resolvedInput,
      this.#inspectionsByRunId.get(context.runId),
      reservedNodeIdsForTargets(state, targetIds),
    );
    assertDeliveryAcceptsMaterialWrites(state);
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
      input: resolvedInput,
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
  ): DesignPlanApplyAuthorization {
    const state = this.#requireDesignPlan(context);
    const assumedAllocatedTargetIds = new Set(allocationTargetIds);
    if (assumedAllocatedTargetIds.size !== allocationTargetIds.length) {
      throw new Error(
        "design_workflow.allocation_state_invalid: Compact allocation target IDs must be unique",
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
        throw new Error(
          `design_workflow.allocation_state_invalid: Delivery target ${targetId} is not pending creation`,
        );
      }
    }
    const resolvedInput = resolvePlannedStructureGeometry(input, state);
    const targetIds = [
      ...assertPlannedTargetWrites(
        resolvedInput,
        state,
        assumedAllocatedTargetIds,
      ),
    ];
    if (targetIds.length === 0) {
      throw new Error(
        "design_workflow.material_write_required: Compact first-slice input must create real editable content inside the first allocated target",
      );
    }
    assertApplyUsesNewNodeIdNamespace(
      resolvedInput,
      this.#inspectionsByRunId.get(context.runId),
      reservedNodeIdsForTargets(state, targetIds),
    );
    assertDeliveryAcceptsMaterialWrites(state);
    return {
      input: resolvedInput,
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

  recordDesignApplyCompleted(
    runId: string,
    input: DesignApplyToolInput,
    authorization: DesignPlanApplyAuthorization | undefined,
    revision?: number,
  ): void {
    const state = this.#designPlansByRunId.get(runId);
    if (!state || !authorization || authorization.targetIds.length === 0)
      return;
    for (const targetId of authorization.targetIds) {
      const target = state.targetsById.get(targetId);
      if (!target) continue;
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

  resolveMaterialTargetIds(
    context: TrustedToolContext,
    nodeIds: readonly string[],
    parentId?: string | null,
  ): string[] {
    const state = this.#requireDesignPlan(context);
    const targets = new Set<string>();
    for (const nodeId of nodeIds) {
      const target = findTargetForNode(state, nodeId);
      if (!target) {
        throw new Error(
          `Design write target ${nodeId} is outside every declared delivery artboard`,
        );
      }
      targets.add(target.delivery.targetId);
    }
    if (parentId !== undefined) {
      const target = findTargetForParent(state, parentId);
      if (!target) {
        throw new Error(
          "Design write parent is outside every declared delivery artboard",
        );
      }
      targets.add(target.delivery.targetId);
    }
    if (targets.size > 1) {
      throw new Error(
        "One design operation cannot move or combine layers across delivery artboards",
      );
    }
    const targetIds = [...targets];
    assertDeliveryAcceptsMaterialWrites(state);
    return targetIds;
  }

  resolveMaterialTargetIdsIfPlanned(
    context: TrustedToolContext,
    nodeIds: readonly string[],
    parentId?: string | null,
  ): string[] {
    this.assertDesignToolContext(context);
    if (!this.#designPlansByRunId.has(context.runId)) return [];
    return this.resolveMaterialTargetIds(context, nodeIds, parentId);
  }

  getDeliveryLedger(runId: string): DesignDeliveryLedger | undefined {
    const state = this.#designPlansByRunId.get(runId);
    return state ? deliveryLedger(state) : undefined;
  }

  getRecoverableDelivery(
    context: TrustedToolContext,
  ): DesignDeliveryLedger | undefined {
    this.assertDesignToolContext(context);
    const candidate = this.workspaceStore
      .listGlobalTasks()
      .filter(
        (task) =>
          task.runId !== context.runId &&
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

  handleAgentEvent(event: AgentEvent): void {
    if (event.type === "agent.error" && event.runId === undefined) {
      this.#interruptActiveTasks();
      return;
    }
    const runId = "runId" in event ? event.runId : undefined;
    if (!runId) return;
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
    if (!task) return;
    const activityAt = conversationActivityAt(event, this.now);
    if (activityAt) this.#touchConversation(task.conversationId, activityAt);
    const lifecycle = projectGlobalTaskLifecycle(
      { ...event, runId },
      task.lifecycle,
    );
    if (lifecycle === task.lifecycle) {
      if (event.type === "run.completed") {
        this.#tasksByRunId.delete(runId);
        this.#toolBindingsByRunId.delete(runId);
        this.#designPlansByRunId.delete(runId);
        this.#generatedRasterRolesByRunId.delete(runId);
        this.#inspectionsByRunId.delete(runId);
        this.#pageStructureAccessByRunId.delete(runId);
      }
      return;
    }
    const updated: GlobalTaskProjection = {
      ...task,
      lifecycle,
      updatedAt: this.now().toISOString(),
    };
    this.workspaceStore.saveGlobalTask(updated);
    const awaitsRunTerminal =
      event.type === "agent.error" && event.failure !== undefined;
    if (activeLifecycles.has(lifecycle) || awaitsRunTerminal) {
      this.#tasksByRunId.set(runId, updated);
    } else {
      this.#tasksByRunId.delete(runId);
    }
    if (
      event.type === "run.completed" ||
      event.type === "run.continuation" ||
      (event.type === "agent.error" && !awaitsRunTerminal)
    ) {
      this.#toolBindingsByRunId.delete(runId);
      this.#designPlansByRunId.delete(runId);
      this.#generatedRasterRolesByRunId.delete(runId);
      this.#inspectionsByRunId.delete(runId);
      this.#pageStructureAccessByRunId.delete(runId);
    }
  }

  #interruptActiveTasks(): void {
    const timestamp = this.now().toISOString();
    for (const [runId, task] of this.#tasksByRunId) {
      this.workspaceStore.saveGlobalTask({
        ...task,
        lifecycle: "interrupted",
        updatedAt: timestamp,
      });
      this.#tasksByRunId.delete(runId);
      this.#toolBindingsByRunId.delete(runId);
      this.#designPlansByRunId.delete(runId);
      this.#generatedRasterRolesByRunId.delete(runId);
      this.#inspectionsByRunId.delete(runId);
      this.#pageStructureAccessByRunId.delete(runId);
      this.#touchConversation(task.conversationId, timestamp);
    }
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

  #requireDocumentInspection(context: TrustedToolContext): InspectedHierarchy {
    this.assertDesignToolContext(context);
    const inspection = this.#inspectionsByRunId.get(context.runId);
    if (!inspection) {
      throw new Error(
        "design_workflow.inspection_required: Inspect the bound design document before using stable design targets",
      );
    }
    if (inspection.revision !== context.revision) {
      throw new Error(
        `design_workflow.inspection_stale: Inspect the current document revision before continuing; inspected ${inspection.revision}, current ${context.revision}`,
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
  throw new Error(
    `design_workflow.new_node_id_namespace_required: New node ID ${nodeId} must start with ${prefix} from the latest trusted inspection so it cannot collide with hidden nodes on another Page`,
  );
}

/**
 * The accepted plan owns only the disposable structural intent. When the
 * model materializes one of those stable IDs, Main compiles its parent-local
 * geometry from the trusted plan instead of asking the model to repeat exact
 * scaffold coordinates. Real content geometry remains model-authored.
 */
function resolvePlannedStructureGeometry(
  input: DesignApplyToolInput,
  state: DesignWorkflowState,
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
  for (const target of state.targetsById.values()) {
    if (target.planned.artboard.mode !== "create") continue;
    registerPlannedNode(plannedNodes, target.planned.artboard.frameId, {
      kind: "artboard",
      target,
    });
    for (const region of target.planned.composition.regions) {
      registerPlannedNode(plannedNodes, region.nodeId, {
        kind: "region",
        region,
        target,
      });
    }
  }

  let changed = false;
  const commands = input.commands.flatMap((command) => {
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
    if (command.node.kind !== "group" && command.node.kind !== "frame") {
      return command;
    }
    changed = true;
    return [
      {
        ...command,
        pageId: planned.target.planned.pageId,
        parentId: planned.target.planned.artboard.frameId,
        node: {
          ...command.node,
          parentId: planned.target.planned.artboard.frameId,
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
    throw new Error(
      "design_workflow.material_write_required: The planned artboard Frame is already allocated; add real editable content inside it instead of recreating the Frame",
    );
  }
  if (!changed) return input;
  const retainedCommandIds = new Set(
    commands.map((command) => command.commandId),
  );
  const steps = input.steps
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

function registerPlannedNode<T>(
  nodes: Map<string, T>,
  nodeId: string,
  value: T,
): void {
  if (nodes.has(nodeId)) {
    throw new Error(
      `design_workflow.plan_node_ambiguous: Planned node ID ${nodeId} is reused across delivery targets; inspect and define unique stable IDs`,
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
        throw new Error(
          "New design layers cannot be scattered outside the planned artboard Frame",
        );
      }
      if (command.type === "insert_element") {
        throw new Error(
          "The first design creation transaction must create the planned axis-aligned Page-root Frame at its declared position and dimensions",
        );
      }
      throw new Error(
        `Design command ${command.commandId} targets content outside every declared delivery artboard`,
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
      throw new Error(
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
      throw new Error(
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
        throw new Error(
          "Every new design layer must be nested under the planned artboard Frame",
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
      throw new Error(
        "New design layers cannot be scattered outside the planned artboard Frame",
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
    if (
      (command.node.kind !== "group" && command.node.kind !== "frame") ||
      command.parentId !== target.artboard.frameId ||
      command.node.parentId !== target.artboard.frameId ||
      command.node.transform[0] !== 1 ||
      command.node.transform[1] !== 0 ||
      command.node.transform[2] !== 0 ||
      command.node.transform[3] !== 1 ||
      command.node.transform[4] !== region.x ||
      command.node.transform[5] !== region.y ||
      command.node.size.width !== region.width ||
      command.node.size.height !== region.height
    ) {
      throw new Error(
        `Planned region ${region.nodeId} must be an axis-aligned Group or Frame directly inside the artboard at its declared bounds`,
      );
    }
    if (!insertedSubtreeHasMaterialNode(inserts, region.nodeId)) {
      throw new Error(
        `design_workflow.empty_region_draft: Planned region ${region.nodeId} must include at least one real editable content layer in the same transaction; do not commit empty Group or Frame scaffolding`,
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
  throw new Error(
    `design_workflow.empty_artboard_draft: The first transaction for ${target.artboard.frameId} must include at least one real editable content layer; do not commit an empty artboard and defer all visible content to a later call`,
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

function assertDeliveryAcceptsMaterialWrites(state: DesignWorkflowState): void {
  if (!nextIncompleteTarget(state)) {
    throw new Error(
      "design_workflow.delivery_already_verified: Every planned target is already verified; amend the plan before applying more material changes",
    );
  }
}

function assertReferenceStrategyMatchesRun(
  strategy: DesignReferenceStrategy | undefined,
  attachments: readonly AgentImageAttachment[],
): void {
  if (attachments.length > 0 && strategy === undefined) {
    throw new Error(
      "design_workflow.reference_strategy_required: Classify every attached image as a style, composition, brand, content, or ignored reference before writing the design",
    );
  }
  const authorized = new Set(
    attachments.map((attachment) => attachment.attachmentId),
  );
  const declared = new Set(
    strategy?.references.map((reference) => reference.attachmentId) ?? [],
  );
  const unknown = [...declared].find(
    (attachmentId) => !authorized.has(attachmentId),
  );
  const missing = [...authorized].find(
    (attachmentId) => !declared.has(attachmentId),
  );
  if (unknown || missing || declared.size !== authorized.size) {
    throw new Error(
      "design_workflow.reference_strategy_invalid: referenceStrategy must classify every image authorized for this Run exactly once and must not name images from another Run",
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
  };
}

function explicitlyRequestsSingleRaster(value: string): boolean {
  return (
    /\b(?:single|one|flattened|flat)\b.{0,40}\b(?:image|raster|bitmap|png|jpe?g|webp)\b/i.test(
      value,
    ) ||
    /(?:单张|一张|整张|扁平化|不可编辑).{0,20}(?:图片|图像|海报|PNG|JPE?G|WebP)/i.test(
      value,
    )
  );
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
