import type { DesignOperation } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import {
  applyTextCommand,
  inspectTextFontAvailability,
} from "./text-command-executor.js";

describe("text command executor", () => {
  it("owns explicit text range mutation without requiring a provider for fixed text", () => {
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    expect(title?.kind).toBe("text");
    if (title?.kind !== "text") return;

    expect(
      applyTextCommand(
        document,
        {
          commandId: "style_title",
          type: "update_text_range_style",
          nodeId: title.id,
          start: 0,
          end: title.properties.content.length,
          style: { fontWeight: 700 },
        },
        { warnings: [] },
      ),
    ).toBe(true);
    expect(title.properties.runs).toHaveLength(1);
    const run = title.properties.runs?.[0];
    expect(run?.start).toBe(0);
    expect(run?.end).toBe(title.properties.content.length);
    expect(run?.style.fontWeight).toBe(700);
  });

  it("returns bounded unknown font evidence before providers are ready", () => {
    expect(
      inspectTextFontAvailability(undefined, {
        fontFamily: "Inter",
        fontStyleName: "Regular",
        fontWeight: 400,
        fontSlant: "normal",
      }),
    ).toEqual({
      status: "unknown",
      provider: "editor-runtime",
      providerVersion: "unavailable",
      message:
        "Font availability is unavailable until the canvas provider is ready",
    });
  });

  it("declines commands owned by other executors", () => {
    const document = structuredClone(createWelcomeDocument());
    const command: DesignOperation = {
      commandId: "update_page",
      type: "update_page",
      pageId: "page_welcome",
      name: "Renamed",
    };
    expect(applyTextCommand(document, command, { warnings: [] })).toBe(false);
  });
});
