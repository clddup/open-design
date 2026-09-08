import { describe, expect, it } from "vitest";
import {
  MAX_TRANSACTION_COMMANDS,
  schemaValidationIssues,
} from "@opendesign/design-contracts";
import { DesignPlanContract } from "./design-agent-tools";
import {
  DesignGenerationContract,
  compileDesignGenerationToolInput,
} from "./design-generation-tool";

const target = {
  targetId: "poster",
  pageId: "page",
  frame: { frameId: "artboard", x: 0, y: 0 },
};

function shape(id: string, parentId?: string) {
  return {
    id,
    kind: "rectangle",
    name: id,
    ...(parentId === undefined ? {} : { parentId }),
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    fills: [{ type: "solid", color: "#336699", opacity: 1 }],
  };
}

function payload(elements: unknown[]) {
  return {
    deliverable: "poster",
    targets: [{ frame: { width: 800, height: 600 } }],
    rasterAssetRoles: [],
    designGeneration: { label: "Create poster", elements },
  };
}

describe("single authored generation hierarchy", () => {
  it.each([
    { opacity: 0 },
    { kind: "frame" },
    { fills: [{ type: "solid", color: "#336699", opacity: 0 }] },
    {
      fills: [],
      strokes: [{ type: "solid", color: "#336699", opacity: 1 }],
      strokeWidth: 0,
    },
  ])(
    "rejects an empty or invisible batch before Main execution: %j",
    (appearance) => {
      const parsed = DesignGenerationContract.parse(
        payload([{ ...shape("empty"), ...appearance }]),
        { target },
      );
      expect(parsed.ok).toBe(false);
      if (parsed.ok) throw new Error("Expected material rejection");
      expect(parsed.issues).toContainEqual(
        expect.objectContaining({
          code: "design_generation.material_required",
          path: "/designGeneration/elements",
        }),
      );
    },
  );
  it("rejects properties from a different element kind in both projections", () => {
    const input = payload([{ ...shape("rectangle"), clipsContent: true }]);
    expect(
      schemaValidationIssues(DesignGenerationContract.schema, input).length,
    ).toBeGreaterThan(0);
    const parsed = DesignGenerationContract.parse(input, { target });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("Expected kind-specific field rejection");
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        path: "/designGeneration/elements/0/clipsContent",
      }),
    );
  });
  it("accepts a flat composition without injecting any container", () => {
    const input = payload([shape("background"), shape("foreground")]);
    expect(
      schemaValidationIssues(DesignGenerationContract.schema, input),
    ).toEqual([]);
    const parsed = DesignGenerationContract.parse(input, { target });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(
      parsed.value.designGeneration.elements.map((element) => element.parentId),
    ).toEqual(["artboard", "artboard"]);
    const compiled = compileDesignGenerationToolInput(parsed.value);
    expect(compiled.plan.targets[0].composition.regions).toEqual([]);
    expect(
      DesignPlanContract.parse(compiled.plan, { canonical: true }).ok,
    ).toBe(true);
    expect(compiled.apply.commands).toMatchObject([
      { index: 0, node: { id: "background", kind: "rectangle" } },
      { index: 1, node: { id: "foreground", kind: "rectangle" } },
    ]);
    expect(parsed.value.targets[0]).not.toHaveProperty("regions");
  });

  it("preserves mixed top-level layers and more than twelve authored containers", () => {
    const elements = [
      shape("background"),
      ...Array.from({ length: 17 }, (_, index) => [
        { ...shape(`group_${index}`), kind: "group", fills: [] },
        shape(`child_${index}`, `group_${index}`),
      ]).flat(),
      shape("foreground"),
    ];
    const parsed = DesignGenerationContract.parse(payload(elements), {
      target,
      newNodeIdPrefix: "odr_run_",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const compiled = compileDesignGenerationToolInput(parsed.value);
    expect(compiled.apply.commands).toHaveLength(elements.length);
    expect(compiled.apply.commands[1]).toMatchObject({
      parentId: "artboard",
      index: 1,
      node: { kind: "group", id: "odr_run_6_poster_group_0" },
    });
    expect(compiled.apply.commands[2]).toMatchObject({
      parentId: "odr_run_6_poster_group_0",
      index: 0,
    });
    expect(compiled.apply.commands.at(-1)).toMatchObject({
      parentId: "artboard",
      index: 18,
    });
  });

  it.each([
    {
      name: "self-parent",
      elements: [shape("self", "self")],
      index: 0,
      code: "parent_not_available",
    },
    {
      name: "forward-parent",
      elements: [
        shape("child", "later"),
        { ...shape("later"), kind: "group", fills: [] },
      ],
      index: 0,
      code: "parent_not_available",
    },
    {
      name: "non-container",
      elements: [shape("shape"), shape("child", "shape")],
      index: 1,
      code: "parent_not_container",
    },
  ])(
    "reports the authored parent field for $name",
    ({ elements, index, code }) => {
      const parsed = DesignGenerationContract.parse(payload(elements), {
        target,
      });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) throw new Error("Expected invalid hierarchy");
      expect(parsed.issues).toContainEqual(
        expect.objectContaining({
          code: `design_generation.${code}`,
          path: `/designGeneration/elements/${index}/parentId`,
        }),
      );
    },
  );

  it("reserves exactly one transaction operation for the artboard", () => {
    const elements = Array.from(
      { length: MAX_TRANSACTION_COMMANDS - 1 },
      (_, index) => shape(`layer_${index}`),
    );
    const accepted = payload(elements);
    expect(
      schemaValidationIssues(DesignGenerationContract.schema, accepted),
    ).toEqual([]);
    expect(DesignGenerationContract.parse(accepted, { target }).ok).toBe(true);
    const overflow = payload([...elements, shape("extra")]);
    expect(
      schemaValidationIssues(DesignGenerationContract.schema, overflow).length,
    ).toBeGreaterThan(0);
    const rejected = DesignGenerationContract.parse(overflow, { target });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("Expected transaction overflow");
    expect(rejected.issues[0].path).toBe("/designGeneration/elements");
  });
});
