import type {
  DesignAsset,
  ImageAssetDerivation,
  ImageLightingPreset,
  ImagePlacement,
  Size,
} from "@opendesign/design-contracts";
import type {
  BrowserWindow,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  OpenDialogReturnValue,
} from "electron";
import {
  channels,
  isAgentAttachmentImport,
  isAgentAttachmentPreviewRequest,
  isCancelDesignImageEditRequest,
  isDesignImageEditRequest,
  type DesignImageAreaSelection,
  type DesignImageEditRequest,
  type DesignImageExpansion,
} from "@/shared/desktop-api.js";
import type { AppLocale } from "@/shared/i18n/locale.js";
import { translate } from "@/shared/i18n/messages.js";
import type { AgentAttachmentHost } from "./agent/agent-attachment-host.js";

type MediaAttachmentHost = Pick<
  AgentAttachmentHost,
  "importBytes" | "importFiles" | "preview" | "resolve"
>;
type MediaInputIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface MediaInputIpcRegistrar {
  handle(channel: string, listener: MediaInputIpcHandler): void;
}

export type DesignImageEditInput =
  | {
      action: "remove-background";
      source: DesignAsset;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "upscale";
      source: DesignAsset;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "replace-background";
      source: DesignAsset;
      prompt: string;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "relight";
      source: DesignAsset;
      lightingPreset: ImageLightingPreset;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "prompt-edit";
      source: DesignAsset;
      prompt: string;
      references?: readonly DesignAsset[];
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "erase-object" | "isolate-object";
      source: DesignAsset;
      selection: DesignImageAreaSelection;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "expand";
      source: DesignAsset;
      expansion: DesignImageExpansion;
      placement: ImagePlacement;
      targetSize: Size;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    };

export type DesignImageEditOutput = {
  asset: DesignAsset;
  derivation: ImageAssetDerivation;
  supportingAssets?: DesignAsset[];
};

export interface MediaInputIpcHostOptions {
  decodeImageSize(bytes: Buffer): Size;
  editImage(
    input: DesignImageEditInput,
    signal: AbortSignal,
  ): Promise<DesignImageEditOutput>;
  getAttachmentHost(): MediaAttachmentHost;
  getLocale(): AppLocale;
  getWindow(): BrowserWindow | null;
  openDialog(
    window: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<OpenDialogReturnValue>;
}

export class MediaInputIpcHost {
  readonly #options: MediaInputIpcHostOptions;
  readonly #editControllers = new Map<string, AbortController>();

  constructor(options: MediaInputIpcHostOptions) {
    this.#options = options;
  }

  registerIpc(options: {
    assertRenderer(event: IpcMainInvokeEvent): void;
    ipc: MediaInputIpcRegistrar;
  }): void {
    options.ipc.handle(
      channels.selectAgentAttachments,
      async (event, ...args: unknown[]) => {
        options.assertRenderer(event);
        assertArgumentCount(args, 0);
        const window = this.#options.getWindow();
        if (!window) return [];
        const result = await this.#options.openDialog(
          window,
          attachmentDialogOptions(this.#options.getLocale()),
        );
        if (result.canceled) return [];
        return this.#options.getAttachmentHost().importFiles(result.filePaths);
      },
    );
    options.ipc.handle(
      channels.importAgentAttachments,
      async (event, ...args: unknown[]) => {
        options.assertRenderer(event);
        assertArgumentCount(args, 1);
        const attachments = args[0];
        if (
          !Array.isArray(attachments) ||
          attachments.length > 6 ||
          !attachments.every(isAgentAttachmentImport)
        ) {
          throw new TypeError("Invalid Agent attachment import request");
        }
        const totalBytes = attachments.reduce(
          (total, attachment) => total + attachment.bytes.byteLength,
          0,
        );
        if (totalBytes > 32 * 1024 * 1024) {
          throw new RangeError("Attachments exceed the 32 MB total limit");
        }
        const host = this.#options.getAttachmentHost();
        return await Promise.all(
          attachments.map((attachment) =>
            host.importBytes(attachment.name, attachment.bytes),
          ),
        );
      },
    );
    options.ipc.handle(
      channels.getAgentAttachmentPreview,
      async (event, ...args: unknown[]) => {
        options.assertRenderer(event);
        assertArgumentCount(args, 1);
        const request = args[0];
        if (!isAgentAttachmentPreviewRequest(request)) {
          throw new TypeError("Invalid Agent attachment preview request");
        }
        return {
          attachmentId: request.attachmentId,
          previewDataUrl: await this.#options
            .getAttachmentHost()
            .preview(request.attachmentId),
        };
      },
    );
    options.ipc.handle(
      channels.selectDesignImage,
      async (event, ...args: unknown[]) => {
        options.assertRenderer(event);
        assertArgumentCount(args, 0);
        const window = this.#options.getWindow();
        if (!window) return null;
        const dialogResult = await this.#options.openDialog(
          window,
          designImageDialogOptions(this.#options.getLocale()),
        );
        const path = dialogResult.filePaths[0];
        if (dialogResult.canceled || !path) return null;
        const host = this.#options.getAttachmentHost();
        const selected = (await host.importFiles([path]))[0];
        if (!selected || !selected.attachmentId.startsWith("image_")) {
          throw new TypeError("Selected design asset is not an image");
        }
        const resolved = await host.resolve(selected.attachmentId);
        if (resolved.kind !== "image") {
          throw new TypeError("Selected design asset is not an image");
        }
        const size = this.#options.decodeImageSize(
          Buffer.from(resolved.data, "base64"),
        );
        if (size.width <= 0 || size.height <= 0) {
          throw new TypeError("Selected design image has invalid dimensions");
        }
        const digest = selected.attachmentId.slice("image_".length);
        return {
          asset: {
            id: `asset_${digest}`,
            kind: "image",
            name: selected.name,
            mimeType: resolved.mimeType,
            source: { type: "data", value: resolved.data },
            size,
            extensions: { importedBy: "design-image-picker" },
          },
        };
      },
    );
    options.ipc.handle(
      channels.editDesignImage,
      async (event, ...args: unknown[]) => {
        options.assertRenderer(event);
        assertArgumentCount(args, 1);
        const request = args[0];
        if (!isDesignImageEditRequest(request)) {
          throw new TypeError("Invalid design image edit request");
        }
        if (this.#editControllers.has(request.requestId)) {
          throw new Error(`Image edit ${request.requestId} is already running`);
        }
        const controller = new AbortController();
        this.#editControllers.set(request.requestId, controller);
        try {
          const result = await this.#options.editImage(
            inspectorEditInput(request),
            controller.signal,
          );
          return {
            requestId: request.requestId,
            action: request.action,
            sourceAssetId: request.expectedAssetId,
            ...result,
          };
        } finally {
          this.#editControllers.delete(request.requestId);
        }
      },
    );
    options.ipc.handle(
      channels.cancelDesignImageEdit,
      (event, ...args: unknown[]) => {
        options.assertRenderer(event);
        assertArgumentCount(args, 1);
        const request = args[0];
        if (!isCancelDesignImageEditRequest(request)) {
          throw new TypeError("Invalid design image edit cancellation request");
        }
        const controller = this.#editControllers.get(request.requestId);
        if (!controller) return false;
        controller.abort(
          new DOMException("Image editing cancelled", "AbortError"),
        );
        return true;
      },
    );
  }

  abortAll(message: string): void {
    for (const controller of this.#editControllers.values()) {
      controller.abort(new DOMException(message, "AbortError"));
    }
    this.#editControllers.clear();
  }
}

function inspectorEditInput(
  request: DesignImageEditRequest,
): DesignImageEditInput {
  const common = {
    source: request.source,
    importedBy: "inspector-image-edit" as const,
  };
  if (request.action === "remove-background" || request.action === "upscale") {
    return { ...common, action: request.action };
  }
  if (request.action === "replace-background") {
    return { ...common, action: request.action, prompt: request.prompt };
  }
  if (request.action === "relight") {
    return {
      ...common,
      action: request.action,
      lightingPreset: request.lightingPreset,
    };
  }
  if (request.action === "prompt-edit") {
    return {
      ...common,
      action: request.action,
      prompt: request.prompt,
      ...(request.reference ? { references: [request.reference] } : {}),
    };
  }
  if (request.action === "expand") {
    return {
      ...common,
      action: request.action,
      expansion: request.expansion,
      placement: request.placement,
      targetSize: request.targetSize,
    };
  }
  return { ...common, action: request.action, selection: request.selection };
}

function attachmentDialogOptions(locale: AppLocale): OpenDialogOptions {
  return {
    title: translate(locale, "main.selectAttachmentsTitle"),
    buttonLabel: translate(locale, "main.selectAttachmentsButton"),
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: translate(locale, "main.attachmentFilter"),
        extensions: [
          "png",
          "jpg",
          "jpeg",
          "webp",
          "gif",
          "svg",
          "pdf",
          "docx",
          "txt",
          "md",
          "markdown",
          "csv",
          "html",
          "htm",
          "json",
          "yaml",
          "yml",
        ],
      },
    ],
  };
}

function designImageDialogOptions(locale: AppLocale): OpenDialogOptions {
  return {
    title: translate(locale, "main.selectDesignImageTitle"),
    buttonLabel: translate(locale, "main.selectDesignImageButton"),
    properties: ["openFile"],
    filters: [
      {
        name: translate(locale, "main.imageFilter"),
        extensions: ["png", "jpg", "jpeg", "webp", "gif"],
      },
    ],
  };
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}
