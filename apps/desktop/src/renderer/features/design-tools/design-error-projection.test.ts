import type {
  DesignError,
  DesignOperation,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { projectDesignFailureIssues } from "./design-error-projection";

describe("design error projection", () => {
  it("preserves supported structured fields and command attribution", () => {
    const commands: DesignOperation[] = [
      {
        commandId: "resize_card",
        type: "update_properties",
        nodeId: "card",
        size: { width: 320, height: 240 },
      },
    ];
    const error: DesignError = {
      code: "invalid",
      message: "Invalid card layout",
      retryable: false,
      issues: [
        {
          code: "design.layout.width_invalid",
          path: "/nodesById/card/size/width",
          message: "Card width exceeds its parent",
          expected: 280,
          actual: 320,
          recovery: "Reduce the card width to fit its parent.",
        },
      ],
    };

    expect(projectDesignFailureIssues(error, commands)).toEqual([
      {
        code: "design.layout.width_invalid",
        commandId: "resize_card",
        nodeId: "card",
        path: "/nodesById/card/size/width",
        message: "Card width exceeds its parent",
        expected: 280,
        actual: 320,
        recovery: "Reduce the card width to fit its parent.",
      },
    ]);
  });

  it("omits nested values that the Agent failure contract cannot represent", () => {
    const error: DesignError = {
      code: "invalid",
      message: "Invalid nested metadata",
      retryable: false,
      issues: [
        {
          code: "design.metadata_invalid",
          path: "/nodesById/card/extensions",
          message: "Nested metadata is not supported by the failure event",
          expected: { theme: { name: "dark" } },
          actual: "nested",
        },
      ],
    };

    expect(projectDesignFailureIssues(error, [])).toEqual([
      {
        code: "design.metadata_invalid",
        nodeId: "card",
        path: "/nodesById/card/extensions",
        message: "Nested metadata is not supported by the failure event",
        actual: "nested",
      },
    ]);
  });
});
