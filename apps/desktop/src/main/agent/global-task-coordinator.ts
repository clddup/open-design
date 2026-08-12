import type {
  AgentEvent,
  AgentRequest,
  DesignMutationTarget,
  SelectionScope,
} from "@opendesign/agent-contracts";
import type {
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import type {
  DesignDocument,
  DesignOperation,
  Transform,
} from "@opendesign/design-contracts";
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
  designApplyRequiresPlan,
  designPlanTargets,
  type DesignApplyToolInput,
  type DesignComponentToolInput,
  type DesignPlanTarget,
  type DesignPlanToolInput,
  type DesignVisualReviewToolInput,
  type PlannedDesignRebaseGuard,
  type PlaceableRasterAssetRole,
  type RasterAssetRole,
} from "../../shared/design-agent-tools.js";
import type { RendererDesignCaptureTarget } from "../../shared/design-tool-bridge.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;
type RunScopedEvent = AgentEvent & { runId: string };

type InspectedHierarchy = {
  documentId: string;
  nodesById: Map<
    string,
    {
      childIds: string[];
      id: string;
      kind: string;
      locked: boolean;
      parentId: string | null;
    }
  >;
  pageRootsById: Map<string, Set<string>>;
  revision: number;
};

type DesignDeliveryTargetState = {
  artboardDescendantIds: Set<string>;
  artboardEstablished: boolean;
  captureCount: number;
  delivery: DesignDeliveryTarget;
  lastCaptureRevision: number | null;
  lastMaterialWriteRevision: number | null;
  lastReview: DesignVisualReviewToolInput | null;
  planned: DesignPlanTarget;
  reviewedCaptureCount: number;
  reviewedCaptureRevision: number | null;
};

type DesignWorkflowState = {
  plan: DesignPlanToolInput;
  targetOrder: string[];
  targetsById: Map<string, DesignDeliveryTargetState>;
};

export type DesignPlanApplyAuthorization = {
  input: DesignApplyToolInput;
  plan: DesignPlanToolInput;
  rebaseGuard?: PlannedDesignRebaseGuard;
  targetIds: string[];
};

const activeLifecycles = new Set<GlobalTaskLifecycle>([
  "queued",
  "running",
  "waiting_approval",
]);

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
    { approvalId: string; toolCallId: string }
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
    if (match.project.projectId !== conversation.homeProjectId) {
      throw new Error("Cross-project Agent targets require an explicit grant");
    }
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
      homeProjectId: conversation.homeProjectId,
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
      prompt: request.prompt,
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

  grantPageStructureAccess(
    runId: string,
    approvalId: string,
    toolCallId: string,
  ): void {
    if (!this.#toolBindingsByRunId.has(runId)) {
      throw new Error(
        "Page structure access requires an active registered Run",
      );
    }
    this.#pageStructureAccessByRunId.set(runId, {
      approvalId,
      toolCallId,
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
      input.action === "rename" &&
      input.pageId === binding.mutationTarget.pageId
    ) {
      return;
    }
    throw new Error(
      "design_workflow.page_structure_access_required: Call opendesign_request_page_structure_access and wait for the user's one-time approval before modifying Page structure or another Page",
    );
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
  ): void {
    this.assertDesignToolContext(context);
    const inspection = this.#requireDocumentInspection(context);
    const existingPlan = this.#designPlansByRunId.get(context.runId);
    if (
      existingPlan &&
      [...existingPlan.targetsById.values()].some(
        (target) => target.delivery.status !== "pending",
      )
    ) {
      throw new Error(
        "The design plan cannot be replaced after material design writes have started",
      );
    }
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) throw new Error("Design plan requires an active Run");
    const targets = designPlanTargets(plan);
    assertUniquePlannedNodeIds(targets);
    const recoverableDelivery = this.getRecoverableDelivery(context);
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
    const targetsById = new Map<string, DesignDeliveryTargetState>();
    for (const target of targets) {
      if (
        target.artboard.mode === "create" &&
        inspection.nodesById.has(target.artboard.frameId)
      ) {
        throw new Error(
          `design_workflow.artboard_already_exists: Planned create target ${target.artboard.frameId} already exists; inspect it as an existing artboard instead`,
        );
      }
      const artboardDescendantIds =
        target.artboard.mode === "existing"
          ? resolveExistingArtboardDescendants(inspection, target)
          : new Set<string>();
      const recovered = recoverableDelivery?.targets.find(
        (candidate) =>
          candidate.targetId === target.targetId &&
          candidate.pageId === target.pageId &&
          candidate.rootNodeId === target.artboard.frameId,
      );
      const recoveredDelivery = recoverDeliveryTarget(
        target,
        recovered,
        inspection.revision,
        target.artboard.mode === "existing",
      );
      targetsById.set(target.targetId, {
        artboardEstablished: target.artboard.mode === "existing",
        artboardDescendantIds,
        captureCount: 0,
        delivery: recoveredDelivery,
        lastCaptureRevision: null,
        lastMaterialWriteRevision:
          recoveredDelivery.status === "drafted"
            ? (recoveredDelivery.draftRevision ?? null)
            : null,
        lastReview: null,
        planned: structuredClone(target),
        reviewedCaptureCount: 0,
        reviewedCaptureRevision: null,
      });
    }
    const state: DesignWorkflowState = {
      plan: structuredClone(plan),
      targetOrder: targets.map((target) => target.targetId),
      targetsById,
    };
    this.#designPlansByRunId.set(context.runId, state);
    this.#generatedRasterRolesByRunId.set(context.runId, new Map());
    this.#persistDelivery(context.runId, state);
  }

  recordDocumentInspection(
    context: TrustedToolContext,
    result: TrustedToolResult,
  ): void {
    this.assertDesignToolContext(context);
    this.#inspectionsByRunId.set(
      context.runId,
      parseInspectedHierarchy(context, result),
    );
  }

  assertDocumentInspected(context: TrustedToolContext): void {
    this.#requireDocumentInspection(context);
  }

  recordCanvasCapture(
    context: TrustedToolContext,
    observedRevision = context.revision,
    layoutQuality?: DesignLayoutQualityReport,
  ) {
    this.assertDesignToolContext(context);
    if (!Number.isSafeInteger(observedRevision) || observedRevision < 0) {
      throw new Error(
        "design_workflow.capture_revision_invalid: The rendered capture returned an invalid document revision; capture the current canvas again",
      );
    }
    const state = this.#designPlansByRunId.get(context.runId);
    const target = state ? nextCaptureTarget(state) : undefined;
    if (!state || !target || target.delivery.status === "pending") {
      return {
        capturedRevision: observedRevision,
        nextAction: state ? "write-capture" : "define-plan-write-capture",
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
    if (target.delivery.status === "refined") {
      const inspection = this.#inspectionsByRunId.get(context.runId);
      if (!inspection || inspection.revision !== observedRevision) {
        throw new Error(
          "design_workflow.delivery_verification_required: Final delivery verification requires an authoritative document inspection from the exact captured revision; inspect and capture the current target again",
        );
      }
      assertDeliveryTargetStructure(inspection, target);
      if (layoutQuality.errorCount > 0) {
        const failures = layoutQuality.issues
          .filter((issue) => issue.severity === "error")
          .slice(0, 8)
          .map((issue) => `${issue.code} (${issue.nodeId}): ${issue.message}`)
          .join("; ");
        throw new Error(
          `design_workflow.layout_quality_failed: Final delivery target ${target.delivery.targetId} has ${layoutQuality.errorCount} deterministic layout error(s): ${failures}. Correct the reported nodes, inspect the current document, and capture this target again`,
        );
      }
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

  registerVisualReview(
    context: TrustedToolContext,
    review: DesignVisualReviewToolInput,
  ): void {
    const state = this.#requireDesignPlan(context);
    const target = firstTargetWithStatus(state, "captured");
    if (!target) {
      if (
        [...state.targetsById.values()].some(
          (candidate) => candidate.delivery.status !== "pending",
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
    target.lastReview = structuredClone(review);
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

  assertDesignPlanForImagePlacement(
    context: TrustedToolContext,
    role: PlaceableRasterAssetRole,
    parentId: string | null,
    attachmentId?: string,
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
    return state.plan;
  }

  assertDesignPlanForApply(
    context: TrustedToolContext,
    input: DesignApplyToolInput,
  ): DesignPlanApplyAuthorization | undefined {
    const state = this.#designPlansByRunId.get(context.runId);
    if (!state) {
      if (!designApplyRequiresPlan(input)) return undefined;
      this.#requireDesignPlan(context);
      return undefined;
    }
    const resolvedInput = resolvePlannedStructureGeometry(input, state);
    const targetIds = [...assertPlannedTargetWrites(resolvedInput, state)];
    if (designApplyRequiresPlan(resolvedInput) && targetIds.length === 0) {
      throw new Error(
        "Material design commands must target a declared delivery artboard",
      );
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
    return [...targets];
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
          task.lifecycle !== "completed",
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
        status: "drafted",
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
    const task = this.#tasksByRunId.get(runId);
    if (!task) return;
    const activityAt = conversationActivityAt(event, this.now);
    if (activityAt) this.#touchConversation(task.conversationId, activityAt);
    const lifecycle = projectLifecycle({ ...event, runId }, task.lifecycle);
    if (lifecycle === task.lifecycle) return;
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
    if (event.type === "run.completed" || event.type === "agent.error") {
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

function parseInspectedHierarchy(
  context: TrustedToolContext,
  result: TrustedToolResult,
): InspectedHierarchy {
  if (!validRevision(result.observedRevision)) {
    throw new Error(
      "design_workflow.inspection_invalid: Document inspection did not return a valid observed revision; inspect again",
    );
  }
  const content = recordValue(result.content);
  const document = recordValue(content?.document);
  if (
    !document ||
    document.documentId !== context.documentId ||
    document.revision !== result.observedRevision
  ) {
    throw new Error(
      "design_workflow.inspection_invalid: Document inspection identity or revision is invalid; inspect again",
    );
  }
  const rawPages = recordValue(document.pagesById);
  const rawNodes = recordValue(document.nodesById);
  if (!rawPages || !rawNodes) {
    throw new Error(
      "design_workflow.inspection_invalid: Document inspection hierarchy is missing; inspect again",
    );
  }
  const pageRootsById = new Map<string, Set<string>>();
  for (const [pageId, value] of Object.entries(rawPages)) {
    const page = recordValue(value);
    if (
      !page ||
      page.id !== pageId ||
      !Array.isArray(page.rootNodeIds) ||
      !page.rootNodeIds.every(safeHierarchyId) ||
      new Set(page.rootNodeIds).size !== page.rootNodeIds.length
    ) {
      throw new Error(
        "design_workflow.inspection_invalid: Document inspection contains an invalid Page hierarchy; inspect again",
      );
    }
    pageRootsById.set(pageId, new Set(page.rootNodeIds));
  }
  const nodesById = new Map<
    string,
    {
      childIds: string[];
      id: string;
      kind: string;
      locked: boolean;
      parentId: string | null;
    }
  >();
  for (const [nodeId, value] of Object.entries(rawNodes)) {
    const node = recordValue(value);
    if (
      !node ||
      node.id !== nodeId ||
      !safeHierarchyId(nodeId) ||
      typeof node.kind !== "string" ||
      typeof node.locked !== "boolean" ||
      !Array.isArray(node.childIds) ||
      !node.childIds.every(safeHierarchyId) ||
      new Set(node.childIds).size !== node.childIds.length ||
      !(
        node.parentId === null ||
        (typeof node.parentId === "string" && safeHierarchyId(node.parentId))
      )
    ) {
      throw new Error(
        "design_workflow.inspection_invalid: Document inspection contains an invalid node hierarchy; inspect again",
      );
    }
    nodesById.set(nodeId, {
      childIds: [...node.childIds],
      id: nodeId,
      kind: node.kind,
      locked: node.locked,
      parentId: node.parentId,
    });
  }
  for (const node of nodesById.values()) {
    if (node.parentId !== null && !nodesById.has(node.parentId)) {
      throw new Error(
        `design_workflow.inspection_invalid: Document inspection is missing parent ${node.parentId}; inspect again`,
      );
    }
    for (const childId of node.childIds) {
      if (nodesById.get(childId)?.parentId !== node.id) {
        throw new Error(
          `design_workflow.inspection_invalid: Document inspection contains inconsistent child ${childId}; inspect again`,
        );
      }
    }
    assertAcyclicInspectedParentChain(nodesById, node.id);
  }
  for (const roots of pageRootsById.values()) {
    for (const rootId of roots) {
      if (nodesById.get(rootId)?.parentId !== null) {
        throw new Error(
          "design_workflow.inspection_invalid: Document inspection contains an invalid Page root; inspect again",
        );
      }
    }
  }
  return {
    documentId: context.documentId,
    nodesById,
    pageRootsById,
    revision: result.observedRevision,
  };
}

function resolveExistingArtboardDescendants(
  inspection: InspectedHierarchy,
  target: DesignPlanTarget,
): Set<string> {
  const frameId = target.artboard.frameId;
  const frame = inspection.nodesById.get(frameId);
  if (!frame || frame.kind !== "frame") {
    throw new Error(
      `design_workflow.existing_artboard_invalid: Existing artboard ${frameId} is missing or is not a Frame; inspect again and choose an existing Frame`,
    );
  }
  if (!inspectedNodeBelongsToPage(inspection, target.pageId, frameId)) {
    throw new Error(
      `design_workflow.existing_artboard_invalid: Existing artboard ${frameId} does not belong to Page ${target.pageId}; inspect again and choose a Frame on the target Page`,
    );
  }
  const descendants = new Set<string>();
  for (const node of inspection.nodesById.values()) {
    if (node.id === frameId) continue;
    if (inspectedParentChainReaches(inspection.nodesById, node.id, frameId)) {
      descendants.add(node.id);
    }
  }
  return descendants;
}

function inspectedNodeBelongsToPage(
  inspection: InspectedHierarchy,
  pageId: string,
  nodeId: string,
): boolean {
  const roots = inspection.pageRootsById.get(pageId);
  if (!roots) return false;
  let current: string | null = nodeId;
  const visited = new Set<string>();
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const node = inspection.nodesById.get(current);
    if (!node) return false;
    if (node.parentId === null) return roots.has(node.id);
    current = node.parentId;
  }
  return false;
}

function inspectedParentChainReaches(
  nodesById: InspectedHierarchy["nodesById"],
  nodeId: string,
  ancestorId: string,
): boolean {
  let current = nodesById.get(nodeId)?.parentId ?? null;
  const visited = new Set<string>();
  while (current !== null && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = nodesById.get(current)?.parentId ?? null;
  }
  return false;
}

function assertDeliveryTargetStructure(
  inspection: InspectedHierarchy,
  target: DesignDeliveryTargetState,
): void {
  const artboardId = target.planned.artboard.frameId;
  const artboard = inspection.nodesById.get(artboardId);
  if (
    !artboard ||
    artboard.kind !== "frame" ||
    !inspectedNodeBelongsToPage(inspection, target.planned.pageId, artboardId)
  ) {
    throw new Error(
      `design_workflow.delivery_structure_incomplete: Delivery target ${target.delivery.targetId} requires Frame ${artboardId} on Page ${target.planned.pageId}; inspect the current document and finish that target before capturing again`,
    );
  }
  if (target.planned.artboard.mode === "existing") {
    if (!inspectedSubtreeHasMaterialNode(inspection.nodesById, artboardId)) {
      throw new Error(
        `design_workflow.delivery_structure_incomplete: Existing delivery artboard ${artboardId} has no real editable content; add or refine material layers inside the artboard before capturing again`,
      );
    }
    return;
  }
  for (const region of target.planned.composition.regions) {
    const regionNode = inspection.nodesById.get(region.nodeId);
    if (
      !regionNode ||
      (regionNode.kind !== "group" && regionNode.kind !== "frame") ||
      regionNode.parentId !== artboardId
    ) {
      throw new Error(
        `design_workflow.delivery_structure_incomplete: Planned region ${region.nodeId} must be a direct Group or Frame child of delivery artboard ${artboardId}; inspect the current document and finish that region before capturing again`,
      );
    }
    if (!inspectedSubtreeHasMaterialNode(inspection.nodesById, region.nodeId)) {
      throw new Error(
        `design_workflow.delivery_structure_incomplete: Planned region ${region.nodeId} is empty; add real editable design content before capturing the target again`,
      );
    }
  }
}

function assertLayoutQualityMatchesCapture(
  context: TrustedToolContext,
  target: DesignDeliveryTargetState,
  observedRevision: number,
  layoutQuality: DesignLayoutQualityReport,
): void {
  if (
    layoutQuality.documentId !== context.documentId ||
    layoutQuality.revision !== observedRevision ||
    layoutQuality.pageId !== target.planned.pageId ||
    layoutQuality.artboardFrameId !== target.planned.artboard.frameId
  ) {
    throw new Error(
      "design_workflow.layout_quality_unavailable: The deterministic layout-quality report does not match the current delivery document, revision, Page, and Frame; inspect and capture the current target again",
    );
  }
}

function inspectedSubtreeHasMaterialNode(
  nodesById: InspectedHierarchy["nodesById"],
  rootId: string,
): boolean {
  const pending = [...(nodesById.get(rootId)?.childIds ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) continue;
    if (node.kind !== "group" && node.kind !== "frame") return true;
    pending.push(...node.childIds);
  }
  return false;
}

function assertAcyclicInspectedParentChain(
  nodesById: InspectedHierarchy["nodesById"],
  nodeId: string,
): void {
  let current: string | null = nodeId;
  const visited = new Set<string>();
  while (current !== null) {
    if (visited.has(current)) {
      throw new Error(
        "design_workflow.inspection_invalid: Document inspection contains a parent cycle; inspect again after repairing the document",
      );
    }
    visited.add(current);
    current = nodesById.get(current)?.parentId ?? null;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeHierarchyId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
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
  const commands = input.commands.map((command) => {
    if (command.type !== "insert_element") return command;
    const planned = plannedNodes.get(command.node.id);
    if (!planned) return command;
    if (planned.kind === "artboard") {
      if (command.node.kind !== "frame") return command;
      const { artboard } = planned.target.planned;
      changed = true;
      return {
        ...command,
        pageId: planned.target.planned.pageId,
        parentId: null,
        node: {
          ...command.node,
          parentId: null,
          transform: [1, 0, 0, 1, artboard.x, artboard.y] as Transform,
          size: { width: artboard.width, height: artboard.height },
        },
      };
    }
    if (command.node.kind !== "group" && command.node.kind !== "frame") {
      return command;
    }
    changed = true;
    return {
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
    };
  });
  return changed ? { ...input, commands } : input;
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

function assertUniquePlannedNodeIds(
  targets: readonly DesignPlanTarget[],
): void {
  const ids = new Set<string>();
  for (const target of targets) {
    const plannedNodeIds = [
      target.artboard.frameId,
      ...target.composition.regions.map((region) => region.nodeId),
    ];
    for (const nodeId of plannedNodeIds) {
      if (ids.has(nodeId)) {
        throw new Error(
          `design_workflow.plan_node_ambiguous: Planned node ID ${nodeId} is reused across delivery targets; inspect and define unique stable IDs`,
        );
      }
      ids.add(nodeId);
    }
  }
}

function assertPlannedTargetWrites(
  input: DesignApplyToolInput,
  state: DesignWorkflowState,
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
          (candidate) => candidate.artboardEstablished,
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
    assertPlannedArtboardWrite(input, target);
  }
  return targetIds;
}

function assertPlannedArtboardWrite(
  input: DesignApplyToolInput,
  state: DesignDeliveryTargetState,
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
  if (!state.artboardEstablished) {
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

function recoverDeliveryTarget(
  target: DesignPlanTarget,
  recovered: DesignDeliveryTarget | undefined,
  currentRevision: number,
  artboardExists: boolean,
): DesignDeliveryTarget {
  const pending: DesignDeliveryTarget = {
    targetId: target.targetId,
    label: target.label,
    pageId: target.pageId,
    rootNodeId: target.artboard.frameId,
    status: "pending",
  };
  if (!recovered || !artboardExists || recovered.status === "pending") {
    return pending;
  }
  if (
    recovered.status === "verified" &&
    recovered.verifiedRevision === currentRevision
  ) {
    return { ...structuredClone(recovered), label: target.label };
  }
  return {
    ...pending,
    status: "drafted",
    draftRevision: currentRevision,
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

function conversationActivityAt(
  event: AgentEvent,
  now: () => Date,
): string | null {
  if (event.type === "run.started") return event.startedAt;
  if (event.type === "run.completed") return event.finishedAt;
  if (
    event.type === "message.completed" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "agent.error"
  ) {
    return now().toISOString();
  }
  return null;
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

function projectLifecycle(
  event: RunScopedEvent,
  current: GlobalTaskLifecycle,
): GlobalTaskLifecycle {
  if (event.type === "run.started") return "running";
  if (event.type === "approval.requested") return "waiting_approval";
  if (event.type === "approval.resolved") return "running";
  if (event.type === "tool.failed" && isConflictCode(event.code)) {
    return "conflict";
  }
  if (event.type === "agent.error") return "failed";
  if (event.type !== "run.completed") return current;
  if (event.stopReason === "complete") return "completed";
  if (event.stopReason === "cancelled") return "cancelled";
  return "failed";
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

function isConflictCode(code: string): boolean {
  return ["conflict", "revision", "stale"].some((part) =>
    code.toLowerCase().includes(part),
  );
}

function validRevision(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}
