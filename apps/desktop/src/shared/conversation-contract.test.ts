import { describe, expect, it } from "vitest";
import {
  ConversationDescriptorContract,
  ConversationDescriptorListContract,
  ConversationOpenContextContract,
  CreateConversationRequestContract,
} from "./conversation-contract";

const timestamp = "2026-08-26T12:00:00.000Z";

describe("Conversation contracts", () => {
  it("owns the exact create request shape", () => {
    expect(
      CreateConversationRequestContract.parse({
        conversationId: "conversation_1",
        filedProjectId: "project_1",
        title: "Homepage exploration",
      }),
    ).toMatchObject({ ok: true });
    expect(
      CreateConversationRequestContract.parse({
        conversationId: "conversation_1",
        filedProjectId: "project_1",
        title: "Homepage exploration",
        rootPath: "/tmp/project",
      }),
    ).toMatchObject({
      ok: false,
      issues: [
        {
          code: "conversation.create_request_invalid",
          path: "/rootPath",
        },
      ],
    });
  });

  it("selects the concrete open-context branch", () => {
    expect(
      ConversationOpenContextContract.parse({
        kind: "target-unavailable",
        conversationId: "conversation_1",
        reason: "unknown",
      }),
    ).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: "/reason" })],
    });
  });

  it("rejects one invalid descriptor at its list index", () => {
    expect(
      ConversationDescriptorListContract.parse([
        {
          conversationId: "conversation_1",
          originProjectId: "project_1",
          filedProjectId: "project_1",
          title: "Homepage exploration",
          createdAt: timestamp,
          updatedAt: timestamp,
          lifecycle: "active",
        },
        {
          conversationId: "conversation_2",
          originProjectId: null,
          filedProjectId: null,
          title: "",
          createdAt: timestamp,
          updatedAt: timestamp,
          lifecycle: "active",
        },
      ]),
    ).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: "/1/title" })],
    });
  });

  it("correlates created Conversation descriptors with their request", () => {
    expect(
      ConversationDescriptorContract.parse(
        {
          conversationId: "conversation_other",
          originProjectId: "project_1",
          filedProjectId: "project_1",
          title: "Homepage exploration",
          createdAt: timestamp,
          updatedAt: timestamp,
          lifecycle: "active",
        },
        {
          kind: "create-response",
          request: {
            conversationId: "conversation_1",
            filedProjectId: "project_1",
            title: "Homepage exploration",
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "conversation.response_mismatch",
          path: "/conversationId",
        }),
      ],
    });
  });
});
