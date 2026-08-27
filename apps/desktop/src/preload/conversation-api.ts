import {
  ConversationDescriptorContract,
  ConversationDescriptorListContract,
  ConversationIdentityRequestContract,
  CreateConversationRequestContract,
  type ConversationIdentityRequest,
  type CreateConversationRequest,
  type DeleteConversationRequest,
} from "@opendesign/workspace-contracts";
import {
  ConversationOpenContextContract,
  type ConversationOpenContext,
} from "@/shared/conversation-contract";
import { channels, type DesktopApi } from "@/shared/desktop-api";
import { parseContract } from "./contract-parser";

type ConversationApi = Pick<
  DesktopApi,
  | "createConversation"
  | "deleteConversation"
  | "resolveConversationOpenContext"
  | "listConversations"
>;

export function createConversationApi(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): ConversationApi {
  return {
    createConversation: async (request: CreateConversationRequest) => {
      const canonicalRequest = parseContract(
        CreateConversationRequestContract,
        request,
        "Conversation create request",
      );
      const result = await invoke(
        channels.createConversation,
        canonicalRequest,
      );
      return parseContract(
        ConversationDescriptorContract,
        result,
        "Conversation create response",
        { kind: "create-response", request: canonicalRequest },
      );
    },
    deleteConversation: async (request: DeleteConversationRequest) => {
      const canonicalRequest = parseContract(
        ConversationIdentityRequestContract,
        request,
        "Conversation delete request",
      );
      const result = await invoke(
        channels.deleteConversation,
        canonicalRequest,
      );
      return parseContract(
        ConversationDescriptorContract,
        result,
        "Conversation delete response",
        {
          kind: "delete-response",
          conversationId: canonicalRequest.conversationId,
        },
      );
    },
    resolveConversationOpenContext: async (
      request: ConversationIdentityRequest,
    ): Promise<ConversationOpenContext> => {
      const canonicalRequest = parseContract(
        ConversationIdentityRequestContract,
        request,
        "Conversation open request",
      );
      const result = await invoke(
        channels.resolveConversationOpenContext,
        canonicalRequest,
      );
      return parseContract(
        ConversationOpenContextContract,
        result,
        "Conversation open context",
        { conversationId: canonicalRequest.conversationId },
      );
    },
    listConversations: async () => {
      const result = await invoke(channels.listConversations);
      return parseContract(
        ConversationDescriptorListContract,
        result,
        "Conversation descriptor list",
      );
    },
  };
}
