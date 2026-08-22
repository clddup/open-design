import type {
  GlobalImageGenerationSettings,
  SaveGlobalImageGenerationSettingsRequest,
} from "../../shared/desktop-api";
import {
  GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION,
  isGlobalImageGenerationSettings,
  isSaveGlobalImageGenerationSettingsRequest,
  normalizeProviderBaseUrl,
} from "../../shared/desktop-api";
import type {
  GenerateImageToolInput,
  ImageGenerationOutputFormat,
  ImageGenerationQuality,
  ImageGenerationSize,
} from "../../shared/design-agent-tools";
import { resolveImageUpscaleSize } from "@opendesign/image-service";
import type { WorkspaceStore } from "../project/workspace-store";
import {
  modelProviderCredentialKey,
  type CredentialCipher,
} from "./model-provider-host";

const settingsKey = "image-generation.settings.v1";
const credentialKey = "image-generation.credential.v1";
const legacyCatalogKey = "model.provider.catalog.v2";
const IMAGE_GENERATION_TIMEOUT_MS = 10 * 60_000;
const MAX_IMAGE_GENERATION_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_EDIT_INPUT_BYTES = 50 * 1024 * 1024;

const defaultSettings: GlobalImageGenerationSettings = {
  version: GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION,
  enabled: false,
  apiFormat: "openai-images",
  authMode: "bearer",
  baseUrl: "https://api.openai.com/v1",
  modelId: "",
  hasApiKey: false,
  updatedAt: null,
};

export type GeneratedImage = {
  bytes: Uint8Array;
  apiFormat: GlobalImageGenerationSettings["apiFormat"];
  modelId: string;
  providerRequestId?: string;
  size: ImageGenerationSize;
  quality: ImageGenerationQuality;
  outputFormat: ImageGenerationOutputFormat;
};

export type ImageEditSource = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  name: string;
};

export type RemoveImageBackgroundInput = ImageEditSource;

export type ReplaceImageBackgroundInput = {
  source: ImageEditSource;
  prompt: string;
};

export type PromptImageEditInput = {
  source: ImageEditSource;
  prompt: string;
  references?: readonly ImageEditSource[];
};

export type MaskedImageEditInput = {
  source: ImageEditSource & { mimeType: "image/png" };
  mask: ImageEditSource & { mimeType: "image/png" };
};

export type ExpandImageInput = MaskedImageEditInput & {
  size: `${number}x${number}`;
};

export type UpscaleImageInput = {
  source: ImageEditSource & { mimeType: "image/png" };
  size: `${number}x${number}`;
  preserveTransparency: boolean;
};

export const ERASE_OBJECT_PROMPT =
  "Remove only the object or area inside the transparent mask and reconstruct the background naturally. Preserve the composition, geometry, lighting, texture, and every unmasked part of the source image. Do not crop, resize, restyle, or add unrelated content.";

export const ISOLATE_OBJECT_PROMPT =
  "Preserve the complete object indicated by the transparent mask, including fine edge detail, and isolate it on a fully transparent background. Remove everything else. Do not crop, resize, restyle, relight, or invent missing object content.";

export const EXPAND_IMAGE_PROMPT =
  "Extend the source image naturally into every transparent masked border. Continue the existing scene, composition, perspective, geometry, lighting, texture, depth, and color treatment. Preserve the complete unmasked source exactly, add no unrelated focal subject, and fill the full output canvas without seams or blank borders.";

export const BOOST_RESOLUTION_PROMPT =
  "Increase only the source image resolution and recover natural high-frequency detail. Preserve the exact composition, crop, geometry, subject identity, text, colors, lighting, transparency, and every visible element. Do not add, remove, move, restyle, relight, sharpen excessively, or invent unrelated content. Fill the exact requested output dimensions.";

export const REPLACE_BACKGROUND_PROMPT_PREFIX =
  "Replace only the background of the source image with the background described below. Preserve every foreground subject exactly, including identity, pose, silhouette, proportions, product geometry, logos, text, material, edge detail, lighting on the subject, placement, crop, and composition. Do not add, remove, move, resize, restyle, or relight foreground content. Make the new background spatially coherent with the existing subject and fill the complete image without borders. New background:";

export type EditedImage = {
  bytes: Uint8Array;
  apiFormat: GlobalImageGenerationSettings["apiFormat"];
  modelId: string;
  providerRequestId?: string;
  outputFormat: "png";
  operation:
    | "remove-background"
    | "replace-background"
    | "prompt-edit"
    | "erase-object"
    | "isolate-object"
    | "expand"
    | "upscale";
};

export class ImageGenerationHost {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly cipher: CredentialCipher,
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  getSettings(): GlobalImageGenerationSettings {
    const stored = this.store.getPreference(settingsKey);
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (isGlobalImageGenerationSettings(parsed)) {
          return this.withCredentialState(parsed);
        }
      } catch {
        // Invalid persisted settings are ignored without exposing their contents.
      }
    }
    return this.migrateLegacyCatalog() ?? { ...defaultSettings };
  }

  saveSettings(
    request: SaveGlobalImageGenerationSettingsRequest,
  ): GlobalImageGenerationSettings {
    if (!isSaveGlobalImageGenerationSettingsRequest(request)) {
      throw new TypeError("Invalid global image-generation settings");
    }
    if (request.apiKey !== undefined) {
      if (!this.cipher.available()) {
        throw new Error("Secure credential storage is unavailable");
      }
      this.store.setPreference(
        credentialKey,
        this.cipher.encrypt(request.apiKey).toString("base64"),
      );
    } else if (request.clearApiKey) {
      this.store.deletePreference(credentialKey);
    }
    const settings: GlobalImageGenerationSettings = {
      version: GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION,
      enabled: request.enabled,
      apiFormat: request.apiFormat,
      authMode: request.authMode,
      baseUrl: normalizeProviderBaseUrl(request.baseUrl),
      modelId: request.modelId.trim(),
      hasApiKey: this.store.getPreference(credentialKey) !== null,
      updatedAt: new Date().toISOString(),
    };
    this.persist(settings);
    return settings;
  }

  async generateImage(
    input: GenerateImageToolInput,
    signal: AbortSignal,
  ): Promise<GeneratedImage> {
    const settings = this.getSettings();
    if (!settings.enabled) {
      throw new Error("Global image generation is not enabled");
    }
    if (!settings.modelId) {
      throw new Error("No global image-generation model is configured");
    }
    if (settings.apiFormat !== "openai-images") {
      throw new Error(
        "No supported global image-generation adapter is configured",
      );
    }
    const size = input.size ?? "auto";
    const quality = input.quality ?? "auto";
    const outputFormat = input.outputFormat ?? "png";
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () =>
        controller.abort(
          new DOMException(
            "Image generation timed out after 10 minutes",
            "TimeoutError",
          ),
        ),
      IMAGE_GENERATION_TIMEOUT_MS,
    );
    try {
      const response = await this.fetch(
        `${settings.baseUrl}/images/generations`,
        {
          method: "POST",
          headers: this.headers(settings),
          signal: controller.signal,
          body: JSON.stringify({
            model: settings.modelId,
            prompt: input.prompt.trim(),
            n: 1,
            size,
            quality,
            output_format: outputFormat,
          }),
        },
      );
      const payloadText = await readBoundedResponseText(
        response,
        MAX_IMAGE_GENERATION_RESPONSE_BYTES,
        controller.signal,
      );
      let payload: unknown;
      try {
        payload = JSON.parse(payloadText);
      } catch {
        throw new Error("Image-generation provider returned invalid JSON");
      }
      if (!response.ok) {
        throw new Error(
          `Image generation failed with HTTP ${response.status}: ${providerErrorMessage(payload)}`,
        );
      }
      const encoded = imageResponseBase64(payload);
      const bytes = decodeBoundedBase64(encoded, MAX_GENERATED_IMAGE_BYTES);
      const providerRequestId = response.headers.get("x-request-id")?.trim();
      return {
        bytes,
        apiFormat: settings.apiFormat,
        modelId: settings.modelId,
        ...(providerRequestId ? { providerRequestId } : {}),
        size,
        quality,
        outputFormat,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new DOMException("Image generation cancelled", "AbortError");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  async removeBackground(
    input: RemoveImageBackgroundInput,
    signal: AbortSignal,
  ): Promise<EditedImage> {
    return this.editImage(
      {
        operation: "remove-background",
        prompt:
          "Preserve the complete foreground subject and its fine edge detail. Remove only the background and return the subject on a fully transparent background. Do not restyle, crop, resize, relight, add, or remove foreground content.",
        sources: [input],
        background: "transparent",
      },
      signal,
    );
  }

  async editWithPrompt(
    input: PromptImageEditInput,
    signal: AbortSignal,
  ): Promise<EditedImage> {
    const prompt = input.prompt.trim();
    if (prompt.length < 1 || prompt.length > 32_000) {
      throw new RangeError(
        "Image edit prompt must contain 1 to 32,000 characters",
      );
    }
    const references = input.references ?? [];
    if (references.length > 1) {
      throw new RangeError(
        "Image prompt editing supports at most one reference image",
      );
    }
    return this.editImage(
      {
        operation: "prompt-edit",
        prompt,
        sources: [input.source, ...references],
        background: "auto",
      },
      signal,
    );
  }

  async replaceBackground(
    input: ReplaceImageBackgroundInput,
    signal: AbortSignal,
  ): Promise<EditedImage> {
    const prompt = input.prompt.trim();
    if (prompt.length < 1 || prompt.length > 32_000) {
      throw new RangeError(
        "Image background prompt must contain 1 to 32,000 characters",
      );
    }
    return this.editImage(
      {
        operation: "replace-background",
        prompt: `${REPLACE_BACKGROUND_PROMPT_PREFIX}\n${prompt}`,
        sources: [input.source],
        background: "auto",
      },
      signal,
    );
  }

  async eraseObject(
    input: MaskedImageEditInput,
    signal: AbortSignal,
  ): Promise<EditedImage> {
    return this.editMaskedImage(
      input,
      "erase-object",
      ERASE_OBJECT_PROMPT,
      "auto",
      signal,
    );
  }

  async isolateObject(
    input: MaskedImageEditInput,
    signal: AbortSignal,
  ): Promise<EditedImage> {
    return this.editMaskedImage(
      input,
      "isolate-object",
      ISOLATE_OBJECT_PROMPT,
      "transparent",
      signal,
    );
  }

  async expandImage(
    input: ExpandImageInput,
    signal: AbortSignal,
  ): Promise<EditedImage> {
    return this.editMaskedImage(
      input,
      "expand",
      EXPAND_IMAGE_PROMPT,
      "auto",
      signal,
      input.size,
    );
  }

  async boostResolution(
    input: UpscaleImageInput,
    signal: AbortSignal,
  ): Promise<EditedImage> {
    assertImageEditSource(input.source);
    const source = pngMetadata(input.source.bytes);
    const target = resolveImageUpscaleSize({
      width: source.width,
      height: source.height,
    });
    if (input.size !== `${target.width}x${target.height}`) {
      throw new TypeError(
        "Image upscale request size must match the trusted source target",
      );
    }
    const edited = await this.editImage(
      {
        operation: "upscale",
        prompt: BOOST_RESOLUTION_PROMPT,
        sources: [input.source],
        background: input.preserveTransparency ? "transparent" : "auto",
        size: input.size,
      },
      signal,
    );
    const result = pngMetadata(edited.bytes);
    if (result.width !== target.width || result.height !== target.height) {
      throw new TypeError(
        "Upscaled image output dimensions must match the trusted target",
      );
    }
    return edited;
  }

  private async editMaskedImage(
    input: MaskedImageEditInput,
    operation: "erase-object" | "isolate-object" | "expand",
    prompt: string,
    background: "auto" | "transparent",
    signal: AbortSignal,
    requestedSize?: `${number}x${number}`,
  ): Promise<EditedImage> {
    assertImageEditSource(input.source);
    assertImageEditSource(input.mask);
    const source = pngMetadata(input.source.bytes);
    const mask = pngMetadata(input.mask.bytes);
    if (
      source.width !== mask.width ||
      source.height !== mask.height ||
      !mask.alphaCapable
    ) {
      throw new TypeError(
        "Image edit mask must be an alpha PNG matching the source dimensions",
      );
    }
    if (
      operation === "expand" &&
      requestedSize !== `${source.width}x${source.height}`
    ) {
      throw new TypeError(
        "Expanded image request size must match the prepared source canvas",
      );
    }
    const edited = await this.editImage(
      {
        operation,
        prompt,
        sources: [input.source],
        mask: input.mask,
        background,
        ...(requestedSize ? { size: requestedSize } : {}),
      },
      signal,
    );
    if (operation === "expand") {
      const result = pngMetadata(edited.bytes);
      if (result.width !== source.width || result.height !== source.height) {
        throw new TypeError(
          "Expanded image output dimensions must match the prepared source canvas",
        );
      }
    }
    return edited;
  }

  private async editImage(
    input: {
      operation: EditedImage["operation"];
      prompt: string;
      sources: readonly ImageEditSource[];
      mask?: ImageEditSource & { mimeType: "image/png" };
      background: "auto" | "transparent";
      size?: `${number}x${number}`;
    },
    signal: AbortSignal,
  ): Promise<EditedImage> {
    if (input.sources.length < 1 || input.sources.length > 2) {
      throw new RangeError(
        "Image editing requires one source and at most one reference",
      );
    }
    input.sources.forEach(assertImageEditSource);
    const settings = this.requireEnabledSettings();
    const form = new FormData();
    form.set("model", settings.modelId);
    form.set("prompt", input.prompt);
    for (const source of input.sources) {
      const uploadBytes = new Uint8Array(source.bytes.byteLength);
      uploadBytes.set(source.bytes);
      form.append(
        "image[]",
        new Blob([uploadBytes.buffer], { type: source.mimeType }),
        safeUploadName(source.name, source.mimeType),
      );
    }
    if (input.mask) {
      const uploadBytes = new Uint8Array(input.mask.bytes.byteLength);
      uploadBytes.set(input.mask.bytes);
      form.set(
        "mask",
        new Blob([uploadBytes.buffer], { type: "image/png" }),
        safeUploadName(input.mask.name, "image/png"),
      );
    }
    form.set("n", "1");
    form.set("size", input.size ?? "auto");
    form.set("quality", "auto");
    form.set("background", input.background);
    form.set("output_format", "png");

    const controller = this.createRequestController(
      signal,
      "Image editing timed out after 10 minutes",
    );
    try {
      const response = await this.fetch(`${settings.baseUrl}/images/edits`, {
        method: "POST",
        headers: this.headers(settings, false),
        signal: controller.signal,
        body: form,
      });
      const payloadText = await readBoundedResponseText(
        response,
        MAX_IMAGE_GENERATION_RESPONSE_BYTES,
        controller.signal,
      );
      let payload: unknown;
      try {
        payload = JSON.parse(payloadText);
      } catch {
        throw new Error("Image-editing provider returned invalid JSON");
      }
      if (!response.ok) {
        throw new Error(
          `Image editing failed with HTTP ${response.status}: ${providerErrorMessage(payload)}`,
        );
      }
      const bytes = decodeBoundedBase64(
        imageResponseBase64(payload),
        MAX_GENERATED_IMAGE_BYTES,
      );
      if (input.background === "transparent") {
        assertPngWithTransparency(bytes);
      } else {
        assertPng(bytes);
      }
      const providerRequestId = response.headers.get("x-request-id")?.trim();
      return {
        bytes,
        apiFormat: settings.apiFormat,
        modelId: settings.modelId,
        ...(providerRequestId ? { providerRequestId } : {}),
        outputFormat: "png",
        operation: input.operation,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new DOMException("Image editing cancelled", "AbortError");
      }
      throw error;
    } finally {
      controller.dispose();
    }
  }

  private headers(
    settings: GlobalImageGenerationSettings,
    includeJsonContentType = true,
  ): Headers {
    const headers = new Headers({
      accept: "application/json",
    });
    if (includeJsonContentType) headers.set("content-type", "application/json");
    const credential = this.credential();
    if (settings.authMode !== "none" && !credential) {
      throw new Error("Global image-generation API key is not configured");
    }
    if (settings.authMode === "bearer" && credential) {
      headers.set("authorization", `Bearer ${credential}`);
    } else if (settings.authMode === "x-api-key" && credential) {
      headers.set("x-api-key", credential);
    }
    return headers;
  }

  private requireEnabledSettings(): GlobalImageGenerationSettings {
    const settings = this.getSettings();
    if (!settings.enabled) {
      throw new Error("Global image generation is not enabled");
    }
    if (!settings.modelId) {
      throw new Error("No global image-generation model is configured");
    }
    if (settings.apiFormat !== "openai-images") {
      throw new Error(
        "No supported global image-generation adapter is configured",
      );
    }
    return settings;
  }

  private createRequestController(
    signal: AbortSignal,
    timeoutMessage: string,
  ): AbortController & { dispose: () => void } {
    const controller = new AbortController() as AbortController & {
      dispose: () => void;
    };
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new DOMException(timeoutMessage, "TimeoutError")),
      IMAGE_GENERATION_TIMEOUT_MS,
    );
    controller.dispose = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    };
    return controller;
  }

  private credential(): string | undefined {
    const encrypted = this.store.getPreference(credentialKey);
    if (!encrypted) return undefined;
    if (!this.cipher.available()) {
      throw new Error("Secure credential storage is unavailable");
    }
    return this.cipher.decrypt(Buffer.from(encrypted, "base64"));
  }

  private persist(settings: GlobalImageGenerationSettings): void {
    this.store.setPreference(
      settingsKey,
      JSON.stringify({ ...settings, hasApiKey: false }),
    );
  }

  private withCredentialState(
    settings: GlobalImageGenerationSettings,
  ): GlobalImageGenerationSettings {
    return {
      ...settings,
      hasApiKey: this.store.getPreference(credentialKey) !== null,
    };
  }

  private migrateLegacyCatalog(): GlobalImageGenerationSettings | null {
    const raw = this.store.getPreference(legacyCatalogKey);
    if (!raw) return null;
    try {
      const source = legacyImageGenerationSource(JSON.parse(raw));
      if (!source) return null;
      const oldCredential = this.store.getPreference(
        modelProviderCredentialKey(source.providerId),
      );
      if (oldCredential && !this.store.getPreference(credentialKey)) {
        this.store.setPreference(credentialKey, oldCredential);
      }
      const settings: GlobalImageGenerationSettings = {
        version: GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION,
        enabled: true,
        apiFormat: "openai-images",
        authMode: source.authMode,
        baseUrl: normalizeProviderBaseUrl(source.baseUrl),
        modelId: source.modelId,
        hasApiKey: this.store.getPreference(credentialKey) !== null,
        updatedAt: source.updatedAt,
      };
      if (!isGlobalImageGenerationSettings(settings)) return null;
      this.persist(settings);
      return settings;
    } catch {
      return null;
    }
  }
}

type LegacyImageGenerationSource = {
  providerId: string;
  authMode: GlobalImageGenerationSettings["authMode"];
  baseUrl: string;
  modelId: string;
  updatedAt: string | null;
};

function legacyImageGenerationSource(
  value: unknown,
): LegacyImageGenerationSource | null {
  if (
    !record(value) ||
    value.version !== 2 ||
    !Array.isArray(value.providers)
  ) {
    return null;
  }
  const selection = value.defaultImageGenerationSelection;
  if (
    !record(selection) ||
    typeof selection.providerId !== "string" ||
    typeof selection.modelId !== "string"
  ) {
    return null;
  }
  const providers: unknown[] = value.providers;
  const provider = providers.find(
    (candidate) =>
      record(candidate) && candidate.providerId === selection.providerId,
  );
  if (
    !record(provider) ||
    provider.enabled !== true ||
    provider.imageGenerationApiFormat !== "openai-images" ||
    (provider.authMode !== "bearer" &&
      provider.authMode !== "x-api-key" &&
      provider.authMode !== "none") ||
    typeof provider.baseUrl !== "string" ||
    !Array.isArray(provider.models)
  ) {
    return null;
  }
  const models: unknown[] = provider.models;
  const model = models.find(
    (candidate) => record(candidate) && candidate.modelId === selection.modelId,
  );
  if (
    !record(model) ||
    !record(model.capabilities) ||
    model.capabilities.imageGeneration !== true
  ) {
    return null;
  }
  const source: LegacyImageGenerationSource = {
    providerId: selection.providerId,
    authMode: provider.authMode,
    baseUrl: provider.baseUrl,
    modelId: selection.modelId,
    updatedAt:
      provider.updatedAt === null || typeof provider.updatedAt === "string"
        ? provider.updatedAt
        : null,
  };
  const request = {
    enabled: true,
    apiFormat: "openai-images" as const,
    authMode: source.authMode,
    baseUrl: source.baseUrl,
    modelId: source.modelId,
  };
  return isSaveGlobalImageGenerationSettingsRequest(request) ? source : null;
}

async function readBoundedResponseText(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    throw new RangeError("Image-generation response exceeds the 24 MB limit");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximum) {
      throw new RangeError("Image-generation response exceeds the 24 MB limit");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Image generation cancelled", "AbortError");
      }
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new RangeError(
          "Image-generation response exceeds the 24 MB limit",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function imageResponseBase64(value: unknown): string {
  if (!record(value) || !Array.isArray(value.data)) {
    throw new Error("Image-generation provider returned no image data");
  }
  const data = value.data as unknown[];
  const first: unknown = data[0];
  if (!record(first) || typeof first.b64_json !== "string") {
    throw new Error(
      "Image-generation provider did not return data[0].b64_json",
    );
  }
  return first.b64_json;
}

function decodeBoundedBase64(value: string, maximum: number): Uint8Array {
  const maximumEncodedLength = Math.ceil(maximum / 3) * 4;
  if (
    value.length === 0 ||
    value.length > maximumEncodedLength ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new TypeError("Image-generation provider returned invalid base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maximum) {
    throw new RangeError("Generated image exceeds the 16 MB limit");
  }
  if (bytes.toString("base64") !== value) {
    throw new TypeError("Image-generation provider returned invalid base64");
  }
  return new Uint8Array(bytes);
}

function providerErrorMessage(value: unknown): string {
  if (
    record(value) &&
    record(value.error) &&
    typeof value.error.message === "string"
  ) {
    return value.error.message.slice(0, 2_000);
  }
  return "Provider rejected the image-generation request";
}

function safeUploadName(
  value: string,
  mimeType: RemoveImageBackgroundInput["mimeType"],
): string {
  const extension =
    mimeType === "image/jpeg" ? "jpg" : mimeType.replace("image/", "");
  const stem = value
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${stem || "source-image"}.${extension}`;
}

function assertImageEditSource(source: ImageEditSource): void {
  if (
    source.bytes.byteLength === 0 ||
    source.bytes.byteLength > MAX_IMAGE_EDIT_INPUT_BYTES
  ) {
    throw new RangeError("Image edit inputs must be between 1 byte and 50 MB");
  }
}

function assertPngWithTransparency(value: Uint8Array): void {
  if (!pngMetadata(value).alphaCapable) {
    throw new TypeError(
      "Image-editing provider returned a PNG without transparency",
    );
  }
}

function assertPng(value: Uint8Array): void {
  pngMetadata(value);
}

function pngMetadata(value: Uint8Array): {
  alphaCapable: boolean;
  height: number;
  width: number;
} {
  const bytes = Buffer.from(value);
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (bytes.byteLength < 33 || !bytes.subarray(0, 8).equals(signature)) {
    throw new TypeError("Image-editing provider did not return a PNG image");
  }
  let offset = 8;
  let alphaCapable = false;
  let sawHeader = false;
  let sawEnd = false;
  let width = 0;
  let height = 0;
  while (offset + 12 <= bytes.byteLength) {
    const length = bytes.readUInt32BE(offset);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + length + 4;
    if (nextOffset > bytes.byteLength) {
      throw new TypeError("Image-editing provider returned a malformed PNG");
    }
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR") {
      if (sawHeader || offset !== 8 || length !== 13) {
        throw new TypeError("Image-editing provider returned a malformed PNG");
      }
      sawHeader = true;
      width = bytes.readUInt32BE(dataOffset);
      height = bytes.readUInt32BE(dataOffset + 4);
      if (width <= 0 || height <= 0) {
        throw new TypeError("Image-editing provider returned a malformed PNG");
      }
      const colorType = bytes[dataOffset + 9];
      alphaCapable = colorType === 4 || colorType === 6;
    } else if (type === "tRNS") {
      alphaCapable = true;
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    offset = nextOffset;
  }
  if (!sawHeader || !sawEnd) {
    throw new TypeError("Image-editing provider returned a malformed PNG");
  }
  return { alphaCapable, width, height };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
