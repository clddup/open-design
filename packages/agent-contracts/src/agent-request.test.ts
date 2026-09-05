import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { ModelSelectionSchema as GatewayModelSelectionSchema } from "@opendesign/model-gateway/provider-config";
import {
  AgentAttachmentContract,
  AgentRequestContract,
  AgentRequestSchema,
  MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS,
  MAX_SELECTED_NODE_IDS,
  ModelSelectionSchema,
  ResolvedModelIdentityContract,
  SelectionScopeSchema,
  isAgentEvent,
  isAgentRequest,
  isSelectionScope,
} from "./index.js";

const validStart = {
  type: "run.start",
  runId: "run_1",
  sessionId: "session_1",
  prompt: "Align the selected layers",
  documentId: "document_1",
  revision: 4,
  modelSelection: {
    providerId: "provider_1",
    modelId: "design-model",
    reasoningEffort: "medium",
  },
  modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
  scope: {
    kind: "selection",
    selectedNodeIds: ["node_1", "node_2"],
    primaryNodeId: "node_1",
    pageId: "page_1",
  },
  mutationTarget: { kind: "page", pageId: "page_1" },
} as const;

describe("Agent request contract", () => {
  it("rejects the removed host intent-classification field", () => {
    expect(
      AgentRequestContract.parse({
        ...validStart,
        deliveryScopeReview: "required",
      }).ok,
    ).toBe(false);
  });

  it("reuses the canonical Model Gateway selection schema by identity", () => {
    expect(ModelSelectionSchema).toBe(GatewayModelSelectionSchema);
    expect(
      ResolvedModelIdentityContract.parse({
        providerId: "provider_1",
        modelId: "design-model",
        apiFormat: "openai-responses",
      }).ok,
    ).toBe(true);
    expect(
      ResolvedModelIdentityContract.parse({
        providerId: "provider_1",
        modelId: "",
        apiFormat: "openai-responses",
      }),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "resolved_model_identity.schema_invalid",
          path: "/modelId",
        }),
      ],
    });
  });

  it("accepts a strict host-bound selection snapshot", () => {
    expect(isAgentRequest(validStart)).toBe(true);
    expect(
      Value.Check(SelectionScopeSchema, {
        kind: "page",
        selectedNodeIds: ["node_1"],
        pageId: "page_1",
      }),
    ).toBe(true);
    expect(
      Value.Check(SelectionScopeSchema, {
        kind: "document",
        selectedNodeIds: [],
      }),
    ).toBe(true);
  });

  it("accepts bounded Main-owned continuation provenance", () => {
    const continuation = {
      parentRunId: "run_parent",
      rootRunId: "run_root",
      attempt: 1,
      maxAttempts: 3,
      reason: "budget",
    } as const;
    expect(isAgentRequest({ ...validStart, continuation })).toBe(true);
    expect(
      isAgentEvent({
        type: "run.started",
        runId: "run_next",
        startedAt: "2026-08-12T12:00:00.000Z",
        continuation,
      }),
    ).toBe(true);
    expect(
      isAgentRequest({
        ...validStart,
        continuation: { ...continuation, attempt: 4 },
      }),
    ).toBe(false);
    expect(
      isAgentEvent({
        type: "run.continuation",
        runId: "run_parent",
        status: "scheduled",
        attempt: 1,
        maxAttempts: 3,
        reason: "budget",
      }),
    ).toBe(false);
    expect(
      isAgentEvent({
        type: "run.continuation",
        runId: "run_parent",
        status: "scheduled",
        attempt: 1,
        maxAttempts: 3,
        reason: "budget",
        nextRunId: "run_next",
      }),
    ).toBe(true);
  });

  it("accepts only bounded host-resolved model context metadata", () => {
    expect(isAgentRequest(validStart)).toBe(true);
    expect(
      isAgentRequest({
        ...validStart,
        modelContext: { contextWindow: 1_000, maxOutputTokens: 128 },
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        modelContext: {
          contextWindow: 200_000,
          maxOutputTokens: 16_384,
          apiKey: "forged",
        },
      }),
    ).toBe(false);
  });

  it("rejects the removed generation-mode switch", () => {
    expect(isAgentRequest({ ...validStart, generationMode: "fast" })).toBe(
      false,
    );
  });

  it("accepts only an exact-revision bounded Main inspection snapshot", () => {
    const initialDesignInspection = {
      version: 1,
      observedRevision: validStart.revision,
      content: {
        inspection: { pageId: "page_1", revision: validStart.revision },
      },
    } as const;
    expect(isAgentRequest({ ...validStart, initialDesignInspection })).toBe(
      true,
    );
    expect(
      isAgentRequest({
        ...validStart,
        initialDesignInspection: {
          ...initialDesignInspection,
          observedRevision: validStart.revision + 1,
        },
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        initialDesignInspection: {
          ...initialDesignInspection,
          content: {
            inspection: {
              notice: "x".repeat(MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS + 1),
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        initialDesignInspection: {
          ...initialDesignInspection,
          sourcePath: "/private/document.opendesign",
        },
      }),
    ).toBe(false);

    expect(
      AgentRequestContract.issues({
        ...validStart,
        initialDesignInspection: {
          ...initialDesignInspection,
          observedRevision: validStart.revision + 1,
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "agent_request.initial_inspection_revision_mismatch",
        path: "/initialDesignInspection/observedRevision",
      }),
    );
    expect(
      AgentRequestContract.issues({
        ...validStart,
        initialDesignInspection: {
          ...initialDesignInspection,
          content: {
            inspection: {
              notice: "x".repeat(MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS + 1),
            },
          },
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "agent_initial_inspection.content_size_invalid",
        path: "/initialDesignInspection/content",
      }),
    );
  });

  it("reports the exact Page scope path for a mismatched mutation target", () => {
    expect(
      AgentRequestContract.issues({
        ...validStart,
        scope: { ...validStart.scope, pageId: "page_other" },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "agent_request.page_scope_mismatch",
        path: "/scope/pageId",
      }),
    );
  });

  it("accepts only bounded content-addressed image, document, and SVG handles", () => {
    const imageAttachment = {
      attachmentId: `image_${"a".repeat(64)}`,
      name: "inspiration.png",
      mimeType: "image/png",
      byteSize: 1024,
    } as const;
    const documentAttachment = {
      attachmentId: `file_${"b".repeat(64)}`,
      name: "product-brief.md",
      mimeType: "text/markdown",
      byteSize: 2048,
    } as const;
    const svgAttachment = {
      attachmentId: `svg_${"c".repeat(64)}`,
      name: "brand-mark.svg",
      mimeType: "image/svg+xml",
      byteSize: 4096,
    } as const;

    expect(
      isAgentRequest({
        ...validStart,
        attachments: [imageAttachment, documentAttachment, svgAttachment],
      }),
    ).toBe(true);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: [
          { ...imageAttachment, attachmentId: "../../private.png" },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: Array.from({ length: 7 }, (_, index) => ({
          ...imageAttachment,
          attachmentId: `image_${String(index).repeat(64)}`,
        })),
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: [
          { ...documentAttachment, mimeType: "application/octet-stream" },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: [
          {
            ...documentAttachment,
            attachmentId: `image_${"b".repeat(64)}`,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: [
          { ...svgAttachment, attachmentId: `file_${"c".repeat(64)}` },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRequest({
        ...validStart,
        attachments: [{ ...svgAttachment, mimeType: "text/plain" }],
      }),
    ).toBe(false);
    expect(
      AgentAttachmentContract.issues({
        ...imageAttachment,
        mimeType: "text/plain",
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "agent_attachment.schema_invalid",
        path: "/mimeType",
      }),
    );
  });

  it("rejects extra cross-process properties, duplicates, and oversized selections", () => {
    expect(
      Value.Check(AgentRequestSchema, { ...validStart, unexpected: true }),
    ).toBe(false);
    expect(
      Value.Check(AgentRequestSchema, {
        ...validStart,
        scope: { ...validStart.scope, unexpected: true },
      }),
    ).toBe(false);
    expect(
      isSelectionScope({
        kind: "selection",
        selectedNodeIds: ["node_1", "node_1"],
      }),
    ).toBe(false);
    expect(
      isSelectionScope({
        kind: "selection",
        selectedNodeIds: Array.from(
          { length: MAX_SELECTED_NODE_IDS + 1 },
          (_, index) => `node_${index}`,
        ),
      }),
    ).toBe(false);
  });

  it("requires a primary node to belong to the selected node IDs", () => {
    const semanticMismatch = {
      ...validStart.scope,
      primaryNodeId: "node_elsewhere",
    };

    expect(Value.Check(SelectionScopeSchema, semanticMismatch)).toBe(true);
    expect(isSelectionScope(semanticMismatch)).toBe(false);
    expect(isAgentRequest({ ...validStart, scope: semanticMismatch })).toBe(
      false,
    );
  });

  it("keeps selection context separate from the immutable write target", () => {
    expect(
      isAgentRequest({
        ...validStart,
        scope: {
          ...validStart.scope,
          selectedNodeIds: ["node_2"],
          primaryNodeId: "node_2",
        },
      }),
    ).toBe(true);
    expect(
      isAgentRequest({
        ...validStart,
        mutationTarget: { kind: "page", pageId: "page_other" },
      }),
    ).toBe(false);
  });
});
