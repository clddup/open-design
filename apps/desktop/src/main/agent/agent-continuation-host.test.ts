import { createEmptyDesignDocument } from "@opendesign/editor-runtime";
import type { AgentRequest } from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import { createContinuationRequest } from "./agent-continuation-host";
import type { AgentContinuationDecision } from "./agent-continuation-scheduler";

const source: Extract<AgentRequest, { type: "run.start" }> = {
  type: "run.start",
  runId: "run_old",
  sessionId: "conversation_1",
  prompt: "Build two pages",
  documentId: "document_1",
  revision: 4,
  scope: { kind: "page", pageId: "page_1", selectedNodeIds: ["old_node"] },
  mutationTarget: { kind: "page", pageId: "page_1" },
  modelSelection: { providerId: "provider_1", modelId: "design" },
};

function decision(): Extract<AgentContinuationDecision, { kind: "schedule" }> {
  return {
    kind: "schedule",
    source,
    nextRunId: "run_next",
    continuation: {
      parentRunId: "run_old",
      rootRunId: "run_old",
      attempt: 1,
      maxAttempts: 3,
      reason: "budget",
    },
  };
}

describe("Agent continuation request reconstruction", () => {
  it("reads the latest authoritative revision and clears stale selection", async () => {
    const document = {
      ...createEmptyDesignDocument("document_1", "page_1"),
      revision: 9,
    };
    const projectHost = {
      listOpenProjects: vi.fn(() => [
        {
          projectId: "project_1",
          designFiles: [
            {
              designFileId: "file_1",
              documentId: "document_1",
            },
          ],
        },
      ]),
      readDesignFile: vi.fn(() => Promise.resolve({ document })),
    };

    await expect(
      createContinuationRequest(decision(), projectHost),
    ).resolves.toMatchObject({
      runId: "run_next",
      sessionId: "conversation_1",
      documentId: "document_1",
      revision: 9,
      scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId: "page_1" },
      continuation: decision().continuation,
    });
    expect(projectHost.readDesignFile).toHaveBeenCalledWith(
      "project_1",
      "file_1",
    );
  });

  it("refuses continuation after its stable target Page was deleted", async () => {
    const document = createEmptyDesignDocument("document_1", "page_other");
    const projectHost = {
      listOpenProjects: () => [
        {
          projectId: "project_1",
          designFiles: [{ designFileId: "file_1", documentId: "document_1" }],
        },
      ],
      readDesignFile: () => Promise.resolve({ document }),
    };

    await expect(
      createContinuationRequest(decision(), projectHost),
    ).rejects.toThrow("target Page no longer exists");
  });
});
