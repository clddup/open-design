import { describe, expect, it } from "vitest";
import type { DesignDeliveryScope } from "@/shared/design-agent-tools.js";
import type { InspectedHierarchy } from "./design-plan-registration.js";
import {
  bindFirstSliceToScopeAllocation,
  createScopeArtboardAllocation,
} from "./delivery-scope-artboard-allocation.js";
import { firstSliceInput } from "./design-first-slice-tool-handler.fixture.js";

describe("delivery scope artboard allocation", () => {
  it("creates twelve real prefixed Frames in one non-overlapping transaction", () => {
    const inspection = inspectedPage();
    const allocation = createScopeArtboardAllocation(
      scope(12),
      "page_current",
      inspection,
    );

    expect(allocation.artboards).toHaveLength(12);
    expect(allocation.input.commands).toHaveLength(12);
    expect(allocation.artboards[0]).toMatchObject({
      frameId: "run_scope_scope_1",
      x: 1760,
      y: 80,
    });
    expect(
      allocation.artboards.every((artboard) =>
        artboard.frameId.startsWith("run_scope_"),
      ),
    ).toBe(true);
    expect(hasOverlap(allocation.artboards)).toBe(false);
    expect(
      allocation.input.commands.every(
        (command) =>
          command.type === "insert_element" && command.parentId === null,
      ),
    ).toBe(true);
  });

  it("rebinds the submitted root and only its direct planned regions to the allocated Frame", () => {
    const input = firstSliceInput();
    input.targets[0].targetId = "target_1";
    input.firstSlice.targetId = "target_1";
    input.targets[0].regions.push({
      nodeId: "home_form",
      name: "Form",
      role: "interaction",
      parentId: "home_hero",
      x: 24,
      y: 120,
      width: 294,
      height: 96,
    });
    const allocation = {
      targetId: "target_1",
      label: "Screen 1",
      pageId: "page_current",
      frameId: "run_scope_scope_1",
      x: 1760,
      y: 80,
      width: 1440,
      height: 960,
    };

    const bound = bindFirstSliceToScopeAllocation(
      scope(1),
      new Map([["target_1", allocation]]),
      input,
    );

    expect(bound.targets[0]).toMatchObject({
      pageId: "page_current",
      frame: {
        frameId: "run_scope_scope_1",
        x: 1760,
        y: 80,
        width: 1440,
        height: 960,
      },
      regions: [
        { nodeId: "home_hero", parentId: "run_scope_scope_1" },
        { nodeId: "home_form", parentId: "home_hero" },
      ],
    });
    expect(bound.firstSlice.stages[0].elements[0].parentId).toBe("home_hero");
    expect(input.targets[0].frame.frameId).toBe("frame_home");
  });
});

function scope(count: number): DesignDeliveryScope {
  return {
    version: 1,
    deliverable: "ui",
    objective: "Design the complete product suite",
    targets: Array.from({ length: count }, (_, index) => ({
      targetId: `target_${index + 1}`,
      label: `Screen ${index + 1}`,
      objective: `Design the complete screen ${index + 1}`,
      artboard: {
        width: index % 2 === 0 ? 1440 : 1280,
        height: index % 3 === 0 ? 960 : 900,
      },
      requiredContent: [`Screen ${index + 1} content`],
    })),
    exclusions: [],
    assumptions: [],
  };
}

function inspectedPage(): InspectedHierarchy {
  return {
    catalogComponentsById: new Map(),
    componentsById: new Map(),
    documentId: "document_scope",
    newNodeIdPrefix: "run_scope_",
    nodesById: new Map([
      [
        "existing_root",
        {
          childIds: [],
          componentId: null,
          id: "existing_root",
          kind: "frame",
          locked: false,
          parentId: null,
          size: { width: 1600, height: 1000 },
          transform: [1, 0, 0, 1, 0, 80],
        },
      ],
    ]),
    pageRootsById: new Map([["page_current", new Set(["existing_root"])]]),
    revision: 4,
  };
}

function hasOverlap(
  artboards: readonly {
    x: number;
    y: number;
    width: number;
    height: number;
  }[],
): boolean {
  return artboards.some((left, index) =>
    artboards
      .slice(index + 1)
      .some(
        (right) =>
          left.x < right.x + right.width &&
          left.x + left.width > right.x &&
          left.y < right.y + right.height &&
          left.y + left.height > right.y,
      ),
  );
}
