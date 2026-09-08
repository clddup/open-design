import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  compileDesignGenerationToolInput,
  DesignGenerationContract,
} from "@/shared/design-agent-tools";
import { createStarterProjectFiles } from "@/shared/project/starter-project";
import { ProjectHost } from "../project/project-host";
import { WorkspaceStore } from "../project/workspace-store";
import { GlobalTaskCoordinator } from "./global-task-coordinator";
import {
  designGenerationInput,
  designGenerationModelInput,
} from "./design-generation-tool-handler.fixture";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "opendesign-run-completion-"));
  const store = new WorkspaceStore(":memory:");
  const host = new ProjectHost(store);
  const manifest = await host.createProject(
    join(root, "Design"),
    { projectId: "project", name: "Design" },
    createStarterProjectFiles("project"),
  );
  const file = manifest.designFiles[0];
  const { document } = await host.readDesignFile(
    manifest.projectId,
    file.designFileId,
  );
  const pageId = document.pageOrder[0];
  store.createConversation({
    conversationId: "conversation",
    originProjectId: "project",
    filedProjectId: "project",
    title: "Design",
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    lifecycle: "active",
  });
  const coordinator = new GlobalTaskCoordinator(host, store);
  const context = {
    runId: "run",
    sessionId: "conversation",
    documentId: document.documentId,
    revision: document.revision,
    scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
    mutationTarget: { kind: "page" as const, pageId },
  };
  await coordinator.registerRun({
    type: "run.start",
    ...context,
    prompt: "Create a home screen",
    modelSelection: { providerId: "mock", modelId: "mock" },
  });
  coordinator.recordDocumentInspection(context, {
    observedRevision: document.revision,
    content: {
      document: {
        ...document,
        assetsById: {},
        imageAssetDerivations: [],
        imageAssetDerivationsTruncated: false,
      },
    },
  });
  return { root, store, coordinator, context, pageId };
}

it("persists a completed Run without completing its unfinished design Plan", async () => {
  const { root, store, coordinator, context, pageId } = await setup();
  try {
    const fixture = designGenerationInput();
    const target = fixture.targets[0];
    const parsed = DesignGenerationContract.parse(
      designGenerationModelInput(fixture),
      {
        authoritativePrompt: "Create a home screen",
        target: {
          targetId: target.targetId,
          label: target.label,
          objective: target.objective,
          pageId,
          frame: { ...target.frame, x: 4000 },
        },
      },
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    coordinator.registerDesignPlan(
      context,
      compileDesignGenerationToolInput(parsed.value).plan,
    );
    const delivery = coordinator.getDeliveryLedger(context.runId);
    expect(
      delivery?.planExecution?.targets[0].steps.some(
        (step) => step.status !== "completed",
      ),
    ).toBe(true);
    coordinator.handleAgentEvent({
      type: "run.completed",
      runId: context.runId,
      stopReason: "complete",
      finishedAt: "2026-09-08T00:01:00.000Z",
    });
    const saved = store
      .listGlobalTasks()
      .find((task) => task.runId === context.runId);
    expect(saved?.lifecycle).toBe("completed");
    expect(saved?.delivery).toEqual(delivery);
    expect(
      saved?.delivery?.targets.some((target) => target.status === "verified"),
    ).toBe(false);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
