import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentImageAttachment,
  ToolCallRequest,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import type { DesignOperation } from "@opendesign/design-contracts";
import type { DesignGenerationModelInput } from "@/shared/design-generation-tool-schema";
import { EditorRuntime } from "@opendesign/editor-runtime";
import { executeDesignToolRequest } from "@/renderer/features/design-tools/design-tool-execution";
import { createStarterProjectFiles } from "@/shared/project/starter-project";
import { ProjectHost } from "../project/project-host";
import { WorkspaceStore } from "../project/workspace-store";
import { GlobalTaskCoordinator } from "./global-task-coordinator";
import { parseDesignToolInput } from "./design-tool-input-parser";
import { handleDesignGenerationTool } from "./design-generation-tool-handler";
import { handleEditDesignTool } from "./design-edit-tool-handler";

export type DesignEditingFixture = Awaited<
  ReturnType<typeof setupDesignEditing>
>;

export async function setupDesignEditing(
  attachments: AgentImageAttachment[] = [],
) {
  const store = new WorkspaceStore(":memory:");
  const root = await mkdtemp(join(tmpdir(), "opendesign-plan-editing-"));
  const dispose = async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  };
  const host = new ProjectHost(store);
  const manifest = await host.createProject(
    join(root, "Design"),
    { projectId: "project", name: "Design" },
    createStarterProjectFiles("project"),
  );
  const { document } = await host.readDesignFile(
    "project",
    manifest.designFiles[0].designFileId,
  );
  store.createConversation({
    conversationId: "conversation",
    originProjectId: "project",
    filedProjectId: "project",
    title: "Design",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    lifecycle: "active",
  });
  const runtime = new EditorRuntime(document);
  const coordinator = new GlobalTaskCoordinator(host, store);
  const pageId = document.pageOrder[0];
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
    prompt: "Create a poster",
    modelSelection: { providerId: "mock", modelId: "mock" },
    attachments,
  });
  const execute = async (call: ToolCallRequest) => {
    const response = await executeDesignToolRequest(
      { requestId: call.toolCallId, call, context },
      runtime,
      pageId,
    );
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  };
  const inspect = async () =>
    coordinator.recordDocumentInspection(
      context,
      await execute({
        toolCallId: "inspect",
        toolName: "opendesign_inspect_document",
        input: {},
      }),
    );
  const accept = (result: TrustedToolResult) => {
    if (!result.designRevision)
      throw new Error("Expected a real committed revision");
    context.revision = result.designRevision.revision;
    coordinator.handleAgentEvent({
      type: "tool.completed",
      runId: context.runId,
      toolCallId: "write",
      revision: context.revision,
      result: result.content,
    });
  };
  return {
    host,
    store,
    runtime,
    coordinator,
    context,
    pageId,
    manifest,
    execute,
    inspect,
    accept,
    dispose,
  };
}

export async function generateDesign(
  fixture: DesignEditingFixture,
  metadata: Partial<
    Pick<DesignGenerationModelInput, "referenceStrategy" | "rasterAssetRoles">
  > = {},
) {
  await fixture.inspect();
  const call = {
    toolCallId: `generate_${fixture.context.revision}`,
    toolName: "opendesign_generate_design",
    input: {
      deliverable: "poster",
      targets: [{ frame: { width: 800, height: 600 } }],
      rasterAssetRoles: [],
      ...metadata,
      designGeneration: {
        label: "Create poster",
        elements: [
          {
            kind: "rectangle",
            id: "shape",
            name: "Shape",
            x: 24,
            y: 24,
            width: 80,
            height: 60,
            fills: [{ type: "solid", color: "#336699", opacity: 1 }],
          },
        ],
      },
    },
  };
  const parsed = parseDesignToolInput(
    fixture.coordinator,
    call,
    fixture.context,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const result = await handleDesignGenerationTool(
    fixture.coordinator,
    { execute: fixture.execute } as never,
    { ...call, input: parsed.value },
    fixture.context,
    fixture.context,
    new AbortController().signal,
  );
  fixture.accept(result);
  await fixture.inspect();
}

export async function editDesign(
  fixture: DesignEditingFixture,
  commands: DesignOperation[],
) {
  const result = await handleEditDesignTool({
    coordinator: fixture.coordinator,
    context: fixture.context,
    execute: fixture.execute,
    withDelivery: (value) => value,
    call: {
      toolCallId: `edit_${fixture.context.revision}`,
      toolName: "opendesign_edit_design",
      input: {
        label: "Edit current design",
        edits: [
          { kind: "node", input: { label: "Edit current design", commands } },
        ],
      },
    },
  });
  if (!result) throw new Error("Expected edit result");
  fixture.accept(result);
  await fixture.inspect();
  return result;
}
