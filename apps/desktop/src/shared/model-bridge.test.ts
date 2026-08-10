import { describe, expect, it } from "vitest";
import { DESIGN_AGENT_TOOL_SPECS } from "./design-agent-tools";
import { isModelBridgeRequest } from "./model-bridge";

const attachmentId = `image_${"a".repeat(64)}`;
const documentId = `file_${"b".repeat(64)}`;

function requestWith(content: unknown, tools: unknown[] = []) {
  return {
    type: "model.request",
    requestId: "request_1",
    request: {
      attemptId: "attempt_1",
      sessionId: "conversation_1",
      modelSelection: {
        providerId: "provider_1",
        modelId: "vision-model",
        reasoningEffort: "off",
      },
      system: "OpenDesign visual design agent",
      messages: [{ role: "user", content }],
      tools,
    },
  };
}

describe("Model bridge request guard", () => {
  it("accepts a bounded content-addressed image reference", () => {
    expect(
      isModelBridgeRequest(
        requestWith([
          { type: "text", text: "Use this visual direction" },
          {
            type: "image_ref",
            attachmentId,
            name: "reference.png",
            mimeType: "image/png",
            byteSize: 1024,
          },
        ]),
      ),
    ).toBe(true);
  });

  it("accepts a bounded content-addressed document reference", () => {
    expect(
      isModelBridgeRequest(
        requestWith([
          { type: "text", text: "Use the attached product brief" },
          {
            type: "document_ref",
            attachmentId: documentId,
            name: "product-brief.md",
            mimeType: "text/markdown",
            byteSize: 2048,
          },
        ]),
      ),
    ).toBe(true);
  });

  it("rejects paths and mismatched attachment kinds", () => {
    expect(
      isModelBridgeRequest(
        requestWith([
          {
            type: "document_ref",
            attachmentId: "../../product-brief.md",
            name: "product-brief.md",
            mimeType: "text/markdown",
            byteSize: 2048,
          },
        ]),
      ),
    ).toBe(false);
    expect(
      isModelBridgeRequest(
        requestWith([
          {
            type: "document_ref",
            attachmentId,
            name: "product-brief.md",
            mimeType: "text/markdown",
            byteSize: 2048,
          },
        ]),
      ),
    ).toBe(false);
  });

  it("rejects inline image data submitted by the Agent utility process", () => {
    expect(
      isModelBridgeRequest(
        requestWith([
          { type: "text", text: "Use this visual direction" },
          {
            type: "image",
            data: "aW1hZ2UtYnl0ZXM=",
            mimeType: "image/png",
          },
        ]),
      ),
    ).toBe(false);
  });

  it("accepts the complete production design tool contract", () => {
    const request = requestWith(
      "Create a structured design",
      DESIGN_AGENT_TOOL_SPECS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    );

    expect(isModelBridgeRequest(request)).toBe(true);
  });

  it("rejects an excessive aggregate tool payload", () => {
    const request = requestWith(
      "Create a structured design",
      Array.from({ length: 8 }, (_, index) => ({
        name: `tool_${index}`,
        description: "Bounded test tool",
        inputSchema: {
          type: "object",
          description: "x".repeat(300_000),
        },
      })),
    );

    expect(isModelBridgeRequest(request)).toBe(false);
  });
});
