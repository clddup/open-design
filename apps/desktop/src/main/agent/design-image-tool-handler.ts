import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import type { DesignAsset } from "@opendesign/design-contracts";
import { nativeImage } from "electron";
import {
  EDIT_IMAGE_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_READ_IMAGE_SOURCE_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  READ_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
  EditImageContract,
  GenerateImageContract,
  PlaceImageContract,
  PreparedImageEditSourceContract,
  ReadImageContract,
  UpdateImageContract,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { AgentAttachmentHost } from "./agent-attachment-host.js";
import type { AgentReferenceHost } from "./agent-reference-host.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import type { ImageGenerationHost } from "../model/image-generation-host.js";
import type { DesignImageEditService } from "./design-image-edit-service.js";

export type DesignImageToolHandlerInput = {
  call: ToolCallRequest;
  context: TrustedToolContext;
  executionContext: TrustedToolContext;
  signal: AbortSignal;
  coordinator: GlobalTaskCoordinator;
  getAttachmentHost(): AgentAttachmentHost;
  getReferenceHost(): AgentReferenceHost;
  getImageGenerationHost(): ImageGenerationHost;
  imageEditService: DesignImageEditService;
  execute: (call: ToolCallRequest) => Promise<TrustedToolResult>;
  withDelivery: (result: TrustedToolResult, runId: string) => TrustedToolResult;
};

export async function handleDesignImageTool(
  handlerInput: DesignImageToolHandlerInput,
): Promise<TrustedToolResult | null> {
  const {
    call,
    context,
    executionContext,
    signal,
    coordinator: globalTaskCoordinator,
    imageEditService,
    execute: executeRendererTool,
    withDelivery,
  } = handlerInput;
  if (!isDesignImageTool(call.toolName)) return null;
  const attachmentHost = handlerInput.getAttachmentHost();
  const referenceHost = handlerInput.getReferenceHost();
  const imageGenerationHost = handlerInput.getImageGenerationHost();

  if (call.toolName === READ_IMAGE_TOOL_NAME) {
    const parsed = ReadImageContract.parse(call.input);
    if (!parsed.ok) {
      throw new TypeError(
        formatValidationFailure("opendesign_read_image", parsed.issues),
      );
    }
    return await referenceHost.readImage(parsed.value, context, signal);
  }
  if (call.toolName === GENERATE_IMAGE_TOOL_NAME) {
    const parsed = GenerateImageContract.parse(call.input);
    if (!parsed.ok) {
      throw new TypeError(
        formatValidationFailure("opendesign_generate_image", parsed.issues),
      );
    }
    globalTaskCoordinator.assertDesignPlanForRaster(context, parsed.value.role);
    const generated = await imageGenerationHost.generateImage(
      parsed.value,
      signal,
    );
    const attachment = await attachmentHost.importImageBytes(
      `generated-image.${generated.outputFormat}`,
      generated.bytes,
    );
    const authorized = referenceHost.registerGeneratedImage(
      {
        attachmentId: attachment.attachmentId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
      },
      context,
    );
    globalTaskCoordinator.recordGeneratedRaster(
      context,
      authorized.attachmentId,
      parsed.value.role,
    );
    const intrinsic = nativeImage
      .createFromBuffer(Buffer.from(generated.bytes))
      .getSize();
    if (intrinsic.width <= 0 || intrinsic.height <= 0) {
      throw new TypeError("Generated image has invalid dimensions");
    }
    const digest = authorized.attachmentId.slice("image_".length);
    const assetId = `asset_${digest}`;
    const staged = await executeRendererTool({
      ...call,
      toolCallId: `${call.toolCallId.slice(0, 238)}_stage_asset`,
      toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
      input: {
        label: "Add generated image to Design File assets",
        executionMode: "atomic",
        commands: [
          {
            commandId: `${call.toolCallId.slice(0, 240)}_asset`,
            type: "put_asset",
            asset: {
              id: assetId,
              kind: "image",
              name: authorized.name,
              mimeType: authorized.mimeType,
              source: {
                type: "data",
                value: Buffer.from(generated.bytes).toString("base64"),
              },
              size: {
                width: intrinsic.width,
                height: intrinsic.height,
              },
              extensions: {
                attachmentId: authorized.attachmentId,
                designRole: parsed.value.role,
                generatedBy: "opendesign-agent",
                staged: true,
              },
            },
          },
        ],
      },
    });
    return {
      content: {
        ok: true,
        sourceKind: "generated",
        apiFormat: generated.apiFormat,
        modelId: generated.modelId,
        ...(generated.providerRequestId
          ? { providerRequestId: generated.providerRequestId }
          : {}),
        size: generated.size,
        quality: generated.quality,
        role: parsed.value.role,
        outputFormat: generated.outputFormat,
        attachment: authorized,
        attachments: [authorized],
        asset: {
          assetId,
          name: authorized.name,
          mimeType: authorized.mimeType,
          size: { width: intrinsic.width, height: intrinsic.height },
          role: parsed.value.role,
          scope: "design-file",
        },
      },
      ...(staged.designRevision
        ? { designRevision: staged.designRevision }
        : {}),
    };
  }
  if (call.toolName === PLACE_IMAGE_TOOL_NAME) {
    const parsed = PlaceImageContract.parse(call.input);
    if (!parsed.ok) {
      throw new TypeError(
        formatValidationFailure("Place Image", parsed.issues),
      );
    }
    const input = parsed.value;
    const attachmentId =
      "attachmentId" in input && input.attachmentId !== undefined
        ? referenceHost.hasAuthorizedImage(input.attachmentId, context)
          ? input.attachmentId
          : globalTaskCoordinator.resolveGeneratedRasterAttachmentId(
              context,
              input.attachmentId,
              input.role,
            )
        : undefined;
    globalTaskCoordinator.assertDesignPlanForImagePlacement(
      context,
      input.role,
      input.parentId,
      attachmentId,
      input.nodeId,
    );
    const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(
      context,
      [],
      input.parentId,
    );
    const image = attachmentId
      ? await referenceHost.materializeImage(attachmentId, context)
      : undefined;
    const intrinsic = image
      ? nativeImage
          .createFromBuffer(Buffer.from(image.data, "base64"))
          .getSize()
      : undefined;
    const persistentAssetInput =
      "assetId" in input && input.assetId !== undefined ? input : undefined;
    const intrinsicWidth = Math.max(
      1,
      intrinsic?.width ?? persistentAssetInput?.width ?? 1,
    );
    const intrinsicHeight = Math.max(
      1,
      intrinsic?.height ?? persistentAssetInput?.height ?? 1,
    );
    const width =
      input.width ??
      (input.height
        ? (input.height * intrinsicWidth) / intrinsicHeight
        : intrinsicWidth);
    const height =
      input.height ??
      (input.width
        ? (input.width * intrinsicHeight) / intrinsicWidth
        : intrinsicHeight);
    const assetId = persistentAssetInput
      ? persistentAssetInput.assetId
      : attachmentId
        ? `asset_${attachmentId.slice("image_".length)}`
        : undefined;
    if (!assetId) throw new Error("Image placement source is missing");
    const assetCommand = image
      ? [
          {
            commandId: `${call.toolCallId}_asset`,
            type: "put_asset" as const,
            asset: {
              id: assetId,
              kind: "image" as const,
              name: image.attachment.name,
              mimeType: image.mimeType,
              source: { type: "data" as const, value: image.data },
              size: {
                width: intrinsicWidth,
                height: intrinsicHeight,
              },
              extensions: {
                attachmentId: image.attachment.attachmentId,
                designRole: input.role,
              },
            },
          },
        ]
      : [];
    const result = await executeRendererTool({
      ...call,
      toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
      input: {
        label: `Place ${input.name}`,
        commands: [
          ...assetCommand,
          {
            commandId: `${call.toolCallId}_node`,
            type: "insert_element",
            pageId: input.pageId,
            parentId: input.parentId,
            index: input.index,
            node: {
              id: input.nodeId,
              kind: "image",
              name: input.name,
              parentId: input.parentId,
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, input.x, input.y],
              size: { width, height },
              exportSettings: [],
              opacity: 1,
              properties: {
                assetId,
                placement: input.placement ?? {
                  mode: "fill",
                  focalPoint: { x: 0.5, y: 0.5 },
                },
                altText: input.name,
                cornerRadius: 0,
              },
              extensions: { designRole: input.role },
            },
          },
        ],
      },
    });
    globalTaskCoordinator.recordMaterialDesignWriteCompleted(
      context.runId,
      targetIds,
      result.designRevision?.revision,
      [input.nodeId],
    );
    return withDelivery(result, context.runId);
  }
  if (call.toolName === UPDATE_IMAGE_TOOL_NAME) {
    const parsed = UpdateImageContract.parse(call.input);
    if (!parsed.ok) {
      throw new TypeError(
        formatValidationFailure("Update Image", parsed.issues),
      );
    }
    const input = parsed.value;
    if (
      executionContext.mutationTarget.kind === "page" &&
      executionContext.mutationTarget.pageId !== input.pageId
    ) {
      throw new Error(
        "Image update targets a Page outside the active mutation target",
      );
    }
    globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
    const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(context, [
      input.nodeId,
    ]);
    if (input.action === "replace-source") {
      const image = await referenceHost.materializeImage(
        input.attachmentId,
        context,
      );
      const intrinsic = nativeImage
        .createFromBuffer(Buffer.from(image.data, "base64"))
        .getSize();
      if (intrinsic.width <= 0 || intrinsic.height <= 0) {
        throw new TypeError("Replacement image has invalid dimensions");
      }
      const digest = image.attachment.attachmentId.slice("image_".length);
      const assetId = `asset_${digest}`;
      const result = await executeRendererTool({
        ...call,
        toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
        input: {
          action: "replace-source",
          label: input.label,
          pageId: input.pageId,
          nodeId: input.nodeId,
          asset: {
            id: assetId,
            kind: "image",
            name: image.attachment.name,
            mimeType: image.mimeType,
            source: { type: "data", value: image.data },
            size: { width: intrinsic.width, height: intrinsic.height },
            extensions: {
              attachmentId: image.attachment.attachmentId,
              importedBy: "agent-image-update",
            },
          },
          ...(input.placement === undefined
            ? {}
            : { placement: input.placement }),
        },
      });
      globalTaskCoordinator.recordMaterialDesignWriteCompleted(
        context.runId,
        targetIds,
        result.designRevision?.revision,
      );
      return withDelivery(result, context.runId);
    }
    const result = await executeRendererTool({
      ...call,
      toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
      input,
    });
    globalTaskCoordinator.recordMaterialDesignWriteCompleted(
      context.runId,
      targetIds,
      result.designRevision?.revision,
    );
    return withDelivery(result, context.runId);
  }
  if (call.toolName === EDIT_IMAGE_TOOL_NAME) {
    const parsed = EditImageContract.parse(call.input);
    if (!parsed.ok) {
      throw new TypeError(formatValidationFailure("Edit Image", parsed.issues));
    }
    const input = parsed.value;
    if (
      executionContext.mutationTarget.kind === "page" &&
      executionContext.mutationTarget.pageId !== input.pageId
    ) {
      throw new Error(
        "Image edit targets a Page outside the active mutation target",
      );
    }
    globalTaskCoordinator.assertDocumentInspected(context);
    globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
    const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(context, [
      input.nodeId,
    ]);
    const prepared = await executeRendererTool({
      ...call,
      toolCallId: `${call.toolCallId}_read_source`.slice(0, 256),
      toolName: INTERNAL_READ_IMAGE_SOURCE_TOOL_NAME,
      input: {
        pageId: input.pageId,
        nodeId: input.nodeId,
        expectedAssetId: input.expectedAssetId,
      },
    });
    const parsedPrepared = PreparedImageEditSourceContract.parse(
      prepared.content,
    );
    if (!parsedPrepared.ok) {
      throw new TypeError(
        formatValidationFailure(
          "Image edit source preparation",
          parsedPrepared.issues,
        ),
      );
    }
    const source = parsedPrepared.value.asset;
    const reference =
      input.action === "prompt-edit" && input.referenceAttachmentId
        ? await materializeAgentImageAsset(
            referenceHost,
            input.referenceAttachmentId,
            context,
            "agent-image-edit-reference",
          )
        : undefined;
    const derived = await imageEditService.edit(
      input.action === "remove-background" || input.action === "upscale"
        ? {
            action: input.action,
            source,
            importedBy: "agent-image-edit",
          }
        : input.action === "prompt-edit" ||
            input.action === "replace-background"
          ? {
              action: input.action,
              source,
              prompt: input.prompt,
              ...(reference === undefined ? {} : { references: [reference] }),
              importedBy: "agent-image-edit",
            }
          : input.action === "relight"
            ? {
                action: input.action,
                source,
                lightingPreset: input.lightingPreset,
                importedBy: "agent-image-edit",
              }
            : input.action === "expand"
              ? {
                  action: input.action,
                  source,
                  expansion: input.expansion,
                  placement: parsedPrepared.value.placement,
                  targetSize: parsedPrepared.value.targetSize,
                  importedBy: "agent-image-edit",
                }
              : {
                  action: input.action,
                  source,
                  selection: input.selection,
                  importedBy: "agent-image-edit",
                },
      signal,
    );
    const result = await executeRendererTool({
      ...call,
      toolCallId: `${call.toolCallId}_commit_edit`.slice(0, 256),
      toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
      input: {
        action:
          input.action === "isolate-object"
            ? "derive-layer"
            : input.action === "expand"
              ? "expand-source"
              : input.action === "upscale"
                ? "upscale-source"
                : "derive-source",
        label: input.label,
        pageId: input.pageId,
        nodeId: input.nodeId,
        expectedAssetId: input.expectedAssetId,
        ...(input.action === "expand"
          ? {
              expectedPlacement: parsedPrepared.value.placement,
              expectedTargetSize: parsedPrepared.value.targetSize,
              expansion: input.expansion,
            }
          : {}),
        ...(input.action === "upscale"
          ? (() => {
              if (!source.size || !derived.asset.size) {
                throw new TypeError(
                  "Image upscale requires exact source and target dimensions",
                );
              }
              return {
                expectedSourceSize: source.size,
                targetSize: derived.asset.size,
              };
            })()
          : {}),
        asset: derived.asset,
        derivation: derived.derivation,
        ...(input.action === "isolate-object"
          ? {
              resultNodeId: input.resultNodeId,
              resultNodeName: "Isolated object",
            }
          : {}),
        ...(derived.supportingAssets === undefined
          ? {}
          : { supportingAssets: derived.supportingAssets }),
      },
    });
    globalTaskCoordinator.recordMaterialDesignWriteCompleted(
      context.runId,
      targetIds,
      result.designRevision?.revision,
      input.action === "isolate-object" ? [input.resultNodeId] : undefined,
    );
    return withDelivery(result, context.runId);
  }
  return null;
}

function isDesignImageTool(toolName: string): boolean {
  return (
    toolName === READ_IMAGE_TOOL_NAME ||
    toolName === GENERATE_IMAGE_TOOL_NAME ||
    toolName === PLACE_IMAGE_TOOL_NAME ||
    toolName === UPDATE_IMAGE_TOOL_NAME ||
    toolName === EDIT_IMAGE_TOOL_NAME
  );
}

async function materializeAgentImageAsset(
  referenceHost: AgentReferenceHost,
  attachmentId: string,
  context: TrustedToolContext,
  importedBy: string,
): Promise<DesignAsset> {
  const image = await referenceHost.materializeImage(attachmentId, context);
  const bytes = Buffer.from(image.data, "base64");
  const intrinsic = nativeImage.createFromBuffer(bytes).getSize();
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    throw new TypeError("Image edit reference has invalid dimensions");
  }
  const digest = image.attachment.attachmentId.slice("image_".length);
  return {
    id: `asset_${digest}`,
    kind: "image",
    name: image.attachment.name,
    mimeType: image.mimeType,
    source: { type: "data", value: image.data },
    size: intrinsic,
    extensions: { attachmentId, importedBy },
  };
}
