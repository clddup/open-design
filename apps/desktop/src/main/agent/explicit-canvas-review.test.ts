import { describe, expect, it } from "vitest";
import type {
  AgentImageAttachment,
  TrustedToolContext,
} from "@opendesign/agent-contracts";
import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import type { InspectedHierarchy } from "./design-plan-registration";
import {
  resolveExplicitCanvasReview,
  type ExplicitCanvasReviewEvidence,
} from "./explicit-canvas-review";

const context: TrustedToolContext = {
  runId: "run_followup",
  sessionId: "conversation",
  documentId: "document",
  revision: 5,
  scope: { kind: "page", pageId: "page_home", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_home" },
};
const attachment: AgentImageAttachment = {
  attachmentId: `image_${"a".repeat(64)}`,
  name: "reference.png",
  mimeType: "image/png",
  byteSize: 100,
};
const binding: ExplicitCanvasReviewEvidence = {
  prompt: "继续审核现有首页",
  modelSelection: {
    providerId: "provider",
    modelId: "model",
    reasoningEffort: "high",
  },
  userRequirements: [
    {
      messageId: "original",
      content: "设计中文首页，保留品牌色",
      documents: [],
    },
    { messageId: "followup", content: "继续审核现有首页", documents: [] },
  ],
  imageAttachments: [attachment],
};

function inspection(): InspectedHierarchy {
  const node = (id: string, parentId: string | null, kind = "frame") => ({
    id,
    parentId,
    kind,
    childIds: [] as string[],
    componentId: null,
    locked: false,
    size: { width: 400, height: 800 },
    transform: [1, 0, 0, 1, 0, 0] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
  });
  return {
    documentId: context.documentId,
    revision: context.revision,
    componentsById: new Map(),
    catalogComponentsById: new Map(),
    pageRootsById: new Map([
      ["page_home", new Set(["home"])],
      ["page_other", new Set(["other"])],
    ]),
    nodesById: new Map([
      ["home", node("home", null)],
      ["nested", node("nested", "home")],
      ["text", node("text", "home", "text")],
      ["other", node("other", null)],
    ]),
  };
}

function failureCause(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error.cause;
    throw error;
  }
  throw new Error("Expected explicit review validation to fail");
}

describe("explicit canvas review", () => {
  it("reviews an existing nested Frame without a Plan and preserves all user evidence", () => {
    const current = inspection();
    const before = structuredClone(current);
    const result = resolveExplicitCanvasReview({
      context,
      inspection: current,
      binding,
      target: {
        frameId: "nested",
        deliverable: "ui",
        referenceAttachmentIds: [attachment.attachmentId],
      },
    });
    expect(result.captureTarget).toEqual({
      kind: "frame",
      pageId: "page_home",
      nodeId: "nested",
    });
    expect(result.criticContext.plan).toEqual({
      deliverable: "ui",
      objective: binding.prompt,
      skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS,
    });
    expect(result.criticContext.userRequirements).toEqual(
      binding.userRequirements,
    );
    expect(result.criticContext.referenceAttachments).toEqual([attachment]);
    expect(current).toEqual(before);
    result.criticContext.userRequirements![0].content = "changed";
    result.criticContext.referenceAttachments[0].name = "changed";
    expect(binding.userRequirements[0].content).toBe(
      "设计中文首页，保留品牌色",
    );
    expect(attachment.name).toBe("reference.png");
  });

  it("does not select all attachments or invent quality semantics by default", () => {
    const result = resolveExplicitCanvasReview({
      context,
      inspection: inspection(),
      binding,
      target: { frameId: "home", deliverable: "ui" },
    });
    expect(result.criticContext.referenceAttachments).toEqual([]);
    expect(result.criticContext.target.qualityProfile).toBeUndefined();
    expect(result.captureTarget).not.toHaveProperty("qualityProfile");
  });

  it("forwards the declared quality profile to both capture and critic without sharing caller state", () => {
    const qualityProfile = {
      kind: "ui" as const,
      platform: "ios" as const,
      interactionMode: "touch" as const,
      safeAreaInsets: { top: 24, right: 0, bottom: 16, left: 0 },
      safeAreaNodeIds: ["text"],
      interactiveNodeIds: ["nested"],
    };
    const result = resolveExplicitCanvasReview({
      context,
      inspection: inspection(),
      binding,
      target: { frameId: "home", deliverable: "ui", qualityProfile },
    });
    expect(result.captureTarget).toMatchObject({ qualityProfile });
    expect(result.criticContext.target.qualityProfile).toEqual(qualityProfile);
    qualityProfile.safeAreaNodeIds.push("new_layer");
    expect(result.criticContext.target.qualityProfile).toMatchObject({
      safeAreaNodeIds: ["text"],
    });
  });

  it.each([
    ["missing", "design_target_stale"],
    ["text", "design_target_stale"],
    ["other", "design_scope_conflict"],
  ])("rejects unavailable or unauthorized target %s", (frameId, code) => {
    expect(
      failureCause(() =>
        resolveExplicitCanvasReview({
          context,
          inspection: inspection(),
          binding,
          target: { frameId, deliverable: "ui" },
        }),
      ),
    ).toMatchObject({
      code,
      details: { issues: [{ path: "/target/frameId" }] },
    });
  });

  it("resolves the unique inspected Page for an explicitly document-wide Run", () => {
    const documentContext: TrustedToolContext = {
      ...context,
      scope: { kind: "document", selectedNodeIds: [] },
      mutationTarget: { kind: "document" },
    };
    const result = resolveExplicitCanvasReview({
      context: documentContext,
      inspection: inspection(),
      binding,
      target: { frameId: "other", deliverable: "ui" },
    });
    expect(result.captureTarget).toEqual({
      kind: "frame",
      pageId: "page_other",
      nodeId: "other",
    });
  });

  it("requires the inspection to match the current document revision", () => {
    const stale = inspection();
    stale.revision -= 1;
    expect(
      failureCause(() =>
        resolveExplicitCanvasReview({
          context,
          inspection: stale,
          binding,
          target: { frameId: "home", deliverable: "ui" },
        }),
      ),
    ).toMatchObject({ code: "design_revision_conflict" });
  });

  it("rejects an undeclared attachment with its exact request path", () => {
    expect(
      failureCause(() =>
        resolveExplicitCanvasReview({
          context,
          inspection: inspection(),
          binding,
          target: {
            frameId: "home",
            deliverable: "ui",
            referenceAttachmentIds: ["image_unknown"],
          },
        }),
      ),
    ).toMatchObject({
      code: "design_reference_unavailable",
      details: { issues: [{ path: "/target/referenceAttachmentIds/0" }] },
    });
  });
});
