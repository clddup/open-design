import type {
  AgentEvent,
  AgentRequest,
  DesignMutationTarget,
  SelectionScope,
} from "@opendesign/agent-contracts";
import type { TrustedToolContext } from "@opendesign/agent-runtime";
import type { DesignDocument } from "@opendesign/design-contracts";
import {
  WORKSPACE_CONTRACT_VERSION,
  type GlobalTaskLifecycle,
  type GlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import type { ProjectHost } from "../project/project-host.js";
import type { WorkspaceStore } from "../project/workspace-store.js";
import {
  designApplyRequiresPlan,
  type DesignApplyToolInput,
  type DesignPlanToolInput,
  type DesignVisualReviewToolInput,
  type PlaceableRasterAssetRole,
  type RasterAssetRole,
} from "../../shared/design-agent-tools.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;
type RunScopedEvent = AgentEvent & { runId: string };

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
  readonly #designPlansByRunId = new Map<
    string,
    {
      artboardEstablished: boolean;
      artboardDescendantIds: Set<string>;
      captureCount: number;
      lastCaptureRevision: number | null;
      lastReview: DesignVisualReviewToolInput | null;
      lastMaterialWriteRevision: number | null;
      materialWriteCompleted: boolean;
      plan: DesignPlanToolInput;
      reviewedCaptureCount: number;
      reviewedCaptureRevision: number | null;
    }
  >();
  readonly #generatedRasterRolesByRunId = new Map<
    string,
    Map<string, RasterAssetRole>
  >();
  readonly #inspectedRuns = new Set<string>();

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

  registerDesignPlan(
    context: TrustedToolContext,
    plan: DesignPlanToolInput,
  ): void {
    this.assertDesignToolContext(context);
    if (!this.#inspectedRuns.has(context.runId)) {
      throw new Error(
        "Inspect the bound design document before defining a design plan",
      );
    }
    const existingPlan = this.#designPlansByRunId.get(context.runId);
    if (existingPlan?.materialWriteCompleted) {
      throw new Error(
        "The design plan cannot be replaced after material design writes have started",
      );
    }
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) throw new Error("Design plan requires an active Run");
    const targetPageId =
      binding.mutationTarget.kind === "page"
        ? binding.mutationTarget.pageId
        : binding.scope.pageId;
    if (!targetPageId || plan.pageId !== targetPageId) {
      throw new Error("Design plan Page does not match the registered Run");
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
    this.#designPlansByRunId.set(context.runId, {
      artboardEstablished: plan.artboard.mode === "existing",
      artboardDescendantIds: new Set(),
      captureCount: 0,
      lastCaptureRevision: null,
      lastReview: null,
      lastMaterialWriteRevision: null,
      materialWriteCompleted: false,
      plan: structuredClone(plan),
      reviewedCaptureCount: 0,
      reviewedCaptureRevision: null,
    });
    this.#generatedRasterRolesByRunId.set(context.runId, new Map());
  }

  recordDocumentInspection(context: TrustedToolContext): void {
    this.assertDesignToolContext(context);
    this.#inspectedRuns.add(context.runId);
  }

  assertDocumentInspected(context: TrustedToolContext): void {
    this.assertDesignToolContext(context);
    if (!this.#inspectedRuns.has(context.runId)) {
      throw new Error(
        "Inspect the bound design document before using stable design targets",
      );
    }
  }

  recordCanvasCapture(
    context: TrustedToolContext,
    observedRevision = context.revision,
  ):
    | {
        capturedRevision: number;
        nextAction: "define-plan-write-capture" | "write-capture";
        reviewEligible: false;
      }
    | {
        captureSequence: number;
        capturedRevision: number;
        nextAction: "record-visual-review";
        reviewEligible: true;
      } {
    this.assertDesignToolContext(context);
    if (!Number.isSafeInteger(observedRevision) || observedRevision < 0) {
      throw new Error(
        "design_workflow.capture_revision_invalid: The rendered capture returned an invalid document revision; capture the current canvas again",
      );
    }
    const state = this.#designPlansByRunId.get(context.runId);
    if (!state?.materialWriteCompleted) {
      return {
        capturedRevision: observedRevision,
        nextAction: state ? "write-capture" : "define-plan-write-capture",
        reviewEligible: false,
      };
    }
    if (
      state.lastMaterialWriteRevision !== null &&
      observedRevision < state.lastMaterialWriteRevision
    ) {
      throw new Error(
        "design_workflow.capture_revision_invalid: The rendered capture predates the latest material design revision; capture the current canvas again",
      );
    }
    const captureSequence = state.captureCount + 1;
    this.#designPlansByRunId.set(context.runId, {
      ...state,
      captureCount: captureSequence,
      lastCaptureRevision: observedRevision,
    });
    return {
      captureSequence,
      capturedRevision: observedRevision,
      nextAction: "record-visual-review",
      reviewEligible: true,
    };
  }

  registerVisualReview(
    context: TrustedToolContext,
    review: DesignVisualReviewToolInput,
  ): void {
    const state = this.#requireDesignPlan(context);
    if (!state.materialWriteCompleted) {
      throw new Error(
        "design_workflow.material_write_required: Apply one successful material design transaction from the accepted plan, then call opendesign_capture_canvas before recording a visual review; do not retry the review yet",
      );
    }
    if (state.captureCount <= state.reviewedCaptureCount) {
      throw new Error(
        "design_workflow.capture_required: Call opendesign_capture_canvas once after the latest material design write, then record the visual review from that returned image; do not retry the review before capturing",
      );
    }
    if (
      state.lastCaptureRevision === null ||
      (state.lastMaterialWriteRevision !== null &&
        state.lastCaptureRevision < state.lastMaterialWriteRevision)
    ) {
      throw new Error(
        "design_workflow.capture_revision_invalid: The latest rendered capture predates the latest material design revision; capture the current canvas again before recording the review",
      );
    }
    this.#designPlansByRunId.set(context.runId, {
      ...state,
      lastReview: structuredClone(review),
      reviewedCaptureCount: state.captureCount,
      reviewedCaptureRevision: state.lastCaptureRevision,
    });
  }

  assertVisualReviewBeforeWrite(context: TrustedToolContext): void {
    const state = this.#designPlansByRunId.get(context.runId);
    if (
      state?.materialWriteCompleted &&
      state.captureCount > state.reviewedCaptureCount
    ) {
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
    if (!state.artboardEstablished) {
      throw new Error(
        "Image placement requires the planned artboard Frame to be created first",
      );
    }
    if (parentId !== state.plan.artboard.frameId) {
      throw new Error(
        "Design images must be placed inside the planned artboard Frame",
      );
    }
    return state.plan;
  }

  assertDesignPlanForApply(
    context: TrustedToolContext,
    input: DesignApplyToolInput,
  ): DesignPlanToolInput | undefined {
    if (!designApplyRequiresPlan(input)) return undefined;
    const state = this.#requireDesignPlan(context);
    assertPlannedArtboardWrite(input, state);
    return state.plan;
  }

  recordDesignApplyCompleted(
    runId: string,
    input: DesignApplyToolInput,
    revision?: number,
  ): void {
    const state = this.#designPlansByRunId.get(runId);
    if (!state) return;
    const artboardEstablished =
      state.artboardEstablished ||
      input.commands.some(
        (command) =>
          command.type === "insert_element" &&
          command.node.id === state.plan.artboard.frameId &&
          command.node.kind === "frame",
      );
    const artboardDescendantIds = new Set(state.artboardDescendantIds);
    input.commands.forEach((command) => {
      if (
        command.type === "insert_element" &&
        command.node.id !== state.plan.artboard.frameId
      ) {
        artboardDescendantIds.add(command.node.id);
      }
    });
    this.#designPlansByRunId.set(runId, {
      ...state,
      artboardEstablished,
      artboardDescendantIds,
      lastMaterialWriteRevision: validRevision(revision)
        ? revision
        : state.lastMaterialWriteRevision,
      materialWriteCompleted: true,
    });
  }

  recordMaterialDesignWriteCompleted(runId: string, revision?: number): void {
    const state = this.#designPlansByRunId.get(runId);
    if (!state) return;
    this.#designPlansByRunId.set(runId, {
      ...state,
      lastMaterialWriteRevision: validRevision(revision)
        ? revision
        : state.lastMaterialWriteRevision,
      materialWriteCompleted: true,
    });
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
      this.#inspectedRuns.delete(runId);
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
      this.#inspectedRuns.delete(runId);
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
}

function assertPlannedArtboardWrite(
  input: DesignApplyToolInput,
  state: {
    artboardEstablished: boolean;
    artboardDescendantIds: Set<string>;
    captureCount: number;
    lastCaptureRevision: number | null;
    lastReview: DesignVisualReviewToolInput | null;
    lastMaterialWriteRevision: number | null;
    materialWriteCompleted: boolean;
    plan: DesignPlanToolInput;
    reviewedCaptureCount: number;
    reviewedCaptureRevision: number | null;
  },
): void {
  const inserts = input.commands.filter(
    (command) => command.type === "insert_element",
  );
  const { artboard, pageId } = state.plan;
  if (inserts.length === 0) {
    if (
      !state.artboardEstablished &&
      input.commands.some((command) => command.type === "replace_subtree")
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
    assertPlannedRegionWrites(inserts, state.plan);
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
  assertPlannedRegionWrites(inserts, state.plan);
}

function assertPlannedRegionWrites(
  inserts: readonly Extract<
    DesignApplyToolInput["commands"][number],
    { type: "insert_element" }
  >[],
  plan: DesignPlanToolInput,
): void {
  const regionsById = new Map(
    plan.composition.regions.map((region) => [region.nodeId, region]),
  );
  for (const command of inserts) {
    const region = regionsById.get(command.node.id);
    if (!region) continue;
    if (
      (command.node.kind !== "group" && command.node.kind !== "frame") ||
      command.parentId !== plan.artboard.frameId ||
      command.node.parentId !== plan.artboard.frameId ||
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
  }
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
