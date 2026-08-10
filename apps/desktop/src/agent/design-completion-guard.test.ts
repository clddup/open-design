import type {
  AgentCompletionContext,
  AgentToolCallRecord,
} from "@opendesign/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
} from "../shared/design-agent-tools";
import { reviewDesignCompletion } from "./design-completion-guard";

const materialWrite: AgentToolCallRecord = {
  toolCallId: "write_1",
  toolName: DESIGN_APPLY_TOOL_NAME,
  input: {
    label: "Build mascot",
    commands: [{ type: "insert_element" }, { type: "insert_element" }],
  },
  status: "completed",
  revision: 5,
};

const firstCapture: AgentToolCallRecord = {
  toolCallId: "capture_1",
  toolName: DESIGN_CAPTURE_TOOL_NAME,
  input: {},
  status: "completed",
  revision: 5,
};

const refinementWrite: AgentToolCallRecord = {
  toolCallId: "write_2",
  toolName: DESIGN_APPLY_TOOL_NAME,
  input: {
    label: "Refine mascot silhouette",
    commands: [{ type: "update_properties" }],
  },
  status: "completed",
  revision: 6,
};

const finalCapture: AgentToolCallRecord = {
  toolCallId: "capture_2",
  toolName: DESIGN_CAPTURE_TOOL_NAME,
  input: {},
  status: "completed",
  revision: 6,
};

function context(toolCalls: AgentToolCallRecord[]): AgentCompletionContext {
  return {
    request: {
      runId: "run_1",
      sessionId: "conversation_1",
      prompt: "Design a mascot",
      documentId: "document_1",
      revision: 4,
      scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId: "page_1" },
      modelSelection: {
        providerId: "mock",
        modelId: "design",
        reasoningEffort: "medium",
      },
    },
    currentRevision: toolCalls.at(-1)?.revision ?? 4,
    turn: 4,
    rejectionCount: 0,
    toolCalls,
  };
}

function expectBlocked(
  toolCalls: AgentToolCallRecord[],
  message: string,
): void {
  const result = reviewDesignCompletion(context(toolCalls));
  expect(result.allow).toBe(false);
  if (result.allow) throw new Error("Expected completion to be blocked");
  expect(result.message).toContain(message);
}

describe("design completion guard", () => {
  it("allows non-material conversations to finish normally", () => {
    expect(reviewDesignCompletion(context([]))).toEqual({ allow: true });
  });

  it("requires capture, refinement, and a final capture in order", () => {
    expectBlocked([materialWrite], "opendesign_capture_canvas");
    expectBlocked(
      [materialWrite, firstCapture],
      "concrete refinement transaction",
    );
    expectBlocked([materialWrite, firstCapture, refinementWrite], "again");
    expect(
      reviewDesignCompletion(
        context([materialWrite, firstCapture, refinementWrite, finalCapture]),
      ),
    ).toEqual({ allow: true });
  });

  it("treats placing a generated image as a material canvas write", () => {
    const placeImage: AgentToolCallRecord = {
      toolCallId: "place_1",
      toolName: PLACE_IMAGE_TOOL_NAME,
      input: { attachmentId: `image_${"a".repeat(64)}` },
      status: "completed",
      revision: 5,
    };

    expectBlocked([placeImage], "opendesign_capture_canvas");
    expect(
      reviewDesignCompletion(
        context([placeImage, firstCapture, refinementWrite, finalCapture]),
      ),
    ).toEqual({ allow: true });
  });

  it("accepts a semantic hierarchy edit as a post-review refinement without making it a material draft", () => {
    const hierarchyWrite: AgentToolCallRecord = {
      toolCallId: "hierarchy_1",
      toolName: DESIGN_HIERARCHY_TOOL_NAME,
      input: {
        action: "group",
        pageId: "page_1",
        nodeIds: ["body", "face"],
        groupId: "mascot",
      },
      status: "completed",
      revision: 6,
    };

    expect(reviewDesignCompletion(context([hierarchyWrite]))).toEqual({
      allow: true,
    });
    expect(
      reviewDesignCompletion(
        context([materialWrite, firstCapture, hierarchyWrite, finalCapture]),
      ),
    ).toEqual({ allow: true });
  });

  it("accepts a precise arrangement as a post-review refinement without making it a material draft", () => {
    const arrangeWrite: AgentToolCallRecord = {
      toolCallId: "arrange_1",
      toolName: DESIGN_ARRANGE_TOOL_NAME,
      input: {
        action: "set-horizontal-spacing",
        pageId: "page_1",
        nodeIds: ["card_one", "card_two"],
        spacing: 24,
      },
      status: "completed",
      revision: 7,
    };

    expect(reviewDesignCompletion(context([arrangeWrite]))).toEqual({
      allow: true,
    });
    expect(
      reviewDesignCompletion(
        context([materialWrite, firstCapture, arrangeWrite, finalCapture]),
      ),
    ).toEqual({ allow: true });
  });
});
