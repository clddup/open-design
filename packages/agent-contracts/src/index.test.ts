import { describe, expect, it } from "vitest";
import {
  AgentAttachmentContract,
  AgentRunContinuationContract,
  AgentRunFailureContract,
  DesignMutationTargetContract,
  ModelSelectionContract,
  SelectionScopeContract,
  isAgentAttachment,
  isAgentRunFailure,
  isDesignMutationTarget,
  isSelectionScope,
} from "./index.js";

const validStart = {
  type: "run.start",
  runId: "run_1",
  sessionId: "session_1",
  prompt: "Align the selected layers",
  documentId: "document_1",
  revision: 4,
  modelSelection: {
    providerId: "provider_1",
    modelId: "design-model",
    reasoningEffort: "medium",
  },
  modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
  scope: {
    kind: "selection",
    selectedNodeIds: ["node_1", "node_2"],
    primaryNodeId: "node_1",
    pageId: "page_1",
  },
  mutationTarget: { kind: "page", pageId: "page_1" },
} as const;

const invalidSelectionScope = {
  kind: "selection",
  selectedNodeIds: ["node_1"],
  primaryNodeId: "node_2",
} as const;

describe("Agent contracts", () => {
  it("exports one executable contract for each durable Agent value", () => {
    expect(ModelSelectionContract.parse(validStart.modelSelection).ok).toBe(
      true,
    );
    expect(
      AgentRunFailureContract.parse({
        code: "provider_timeout",
        message: "Provider timed out",
        retryable: true,
      }).ok,
    ).toBe(true);
    expect(
      AgentAttachmentContract.parse({
        attachmentId: `image_${"a".repeat(64)}`,
        name: "reference.png",
        mimeType: "image/png",
        byteSize: 1_024,
      }).ok,
    ).toBe(true);
    expect(SelectionScopeContract.parse(validStart.scope).ok).toBe(true);
    expect(
      DesignMutationTargetContract.parse(validStart.mutationTarget).ok,
    ).toBe(true);
    expect(
      AgentRunContinuationContract.parse({
        parentRunId: "run_parent",
        rootRunId: "run_root",
        attempt: 1,
        maxAttempts: 3,
        reason: "budget",
      }).ok,
    ).toBe(true);
  });

  it("reports precise structure paths from the eight contract facades", () => {
    const cases = [
      [ModelSelectionContract, { ...validStart.modelSelection, modelId: "" }],
      [
        AgentRunFailureContract,
        { code: "provider_timeout", message: "", retryable: true },
      ],
      [
        AgentAttachmentContract,
        {
          attachmentId: `image_${"a".repeat(64)}`,
          name: "reference.png",
          mimeType: "image/png",
          byteSize: 0,
        },
      ],
      [SelectionScopeContract, { kind: "selection", selectedNodeIds: [] }],
      [DesignMutationTargetContract, { kind: "page", pageId: "" }],
      [
        AgentRunContinuationContract,
        {
          parentRunId: "run_parent",
          rootRunId: "run_root",
          attempt: 4,
          maxAttempts: 3,
          reason: "budget",
        },
      ],
    ] as const;
    const expectedPaths = [
      "/modelId",
      "/message",
      "/byteSize",
      "/selectedNodeIds",
      "/pageId",
      "/attempt",
    ];

    cases.forEach(([contract, value], index) => {
      const result = contract.parse(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]?.path).toBe(expectedPaths[index]);
    });
  });

  it("routes thin boolean guards through the canonical contracts", () => {
    expect(
      isAgentRunFailure({
        code: "provider_error",
        message: "",
        retryable: true,
      }),
    ).toBe(false);
    expect(
      isAgentAttachment({
        attachmentId: `image_${"a".repeat(64)}`,
        name: "reference.png",
        mimeType: "image/png",
        byteSize: 0,
      }),
    ).toBe(false);
    expect(isDesignMutationTarget({ kind: "page", pageId: "" })).toBe(false);
  });

  it("centralizes the primary selection relationship", () => {
    expect(SelectionScopeContract.parse(invalidSelectionScope)).toMatchObject({
      ok: false,
      issues: [
        {
          code: "selection_scope.primary_node_not_selected",
          path: "/primaryNodeId",
        },
      ],
    });
    expect(isSelectionScope(invalidSelectionScope)).toBe(false);
  });
});
