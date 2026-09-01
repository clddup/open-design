import { describe, expect, it } from "vitest";
import { canonicalUserMessage } from "./model-message-projection.js";

describe("canonicalUserMessage", () => {
  it("exposes stable Conversation attachment IDs beside multimodal content", () => {
    const attachmentId = `image_${"a".repeat(64)}`;
    const message = canonicalUserMessage("Continue this design", [
      {
        attachmentId,
        name: "reference.png",
        mimeType: "image/png",
        byteSize: 4_096,
      },
    ]);

    const [textBlock, imageBlock] = message.content;
    expect(textBlock?.type).toBe("text");
    if (textBlock?.type !== "text") throw new Error("Expected text block");
    expect(textBlock.text).toContain(`attachmentId=${attachmentId}`);
    expect(imageBlock).toMatchObject({ type: "image_ref", attachmentId });
  });
});
