import { FatalAgentRunError } from "./fatal-agent-run-error";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification";
import type { TrustedToolContext } from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import type { DesignGenerationToolInput } from "@/shared/design-agent-tools.js";
import {
  DESIGN_EDIT_TOOL_NAME,
  DESIGN_GENERATION_TOOL_NAME,
  DESIGN_FONT_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_SYSTEM_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import {
  designGenerationInput,
  designGenerationModelInput,
} from "./design-generation-tool-handler.fixture.js";
import { parseDesignToolInput } from "./design-tool-input-parser.js";

const context: TrustedToolContext = {
  runId: "run_parser",
  sessionId: "conversation_parser",
  documentId: "document_parser",
  revision: 4,
  scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_1" },
};

function coordinator() {
  const input = designGenerationInput();
  return {
    assertDesignToolContext: vi.fn(),
    authoritativeDesignPrompt: vi.fn(() => "Create a focused home screen"),
    designGenerationTargetBinding: vi.fn(() => ({
      targetId: "home",
      label: "Home",
      objective: "Show the product value immediately",
      pageId: "page_1",
      frame: { frameId: "frame_home", x: 80, y: 40 },
    })),
    input,
  };
}

describe("parseDesignToolInput", () => {
  it("keeps missing or mismatched Run identity fatal before accessing tools", () => {
    const host = coordinator();
    host.assertDesignToolContext.mockImplementation(() => {
      throw new Error("Run identity mismatch");
    });
    expect(() =>
      parseDesignToolInput(
        host as never,
        {
          toolCallId: "bad_context",
          toolName: DESIGN_GENERATION_TOOL_NAME,
          input: {},
        },
        context,
      ),
    ).toThrow(FatalAgentRunError);
    expect(host.designGenerationTargetBinding).not.toHaveBeenCalled();
  });

  it.each(["context", "binding"])(
    "preserves the exact recoverable %s failure",
    (stage) => {
      const host = coordinator();
      const error = designWorkflowError(
        stage === "context" ? "revision_conflict" : "delivery_scope_mismatch",
        "Inspect the current target",
      );
      const reject = () => {
        throw error;
      };
      if (stage === "context")
        host.assertDesignToolContext.mockImplementation(reject);
      else host.designGenerationTargetBinding.mockImplementation(reject);
      let caught: unknown;
      try {
        parseDesignToolInput(
          host as never,
          {
            toolCallId: "recoverable",
            toolName: DESIGN_GENERATION_TOOL_NAME,
            input: {},
          },
          context,
        );
      } catch (failure) {
        caught = failure;
      }
      expect(caught).toBe(error);
    },
  );

  it("binds one Design Generation to trusted Run identity before dispatch", () => {
    const host = coordinator();
    const result = parseDesignToolInput(
      host as never,
      {
        toolCallId: "design_generation",
        toolName: DESIGN_GENERATION_TOOL_NAME,
        input: designGenerationModelInput(host.input),
      },
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as DesignGenerationToolInput;
    expect(value.targets[0]).toMatchObject({
      targetId: "home",
      pageId: "page_1",
      frame: { frameId: "frame_home", x: 80, y: 40 },
      qualityProfile: { kind: "ui" },
    });
    const element = value.designGeneration.elements.find((candidate) =>
      candidate.id.endsWith("hero_title"),
    );
    expect(element?.id).toMatch(/^odr_run_parser_/);
    expect(element?.parentId).toMatch(/^odr_run_parser_/);
    expect(host.assertDesignToolContext).toHaveBeenCalledWith(context);
  });

  it.each([
    {
      name: "nested Edit geometry",
      toolName: DESIGN_EDIT_TOOL_NAME,
      input: {
        label: "Invalid",
        edits: [
          {
            kind: "arrange",
            input: {
              action: "resize-frame",
              label: "Resize",
              pageId: "page_1",
              frameId: "frame_1",
              width: 0,
              height: 720,
            },
          },
        ],
      },
      path: "/edits/0/input/width",
    },
    {
      name: "image size",
      toolName: GENERATE_IMAGE_TOOL_NAME,
      input: { prompt: "Too large", role: "hero", size: "8192x8192" },
      path: "/size",
    },
    {
      name: "export filename",
      toolName: EXPORT_SVG_TOOL_NAME,
      input: {
        pageId: "page_1",
        rootNodeIds: ["logo"],
        suggestedName: "../logo.svg",
        includeLayerIds: true,
        padding: 0,
      },
      path: "/suggestedName",
    },
    {
      name: "Page identity",
      toolName: DESIGN_PAGE_TOOL_NAME,
      input: { action: "delete", label: "Delete Page" },
      path: "/pageId",
    },
    {
      name: "design-system discriminant branch",
      toolName: DESIGN_SYSTEM_TOOL_NAME,
      input: {
        kind: "variable",
        input: {
          action: "set-mode",
          label: "Invalid target",
          pageId: "page_1",
          target: { kind: "node", nodeId: "title" },
          collectionId: "theme",
          modeId: "dark",
        },
      },
      path: "/input/target/id",
    },
    {
      name: "font branch fields",
      toolName: DESIGN_FONT_TOOL_NAME,
      input: {
        action: "reflow",
        label: "Reflow heading",
        pageId: "page_1",
        nodeIds: ["heading"],
        expectedFont: {
          fontFamily: "Inter",
          fontStyleName: "Regular",
          fontWeight: 400,
          fontSlant: "normal",
        },
        replacementFont: {
          fontFamily: "Arial",
          fontStyleName: "Regular",
          fontWeight: 400,
          fontSlant: "normal",
        },
      },
      path: "/replacementFont",
    },
    {
      name: "vector segment position",
      toolName: DESIGN_VECTOR_TOOL_NAME,
      input: {
        action: "cut-path",
        label: "Cut logo",
        pageId: "page_1",
        nodeId: "logo_path",
        pathId: "outer_path",
        at: { kind: "segment", segmentId: "curve" },
      },
      path: "/at/t",
    },
  ])("returns the exact field for $name", ({ toolName, input, path }) => {
    const result = parseDesignToolInput(
      coordinator() as never,
      { toolCallId: "invalid", toolName, input },
      context,
    );

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Expected invalid input");
    expect(result.issues).toContainEqual(expect.objectContaining({ path }));
  });
});
