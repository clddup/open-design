import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  canDeleteNodes,
  createWelcomeDocument,
} from "./index.js";
import { planCreateBooleanGroup } from "./boolean-operations.js";
import {
  navigateBooleanSelection,
  resolveBooleanEditScope,
} from "./selection-navigation.js";

function createBooleanDocument() {
  const runtime = new EditorRuntime(createWelcomeDocument());
  const plan = planCreateBooleanGroup(
    runtime.getSnapshot().document,
    "page_welcome",
    ["feature_one", "feature_two"],
    "subtract",
    {
      booleanId: "boolean_cards",
      commandPrefix: "boolean_cards",
      name: "Boolean cards",
    },
  );
  if (!plan.ok) throw new Error(plan.message);
  const applied = runtime.apply({
    actor: { type: "user", id: "selection-test" },
    baseRevision: 0,
    commands: plan.commands,
    documentId: "document_welcome",
    label: "Create Boolean",
    transactionId: "create_boolean_cards",
  });
  if (!applied.ok) throw new Error(applied.error.message);
  return runtime.getSnapshot().document;
}

describe("Boolean nested selection navigation", () => {
  it("derives transient editable scope only from direct operands of one Boolean", () => {
    const document = createBooleanDocument();
    expect(
      resolveBooleanEditScope(document, "page_welcome", ["feature_one"]),
    ).toEqual({
      booleanId: "boolean_cards",
      operandIds: ["feature_one", "feature_two"],
      readOnly: false,
      selectedOperandIds: ["feature_one"],
    });
    expect(
      resolveBooleanEditScope(document, "page_welcome", [
        "feature_one",
        "feature_two",
      ]),
    ).toMatchObject({ booleanId: "boolean_cards", readOnly: false });
    expect(
      resolveBooleanEditScope(document, "page_welcome", ["feature_three"]),
    ).toBeNull();
    expect(
      resolveBooleanEditScope(document, "missing_page", ["feature_one"]),
    ).toBeNull();
  });

  it("enters the top visible operand, traverses siblings, and exits to the Boolean", () => {
    const document = createBooleanDocument();
    expect(
      navigateBooleanSelection(
        document,
        "page_welcome",
        ["boolean_cards"],
        "enter",
      ),
    ).toBe("feature_two");
    expect(
      navigateBooleanSelection(
        document,
        "page_welcome",
        ["feature_one"],
        "next-operand",
      ),
    ).toBe("feature_two");
    expect(
      navigateBooleanSelection(
        document,
        "page_welcome",
        ["feature_two"],
        "previous-operand",
      ),
    ).toBe("feature_one");
    expect(
      navigateBooleanSelection(
        document,
        "page_welcome",
        ["feature_two"],
        "next-operand",
      ),
    ).toBeNull();
    expect(
      navigateBooleanSelection(
        document,
        "page_welcome",
        ["feature_one"],
        "exit",
      ),
    ).toBe("boolean_cards");
  });

  it("keeps inherited-locked operands inspectable while marking the scope read-only", () => {
    const document = structuredClone(createBooleanDocument());
    const boolean = document.nodesById.boolean_cards;
    if (!boolean || boolean.kind !== "boolean") {
      throw new Error("Missing Boolean fixture");
    }
    boolean.locked = true;
    expect(
      resolveBooleanEditScope(document, "page_welcome", ["feature_one"]),
    ).toMatchObject({ booleanId: "boolean_cards", readOnly: true });
    expect(
      navigateBooleanSelection(
        document,
        "page_welcome",
        ["boolean_cards"],
        "enter",
      ),
    ).toBe("feature_two");
    expect(canDeleteNodes(document, ["feature_one"])).toBe(false);
    expect(canDeleteNodes(document, ["boolean_cards"])).toBe(false);
  });

  it("prevents invalid two-operand deletion while allowing deletion of an unlocked Boolean", () => {
    const document = createBooleanDocument();
    expect(canDeleteNodes(document, ["feature_one"])).toBe(false);
    expect(canDeleteNodes(document, ["feature_one", "feature_two"])).toBe(
      false,
    );
    expect(canDeleteNodes(document, ["boolean_cards"])).toBe(true);
  });
});
