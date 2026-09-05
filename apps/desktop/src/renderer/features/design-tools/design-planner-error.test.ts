import { describe, expect, it } from "vitest";
import { TrustedToolFailureContract } from "@opendesign/agent-contracts";
import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { DESIGN_EDIT_TOOL_NAME } from "@/shared/design-agent-tools";
import type { InternalDesignEditToolInput } from "@/shared/design-agent-tools";
import { RendererDesignToolResponseContract } from "@/shared/design-tool-bridge";
import { executeDesignToolRequest } from "./design-tool-execution";

async function failedEdit(input: InternalDesignEditToolInput) {
  const runtime = new EditorRuntime(createWelcomeDocument());
  const before = runtime.getSnapshot();
  let caught: unknown;
  try {
    await executeDesignToolRequest(
      {
        requestId: "planner_request",
        call: {
          toolCallId: "planner_call",
          toolName: DESIGN_EDIT_TOOL_NAME,
          input,
        },
        context: {
          runId: "planner_run",
          sessionId: "planner_session",
          documentId: "document_welcome",
          revision: 0,
          scope: { kind: "page", pageId: "page_welcome", selectedNodeIds: [] },
          mutationTarget: { kind: "page", pageId: "page_welcome" },
        },
      },
      runtime,
      "page_welcome",
    );
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const parsed = TrustedToolFailureContract.parse((caught as Error).cause);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  expect(
    RendererDesignToolResponseContract.parse({
      requestId: "planner_request",
      ok: false,
      error: parsed.value,
    }).ok,
  ).toBe(true);
  expect(runtime.getSnapshot().document).toEqual(before.document);
  expect(runtime.getSnapshot().state.history).toEqual(before.state.history);
  return parsed.value;
}

const mixedGroup = {
  kind: "hierarchy" as const,
  input: {
    action: "group" as const,
    label: "Group",
    pageId: "page_welcome",
    nodeIds: ["title_welcome", "feature_one"],
    groupId: "new_group",
    name: "Group",
  },
};

const alignment = {
  kind: "arrange" as const,
  input: {
    action: "align-left" as const,
    label: "Align",
    pageId: "page_welcome",
    nodeIds: ["feature_one", "feature_two"],
  },
};

describe("planner errors across the Agent bridge", () => {
  it("identifies the failed edit and leaves earlier planned edits uncommitted", async () => {
    const failure = await failedEdit({
      label: "Arrange then group",
      edits: [alignment, mixedGroup],
    });
    expect(failure).toMatchObject({
      code: "edit-design.hierarchy.mixed-parent",
      recoverable: true,
      details: {
        fingerprint: "planner:edit-design.hierarchy:group:mixed-parent",
        issues: [
          {
            code: "edit-design.hierarchy.mixed-parent",
            path: "/edits/1/input",
          },
        ],
        recovery: { action: "correct-and-retry", required: false },
      },
    });
    expect(failure.details?.issues[0]?.recovery).toContain(
      "No part of this transaction was committed",
    );
  });

  it("distinguishes arrangement and hierarchy failures without using message text", async () => {
    const hierarchy = await failedEdit({ label: "Group", edits: [mixedGroup] });
    const arrange = await failedEdit({
      label: "Align",
      edits: [
        {
          ...alignment,
          input: {
            ...alignment.input,
            nodeIds: ["missing_one", "missing_two"],
          },
        },
      ],
    });
    expect(arrange.code).toMatch(/^edit-design\.arrange\./);
    expect(arrange.details?.issues[0].path).toBe("/edits/0/input");
    expect(arrange.details?.fingerprint).not.toBe(
      hierarchy.details?.fingerprint,
    );
  });

  it("keeps the same root cause when an edit moves within the batch", async () => {
    const first = await failedEdit({ label: "Group", edits: [mixedGroup] });
    const second = await failedEdit({
      label: "Align then group",
      edits: [alignment, mixedGroup],
    });
    expect(first.details?.fingerprint).toBe(second.details?.fingerprint);
    expect(first.details?.issues[0].path).not.toBe(
      second.details?.issues[0].path,
    );
  });
});
