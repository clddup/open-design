import {
  isAgentAttachmentImport,
  isAgentAttachmentPreviewRequest,
  isAgentAttachmentPreviewResult,
  isAgentAttachmentSelection,
  isCancelDesignImageEditRequest,
  isDesignImageEditRequest,
  isDesignImageEditResult,
  isDesignImageSelection,
  type AgentAttachmentImport,
  type AgentAttachmentPreviewRequest,
  type AgentAttachmentPreviewResult,
  type AgentAttachmentSelection,
  type CancelDesignImageEditRequest,
  type DesignImageEditRequest,
  type DesignImageEditResult,
  type DesignImageSelection,
} from "@/shared/media-input-contract";
import { channels, type DesktopApi } from "@/shared/desktop-api";
import { validate, validateArray } from "./value-parser";

type MediaApi = Pick<
  DesktopApi,
  | "selectAgentAttachments"
  | "importAgentAttachments"
  | "getAgentAttachmentPreview"
  | "selectDesignImage"
  | "editDesignImage"
  | "cancelDesignImageEdit"
>;

export function createMediaApi(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): MediaApi {
  return {
    selectAgentAttachments: async () =>
      validateArray<AgentAttachmentSelection>(
        await invoke(channels.selectAgentAttachments),
        isAgentAttachmentSelection,
        "Invalid Agent attachment selection response",
      ),
    importAgentAttachments: async (attachments: AgentAttachmentImport[]) => {
      if (
        !Array.isArray(attachments) ||
        attachments.length > 6 ||
        !attachments.every(isAgentAttachmentImport)
      ) {
        throw new TypeError("Invalid Agent attachment import request");
      }
      return validateArray<AgentAttachmentSelection>(
        await invoke(channels.importAgentAttachments, attachments),
        isAgentAttachmentSelection,
        "Invalid Agent attachment import response",
      );
    },
    getAgentAttachmentPreview: async (
      request: AgentAttachmentPreviewRequest,
    ) => {
      validate(
        request,
        isAgentAttachmentPreviewRequest,
        "Invalid Agent attachment preview request",
      );
      return validate<AgentAttachmentPreviewResult>(
        await invoke(channels.getAgentAttachmentPreview, request),
        isAgentAttachmentPreviewResult,
        "Invalid Agent attachment preview response",
      );
    },
    selectDesignImage: async () => {
      const result = await invoke(channels.selectDesignImage);
      return result === null
        ? null
        : validate<DesignImageSelection>(
            result,
            isDesignImageSelection,
            "Invalid design image selection response",
          );
    },
    editDesignImage: async (request: DesignImageEditRequest) => {
      validate(
        request,
        isDesignImageEditRequest,
        "Invalid design image edit request",
      );
      return validate<DesignImageEditResult>(
        await invoke(channels.editDesignImage, request),
        isDesignImageEditResult,
        "Invalid design image edit response",
      );
    },
    cancelDesignImageEdit: async (request: CancelDesignImageEditRequest) => {
      validate(
        request,
        isCancelDesignImageEditRequest,
        "Invalid design image edit cancellation request",
      );
      const result = await invoke(channels.cancelDesignImageEdit, request);
      if (typeof result !== "boolean") {
        throw new TypeError("Invalid design image edit cancellation response");
      }
      return result;
    },
  };
}
