import { describe, expect, it, vi } from "vitest";
import { channels } from "@/shared/desktop-api";
import { createConversationApi } from "./conversation-api";

const timestamp = "2026-08-26T12:00:00.000Z";

function descriptor(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    conversationId: "conversation_1",
    originProjectId: "project_1",
    filedProjectId: "project_1",
    title: "Homepage exploration",
    createdAt: timestamp,
    updatedAt: timestamp,
    lifecycle: "active",
    ...overrides,
  };
}

describe("Conversation preload API", () => {
  it("rejects invalid outbound input before invoking Main", async () => {
    const invoke = vi.fn();
    const api = createConversationApi(invoke);
    await expect(
      api.createConversation({
        conversationId: "conversation_1",
        filedProjectId: "project_1",
        title: "Homepage\nexploration",
      }),
    ).rejects.toThrow("conversation.create_request_invalid at /title");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a structurally valid create response from another request", async () => {
    const invoke = vi.fn().mockResolvedValue(
      descriptor({
        conversationId: "conversation_other",
      }),
    );
    const api = createConversationApi(invoke);
    await expect(
      api.createConversation({
        conversationId: "conversation_1",
        filedProjectId: "project_1",
        title: "Homepage exploration",
      }),
    ).rejects.toThrow("conversation.response_mismatch at /conversationId");
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(channels.createConversation, {
      conversationId: "conversation_1",
      filedProjectId: "project_1",
      title: "Homepage exploration",
    });
  });

  it("correlates delete and open-context responses", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        descriptor({
          conversationId: "conversation_other",
          lifecycle: "deleted",
        }),
      )
      .mockResolvedValueOnce({
        kind: "target-unavailable",
        conversationId: "conversation_other",
        reason: "no-target",
      });
    const api = createConversationApi(invoke);
    await expect(
      api.deleteConversation({ conversationId: "conversation_1" }),
    ).rejects.toThrow("conversation.response_mismatch at /conversationId");
    await expect(
      api.resolveConversationOpenContext({ conversationId: "conversation_1" }),
    ).rejects.toThrow("conversation.open_context_mismatch at /conversationId");
  });

  it("reports the indexed field from an invalid list item", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue([descriptor(), descriptor({ title: "" })]);
    const api = createConversationApi(invoke);
    await expect(api.listConversations()).rejects.toThrow(
      "workspace.conversation_descriptor_list_invalid at /1/title",
    );
  });
});
