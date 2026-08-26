import type {
  DesignAsset,
  ImageAssetDerivation,
  Size,
} from "@opendesign/design-contracts";
import { resolveImageUpscaleSize } from "@opendesign/image-service";
import { nativeImage } from "electron";
import { createHash } from "node:crypto";
import {
  ERASE_OBJECT_PROMPT,
  EXPAND_IMAGE_PROMPT,
  ISOLATE_OBJECT_PROMPT,
  type ImageGenerationHost,
} from "../model/image-generation-host.js";
import { createImageEditMaskPng } from "../model/image-edit-mask.js";
import {
  compositeProtectedImageExpansion,
  createImageExpansionRaster,
  type PreparedImageExpansionRaster,
} from "../model/image-expand-raster.js";
import type {
  DesignImageEditInput,
  DesignImageEditOutput,
} from "../media-input-ipc.js";
import type { AgentAttachmentHost } from "./agent-attachment-host.js";

export type DesignImageEditServiceDependencies = {
  getAttachmentHost(): AgentAttachmentHost;
  getImageGenerationHost(): ImageGenerationHost;
};

export class DesignImageEditService {
  constructor(
    private readonly dependencies: DesignImageEditServiceDependencies,
  ) {}

  readonly edit = (
    input: DesignImageEditInput,
    signal: AbortSignal,
  ): Promise<DesignImageEditOutput> =>
    editDesignImageAsset(input, signal, this.dependencies);
}

async function editDesignImageAsset(
  input: DesignImageEditInput,
  signal: AbortSignal,
  dependencies: DesignImageEditServiceDependencies,
): Promise<{
  asset: DesignAsset;
  derivation: ImageAssetDerivation;
  supportingAssets?: DesignAsset[];
}> {
  const source = toImageEditSource(input.source);
  const references =
    input.action === "prompt-edit" ? (input.references ?? []) : [];
  if (
    references.length > 1 ||
    references.some((reference) => reference.id === input.source.id)
  ) {
    throw new TypeError(
      "Image editing supports at most one distinct reference image",
    );
  }
  let pendingMask:
    | {
        bytes: Uint8Array;
        name: string;
        size: { width: number; height: number };
      }
    | undefined;
  let pendingExpansion: PreparedImageExpansionRaster | undefined;
  let pendingUpscale:
    | { sourceSize: Size; targetSize: Size; preserveTransparency: boolean }
    | undefined;
  const edited = await (async () => {
    if (input.action === "remove-background") {
      return dependencies
        .getImageGenerationHost()
        .removeBackground(source, signal);
    }
    if (input.action === "prompt-edit") {
      return dependencies.getImageGenerationHost().editWithPrompt(
        {
          source,
          prompt: input.prompt,
          references: references.map(toImageEditSource),
        },
        signal,
      );
    }
    if (input.action === "replace-background") {
      return dependencies
        .getImageGenerationHost()
        .replaceBackground({ source, prompt: input.prompt }, signal);
    }
    if (input.action === "relight") {
      return dependencies
        .getImageGenerationHost()
        .changeLighting(
          { source, lightingPreset: input.lightingPreset },
          signal,
        );
    }
    const decodedSource = nativeImage.createFromBuffer(
      Buffer.from(source.bytes),
    );
    const intrinsic = decodedSource.getSize();
    if (intrinsic.width <= 0 || intrinsic.height <= 0) {
      throw new TypeError("Image editing source could not be decoded");
    }
    if (input.action === "upscale") {
      if (
        !input.source.size ||
        input.source.size.width !== intrinsic.width ||
        input.source.size.height !== intrinsic.height
      ) {
        throw new TypeError(
          "Image upscale source dimensions do not match the embedded asset",
        );
      }
      const targetSize = resolveImageUpscaleSize(intrinsic);
      const preserveTransparency = nativeImageHasTransparentPixels(
        decodedSource.toBitmap(),
      );
      pendingUpscale = {
        sourceSize: intrinsic,
        targetSize,
        preserveTransparency,
      };
      return dependencies.getImageGenerationHost().boostResolution(
        {
          source: {
            bytes: decodedSource.toPNG(),
            mimeType: "image/png",
            name: `${input.source.name.replace(/\.[^.]+$/, "")} — Upscale source.png`,
          },
          size: `${targetSize.width}x${targetSize.height}`,
          preserveTransparency,
        },
        signal,
      );
    }
    if (input.action === "expand") {
      pendingExpansion = createImageExpansionRaster({
        expansion: input.expansion,
        placement: input.placement,
        source: {
          bgra: decodedSource.toBitmap(),
          size: intrinsic,
        },
        targetSize: input.targetSize,
      });
      const providerSize = pendingExpansion.geometry.outputSize;
      const preparedSourceBytes = nativeImage
        .createFromBitmap(Buffer.from(pendingExpansion.sourceCanvas.bgra), {
          width: providerSize.width,
          height: providerSize.height,
        })
        .toPNG();
      const maskName = `${input.source.name.replace(/\.[^.]+$/, "")} — Expansion mask.png`;
      pendingMask = {
        bytes: pendingExpansion.maskPng,
        name: maskName,
        size: providerSize,
      };
      return dependencies.getImageGenerationHost().expandImage(
        {
          source: {
            bytes: preparedSourceBytes,
            mimeType: "image/png",
            name: `${input.source.name.replace(/\.[^.]+$/, "")} — Expansion source.png`,
          },
          mask: {
            bytes: pendingExpansion.maskPng,
            mimeType: "image/png",
            name: maskName,
          },
          size: `${providerSize.width}x${providerSize.height}`,
        },
        signal,
      );
    }
    const maskBytes = createImageEditMaskPng({
      width: intrinsic.width,
      height: intrinsic.height,
      points: input.selection.points,
    });
    const normalizedSourceBytes = decodedSource.toPNG();
    const maskName = `${input.source.name.replace(/\.[^.]+$/, "")} — Area mask.png`;
    pendingMask = {
      bytes: maskBytes,
      name: maskName,
      size: intrinsic,
    };
    const maskedInput = {
      source: {
        bytes: normalizedSourceBytes,
        mimeType: "image/png" as const,
        name: `${input.source.name.replace(/\.[^.]+$/, "")}.png`,
      },
      mask: {
        bytes: maskBytes,
        mimeType: "image/png" as const,
        name: maskName,
      },
    };
    return input.action === "erase-object"
      ? dependencies.getImageGenerationHost().eraseObject(maskedInput, signal)
      : dependencies
          .getImageGenerationHost()
          .isolateObject(maskedInput, signal);
  })();
  let bytes: Buffer = Buffer.from(edited.bytes);
  let editedNativeImage = nativeImage.createFromBuffer(bytes);
  let intrinsic = editedNativeImage.getSize();
  if (pendingExpansion) {
    const composite = compositeProtectedImageExpansion({
      generated: {
        bgra: editedNativeImage.toBitmap(),
        size: intrinsic,
      },
      prepared: pendingExpansion,
    });
    bytes = nativeImage
      .createFromBitmap(Buffer.from(composite.bgra), {
        width: composite.size.width,
        height: composite.size.height,
      })
      .toPNG();
    editedNativeImage = nativeImage.createFromBuffer(bytes);
    intrinsic = editedNativeImage.getSize();
  }
  if (
    intrinsic.width <= 0 ||
    intrinsic.height <= 0 ||
    ((input.action === "remove-background" ||
      input.action === "isolate-object") &&
      !nativeImageHasTransparentPixels(editedNativeImage.toBitmap()))
  ) {
    throw new TypeError(
      input.action === "remove-background"
        ? "Background removal did not return a valid image with transparent pixels"
        : input.action === "isolate-object"
          ? "Object isolation did not return a valid image with transparent pixels"
          : "Image editing did not return a valid image",
    );
  }
  const supportingMaskAsset: DesignAsset | undefined = pendingMask
    ? {
        id: `asset_${createHash("sha256").update(pendingMask.bytes).digest("hex")}`,
        kind: "image",
        name: pendingMask.name,
        mimeType: "image/png",
        source: {
          type: "data",
          value: Buffer.from(pendingMask.bytes).toString("base64"),
        },
        size: pendingMask.size,
        extensions: {
          importedBy: input.importedBy,
          role: "image-edit-mask",
        },
      }
    : undefined;
  const attachment = await dependencies
    .getAttachmentHost()
    .importImageBytes(
      `${input.source.name.replace(/\.[^.]+$/, "")} — ${
        input.action === "remove-background"
          ? "Background removed"
          : input.action === "replace-background"
            ? "Background replaced"
            : input.action === "relight"
              ? "Lighting changed"
              : input.action === "erase-object"
                ? "Object erased"
                : input.action === "isolate-object"
                  ? "Object isolated"
                  : input.action === "expand"
                    ? "Expanded"
                    : input.action === "upscale"
                      ? "Resolution boosted"
                      : "Edited"
      }.png`,
      bytes,
    );
  const digest = attachment.attachmentId.slice("image_".length);
  const asset: DesignAsset = {
    id: `asset_${digest}`,
    kind: "image",
    name: attachment.name,
    mimeType: attachment.mimeType,
    source: { type: "data", value: bytes.toString("base64") },
    size: intrinsic,
    extensions: { importedBy: input.importedBy },
  };
  return {
    asset,
    derivation: {
      id: `image_derivation_${crypto.randomUUID()}`.slice(0, 256),
      sourceAssetId: input.source.id,
      resultAssetId: asset.id,
      operation: input.action,
      ...(input.action === "prompt-edit"
        ? { prompt: input.prompt.trim() }
        : input.action === "replace-background"
          ? { prompt: input.prompt.trim() }
          : input.action === "relight"
            ? { lightingPreset: input.lightingPreset }
            : input.action === "erase-object"
              ? { prompt: ERASE_OBJECT_PROMPT }
              : input.action === "isolate-object"
                ? { prompt: ISOLATE_OBJECT_PROMPT }
                : input.action === "expand"
                  ? { prompt: EXPAND_IMAGE_PROMPT }
                  : {}),
      ...(supportingMaskAsset ? { maskAssetId: supportingMaskAsset.id } : {}),
      referenceAssetIds: references.map((reference) => reference.id),
      extensions: {
        provider: edited.apiFormat,
        modelId: edited.modelId,
        ...(edited.providerRequestId
          ? { providerRequestId: edited.providerRequestId }
          : {}),
        ...(input.action === "erase-object" || input.action === "isolate-object"
          ? { selectionPointCount: input.selection.points.length }
          : {}),
        ...(input.action === "expand" && pendingExpansion
          ? {
              expansion: { ...input.expansion },
              sourcePlacement: structuredClone(input.placement),
              sourceTargetSize: { ...input.targetSize },
              providerCanvasSize: {
                ...pendingExpansion.geometry.outputSize,
              },
              providerSourceRect: {
                ...pendingExpansion.geometry.sourceRect,
              },
            }
          : {}),
        ...(input.action === "upscale" && pendingUpscale
          ? {
              sourceSize: { ...pendingUpscale.sourceSize },
              targetSize: { ...pendingUpscale.targetSize },
              preserveTransparency: pendingUpscale.preserveTransparency,
              pixelGain:
                (pendingUpscale.targetSize.width *
                  pendingUpscale.targetSize.height) /
                (pendingUpscale.sourceSize.width *
                  pendingUpscale.sourceSize.height),
            }
          : {}),
      },
    },
    ...(supportingMaskAsset
      ? { supportingAssets: [supportingMaskAsset] }
      : references.length === 0
        ? {}
        : { supportingAssets: [...references] }),
  };
}

function toImageEditSource(source: DesignAsset): {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  name: string;
} {
  if (
    source.kind !== "image" ||
    source.source.type !== "data" ||
    (source.mimeType !== "image/png" &&
      source.mimeType !== "image/jpeg" &&
      source.mimeType !== "image/webp")
  ) {
    throw new TypeError("Image edit source is not a supported embedded raster");
  }
  const bytes = Buffer.from(source.source.value, "base64");
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > 16 * 1024 * 1024 ||
    bytes.toString("base64") !== source.source.value
  ) {
    throw new TypeError("Image edit source has invalid image data");
  }
  const intrinsic = nativeImage.createFromBuffer(bytes).getSize();
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    throw new TypeError("Image edit source has invalid dimensions");
  }
  return { bytes, mimeType: source.mimeType, name: source.name };
}

function nativeImageHasTransparentPixels(bitmap: Buffer): boolean {
  if (bitmap.byteLength === 0 || bitmap.byteLength % 4 !== 0) return false;
  for (let offset = 3; offset < bitmap.byteLength; offset += 4) {
    if (bitmap[offset] !== 0xff) return true;
  }
  return false;
}
