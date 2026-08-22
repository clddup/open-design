import type { DesignOperation } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { applyComponentSourceCommand } from "./component-source-command-executor.js";
import { createWelcomeDocument } from "./document.js";
import { OperationError } from "./operation-error.js";

describe("component source command executor", () => {
  it("owns local component registration and deletion", () => {
    const document = structuredClone(createWelcomeDocument());
    expect(
      applyComponentSourceCommand(document, {
        commandId: "put_component",
        type: "put_component",
        component: {
          id: "component_welcome",
          name: "Welcome",
          rootNodeId: "frame_welcome",
          componentPropertyOrder: [],
          componentPropertyDefinitions: {},
          variantProperties: {},
          extensions: {},
        },
      }),
    ).toBe(true);
    expect(document.componentsById.component_welcome?.rootNodeId).toBe(
      "frame_welcome",
    );

    expect(
      applyComponentSourceCommand(document, {
        commandId: "delete_component",
        type: "delete_component",
        componentId: "component_welcome",
      }),
    ).toBe(true);
    expect(document.componentsById.component_welcome).toBeUndefined();
  });

  it("rejects rebinding an existing component identity", () => {
    const document = structuredClone(createWelcomeDocument());
    const component: Extract<
      DesignOperation,
      { type: "put_component" }
    >["component"] = {
      id: "component_welcome",
      name: "Welcome",
      rootNodeId: "frame_welcome",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    applyComponentSourceCommand(document, {
      commandId: "put_component",
      type: "put_component",
      component,
    });

    expect(() =>
      applyComponentSourceCommand(document, {
        commandId: "rebind_component",
        type: "put_component",
        component: { ...component, rootNodeId: "feature_group" },
      }),
    ).toThrowError(OperationError);
    expect(document.componentsById.component_welcome?.rootNodeId).toBe(
      "frame_welcome",
    );
  });

  it("declines commands owned by other executors", () => {
    const document = structuredClone(createWelcomeDocument());
    const command: DesignOperation = {
      commandId: "update_page",
      type: "update_page",
      pageId: "page_welcome",
      name: "Renamed",
    };

    expect(applyComponentSourceCommand(document, command)).toBe(false);
  });
});
