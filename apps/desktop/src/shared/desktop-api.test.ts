import { createWelcomeDocument } from "@opendesign/editor-runtime";
import {
  PROJECT_MANIFEST_VERSION,
  WORKSPACE_CONTRACT_VERSION,
} from "@opendesign/workspace-contracts";
import { describe, expect, it } from "vitest";
import {
  isConversationDescriptorResult,
  isCreateConversationRequest,
  isCreateProjectDesignFileRequest,
  isCreateProjectRequest,
  isAgentAttachmentPreviewRequest,
  isAgentAttachmentPreviewResult,
  isAgentAttachmentSelection,
  isDesignImageEditRequest,
  isDesignImageEditResult,
  isDesignImageSelection,
  isFontBinaryDescriptor,
  isFontBinaryPayload,
  isFontBinaryReadRequest,
  isGlobalImageGenerationSettings,
  isGlobalTaskProjectionResult,
  isDeleteConversationRequest,
  isModelProviderCatalog,
  isProviderConnectionResult,
  migrateModelProviderCatalog,
  isProjectDesignFile,
  isProjectDesignFileRequest,
  isProjectManifestResult,
  isRecentProject,
  isRenameProjectDesignFileRequest,
  isOpenSvgFile,
  isSaveDesignFileRequest,
  isSaveGlobalImageGenerationSettingsRequest,
  isSaveModelProviderProfileRequest,
  isSaveProjectDesignFileRequest,
  isSaveSvgFileRequest,
  isSaveSvgFileResult,
  isSaveRasterFileRequest,
  isSaveRasterFileResult,
} from "./desktop-api";

const now = "2026-08-07T12:00:00.000Z";

describe("Model provider desktop API guards", () => {
  const profile = {
    providerId: "provider_1",
    name: "Primary",
    enabled: true,
    apiFormat: "openai-responses",
    authMode: "bearer",
    baseUrl: "https://api.openai.com/v1",
    models: [
      {
        modelId: "design-model",
        name: "Design model",
        contextWindow: 200_000,
        maxOutputTokens: 16_384,
        capabilities: {
          toolUse: true,
          imageInput: true,
          reasoning: true,
        },
        reasoningEfforts: ["off", "medium", "high"],
      },
    ],
  };

  it("accepts a sanitized catalog and rejects returned credentials", () => {
    expect(
      isModelProviderCatalog({
        version: 3,
        providers: [{ ...profile, hasApiKey: true, updatedAt: now }],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "design-model",
          reasoningEffort: "medium",
        },
      }),
    ).toBe(true);
    expect(
      isModelProviderCatalog({
        version: 3,
        providers: [
          { ...profile, hasApiKey: true, updatedAt: now, apiKey: "secret" },
        ],
      }),
    ).toBe(false);
  });

  it("migrates v1 catalogs into a conversation-only v3 catalog", () => {
    const migrated = migrateModelProviderCatalog({
      version: 1,
      providers: [
        {
          ...profile,
          models: profile.models.map((model) => ({
            ...model,
            capabilities: {
              toolUse: model.capabilities.toolUse,
              imageInput: model.capabilities.imageInput,
              reasoning: model.capabilities.reasoning,
            },
          })),
          hasApiKey: true,
          updatedAt: now,
        },
      ],
      defaultSelection: {
        providerId: "provider_1",
        modelId: "design-model",
        reasoningEffort: "medium",
      },
    });

    expect(migrated?.version).toBe(3);
    expect(migrated?.providers[0]?.models[0]?.capabilities).toEqual({
      toolUse: true,
      imageInput: true,
      reasoning: true,
    });
  });

  it("strips legacy image-generation fields while migrating v2 catalogs", () => {
    const migrated = migrateModelProviderCatalog({
      version: 2,
      providers: [
        {
          ...profile,
          imageGenerationApiFormat: "openai-images",
          models: profile.models.map((model) => ({
            ...model,
            capabilities: {
              ...model.capabilities,
              imageGeneration: true,
            },
          })),
          hasApiKey: true,
          updatedAt: now,
        },
      ],
      defaultSelection: {
        providerId: "provider_1",
        modelId: "design-model",
        reasoningEffort: "medium",
      },
      defaultImageGenerationSelection: {
        providerId: "provider_1",
        modelId: "design-model",
      },
    });

    expect(migrated).toMatchObject({ version: 3 });
    expect(migrated?.providers[0]).not.toHaveProperty(
      "imageGenerationApiFormat",
    );
    expect(migrated?.providers[0]?.models[0]?.capabilities).not.toHaveProperty(
      "imageGeneration",
    );
    expect(migrated).not.toHaveProperty("defaultImageGenerationSelection");
  });

  it("validates protocol profiles, local URLs and secret-bearing save requests", () => {
    expect(
      isSaveModelProviderProfileRequest({
        ...profile,
        apiKey: "secret",
      }),
    ).toBe(true);
    expect(
      isSaveModelProviderProfileRequest({
        ...profile,
        apiFormat: "anthropic-messages",
        authMode: "x-api-key",
        baseUrl: "http://localhost:11434/v1",
      }),
    ).toBe(true);
    expect(
      isSaveModelProviderProfileRequest({
        ...profile,
        baseUrl: "https://secret@models.example/v1",
      }),
    ).toBe(false);
  });

  it("requires an exact Agent compatibility connection result", () => {
    expect(
      isProviderConnectionResult({
        status: "text-only",
        ok: false,
        message: "Parameterized tool call was not produced",
        providerId: "provider_1",
        modelId: "design-model",
        latencyMs: 42,
        textLatencyMs: 10,
        toolLatencyMs: 32,
      }),
    ).toBe(true);
    expect(
      isProviderConnectionResult({
        status: "text-only",
        ok: true,
        message: "Contradictory result",
        providerId: "provider_1",
        modelId: "design-model",
        latencyMs: 42,
      }),
    ).toBe(false);
  });
});

describe("Global image-generation desktop API guards", () => {
  const settings = {
    version: 1,
    enabled: true,
    apiFormat: "openai-images",
    authMode: "bearer",
    baseUrl: "https://images.example/v1",
    modelId: "future-image-model",
    hasApiKey: true,
    updatedAt: now,
  };

  it("accepts only the standalone sanitized settings shape", () => {
    expect(isGlobalImageGenerationSettings(settings)).toBe(true);
    expect(
      isGlobalImageGenerationSettings({
        ...settings,
        providerId: "provider_1",
      }),
    ).toBe(false);
    expect(
      isGlobalImageGenerationSettings({ ...settings, apiKey: "secret" }),
    ).toBe(false);
  });

  it("validates independent settings writes without a Provider selection", () => {
    expect(
      isSaveGlobalImageGenerationSettingsRequest({
        enabled: true,
        apiFormat: "openai-images",
        authMode: "x-api-key",
        baseUrl: "https://images.example/v1",
        modelId: "future-image-model",
        apiKey: "image-secret",
      }),
    ).toBe(true);
    expect(
      isSaveGlobalImageGenerationSettingsRequest({
        enabled: false,
        apiFormat: "openai-images",
        authMode: "bearer",
        baseUrl: "https://images.example/v1",
        modelId: "",
      }),
    ).toBe(true);
    expect(
      isSaveGlobalImageGenerationSettingsRequest({
        enabled: true,
        apiFormat: "openai-images",
        authMode: "bearer",
        baseUrl: "https://images.example/v1",
        modelId: "",
      }),
    ).toBe(false);
  });
});

describe("Agent attachment desktop API guards", () => {
  const attachmentId = `image_${"a".repeat(64)}`;

  it("accepts only path-free content-addressed selections and previews", () => {
    expect(
      isAgentAttachmentSelection({
        attachmentId,
        name: "reference.png",
        mimeType: "image/png",
        byteSize: 1024,
        previewDataUrl: "data:image/png;base64,aW1hZ2U=",
      }),
    ).toBe(true);
    expect(isAgentAttachmentPreviewRequest({ attachmentId })).toBe(true);
    expect(
      isAgentAttachmentPreviewResult({
        attachmentId,
        previewDataUrl: "data:image/png;base64,aW1hZ2U=",
      }),
    ).toBe(true);
    const documentId = `file_${"b".repeat(64)}`;
    expect(
      isAgentAttachmentSelection({
        attachmentId: documentId,
        name: "product-brief.md",
        mimeType: "text/markdown",
        byteSize: 2048,
      }),
    ).toBe(true);
    expect(
      isAgentAttachmentPreviewResult({
        attachmentId: documentId,
        previewDataUrl: null,
      }),
    ).toBe(true);
    const svgId = `svg_${"c".repeat(64)}`;
    expect(
      isAgentAttachmentSelection({
        attachmentId: svgId,
        name: "brand-mark.svg",
        mimeType: "image/svg+xml",
        byteSize: 4096,
      }),
    ).toBe(true);
    expect(
      isAgentAttachmentPreviewResult({
        attachmentId: svgId,
        previewDataUrl: null,
      }),
    ).toBe(true);
    expect(
      isAgentAttachmentSelection({
        attachmentId: svgId,
        name: "brand-mark.svg",
        mimeType: "text/plain",
        byteSize: 4096,
      }),
    ).toBe(false);
  });

  it("rejects arbitrary paths and mismatched preview media types", () => {
    expect(
      isAgentAttachmentSelection({
        attachmentId,
        name: "reference.png",
        mimeType: "image/png",
        byteSize: 1024,
        previewDataUrl: "data:image/jpeg;base64,aW1hZ2U=",
        path: "/tmp/reference.png",
      }),
    ).toBe(false);
    expect(
      isAgentAttachmentPreviewRequest({
        attachmentId: "../../reference.png",
      }),
    ).toBe(false);
  });
});

describe("Design image desktop API guards", () => {
  const sourceAsset = {
    id: `asset_${"a".repeat(64)}`,
    kind: "image",
    name: "Hero.webp",
    mimeType: "image/webp",
    source: { type: "data", value: "aW1hZ2U=" },
    size: { width: 1600, height: 900 },
    extensions: { importedBy: "design-image-picker" },
  } as const;
  const referenceAsset = {
    ...sourceAsset,
    id: `asset_${"b".repeat(64)}`,
    name: "Reference.png",
    mimeType: "image/png",
  } as const;

  it("accepts an embedded content-addressed image without exposing its path", () => {
    const selection = { asset: sourceAsset };
    expect(isDesignImageSelection(selection)).toBe(true);
    expect(
      isDesignImageSelection({
        ...selection,
        asset: {
          ...selection.asset,
          source: { type: "external", value: "C:\\Users\\me\\hero.webp" },
        },
      }),
    ).toBe(false);
  });

  it("accepts exact prompt edits with one distinct embedded reference", () => {
    const request = {
      requestId: "image_edit_request",
      action: "prompt-edit",
      pageId: "page_welcome",
      nodeId: "hero",
      expectedAssetId: sourceAsset.id,
      source: sourceAsset,
      prompt: "Use the reference lighting and preserve the subject",
      reference: referenceAsset,
    };
    expect(isDesignImageEditRequest(request)).toBe(true);
    expect(isDesignImageEditRequest({ ...request, prompt: "   " })).toBe(false);
    expect(
      isDesignImageEditRequest({ ...request, reference: sourceAsset }),
    ).toBe(false);
    expect(
      isDesignImageEditRequest({ ...request, provider: "openai-images" }),
    ).toBe(false);
  });

  it("binds prompt-edit results to exact supporting assets and provenance", () => {
    const resultAsset = {
      ...referenceAsset,
      id: `asset_${"c".repeat(64)}`,
      name: "Hero — Edited.png",
    };
    const result = {
      requestId: "image_edit_request",
      action: "prompt-edit",
      sourceAssetId: sourceAsset.id,
      asset: resultAsset,
      supportingAssets: [referenceAsset],
      derivation: {
        id: "image_derivation_prompt_edit",
        sourceAssetId: sourceAsset.id,
        resultAssetId: resultAsset.id,
        operation: "prompt-edit",
        prompt: "Use the reference lighting and preserve the subject",
        referenceAssetIds: [referenceAsset.id],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    };
    expect(isDesignImageEditResult(result)).toBe(true);
    expect(isDesignImageEditResult({ ...result, supportingAssets: [] })).toBe(
      false,
    );
    expect(
      isDesignImageEditResult({
        ...result,
        derivation: { ...result.derivation, prompt: undefined },
      }),
    ).toBe(false);
    expect(isDesignImageEditResult({ ...result, bytes: "not allowed" })).toBe(
      false,
    );
  });

  it("binds background replacement to one description and no hidden inputs", () => {
    const request = {
      requestId: "image_background_request",
      action: "replace-background",
      pageId: "page_welcome",
      nodeId: "hero",
      expectedAssetId: sourceAsset.id,
      source: sourceAsset,
      prompt: "A warm editorial studio with a limestone plinth",
    };
    expect(isDesignImageEditRequest(request)).toBe(true);
    expect(isDesignImageEditRequest({ ...request, prompt: "   " })).toBe(false);
    expect(
      isDesignImageEditRequest({ ...request, reference: referenceAsset }),
    ).toBe(false);

    const resultAsset = {
      ...sourceAsset,
      id: `asset_${"9".repeat(64)}`,
      name: "Hero — Background replaced.png",
      mimeType: "image/png",
    };
    const result = {
      requestId: request.requestId,
      action: request.action,
      sourceAssetId: sourceAsset.id,
      asset: resultAsset,
      derivation: {
        id: "image_derivation_background",
        sourceAssetId: sourceAsset.id,
        resultAssetId: resultAsset.id,
        operation: request.action,
        prompt: request.prompt,
        referenceAssetIds: [],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    };
    expect(isDesignImageEditResult(result)).toBe(true);
    expect(
      isDesignImageEditResult({
        ...result,
        derivation: {
          ...result.derivation,
          referenceAssetIds: [referenceAsset.id],
        },
        supportingAssets: [referenceAsset],
      }),
    ).toBe(false);
  });

  it("binds relighting to one trusted lighting preset", () => {
    const request = {
      requestId: "image_relight_request",
      action: "relight",
      pageId: "page_welcome",
      nodeId: "hero",
      expectedAssetId: sourceAsset.id,
      source: sourceAsset,
      lightingPreset: "neon",
    };
    expect(isDesignImageEditRequest(request)).toBe(true);
    expect(
      isDesignImageEditRequest({ ...request, lightingPreset: "party-mode" }),
    ).toBe(false);
    expect(
      isDesignImageEditRequest({ ...request, prompt: "Make it neon" }),
    ).toBe(false);

    const resultAsset = {
      ...sourceAsset,
      id: `asset_${"8".repeat(64)}`,
      name: "Hero — Lighting changed.png",
      mimeType: "image/png",
    };
    const result = {
      requestId: request.requestId,
      action: request.action,
      sourceAssetId: sourceAsset.id,
      asset: resultAsset,
      derivation: {
        id: "image_derivation_relight",
        sourceAssetId: sourceAsset.id,
        resultAssetId: resultAsset.id,
        operation: request.action,
        lightingPreset: request.lightingPreset,
        referenceAssetIds: [],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    };
    expect(isDesignImageEditResult(result)).toBe(true);
    expect(
      isDesignImageEditResult({
        ...result,
        derivation: { ...result.derivation, prompt: "Make it neon" },
      }),
    ).toBe(false);
  });

  it("accepts bounded source-normalized area edits and exact mask provenance", () => {
    const request = {
      requestId: "image_area_edit_request",
      action: "erase-object",
      pageId: "page_welcome",
      nodeId: "hero",
      expectedAssetId: sourceAsset.id,
      source: sourceAsset,
      selection: {
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
      },
    };
    expect(isDesignImageEditRequest(request)).toBe(true);
    expect(
      isDesignImageEditRequest({
        ...request,
        selection: { points: [{ x: 2, y: 0 }] },
      }),
    ).toBe(false);

    const maskAsset = {
      ...referenceAsset,
      id: `asset_${"d".repeat(64)}`,
      name: "Selection mask.png",
    };
    const resultAsset = {
      ...referenceAsset,
      id: `asset_${"e".repeat(64)}`,
      name: "Hero — Object erased.png",
    };
    const result = {
      requestId: request.requestId,
      action: "erase-object",
      sourceAssetId: sourceAsset.id,
      asset: resultAsset,
      supportingAssets: [maskAsset],
      derivation: {
        id: "image_derivation_erase",
        sourceAssetId: sourceAsset.id,
        resultAssetId: resultAsset.id,
        operation: "erase-object",
        prompt: "Remove the selected object",
        maskAssetId: maskAsset.id,
        referenceAssetIds: [],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    };
    expect(isDesignImageEditResult(result)).toBe(true);
    expect(
      isDesignImageEditResult({
        ...result,
        derivation: { ...result.derivation, maskAssetId: referenceAsset.id },
      }),
    ).toBe(false);
    expect(
      isDesignImageEditResult({
        ...result,
        supportingAssets: [{ ...maskAsset, mimeType: "image/jpeg" }],
      }),
    ).toBe(false);
  });

  it("binds image expansion to exact geometry and PNG mask provenance", () => {
    const request = {
      requestId: "image_expand_request",
      action: "expand",
      pageId: "page_welcome",
      nodeId: "hero",
      expectedAssetId: sourceAsset.id,
      source: sourceAsset,
      expansion: { top: 20, right: 100, bottom: 20, left: 0 },
      placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
      targetSize: { width: 400, height: 300 },
    };
    expect(isDesignImageEditRequest(request)).toBe(true);
    expect(
      isDesignImageEditRequest({
        ...request,
        expansion: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    ).toBe(false);
    expect(
      isDesignImageEditRequest({
        ...request,
        targetSize: { width: 0, height: 300 },
      }),
    ).toBe(false);

    const maskAsset = {
      ...referenceAsset,
      id: `asset_${"1".repeat(64)}`,
      name: "Expansion mask.png",
      mimeType: "image/png",
    };
    const resultAsset = {
      ...referenceAsset,
      id: `asset_${"2".repeat(64)}`,
      name: "Hero — Expanded.png",
      mimeType: "image/png",
    };
    const result = {
      requestId: request.requestId,
      action: "expand",
      sourceAssetId: sourceAsset.id,
      asset: resultAsset,
      supportingAssets: [maskAsset],
      derivation: {
        id: "image_derivation_expand",
        sourceAssetId: sourceAsset.id,
        resultAssetId: resultAsset.id,
        operation: "expand",
        prompt: "Extend the image naturally",
        maskAssetId: maskAsset.id,
        referenceAssetIds: [],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    };
    expect(isDesignImageEditResult(result)).toBe(true);
    expect(
      isDesignImageEditResult({
        ...result,
        asset: { ...resultAsset, mimeType: "image/jpeg" },
      }),
    ).toBe(false);
  });

  it("accepts a parameter-free resolution boost and exact upscale provenance", () => {
    const request = {
      requestId: "image_upscale_request",
      action: "upscale",
      pageId: "page_welcome",
      nodeId: "hero",
      expectedAssetId: sourceAsset.id,
      source: sourceAsset,
    };
    expect(isDesignImageEditRequest(request)).toBe(true);
    expect(isDesignImageEditRequest({ ...request, scale: 4 })).toBe(false);

    const resultAsset = {
      ...sourceAsset,
      id: `asset_${"3".repeat(64)}`,
      name: "Hero — Resolution boosted.png",
      mimeType: "image/png",
      size: { width: 2_560, height: 1_440 },
    };
    const result = {
      requestId: request.requestId,
      action: "upscale",
      sourceAssetId: sourceAsset.id,
      asset: resultAsset,
      derivation: {
        id: "image_derivation_upscale",
        sourceAssetId: sourceAsset.id,
        resultAssetId: resultAsset.id,
        operation: "upscale",
        referenceAssetIds: [],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    };
    expect(isDesignImageEditResult(result)).toBe(true);
    expect(
      isDesignImageEditResult({
        ...result,
        derivation: { ...result.derivation, prompt: "Upscale" },
      }),
    ).toBe(false);
    expect(
      isDesignImageEditResult({
        ...result,
        asset: { ...resultAsset, mimeType: "image/jpeg" },
      }),
    ).toBe(false);
  });
});

describe("Font binary desktop API guards", () => {
  const descriptor = {
    byteSize: 12,
    fontId: `font_${"a".repeat(64)}`,
    format: "ttf",
    name: "NotoSans.ttf",
  } as const;

  it("accepts path-free descriptors, bounded bytes, and stable read requests", () => {
    expect(isFontBinaryDescriptor(descriptor)).toBe(true);
    expect(
      isFontBinaryPayload({ ...descriptor, bytes: new Uint8Array(12) }),
    ).toBe(true);
    expect(isFontBinaryReadRequest({ fontId: descriptor.fontId })).toBe(true);
  });

  it("rejects paths, size drift, and arbitrary identifiers", () => {
    expect(
      isFontBinaryDescriptor({ ...descriptor, path: "/tmp/NotoSans.ttf" }),
    ).toBe(false);
    expect(
      isFontBinaryPayload({ ...descriptor, bytes: new Uint8Array(11) }),
    ).toBe(false);
    expect(isFontBinaryReadRequest({ fontId: "../../font.ttf" })).toBe(false);
  });
});

function designFileDescriptor() {
  return {
    designFileId: "design_mobile",
    documentId: "document_welcome",
    name: "Mobile UI",
    relativePath: "designs/mobile-ui.opendesign",
    createdAt: now,
    updatedAt: now,
    lifecycle: "active" as const,
  };
}

describe("Project desktop API guards", () => {
  it("accepts path-free Project identity and rejects renderer paths", () => {
    expect(
      isCreateProjectRequest({
        projectId: "project_acme",
      }),
    ).toBe(true);
    expect(
      isCreateProjectRequest({
        projectId: "project_acme",
        name: "Acme Design",
      }),
    ).toBe(false);
    expect(
      isCreateProjectRequest({
        projectId: "project_acme",
        rootPath: "/tmp/Acme Design",
      }),
    ).toBe(false);
  });

  it("validates Project manifests and path-free recent entries", () => {
    expect(
      isProjectManifestResult({
        manifestVersion: PROJECT_MANIFEST_VERSION,
        projectId: "project_acme",
        name: "Acme Design",
        createdAt: now,
        updatedAt: now,
        lifecycle: "active",
        designFiles: [],
      }),
    ).toBe(true);
    expect(
      isRecentProject({
        projectId: "project_acme",
        name: "Acme Design",
        lastOpenedAt: now,
      }),
    ).toBe(true);
    expect(
      isRecentProject({
        projectId: "project_acme",
        name: "Acme Design",
        lastOpenedAt: now,
        rootPath: "/tmp/Acme Design",
      }),
    ).toBe(false);
  });

  it("validates structured design-file requests and document identity", () => {
    const document = createWelcomeDocument();
    const descriptor = designFileDescriptor();
    expect(
      isCreateProjectDesignFileRequest({
        projectId: "project_acme",
        descriptor,
        document,
      }),
    ).toBe(true);
    expect(isProjectDesignFile({ descriptor, document })).toBe(true);
    expect(
      isProjectDesignFileRequest({
        projectId: "project_acme",
        designFileId: "design_mobile",
      }),
    ).toBe(true);
    expect(
      isSaveProjectDesignFileRequest({
        projectId: "project_acme",
        designFileId: "design_mobile",
        document,
      }),
    ).toBe(true);
    expect(
      isRenameProjectDesignFileRequest({
        projectId: "project_acme",
        designFileId: "design_mobile",
        name: "Launch poster",
      }),
    ).toBe(true);

    const substituted = structuredClone(document);
    substituted.documentId = "document_other";
    expect(
      isCreateProjectDesignFileRequest({
        projectId: "project_acme",
        descriptor,
        document: substituted,
      }),
    ).toBe(false);
  });

  it("rejects arbitrary paths and unknown privileged fields", () => {
    expect(
      isProjectDesignFileRequest({
        projectId: "project_acme",
        designFileId: "design_mobile",
        path: "/tmp/forged.opendesign",
      }),
    ).toBe(false);
    expect(
      isSaveProjectDesignFileRequest({
        projectId: "project_acme",
        designFileId: "design_mobile",
        document: createWelcomeDocument(),
        rootPath: "/tmp/Acme Design",
      }),
    ).toBe(false);
    expect(
      isRenameProjectDesignFileRequest({
        projectId: "project_acme",
        designFileId: "design_mobile",
        name: " Forged name ",
      }),
    ).toBe(false);
    expect(
      isRenameProjectDesignFileRequest({
        projectId: "project_acme",
        designFileId: "design_mobile",
        name: "Launch poster",
        path: "/tmp/forged.opendesign",
      }),
    ).toBe(false);
  });
});

describe("Conversation desktop API guards", () => {
  it("accepts path-free creation and deletion requests", () => {
    expect(
      isCreateConversationRequest({
        conversationId: "conversation_mobile",
        filedProjectId: "project_acme",
        title: "Refine the mobile experience",
      }),
    ).toBe(true);
    expect(
      isDeleteConversationRequest({ conversationId: "conversation_mobile" }),
    ).toBe(true);
  });

  it("rejects paths, forged lifecycle state, and unknown fields", () => {
    expect(
      isCreateConversationRequest({
        conversationId: "conversation_mobile",
        filedProjectId: "project_acme",
        title: "Refine the mobile experience",
        rootPath: "/tmp/Acme Design",
      }),
    ).toBe(false);
    expect(
      isCreateConversationRequest({
        conversationId: "conversation_mobile",
        filedProjectId: "project_acme",
        title: "Refine the mobile experience",
        lifecycle: "active",
      }),
    ).toBe(false);
    expect(
      isDeleteConversationRequest({
        conversationId: "conversation_mobile",
        includeDeleted: true,
      }),
    ).toBe(false);
  });

  it("validates complete Conversation and Global Task results", () => {
    const document = createWelcomeDocument();
    const pageId = document.pageOrder[0];
    if (!pageId) throw new Error("Welcome document must contain a page");
    const primaryTarget = {
      targetId: "target_mobile",
      projectId: "project_acme",
      designFileId: "design_mobile",
      documentId: document.documentId,
      pageId,
      selectedNodeIds: [],
      baseRevision: document.revision,
    };
    const conversation = {
      conversationId: "conversation_mobile",
      originProjectId: "project_acme",
      filedProjectId: "project_acme",
      title: "Refine the mobile experience",
      createdAt: now,
      updatedAt: now,
      lifecycle: "active",
    };
    const task = {
      version: WORKSPACE_CONTRACT_VERSION,
      taskId: "task_mobile",
      conversationId: conversation.conversationId,
      runId: "run_mobile",
      title: conversation.title,
      lifecycle: "running",
      targetSet: { targets: [primaryTarget], primaryTarget },
      createdAt: now,
      updatedAt: now,
    };

    expect(isConversationDescriptorResult(conversation)).toBe(true);
    expect(isGlobalTaskProjectionResult(task)).toBe(true);
    expect(
      isConversationDescriptorResult({
        ...conversation,
        rootPath: "/tmp/Acme Design",
      }),
    ).toBe(false);
    expect(
      isGlobalTaskProjectionResult({ ...task, lifecycle: "unknown" }),
    ).toBe(false);
  });
});

describe("isSaveDesignFileRequest", () => {
  it("accepts bounded document contents and a local file name", () => {
    expect(
      isSaveDesignFileRequest({
        suggestedName: "Untitled",
        contents: '{"format":"dev.opendesign.document"}',
      }),
    ).toBe(true);
  });

  it("allows Save As without accepting renderer-selected paths", () => {
    expect(
      isSaveDesignFileRequest({
        suggestedName: "Untitled",
        contents: "{}",
        saveAs: true,
      }),
    ).toBe(true);
  });

  it("rejects paths, control characters, and unknown privileged fields", () => {
    expect(
      isSaveDesignFileRequest({
        suggestedName: "../outside.opendesign",
        contents: "{}",
      }),
    ).toBe(false);
    expect(
      isSaveDesignFileRequest({
        suggestedName: "Untitled\u0000.opendesign",
        contents: "{}",
      }),
    ).toBe(false);
    expect(
      isSaveDesignFileRequest({
        suggestedName: "Untitled",
        contents: "{}",
        path: "/tmp/forged.opendesign",
      }),
    ).toBe(false);
  });

  it("rejects empty and oversized documents", () => {
    expect(
      isSaveDesignFileRequest({ suggestedName: "Untitled", contents: "" }),
    ).toBe(false);
    expect(
      isSaveDesignFileRequest({
        suggestedName: "Untitled",
        contents: "x".repeat(64 * 1024 * 1024 + 1),
      }),
    ).toBe(false);
  });
});

describe("SVG file desktop API guards", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" />';

  it("accepts path-free bounded open and save values", () => {
    expect(isOpenSvgFile({ name: "Brand.svg", contents: svg })).toBe(true);
    expect(
      isSaveSvgFileRequest({ suggestedName: "Brand mark", contents: svg }),
    ).toBe(true);
    expect(isSaveSvgFileResult({ name: "Brand mark.SVG" })).toBe(true);
  });

  it("rejects renderer paths, controls, unknown fields, and non-SVG results", () => {
    expect(
      isSaveSvgFileRequest({
        suggestedName: "../Brand.svg",
        contents: svg,
      }),
    ).toBe(false);
    expect(
      isSaveSvgFileRequest({
        suggestedName: "Brand\u0000.svg",
        contents: svg,
      }),
    ).toBe(false);
    expect(
      isSaveSvgFileRequest({
        suggestedName: "Brand",
        contents: svg,
        filePath: "C:\\Users\\designer\\Brand.svg",
      }),
    ).toBe(false);
    expect(
      isOpenSvgFile({
        name: "Brand.svg",
        contents: svg,
        path: "/tmp/Brand.svg",
      }),
    ).toBe(false);
    expect(isSaveSvgFileResult({ name: "Brand.png" })).toBe(false);
    for (const suggestedName of ["CON.svg", "Brand.", "Brand:final.svg"]) {
      expect(isSaveSvgFileRequest({ suggestedName, contents: svg })).toBe(
        false,
      );
    }
  });

  it("rejects empty and over-budget SVG text", () => {
    expect(isSaveSvgFileRequest({ suggestedName: "Brand", contents: "" })).toBe(
      false,
    );
    expect(
      isSaveSvgFileRequest({
        suggestedName: "Brand",
        contents: "x".repeat(2_000_001),
      }),
    ).toBe(false);
  });
});

describe("raster file desktop API guards", () => {
  const request = {
    suggestedName: "Poster",
    format: "webp",
    mimeType: "image/webp",
    bytes: new Uint8Array([1, 2, 3]),
    width: 1600,
    height: 900,
  };

  it("accepts only exact path-free encoded image requests and metadata", () => {
    expect(isSaveRasterFileRequest(request)).toBe(true);
    expect(isSaveRasterFileResult({ name: "Poster.webp", byteSize: 3 })).toBe(
      true,
    );
    expect(
      isSaveRasterFileRequest({ ...request, filePath: "/tmp/Poster.webp" }),
    ).toBe(false);
    expect(isSaveRasterFileRequest({ ...request, mimeType: "image/png" })).toBe(
      false,
    );
    expect(isSaveRasterFileRequest({ ...request, width: 20_000 })).toBe(false);
  });
});
